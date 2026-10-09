-- Core HR S0–S3: nền tảng định danh/quyền, danh mục, hồ sơ con người, giai đoạn làm việc, phân công, audit, idempotency.
-- Viết tay vì Prisma không diễn đạt được exclusion constraint, deferrable FK, trigger và GRANT.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Vai trò ứng dụng. Ở local được docker/db-init tạo kèm LOGIN; ở môi trường khác cấp mật khẩu ngoài migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hrms_app') THEN
    CREATE ROLE hrms_app NOLOGIN;
  END IF;
END $$;

-- ===================== Tài khoản đăng nhập và quyền (tách khỏi hồ sơ) =====================
CREATE TABLE app_user (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_tenant_id  uuid NOT NULL,
  entra_object_id  uuid NOT NULL,
  display_name     text NOT NULL,
  is_enabled       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_entra_identity_uq UNIQUE (entra_tenant_id, entra_object_id)
);

CREATE TABLE app_user_role (
  user_id     uuid NOT NULL REFERENCES app_user(id),
  role_code   text NOT NULL CHECK (role_code IN ('HR_ADMIN', 'HR_EDITOR', 'HR_VIEWER', 'API_DOCS_READER')),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES app_user(id),
  PRIMARY KEY (user_id, role_code)
);

-- ===================== Danh mục =====================
CREATE TABLE department (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL CHECK (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX department_code_ci_uq ON department (lower(code));

CREATE TABLE position (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL CHECK (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name_en     text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 150),
  name_vi     text CHECK (name_vi IS NULL OR char_length(btrim(name_vi)) BETWEEN 1 AND 150),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX position_code_ci_uq ON position (lower(code));

CREATE TABLE job_level (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL CHECK (code ~ '^[A-Za-z0-9._-]{1,30}$'),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  sort_order  integer,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_level_code_ci_uq ON job_level (lower(code));

-- ===================== Con người =====================
CREATE TABLE person (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- mã nội bộ ổn định
  employee_code       text NOT NULL,                                -- mã NV hiện dùng (bản sao có kiểm soát từ registry)
  full_name           text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 150),
  gender              text CHECK (gender IN ('male', 'female', 'other')),
  date_of_birth       date,
  personal_email      text,
  mobile_phone        text,
  profile_state       text NOT NULL CHECK (profile_state IN ('draft', 'complete')),
  revision            integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES app_user(id)
);
CREATE UNIQUE INDEX person_employee_code_ci_uq ON person (lower(employee_code));
CREATE INDEX person_full_name_idx ON person (lower(full_name));

-- Sổ đăng ký mã NV: chỉ thêm, không sửa/xóa => một chuỗi mã chỉ từng gắn với một người (không tái sử dụng).
CREATE SEQUENCE employee_code_seq AS bigint START 1;
CREATE TABLE employee_code_registry (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
  person_id   uuid NOT NULL REFERENCES person(id),
  source      text NOT NULL CHECK (source IN ('generated', 'legacy')),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  issued_by   uuid NOT NULL REFERENCES app_user(id),
  CONSTRAINT employee_code_registry_code_person_uq UNIQUE (code, person_id)
);
CREATE UNIQUE INDEX employee_code_registry_code_ci_uq ON employee_code_registry (lower(code));
ALTER TABLE person
  ADD CONSTRAINT person_employee_code_registered_fk
  FOREIGN KEY (employee_code, id) REFERENCES employee_code_registry (code, person_id)
  DEFERRABLE INITIALLY DEFERRED;

-- Liên kết hệ ngoài (leave tool...). Chưa có API ở S0–S3; khóa ngoài chỉ duy nhất trong từng hệ.
CREATE TABLE external_identity (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id            uuid NOT NULL REFERENCES person(id),
  system               text NOT NULL CHECK (system IN ('leave_tool')),
  external_id          text NOT NULL,
  valid_from           date,
  valid_to             date CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  verification_source  text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identity_system_external_uq UNIQUE (system, external_id)
);

-- ===================== Giai đoạn làm việc =====================
-- end_date BAO GỒM ngày đó. Các giai đoạn của một người không chồng lấn.
-- Email công ty duy nhất trong khoảng thời gian được cấp (kể cả người có ngày nghỉ dự kiến).
CREATE TABLE employment (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      uuid NOT NULL REFERENCES person(id),
  start_date     date NOT NULL,
  end_date       date,
  work_email     text,
  record_source  text NOT NULL DEFAULT 'form' CHECK (record_source IN ('form', 'snapshot_import', 'legacy_import')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL REFERENCES app_user(id),
  CONSTRAINT employment_dates_ck CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT employment_no_overlap_ex
    EXCLUDE USING gist (person_id WITH =, daterange(start_date, end_date, '[]') WITH &&),
  CONSTRAINT employment_work_email_period_ex
    EXCLUDE USING gist (lower(work_email) WITH =, daterange(start_date, end_date, '[]') WITH &&)
    WHERE (work_email IS NOT NULL)
);
CREATE INDEX employment_person_idx ON employment (person_id);

-- Dòng thời gian trạng thái làm việc, độc lập với hợp đồng/tài khoản.
CREATE TABLE employment_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_id   uuid NOT NULL REFERENCES employment(id),
  event_type      text NOT NULL CHECK (event_type IN ('start', 'suspend', 'resume', 'end', 'cancel_planned_start')),
  effective_date  date NOT NULL,
  reason          text,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  recorded_by     uuid NOT NULL REFERENCES app_user(id)
);
CREATE UNIQUE INDEX employment_event_one_start_uq ON employment_event (employment_id) WHERE event_type = 'start';

-- ===================== Phân công theo ngày hiệu lực =====================
-- effective_from BAO GỒM, effective_to KHÔNG bao gồm; NULL = chưa xác định ngày kết thúc.
CREATE TABLE job_assignment (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employment_id          uuid NOT NULL REFERENCES employment(id),
  effective_from         date NOT NULL,
  effective_to           date,
  department_id          uuid NOT NULL REFERENCES department(id),
  position_id            uuid NOT NULL REFERENCES position(id),
  job_level_id           uuid REFERENCES job_level(id),
  manager_employment_id  uuid REFERENCES employment(id),
  record_source          text NOT NULL DEFAULT 'form' CHECK (record_source IN ('form', 'snapshot_import')),
  change_reason          text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NOT NULL REFERENCES app_user(id),
  CONSTRAINT job_assignment_dates_ck CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT job_assignment_not_self_managed_ck CHECK (manager_employment_id IS DISTINCT FROM employment_id),
  CONSTRAINT job_assignment_no_overlap_ex
    EXCLUDE USING gist (employment_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&)
);
CREATE INDEX job_assignment_employment_idx ON job_assignment (employment_id);
CREATE INDEX job_assignment_department_idx ON job_assignment (department_id);

-- Phân công phải nằm trong giai đoạn làm việc. Kiểm tra trễ đến cuối transaction để cho phép sửa nhiều bước.
CREATE FUNCTION job_assignment_within_employment() RETURNS trigger LANGUAGE plpgsql AS $$
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
    AND (a.effective_from < e.start_date
         OR (e.end_date IS NOT NULL AND (a.effective_to IS NULL OR a.effective_to > e.end_date + 1)));
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'job_assignment outside employment period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'job_assignment_within_employment';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER job_assignment_within_employment_trg
  AFTER INSERT OR UPDATE ON job_assignment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION job_assignment_within_employment();

CREATE CONSTRAINT TRIGGER employment_contains_assignments_trg
  AFTER UPDATE OF start_date, end_date ON employment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION job_assignment_within_employment();

-- ===================== Audit (chỉ ghi thêm, không chứa giá trị hồ sơ) =====================
CREATE TABLE audit_event (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_user_id   uuid REFERENCES app_user(id),
  action          text NOT NULL,
  outcome         text NOT NULL CHECK (outcome IN ('success', 'denied')),
  entity_type     text NOT NULL,
  entity_id       uuid,
  request_id      text NOT NULL,
  changed_fields  text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_event_entity_idx ON audit_event (entity_type, entity_id);

-- ===================== Idempotency =====================
-- Lưu tối thiểu: HMAC của payload (không lưu payload), id tài nguyên. Replay luôn kiểm quyền và đọc lại dữ liệu hiện hành.
CREATE TABLE idempotency_record (
  actor_user_id    uuid NOT NULL REFERENCES app_user(id),
  operation        text NOT NULL,
  idempotency_key  text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_hmac     text NOT NULL,
  resource_id      uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (actor_user_id, operation, idempotency_key)
);

-- ===================== Quyền DB của ứng dụng =====================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hrms_app;
GRANT SELECT, INSERT, UPDATE ON app_user, app_user_role, department, position, job_level, person, employment, job_assignment TO hrms_app;
GRANT DELETE ON app_user_role TO hrms_app;
GRANT SELECT, INSERT ON employee_code_registry, external_identity, employment_event, audit_event TO hrms_app;
GRANT SELECT, INSERT, DELETE ON idempotency_record TO hrms_app;
GRANT USAGE ON SEQUENCE employee_code_seq TO hrms_app;
-- Không cấp DELETE trên person/employment/job_assignment; không cấp UPDATE/DELETE trên audit_event và registry.
