-- S4.0 (C-29): operational marker for Cancel Planned Period. Forward migration; committed migrations are not edited.
-- Non-destructive: adds a nullable column (existing periods stay non-cancelled), narrows two exclusion constraints
-- to non-cancelled periods, and adds safeguards for the approved "cancellation is terminal" rule.
-- The Cancel Planned Period action itself (API/UI) is implemented in S4.10.

ALTER TABLE employment ADD COLUMN cancelled_at timestamptz;
COMMENT ON COLUMN employment.cancelled_at IS
  'Set when a planned period is cancelled before it began (C-29). Actor and reason live in the cancel_planned_start event and audit.';

-- Cancelled periods no longer block another valid period of the same person...
ALTER TABLE employment DROP CONSTRAINT employment_no_overlap_ex;
ALTER TABLE employment ADD CONSTRAINT employment_no_overlap_ex
  EXCLUDE USING gist (person_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (cancelled_at IS NULL);

-- ...and no longer reserve their Work Email.
ALTER TABLE employment DROP CONSTRAINT employment_work_email_period_ex;
ALTER TABLE employment ADD CONSTRAINT employment_work_email_period_ex
  EXCLUDE USING gist (lower(work_email) WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (work_email IS NOT NULL AND cancelled_at IS NULL);

-- Cancellation is terminal in S4: once cancelled, the marker cannot be cleared or changed and the period's
-- dates, Employee Type, Work Email and person cannot be edited (history stays as it was planned).
CREATE FUNCTION employment_cancelled_is_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL AND (
       NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    OR NEW.start_date IS DISTINCT FROM OLD.start_date
    OR NEW.end_date IS DISTINCT FROM OLD.end_date
    OR NEW.employee_type_id IS DISTINCT FROM OLD.employee_type_id
    OR NEW.work_email IS DISTINCT FROM OLD.work_email
    OR NEW.person_id IS DISTINCT FROM OLD.person_id
  ) THEN
    RAISE EXCEPTION 'a cancelled employment period cannot be changed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_cancelled_is_terminal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employment_cancelled_is_terminal_trg
  BEFORE UPDATE ON employment
  FOR EACH ROW EXECUTE FUNCTION employment_cancelled_is_terminal();

-- At most one cancellation event per period.
CREATE UNIQUE INDEX employment_event_one_cancel_uq ON employment_event (employment_id)
  WHERE event_type = 'cancel_planned_start';
