-- Phase 2A slice 2A-2 (owner decision 2026-10-16, C-111): a contract whose Employment Period is VOIDED is read-only
-- for normal lifecycle actions. The period was declared erroneous (C-86), so nothing may keep mutating contracts under
-- it — only its own dispositions may still be set (Discard a Draft = cancelled_at; Void a finalized record =
-- voided_at), so HR can clean up. A CANCELLED period is different: recording a true fact such as the signature date
-- stays possible there (the contract remains non-operational). Forward, additive: one trigger, no data change.
CREATE FUNCTION contract_voided_parent_read_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.employment_id, NEW.parent_contract_id, NEW.relationship_type, NEW.contract_type_id, NEW.contract_number,
      NEW.effective_from, NEW.effective_to, NEW.is_open_ended, NEW.summary, NEW.finalized_at, NEW.finalized_by, NEW.signed_at)
     IS NOT DISTINCT FROM
     (OLD.employment_id, OLD.parent_contract_id, OLD.relationship_type, OLD.contract_type_id, OLD.contract_number,
      OLD.effective_from, OLD.effective_to, OLD.is_open_ended, OLD.summary, OLD.finalized_at, OLD.finalized_by, OLD.signed_at) THEN
    RETURN NEW; -- disposition / bookkeeping only (cancelled_at, voided_at, revision, updated_at)
  END IF;
  IF EXISTS (SELECT 1 FROM employment e WHERE e.id = OLD.employment_id AND e.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a contract under a voided employment period is read-only (constraint "contract_voided_parent_read_only")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contract_voided_parent_read_only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_voided_parent_read_only_trg
  BEFORE UPDATE ON contract
  FOR EACH ROW EXECUTE FUNCTION contract_voided_parent_read_only();
