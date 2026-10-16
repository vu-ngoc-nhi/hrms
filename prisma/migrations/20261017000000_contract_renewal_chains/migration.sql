-- Phase 2A slice 2A-5 — renewal chains (PV-39 → C-115; gate docs/design/phase2a-slice-2a-5-renewal-gate.md rev. 3).
-- Forward-only, no data change. Replaces the 2A-1 rule "the parent of a renewal has no parent itself", which blocked
-- A → B → C: a renewal is an agreement and may be renewed again. Adds the renewable-parent rules, the "renewal starts
-- after its parent" rule and a parent guard, and names the invariant precisely:
--   ONE NON-DISPOSED DIRECT RENEWAL PER PARENT AGREEMENT — disposed = Discarded or Cancelled (cancelled_at) or Voided.
-- Existing renewal rows are VALIDATED against the approved model; the migration fails only on incompatible data.

-- ===================== (1) Validation of existing renewal rows =====================
-- Reusable (also callable by checks/tests); returns one row per violation of the approved renewal model.
CREATE FUNCTION contract_renewal_model_violations() RETURNS TABLE (contract_id uuid, violation text)
LANGUAGE sql STABLE AS $$
  -- Parent is an amendment (never a valid renewal parent).
  SELECT c.id, 'parent_is_amendment' FROM contract c JOIN contract p ON p.id = c.parent_contract_id
  WHERE c.relationship_type = 'renewal' AND p.relationship_type = 'amendment'
  UNION ALL
  -- Parent in another Employment Period (the composite FK forbids it; checked for completeness).
  SELECT c.id, 'cross_period_parent' FROM contract c JOIN contract p ON p.id = c.parent_contract_id
  WHERE c.relationship_type = 'renewal' AND p.employment_id <> c.employment_id
  UNION ALL
  -- Branching: more than one non-disposed direct renewal of the same parent.
  SELECT c.id, 'branching' FROM contract c
  WHERE c.relationship_type = 'renewal' AND c.cancelled_at IS NULL AND c.voided_at IS NULL
    AND (SELECT count(*) FROM contract s WHERE s.parent_contract_id = c.parent_contract_id AND s.relationship_type = 'renewal'
           AND s.cancelled_at IS NULL AND s.voided_at IS NULL) > 1
  UNION ALL
  -- A non-disposed renewal whose parent is not a renewable agreement (Draft, disposed, open-ended or without Effective To).
  SELECT c.id, 'parent_not_renewable' FROM contract c JOIN contract p ON p.id = c.parent_contract_id
  WHERE c.relationship_type = 'renewal' AND c.cancelled_at IS NULL AND c.voided_at IS NULL
    AND (p.finalized_at IS NULL OR p.cancelled_at IS NOT NULL OR p.voided_at IS NOT NULL OR p.is_open_ended OR p.effective_to IS NULL)
  UNION ALL
  -- A renewal that does not start after its parent.
  SELECT c.id, 'starts_before_parent' FROM contract c JOIN contract p ON p.id = c.parent_contract_id
  WHERE c.relationship_type = 'renewal' AND c.effective_from IS NOT NULL AND p.effective_from IS NOT NULL
    AND c.effective_from <= p.effective_from
$$;
REVOKE ALL ON FUNCTION contract_renewal_model_violations() FROM PUBLIC;
COMMENT ON FUNCTION contract_renewal_model_violations() IS
  'Rows violating the approved renewal model (C-115). Empty on a consistent database.';

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(violation || ':' || contract_id::text, ', ') INTO bad FROM contract_renewal_model_violations();
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'existing renewal rows violate the approved renewal model (C-115): %', bad;
  END IF;
END $$;

-- ===================== (2) Invariant naming (definition unchanged) =====================
ALTER INDEX contract_one_live_renewal_uq RENAME TO contract_one_nondisposed_renewal_uq;
COMMENT ON INDEX contract_one_nondisposed_renewal_uq IS
  'One non-disposed direct renewal per parent agreement (disposed = Discarded, Cancelled or Voided). No branching.';

-- ===================== (3) Structural rules: same body as 2A-1 except the parent block =====================
CREATE OR REPLACE FUNCTION contract_structural_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p_start date;
  p_end date;
  p_cancelled timestamptz;
  p_voided timestamptz;
  check_dates boolean;
  check_validity boolean;
  parent contract%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_contract_id IS DISTINCT FROM OLD.parent_contract_id OR NEW.relationship_type IS DISTINCT FROM OLD.relationship_type THEN
      RAISE EXCEPTION 'the relationship of a contract cannot be changed (constraint "contract_link_immutable")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_link_immutable';
    END IF;
    IF OLD.finalized_at IS NOT NULL AND NEW.employment_id IS DISTINCT FROM OLD.employment_id THEN
      RAISE EXCEPTION 'the employment period of a finalized contract cannot be changed (constraint "contract_employment_fixed_after_finalize")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_employment_fixed_after_finalize';
    END IF;
  END IF;

  IF NEW.parent_contract_id IS NOT NULL THEN
    -- Read-locked so a concurrent Return to Draft / Cancel / Void / correction of the parent serializes with this write.
    SELECT * INTO parent FROM contract WHERE id = NEW.parent_contract_id FOR SHARE;
    IF TG_OP = 'INSERT' THEN
      -- Any agreement (original or renewal) may be renewed; an amendment never (C-115).
      IF parent.relationship_type = 'amendment' THEN
        RAISE EXCEPTION 'the parent of a renewal must be an agreement (constraint "contract_parent_is_agreement")'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_is_agreement';
      END IF;
      -- Renewable parent: Finalized or Signed, not disposed, finite term.
      IF parent.finalized_at IS NULL OR parent.cancelled_at IS NOT NULL OR parent.voided_at IS NOT NULL
         OR parent.is_open_ended OR parent.effective_to IS NULL THEN
        RAISE EXCEPTION 'the parent contract cannot be renewed (constraint "contract_parent_renewable")'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_renewable';
      END IF;
    END IF;
    -- A renewal starts after the contract it renews (whenever its Effective From is written or it is finalized).
    IF NEW.effective_from IS NOT NULL AND parent.effective_from IS NOT NULL AND NEW.effective_from <= parent.effective_from
       AND (TG_OP = 'INSERT' OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
            OR (OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'a renewal must start after its parent (constraint "contract_renewal_starts_after_parent")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_renewal_starts_after_parent';
    END IF;
  END IF;

  check_validity := TG_OP = 'INSERT' OR (OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL)
                    OR NEW.employment_id IS DISTINCT FROM OLD.employment_id;
  check_dates := NEW.effective_from IS NOT NULL AND (
                   TG_OP = 'INSERT' OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
                   OR NEW.employment_id IS DISTINCT FROM OLD.employment_id
                   OR (OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL));
  IF check_validity OR check_dates THEN
    -- Serializes with a concurrent period correction / cancellation / void of the same period.
    SELECT e.start_date, e.end_date, e.cancelled_at, e.voided_at INTO p_start, p_end, p_cancelled, p_voided
    FROM employment e WHERE e.id = NEW.employment_id FOR SHARE;
    IF check_validity AND (p_cancelled IS NOT NULL OR p_voided IS NOT NULL) THEN
      RAISE EXCEPTION 'the employment period is cancelled or voided (constraint "contract_period_valid")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_period_valid';
    END IF;
    IF check_dates AND (NEW.effective_from < p_start OR (p_end IS NOT NULL AND NEW.effective_from > p_end)) THEN
      RAISE EXCEPTION 'contract effective_from outside its employment period (constraint "contract_effective_from_within_period")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_effective_from_within_period';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ===================== (4) Parent guard: a parent with a non-disposed direct renewal =====================
-- cannot be Cancelled, Voided or returned to Draft, cannot become open-ended / lose its Effective To, and cannot move
-- its Effective From onto or after the renewal's start. Nothing cascades: HR deals with the renewal first.
CREATE FUNCTION contract_parent_with_renewal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  child_from date;
  has_child boolean;
BEGIN
  SELECT true, min(c.effective_from) INTO has_child, child_from
  FROM contract c
  WHERE c.parent_contract_id = OLD.id AND c.relationship_type = 'renewal' AND c.cancelled_at IS NULL AND c.voided_at IS NULL
  HAVING count(*) > 0;
  IF has_child IS NULL THEN
    RETURN NEW;
  END IF;
  IF (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL) OR (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL)
     OR (OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS NULL) THEN
    RAISE EXCEPTION 'a contract with a non-disposed renewal cannot be cancelled, voided or returned to draft (constraint "contract_parent_has_renewal")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_has_renewal';
  END IF;
  IF NEW.is_open_ended OR NEW.effective_to IS NULL THEN
    RAISE EXCEPTION 'a renewed contract keeps a finite term (constraint "contract_parent_renewable")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_renewable';
  END IF;
  IF child_from IS NOT NULL AND NEW.effective_from IS DISTINCT FROM OLD.effective_from AND NEW.effective_from >= child_from THEN
    RAISE EXCEPTION 'a renewal must start after its parent (constraint "contract_renewal_starts_after_parent")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_renewal_starts_after_parent';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_parent_with_renewal_guard_trg
  BEFORE UPDATE ON contract
  FOR EACH ROW EXECUTE FUNCTION contract_parent_with_renewal_guard();
