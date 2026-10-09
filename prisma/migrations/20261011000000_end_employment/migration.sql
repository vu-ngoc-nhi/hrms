-- S4.7 End Employment (C-21, C-50 to C-53). Forward migration, non-destructive: adds reference data, nullable columns,
-- constraints and triggers; existing rows are unchanged (every new column is NULL on them).

-- ===================== End Reason reference data (C-21) =====================
-- System reference data with stable codes and the approved product labels. A product classification only; the legal
-- interpretation of End Reasons is Pending Legal Review (PL-09). RELATIONSHIP_CHANGE is system-only (not selectable).
CREATE TABLE end_reason (
  code           text PRIMARY KEY CHECK (code ~ '^[A-Z_]{1,40}$'),
  label          text NOT NULL,
  selectable     boolean NOT NULL,
  note_required  boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL
);
INSERT INTO end_reason (code, label, selectable, note_required, sort_order) VALUES
  ('VOLUNTARY_RESIGNATION',  'Voluntary Resignation',   true,  false, 10),
  ('EMPLOYER_INITIATED_END', 'Employer-initiated End',  true,  false, 20),
  ('PLANNED_TERM_COMPLETED', 'Planned Term Completed',  true,  false, 30),
  ('MUTUAL_AGREEMENT',       'Mutual Agreement',        true,  false, 40),
  ('PROBATION_NOT_PASSED',   'Probation Not Passed',    true,  false, 50),
  ('OTHER',                  'Other',                   true,  true,  60),
  ('RELATIONSHIP_CHANGE',    'Relationship Change',     false, false, 70);
GRANT SELECT ON end_reason TO hrms_app;

-- ===================== Lifecycle event metadata (C-52) =====================
ALTER TABLE employment_event DROP CONSTRAINT employment_event_event_type_check;
ALTER TABLE employment_event ADD CONSTRAINT employment_event_event_type_check
  CHECK (event_type IN ('start', 'suspend', 'resume', 'end', 'end_reversed', 'cancel_planned_start'));

ALTER TABLE employment_event
  ADD COLUMN end_reason_code text REFERENCES end_reason(code),
  ADD COLUMN end_note text CHECK (end_note IS NULL OR char_length(btrim(end_note)) BETWEEN 1 AND 1000),
  ADD COLUMN previous_end_date date,
  ADD COLUMN closed_assignment_id uuid REFERENCES job_assignment(id),
  ADD COLUMN closed_assignment_previous_effective_to date,
  ADD COLUMN reverses_event_id uuid REFERENCES employment_event(id);

COMMENT ON COLUMN employment_event.previous_end_date IS
  'end events only: employment.end_date before End Employment (NULL = the period was open). Source for Reverse End Employment.';
COMMENT ON COLUMN employment_event.closed_assignment_id IS
  'end events only: the assignment whose effective_to End Employment changed (NULL = none changed).';
COMMENT ON COLUMN employment_event.closed_assignment_previous_effective_to IS
  'end events only: that assignment''s exact effective_to before End Employment (NULL = it was open-ended).';
COMMENT ON COLUMN employment_event.reverses_event_id IS
  'end_reversed events only: the exact end event this reversal reverses.';

ALTER TABLE employment_event
  -- End-specific metadata exists only on `end` events.
  ADD CONSTRAINT employment_event_end_metadata_ck CHECK (
    event_type = 'end'
    OR (end_reason_code IS NULL AND end_note IS NULL AND previous_end_date IS NULL
        AND closed_assignment_id IS NULL AND closed_assignment_previous_effective_to IS NULL)),
  -- A previous effective_to is meaningful only together with the assignment it belongs to.
  ADD CONSTRAINT employment_event_closed_assignment_ck CHECK (
    closed_assignment_id IS NOT NULL OR closed_assignment_previous_effective_to IS NULL),
  -- A note belongs to a structured End Reason; OTHER requires a note (C-21).
  ADD CONSTRAINT employment_event_end_note_ck CHECK (end_note IS NULL OR end_reason_code IS NOT NULL),
  ADD CONSTRAINT employment_event_other_needs_note_ck CHECK (end_reason_code IS DISTINCT FROM 'OTHER' OR end_note IS NOT NULL),
  -- reverses_event_id exists exactly on `end_reversed` events.
  ADD CONSTRAINT employment_event_reversal_link_ck CHECK ((event_type = 'end_reversed') = (reverses_event_id IS NOT NULL));

-- One End event can be reversed at most once.
CREATE UNIQUE INDEX employment_event_one_reversal_uq ON employment_event (reverses_event_id) WHERE reverses_event_id IS NOT NULL;
CREATE INDEX employment_event_employment_type_idx ON employment_event (employment_id, event_type);

-- Insert rules that need other rows (C-51): an `end_reversed` event must reverse an `end` event of the same period,
-- and a period can have at most one Active End Event (an `end` event not reversed by an `end_reversed` event).
-- The period row is locked so two concurrent inserts for the same period are serialized.
CREATE FUNCTION employment_event_lifecycle_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
BEGIN
  IF NEW.event_type NOT IN ('end', 'end_reversed') THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM employment WHERE id = NEW.employment_id FOR UPDATE;
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

CREATE TRIGGER employment_event_lifecycle_rules_trg
  BEFORE INSERT ON employment_event
  FOR EACH ROW EXECUTE FUNCTION employment_event_lifecycle_rules();

-- ===================== Immutability (C-53, extends C-43) =====================
-- The historical correction may change only effective_date of a start/end event; every other column, including all
-- new metadata, is immutable. (The application role also only holds the column-level UPDATE (effective_date) grant.)
CREATE OR REPLACE FUNCTION employment_event_date_correction_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_type NOT IN ('start', 'end') THEN
    RAISE EXCEPTION 'only start and end lifecycle event dates can be corrected'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_event_date_correction_scope';
  END IF;
  IF (NEW.id, NEW.employment_id, NEW.event_type, NEW.reason, NEW.recorded_at, NEW.recorded_by,
      NEW.end_reason_code, NEW.end_note, NEW.previous_end_date, NEW.closed_assignment_id,
      NEW.closed_assignment_previous_effective_to, NEW.reverses_event_id)
     IS DISTINCT FROM
     (OLD.id, OLD.employment_id, OLD.event_type, OLD.reason, OLD.recorded_at, OLD.recorded_by,
      OLD.end_reason_code, OLD.end_note, OLD.previous_end_date, OLD.closed_assignment_id,
      OLD.closed_assignment_previous_effective_to, OLD.reverses_event_id) THEN
    RAISE EXCEPTION 'only effective_date of a lifecycle event can be corrected'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_event_date_correction_scope';
  END IF;
  RETURN NEW;
END $$;
