-- Phase 2A slice 2A-1 — Contract foundation (ADR-0005; decisions C-104 … C-109, M-15 … M-18).
-- Forward, additive and non-destructive: three new tables, an extended audit allow-list and new permission rows in
-- the policy mirror. No existing row is changed or transformed; Phase 1 tables, triggers and grants are untouched.
-- A Contract documents terms of ONE Employment Period; nothing here changes employment, assignment or person data.

-- ===================== Contract Type (reference data only) =====================
-- Catalog like the Organization catalogs: code set once, deactivated never deleted. Deliberately no behaviour flags
-- (no fixed-term/open-ended, salary, notice, renewal or legal rule): the real catalog is pending (PV-31, PL-12).
CREATE TABLE contract_type (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL CHECK (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  name_vi     text CHECK (name_vi IS NULL OR char_length(btrim(name_vi)) BETWEEN 1 AND 150),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contract_type_code_ci_uq ON contract_type (lower(code));
COMMENT ON TABLE contract_type IS
  'Contract Type catalog (reference data, not contract content). No business rules live on this table (C-104, M-16).';

-- ===================== Contract (agreements; renewals link to their parent) =====================
-- Document state is derived from markers, never stored as a status: Draft = finalized_at IS NULL; Finalized =
-- content locked from normal editing; Signed = signed_at set. Time state (upcoming/active/expired) is computed.
-- Cancelled / Voided are mutually exclusive terminal dispositions.
CREATE TABLE contract (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_id       uuid NOT NULL REFERENCES employment(id),
  parent_contract_id  uuid,
  -- Phase 2A admits renewal links only; 'amendment' is added by a forward migration after its checkpoint (C-109).
  relationship_type   text CHECK (relationship_type IN ('renewal')),
  contract_type_id    uuid REFERENCES contract_type(id),
  -- Stored trimmed of surrounding whitespace by the application; unique case-insensitively (index below).
  contract_number     text CHECK (contract_number IS NULL OR (char_length(contract_number) BETWEEN 1 AND 100
                                   AND contract_number !~ '^\s' AND contract_number !~ '\s$')),
  effective_from      date,
  effective_to        date,                     -- inclusive, like employment.end_date
  is_open_ended       boolean NOT NULL DEFAULT false,
  summary             text CHECK (summary IS NULL OR char_length(btrim(summary)) BETWEEN 1 AND 1000),
  finalized_at        timestamptz,
  finalized_by        uuid REFERENCES app_user(id),
  signed_at           date,                     -- business date HR confirms full execution (C-105); not a timestamp
  cancelled_at        timestamptz,
  voided_at           timestamptz,
  revision            integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Target of the same-period parent FK below.
  CONSTRAINT contract_id_employment_uq UNIQUE (id, employment_id),
  -- A renewal's parent belongs to the SAME Employment Period (composite FK; NULL parent = original agreement).
  CONSTRAINT contract_parent_same_period_fk FOREIGN KEY (parent_contract_id, employment_id) REFERENCES contract (id, employment_id),
  CONSTRAINT contract_relationship_pair_ck CHECK ((parent_contract_id IS NULL) = (relationship_type IS NULL)),
  CONSTRAINT contract_not_own_parent_ck CHECK (parent_contract_id IS DISTINCT FROM id),
  -- Effective To and Open-ended are mutually exclusive; Effective To never precedes Effective From.
  CONSTRAINT contract_term_exclusive_ck CHECK (NOT (is_open_ended AND effective_to IS NOT NULL)),
  CONSTRAINT contract_dates_ck CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  -- A Finalized record carries the M-16 required fields: type, number, Effective From, Effective To OR Open-ended.
  CONSTRAINT contract_finalized_complete_ck CHECK (finalized_at IS NULL OR (
    contract_type_id IS NOT NULL AND contract_number IS NOT NULL AND effective_from IS NOT NULL
    AND (effective_to IS NOT NULL OR is_open_ended))),
  CONSTRAINT contract_finalized_by_ck CHECK ((finalized_at IS NULL) = (finalized_by IS NULL)),
  CONSTRAINT contract_signed_requires_finalized_ck CHECK (signed_at IS NULL OR finalized_at IS NOT NULL),
  CONSTRAINT contract_single_disposition_ck CHECK (cancelled_at IS NULL OR voided_at IS NULL),
  -- Void applies to Finalized/Signed records only; a Draft that is not needed is discarded (= Cancelled).
  CONSTRAINT contract_void_requires_finalized_ck CHECK (voided_at IS NULL OR finalized_at IS NOT NULL)
);
COMMENT ON COLUMN contract.signed_at IS
  'Business date on which HR confirms the contract has been fully executed by all required parties (C-105). Who recorded it and when lives in contract_history_event / audit. Not-in-the-future is checked by the service against the Asia/Ho_Chi_Minh business date.';
COMMENT ON COLUMN contract.effective_to IS 'Inclusive last day of the contract term; NULL while Draft or when is_open_ended.';

-- M-18: once assigned, a number is unique across the WHOLE register — no disposition is excluded, so a Cancelled
-- (discarded) or Voided record keeps its number. Case folding uses ICU so it does not depend on the database's
-- default collation (Vietnamese letters such as Đ/đ fold correctly).
CREATE UNIQUE INDEX contract_number_ci_uq ON contract (lower(contract_number COLLATE "und-x-icu"));
-- At most one live renewal per agreement (C-104): a cancelled/voided renewal frees the slot.
CREATE UNIQUE INDEX contract_one_live_renewal_uq ON contract (parent_contract_id)
  WHERE relationship_type = 'renewal' AND cancelled_at IS NULL AND voided_at IS NULL;
CREATE INDEX contract_employment_idx ON contract (employment_id);
CREATE INDEX contract_type_idx ON contract (contract_type_id);

-- ===================== Structural rules that need other rows =====================
-- (1) Effective From lies inside the linked Employment Period (start_date <= effective_from <= end_date when the
--     period has an end date). Checked when the date or the period link is written, and when a record is finalized;
--     Created/Finalized/Signed timestamps are never compared with the period. An Ended period is valid.
--     Later Phase 1 period corrections are NOT blocked (C-107): a contract that falls outside afterwards is surfaced
--     for review, so this rule lives on contract writes only.
-- (2) New records and finalization require a period that is neither Cancelled nor Voided.
-- (3) The parent of a renewal is an agreement (has no parent itself); the link is fixed once written.
-- (4) employment_id is fixed once the contract has been finalized.
CREATE FUNCTION contract_structural_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p_start date;
  p_end date;
  p_cancelled timestamptz;
  p_voided timestamptz;
  check_dates boolean;
  check_validity boolean;
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

  IF TG_OP = 'INSERT' AND NEW.parent_contract_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM contract c WHERE c.id = NEW.parent_contract_id AND c.parent_contract_id IS NOT NULL) THEN
      RAISE EXCEPTION 'the parent of a renewal must be an agreement (constraint "contract_parent_is_agreement")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_parent_is_agreement';
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
CREATE TRIGGER contract_structural_rules_trg
  BEFORE INSERT OR UPDATE ON contract
  FOR EACH ROW EXECUTE FUNCTION contract_structural_rules();

-- Cancelled / Voided are terminal: never inserted already disposed, never changed afterwards, and setting the marker
-- does not change the recorded content (evidence is kept as it was).
CREATE FUNCTION contract_disposition_is_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cancelled_at IS NOT NULL OR NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'a contract cannot be created cancelled or voided (constraint "contract_disposition_is_terminal")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_disposition_is_terminal';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.cancelled_at IS NOT NULL OR OLD.voided_at IS NOT NULL) AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'a cancelled or voided contract cannot be changed (constraint "contract_disposition_is_terminal")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_disposition_is_terminal';
  END IF;
  IF (NEW.cancelled_at IS NOT NULL OR NEW.voided_at IS NOT NULL)
     AND (NEW.employment_id, NEW.contract_type_id, NEW.contract_number, NEW.effective_from, NEW.effective_to,
          NEW.is_open_ended, NEW.summary, NEW.finalized_at, NEW.finalized_by, NEW.signed_at)
         IS DISTINCT FROM
         (OLD.employment_id, OLD.contract_type_id, OLD.contract_number, OLD.effective_from, OLD.effective_to,
          OLD.is_open_ended, OLD.summary, OLD.finalized_at, OLD.finalized_by, OLD.signed_at) THEN
    RAISE EXCEPTION 'cancelling or voiding a contract must not change its content (constraint "contract_disposition_is_terminal")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_disposition_is_terminal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_disposition_is_terminal_trg
  BEFORE INSERT OR UPDATE ON contract
  FOR EACH ROW EXECUTE FUNCTION contract_disposition_is_terminal();

-- ===================== Contract business history =====================
-- Business-readable history for HR (Recorded By / At, effective date where applicable, reason where relevant). Not
-- event sourcing and not the technical audit (audit_event). Append-only for the application role.
CREATE TABLE contract_history_event (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id          uuid NOT NULL REFERENCES contract(id),
  event_type           text NOT NULL CHECK (event_type IN (
                         'created', 'discarded', 'finalized', 'returned_to_draft', 'signed_confirmed',
                         'renewal_created', 'cancelled', 'corrected', 'voided')),
  effective_date       date,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  recorded_by          uuid NOT NULL REFERENCES app_user(id),
  reason               text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000),
  related_contract_id  uuid REFERENCES contract(id),
  -- Mandatory reasons (C-107, C-109).
  CONSTRAINT contract_history_event_reason_required_ck CHECK (
    event_type NOT IN ('returned_to_draft', 'cancelled', 'corrected', 'voided') OR reason IS NOT NULL),
  CONSTRAINT contract_history_event_related_ck CHECK (event_type <> 'renewal_created' OR related_contract_id IS NOT NULL)
);
CREATE INDEX contract_history_event_contract_idx ON contract_history_event (contract_id, recorded_at);

-- ===================== Technical audit: approved old/new fields (C-24 allow-list, ADR-0005 §12) =====================
-- Non-personal contract fields only; summary and reasons never get old/new values.
ALTER TABLE audit_field_change DROP CONSTRAINT audit_field_change_field_check;
ALTER TABLE audit_field_change ADD CONSTRAINT audit_field_change_field_check CHECK (field IN (
  'employee_type_id', 'department_id', 'job_title_id', 'job_level_id',
  'employment.start_date', 'employment.end_date',
  'assignment.effective_from', 'assignment.effective_to',
  'contract.contract_type_id', 'contract.contract_number', 'contract.effective_from', 'contract.effective_to',
  'contract.is_open_ended', 'contract.signed_at', 'contract.finalized_at'));

-- ===================== Permissions (C-106): policy mirror of ROLE_PERMISSIONS =====================
INSERT INTO access_role_permission (role_code, permission) VALUES
  ('HR_ADMIN', 'contracts.read'), ('HR_ADMIN', 'contracts.manage'), ('HR_ADMIN', 'contracts.finalize'), ('HR_ADMIN', 'contracts.correct'),
  ('HR_EDITOR', 'contracts.read'), ('HR_EDITOR', 'contracts.manage'), ('HR_EDITOR', 'contracts.finalize');

-- ===================== Grants: no DELETE anywhere; history is append-only =====================
GRANT SELECT, INSERT, UPDATE ON contract_type, contract TO hrms_app;
GRANT SELECT, INSERT ON contract_history_event TO hrms_app;
