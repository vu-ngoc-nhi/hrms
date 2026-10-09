-- S4.1 (C-23, C-24): minimal audit foundation. Forward migration; committed migrations are not edited.
-- Non-destructive: adds a nullable column and a new child table.

-- Reason for actions that require one (nullable: not every action needs a reason).
ALTER TABLE audit_event ADD COLUMN reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000);

-- Old/new values for the approved non-sensitive STRUCTURAL fields only. The CHECK makes it impossible to store raw
-- values of personal fields (name, DOB, gender, phone, personal/work email, manager) even by mistake.
CREATE TABLE audit_field_change (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_event_id  bigint NOT NULL REFERENCES audit_event(id),
  field           text NOT NULL CHECK (field IN (
                    'employee_type_id', 'department_id', 'job_title_id', 'job_level_id',
                    'employment.start_date', 'employment.end_date',
                    'assignment.effective_from', 'assignment.effective_to')),
  old_value       text,
  new_value       text,
  CONSTRAINT audit_field_change_differs_ck CHECK (old_value IS DISTINCT FROM new_value)
);
CREATE INDEX audit_field_change_event_idx ON audit_field_change (audit_event_id);

-- Same rights as audit_event: the application may insert and read, never update or delete.
GRANT SELECT, INSERT ON audit_field_change TO hrms_app;
