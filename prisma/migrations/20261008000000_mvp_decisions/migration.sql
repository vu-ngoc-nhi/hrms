-- MVP decisions of 2026-10-08. Additive / rename-only: no rows or columns with data are dropped.
-- Revised 2026-10-08 (PV-01) before being applied outside local databases: employee_type moved from job_assignment
-- to employment. hrms_dev was reset under explicit one-time approval; hrms_test is recreated by every test run.

-- 1. Business terminology: "Job Title" in UI and code (was "position").
ALTER TABLE position RENAME TO job_title;
ALTER INDEX position_code_ci_uq RENAME TO job_title_code_ci_uq;
ALTER TABLE job_assignment RENAME COLUMN position_id TO job_title_id;

-- 2. Employee Type (Confirmed Decision PV-01): the nature of the working relationship (Employee, Service Contractor,
--    Intern...). It belongs to the EMPLOYMENT PERIOD, not to the organizational assignment, so a department or
--    job-title change never changes it. A relationship change (e.g. Service Contractor -> Employee) is recorded as a
--    new employment period. Working Arrangement (Full-time/Part-time) and Employment Stage (Probation...) are
--    separate concepts and are not modelled in the MVP schema.
--    requires_work_email: HR-managed flag used by the operational completeness rule (PV-03).
CREATE TABLE employee_type (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL CHECK (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name                 text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  requires_work_email  boolean NOT NULL DEFAULT true,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employee_type_code_ci_uq ON employee_type (lower(code));
ALTER TABLE employment ADD COLUMN employee_type_id uuid REFERENCES employee_type(id);

-- Once set, the employee type of a period cannot be changed in place (it may only be filled in when empty);
-- a different relationship requires a new employment period, which keeps the change traceable.
CREATE FUNCTION employment_employee_type_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.employee_type_id IS NOT NULL AND NEW.employee_type_id IS DISTINCT FROM OLD.employee_type_id THEN
    RAISE EXCEPTION 'employee type of an employment period cannot be changed; start a new employment period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'employment_employee_type_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employment_employee_type_immutable_trg
  BEFORE UPDATE OF employee_type_id ON employment
  FOR EACH ROW EXECUTE FUNCTION employment_employee_type_immutable();

-- 3. Profile completeness is computed from versioned rules at read time, not stored.
--    person.profile_state is deprecated: no longer written or read. Dropping it needs explicit approval.
ALTER TABLE person ALTER COLUMN profile_state DROP NOT NULL;
COMMENT ON COLUMN person.profile_state IS 'DEPRECATED 2026-10-08: completeness is computed; drop requires approval';

-- 4. Role codes are validated by the application allow-list (unknown codes grant nothing),
--    so roles can be added or retired without a schema change.
ALTER TABLE app_user_role DROP CONSTRAINT app_user_role_role_code_check;
ALTER TABLE app_user_role ADD CONSTRAINT app_user_role_role_code_format_ck CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,49}$');

GRANT SELECT, INSERT, UPDATE ON employee_type TO hrms_app;
