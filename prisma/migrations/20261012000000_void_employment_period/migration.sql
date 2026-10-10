-- PV-25 Void Employment Period (design revision 2, approved 2026-10-10). Forward migration, non-destructive: adds a
-- nullable column (existing periods stay non-voided), narrows two exclusion constraints, and adds safety nets for the
-- approved rules "a voided period has no operational effect" and "Void is terminal". No data is transformed.

-- ===================== Void marker =====================
ALTER TABLE employment ADD COLUMN voided_at timestamptz;
COMMENT ON COLUMN employment.voided_at IS
  'Set when HR voids an effective period entered in error (PV-25). Actor and reason live in the employment_voided event and audit.';

-- Cancelled and Voided are mutually exclusive record dispositions.
ALTER TABLE employment ADD CONSTRAINT employment_single_disposition_ck CHECK (cancelled_at IS NULL OR voided_at IS NULL);

-- Voided periods no longer block another valid period of the same person...
ALTER TABLE employment DROP CONSTRAINT employment_no_overlap_ex;
ALTER TABLE employment ADD CONSTRAINT employment_no_overlap_ex
  EXCLUDE USING gist (person_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (cancelled_at IS NULL AND voided_at IS NULL);

-- ...and no longer reserve their Work Email.
ALTER TABLE employment DROP CONSTRAINT employment_work_email_period_ex;
ALTER TABLE employment ADD CONSTRAINT employment_work_email_period_ex
  EXCLUDE USING gist (lower(work_email) WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (work_email IS NOT NULL AND cancelled_at IS NULL AND voided_at IS NULL);

-- Dispositions are terminal: once cancelled or voided, the marker cannot be cleared or changed and the period's dates,
-- Employee Type, Work Email and person cannot be edited (history stays exactly as recorded).
CREATE OR REPLACE FUNCTION employment_cancelled_is_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL AND (
       NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
    OR NEW.start_date IS DISTINCT FROM OLD.start_date
    OR NEW.end_date IS DISTINCT FROM OLD.end_date
    OR NEW.employee_type_id IS DISTINCT FROM OLD.employee_type_id
    OR NEW.work_email IS DISTINCT FROM OLD.work_email
    OR NEW.person_id IS DISTINCT FROM OLD.person_id
  ) THEN
    RAISE EXCEPTION 'a cancelled employment period cannot be changed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_cancelled_is_terminal';
  END IF;
  IF OLD.voided_at IS NOT NULL AND (
       NEW.voided_at IS DISTINCT FROM OLD.voided_at
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.start_date IS DISTINCT FROM OLD.start_date
    OR NEW.end_date IS DISTINCT FROM OLD.end_date
    OR NEW.employee_type_id IS DISTINCT FROM OLD.employee_type_id
    OR NEW.work_email IS DISTINCT FROM OLD.work_email
    OR NEW.person_id IS DISTINCT FROM OLD.person_id
  ) THEN
    RAISE EXCEPTION 'a voided employment period cannot be changed (constraint "employment_voided_is_terminal")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_voided_is_terminal';
  END IF;
  RETURN NEW;
END $$;

-- ===================== employment_voided event =====================
ALTER TABLE employment_event DROP CONSTRAINT employment_event_event_type_check;
ALTER TABLE employment_event ADD CONSTRAINT employment_event_event_type_check
  CHECK (event_type IN ('start', 'suspend', 'resume', 'end', 'end_reversed', 'cancel_planned_start', 'employment_voided'));

-- At most one void event per period.
CREATE UNIQUE INDEX employment_event_one_void_uq ON employment_event (employment_id)
  WHERE event_type = 'employment_voided';

-- Messages of the new rules name their constraint, so the application can map them even when the database driver
-- does not expose the constraint field of a check_violation raised by a trigger.

-- Insert rules (extends C-51): a voided period accepts no further events except its single employment_voided event,
-- and that event requires the void marker to be set first in the same transaction. The period row is locked so an
-- event insert and a concurrent Void on the same period are serialized.
CREATE OR REPLACE FUNCTION employment_event_lifecycle_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
  period_voided_at timestamptz;
BEGIN
  SELECT voided_at INTO period_voided_at FROM employment WHERE id = NEW.employment_id FOR UPDATE;
  IF NEW.event_type = 'employment_voided' THEN
    IF period_voided_at IS NULL THEN
      RAISE EXCEPTION 'an employment_voided event requires the period to be voided (constraint "employment_event_void_requires_marker")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_event_void_requires_marker';
    END IF;
    RETURN NEW;
  END IF;
  IF period_voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'a voided employment period accepts no further lifecycle events (constraint "employment_event_after_void")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_event_after_void';
  END IF;
  IF NEW.event_type NOT IN ('end', 'end_reversed') THEN
    RETURN NEW;
  END IF;
  IF NEW.event_type = 'end_reversed' THEN
    SELECT employment_id, event_type INTO target FROM employment_event WHERE id = NEW.reverses_event_id;
    IF target IS NULL OR target.event_type <> 'end' OR target.employment_id <> NEW.employment_id THEN
      RAISE EXCEPTION 'an end_reversed event must reverse an end event of the same employment period'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_event_reversal_target';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM employment_event e
    WHERE e.employment_id = NEW.employment_id AND e.event_type = 'end'
      AND NOT EXISTS (SELECT 1 FROM employment_event r WHERE r.reverses_event_id = e.id)
  ) THEN
    RAISE EXCEPTION 'this employment period already has an active end event'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'employment_event_one_active_end';
  END IF;
  RETURN NEW;
END $$;

-- ===================== Manager references (PV-25 §4 safety net) =====================
-- An assignment may not reference a voided period as manager for dates that overlap it. Checked when the reference or
-- the assignment dates are written; the manager period row is share-locked so this serializes with a concurrent Void
-- (which locks the period before evaluating its dependency checks). Existing non-overlapping references are untouched.
CREATE FUNCTION job_assignment_manager_not_voided() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  m record;
BEGIN
  IF NEW.manager_employment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT start_date, end_date, voided_at INTO m FROM employment WHERE id = NEW.manager_employment_id FOR SHARE;
  IF m.voided_at IS NOT NULL
     AND daterange(NEW.effective_from, NEW.effective_to, '[)') && daterange(m.start_date, m.end_date, '[]') THEN
    RAISE EXCEPTION 'an assignment cannot reference a voided employment period as manager for overlapping dates (constraint "job_assignment_manager_not_voided")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'job_assignment_manager_not_voided';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_assignment_manager_not_voided_trg
  BEFORE INSERT OR UPDATE OF manager_employment_id, effective_from, effective_to ON job_assignment
  FOR EACH ROW EXECUTE FUNCTION job_assignment_manager_not_voided();
