-- PV-29 Cancel Planned Assignment (design revision 1, approved 2026-10-11, BD-1 … BD-10). Forward migration,
-- non-destructive: adds a nullable disposition column (every existing assignment stays operational), narrows the
-- assignment overlap exclusion and the period containment trigger to operational rows, and adds a safety net for the
-- approved rule "a cancelled planned assignment is permanent historical evidence". No data is transformed.

-- ===================== Cancellation marker =====================
ALTER TABLE job_assignment ADD COLUMN cancelled_at timestamptz;
COMMENT ON COLUMN job_assignment.cancelled_at IS
  'Set when HR cancels a planned assignment before it takes effect (PV-29). Actor and reason live in audit. Dates and values are kept unchanged as evidence.';

-- A cancelled row keeps its original range as evidence while its predecessor is extended over that range again.
ALTER TABLE job_assignment DROP CONSTRAINT job_assignment_no_overlap_ex;
ALTER TABLE job_assignment ADD CONSTRAINT job_assignment_no_overlap_ex
  EXCLUDE USING gist (employment_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&)
  WHERE (cancelled_at IS NULL);

-- Containment applies to operational rows only: after a cancellation the period end may legitimately move before the
-- cancelled row's dates (e.g. End Employment before the plan's date). Unchanged otherwise.
CREATE OR REPLACE FUNCTION job_assignment_within_employment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad_count integer;
  target_employment uuid;
BEGIN
  IF TG_TABLE_NAME = 'employment' THEN
    target_employment := NEW.id;
  ELSE
    target_employment := NEW.employment_id;
  END IF;
  SELECT count(*) INTO bad_count
  FROM job_assignment a
  JOIN employment e ON e.id = a.employment_id
  WHERE a.employment_id = target_employment
    AND a.cancelled_at IS NULL
    AND (a.effective_from < e.start_date
         OR (e.end_date IS NOT NULL AND (a.effective_to IS NULL OR a.effective_to > e.end_date + 1)));
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'job_assignment outside employment period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'job_assignment_within_employment';
  END IF;
  RETURN NULL;
END $$;

-- ===================== Terminal disposition (BD-10) =====================
-- Once cancelled, an assignment row cannot be changed or re-activated, and it is never inserted already cancelled.
-- Setting the marker is refused while an Active End Event closes this exact row (BD-5: Reverse End first), so the End
-- effect stays exactly reversible (C-54). The period row is locked to serialize with a concurrent End / Reverse End.
CREATE FUNCTION job_assignment_cancelled_is_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'an assignment cannot be created cancelled (constraint "job_assignment_cancelled_is_terminal")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'job_assignment_cancelled_is_terminal';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.cancelled_at IS NOT NULL AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'a cancelled assignment cannot be changed (constraint "job_assignment_cancelled_is_terminal")'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'job_assignment_cancelled_is_terminal';
  END IF;
  IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
    IF NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
       OR NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.job_title_id IS DISTINCT FROM OLD.job_title_id
       OR NEW.job_level_id IS DISTINCT FROM OLD.job_level_id OR NEW.manager_employment_id IS DISTINCT FROM OLD.manager_employment_id
       OR NEW.employment_id IS DISTINCT FROM OLD.employment_id THEN
      RAISE EXCEPTION 'cancelling an assignment must not change its dates or values (constraint "job_assignment_cancelled_is_terminal")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'job_assignment_cancelled_is_terminal';
    END IF;
    PERFORM 1 FROM employment WHERE id = NEW.employment_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM employment_event e
      WHERE e.closed_assignment_id = NEW.id AND e.event_type = 'end'
        AND NOT EXISTS (SELECT 1 FROM employment_event r WHERE r.reverses_event_id = e.id)
    ) THEN
      RAISE EXCEPTION 'an assignment closed by an active End Employment cannot be cancelled (constraint "job_assignment_cancel_closed_by_end")'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'job_assignment_cancel_closed_by_end';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_assignment_cancelled_is_terminal_trg
  BEFORE INSERT OR UPDATE ON job_assignment
  FOR EACH ROW EXECUTE FUNCTION job_assignment_cancelled_is_terminal();
