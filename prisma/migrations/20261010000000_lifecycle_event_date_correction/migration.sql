-- S4.6 (C-43): employment_event.effective_date is the corrected business-effective date of a lifecycle event.
-- When HR_ADMIN corrects a period start or end date, the existing `start` / `end` event date is synced in the same
-- transaction. Forward migration, non-destructive: no data is changed.
--
-- Minimum permission: the application role may update ONLY the effective_date column. employment_event stays
-- insert-only for every other column (actor, reason, recorded timestamp, type, period).
GRANT UPDATE (effective_date) ON employment_event TO hrms_app;

-- Scope guard: only `start` and `end` events can have their date corrected, and nothing else may change in the row
-- (also protects against a broader grant being added later by mistake).
CREATE FUNCTION employment_event_date_correction_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_type NOT IN ('start', 'end') THEN
    RAISE EXCEPTION 'only start and end lifecycle event dates can be corrected'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_event_date_correction_scope';
  END IF;
  IF (NEW.id, NEW.employment_id, NEW.event_type, NEW.reason, NEW.recorded_at, NEW.recorded_by)
     IS DISTINCT FROM (OLD.id, OLD.employment_id, OLD.event_type, OLD.reason, OLD.recorded_at, OLD.recorded_by) THEN
    RAISE EXCEPTION 'only effective_date of a lifecycle event can be corrected'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_event_date_correction_scope';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER employment_event_date_correction_scope_trg
  BEFORE UPDATE ON employment_event
  FOR EACH ROW EXECUTE FUNCTION employment_event_date_correction_scope();
