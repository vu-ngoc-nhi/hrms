-- Guarded access administration (C-89, C-93; design docs/design/access-administration-command.md revision 2).
-- Forward migration, non-destructive: existing app_user / app_user_role rows are unchanged.
--
-- The ONLY mutation path for application accounts and role assignments is a small set of SECURITY DEFINER routines
-- owned by the dedicated NOLOGIN role hrms_access_function_owner. Human operators log in with personal roles that are
-- members of hrms_access_admin: they can SELECT access-control data and EXECUTE the guarded routines, and hold no DML
-- privilege on any access-control table and no privilege on any HR table. Operator identity, environment and tenant
-- come from owner-maintained tables keyed by session_user — never from operator-settable values (custom settings
-- such as hrms.operator_oid can be SET by any session and are not used).
-- Operator LOGIN roles carry passwords and are created by IT outside migrations (docs/production/access-administration-runbook.md).

-- ===================== Roles (NOLOGIN, no secrets) =====================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_access_function_owner') THEN
    CREATE ROLE hrms_access_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_access_admin') THEN
    CREATE ROLE hrms_access_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  -- Fail closed when pre-created roles (e.g. by IT) have elevated attributes or unexpected memberships.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('hrms_access_function_owner', 'hrms_access_admin')
             AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'access-administration roles must be NOLOGIN without elevated attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
             WHERE r.rolname = 'hrms_access_function_owner') THEN
    RAISE EXCEPTION 'hrms_access_function_owner must not be a member of any role';
  END IF;
  IF pg_has_role('hrms_access_admin', 'hrms_access_function_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'hrms_access_admin must not be a member of hrms_access_function_owner';
  END IF;
END $$;

-- ===================== Runtime least privilege (C-93 G) =====================
-- The application only reads accounts and roles (authentication); it never writes them.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON app_user, app_user_role FROM hrms_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- No role needs temporary objects; without TEMP an operator cannot even create pg_temp objects (defence in depth on
-- top of the pinned function search_path). The application and operators get only explicit grants.
DO $$ BEGIN EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()); END $$;

-- ===================== Policy mirror (migration-controlled) =====================
-- One immutable table mirrors the code role → permission map (src/modules/identity/permissions.ts ROLE_PERMISSIONS):
-- the distinct role codes are the supported allow-list and the rows give effective permissions for the
-- capability-based last-admin rule. Changed ONLY by migrations; a contract test compares it with the code.
-- This is not configurable RBAC: no routine reads input into it and nobody but the owner can write it.
CREATE TABLE access_role_permission (
  role_code   text NOT NULL CHECK (role_code ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  permission  text NOT NULL CHECK (permission ~ '^[a-z]+\.[a-z_]+$'),
  PRIMARY KEY (role_code, permission)
);
INSERT INTO access_role_permission (role_code, permission) VALUES
  ('HR_ADMIN', 'employees.read'), ('HR_ADMIN', 'employees.read_personal'), ('HR_ADMIN', 'employees.create'),
  ('HR_ADMIN', 'employees.write_personal'), ('HR_ADMIN', 'employees.set_code'), ('HR_ADMIN', 'employees.update'),
  ('HR_ADMIN', 'employment.manage'), ('HR_ADMIN', 'employment.correct'), ('HR_ADMIN', 'catalogs.read'),
  ('HR_ADMIN', 'catalogs.manage'),
  ('HR_EDITOR', 'employees.read'), ('HR_EDITOR', 'employees.read_personal'), ('HR_EDITOR', 'employees.create'),
  ('HR_EDITOR', 'employees.write_personal'), ('HR_EDITOR', 'employees.update'), ('HR_EDITOR', 'employment.manage'),
  ('HR_EDITOR', 'catalogs.read'),
  ('API_DOCS_READER', 'docs.read');

-- ===================== Protected environment and operator mapping (owner-maintained) =====================
CREATE TABLE access_environment (
  singleton        boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment      text NOT NULL CHECK (environment IN ('local', 'test', 'staging', 'production')),
  entra_tenant_id  uuid NOT NULL,
  configured_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE access_environment IS
  'Single row identifying this database for access administration (environment and the Entra tenant of application users). Owner-maintained via access_environment_configure.';

CREATE TABLE access_operator (
  db_login         text PRIMARY KEY CHECK (db_login ~ '^[a-z][a-z0-9_]{2,62}$'),
  entra_tenant_id  uuid NOT NULL,
  entra_object_id  uuid NOT NULL,
  display_name     text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 150),
  is_active        boolean NOT NULL DEFAULT true,
  registered_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_operator_entra_identity_uq UNIQUE (entra_tenant_id, entra_object_id)
);
COMMENT ON TABLE access_operator IS
  'Trusted mapping session_user (personal operator DB login) -> operator Entra identity, used for the audit actor and the self-escalation guard. Owner-maintained via access_operator_register / access_operator_deactivate.';

-- ===================== Security audit (append-only) =====================
CREATE TABLE access_audit_event (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at               timestamptz NOT NULL DEFAULT now(),
  environment               text NOT NULL,
  operator_login            text NOT NULL,
  operator_entra_object_id  uuid,
  action                    text NOT NULL CHECK (action IN ('user_created', 'user_enabled', 'user_disabled', 'role_assigned',
                              'role_removed', 'operator_registered', 'operator_deactivated', 'environment_configured')),
  target_user_id            uuid REFERENCES app_user(id),
  target_operator_login     text,
  role_code                 text,
  previous_state            jsonb,
  new_state                 jsonb NOT NULL,
  reason                    text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  correlation_id            uuid NOT NULL,
  CONSTRAINT access_audit_event_user_target_ck
    CHECK ((action IN ('user_created', 'user_enabled', 'user_disabled', 'role_assigned', 'role_removed')) = (target_user_id IS NOT NULL)),
  CONSTRAINT access_audit_event_operator_target_ck
    CHECK ((action IN ('operator_registered', 'operator_deactivated')) = (target_operator_login IS NOT NULL)),
  CONSTRAINT access_audit_event_role_ck CHECK ((action IN ('role_assigned', 'role_removed')) = (role_code IS NOT NULL))
);
CREATE INDEX access_audit_event_target_user_idx ON access_audit_event (target_user_id);
CREATE INDEX access_audit_event_occurred_idx ON access_audit_event (occurred_at);
COMMENT ON TABLE access_audit_event IS
  'Access-administration security audit, separate from employee history (C-85). Append-only; written only by the guarded routines in the same transaction as the change. Retention: Pending Legal Review.';

CREATE FUNCTION access_audit_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'access audit events are append-only'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'access_audit_event_append_only';
END $$;
CREATE TRIGGER access_audit_event_no_update_delete_trg
  BEFORE UPDATE OR DELETE ON access_audit_event FOR EACH ROW EXECUTE FUNCTION access_audit_event_append_only();
CREATE TRIGGER access_audit_event_no_truncate_trg
  BEFORE TRUNCATE ON access_audit_event FOR EACH STATEMENT EXECUTE FUNCTION access_audit_event_append_only();

-- ===================== Read helpers (invoker rights; EXECUTE granted to operators) =====================
-- The single DB-side definition of the administrative capability set; mirrors ADMINISTRATIVE_PERMISSIONS in code.
CREATE FUNCTION public.access_admin_permissions() RETURNS text[] LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$ SELECT ARRAY['catalogs.manage', 'employees.set_code', 'employment.correct']::text[] $$;

-- Effective permissions of an application user: empty when disabled; unsupported stored codes contribute nothing.
CREATE FUNCTION public.access_effective_permissions(p_user_id uuid) RETURNS text[] LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT rp.permission ORDER BY rp.permission), '{}'::text[])
  FROM public.app_user u
  JOIN public.app_user_role ur ON ur.user_id = u.id
  JOIN public.access_role_permission rp ON rp.role_code = ur.role_code
  WHERE u.id = p_user_id AND u.is_enabled
$$;

-- Active administrative users: enabled users whose effective permissions contain every administrative capability.
CREATE FUNCTION public.access_admin_count() RETURNS integer LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer FROM public.app_user u
  WHERE u.is_enabled AND public.access_effective_permissions(u.id) @> public.access_admin_permissions()
$$;

-- Access state used for previews and the optimistic "expected state" check (stored codes, deterministic order).
CREATE FUNCTION public.access_user_state(p_user_id uuid) RETURNS jsonb LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
    'enabled', u.is_enabled,
    'roles', COALESCE((SELECT jsonb_agg(ur.role_code ORDER BY ur.role_code COLLATE "C")
                       FROM public.app_user_role ur WHERE ur.user_id = u.id), '[]'::jsonb))
  FROM public.app_user u WHERE u.id = p_user_id
$$;

-- ===================== Internal helpers (owner-only) =====================
-- Common entry: isolation check, global access lock, environment check, trusted operator from session_user.
CREATE FUNCTION public.access_begin(
  p_environment text,
  OUT environment text, OUT tenant_id uuid, OUT operator_login text, OUT operator_tenant uuid, OUT operator_oid uuid)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ACCESS_ISOLATION: access administration requires READ COMMITTED isolation';
  END IF;
  -- Serializes every access mutation (race-free last-admin evaluation). Released at commit/rollback.
  PERFORM pg_catalog.pg_advisory_xact_lock(7262013001);
  SELECT e.environment, e.entra_tenant_id INTO environment, tenant_id FROM public.access_environment e;
  IF environment IS NULL THEN
    RAISE EXCEPTION 'ACCESS_ENVIRONMENT_MISMATCH: this database has no configured access environment';
  END IF;
  IF p_environment IS DISTINCT FROM environment THEN
    RAISE EXCEPTION 'ACCESS_ENVIRONMENT_MISMATCH: target environment "%" does not match this database ("%")', p_environment, environment;
  END IF;
  SELECT o.db_login, o.entra_tenant_id, o.entra_object_id INTO operator_login, operator_tenant, operator_oid
  FROM public.access_operator o WHERE o.db_login = session_user::text AND o.is_active;
  IF operator_login IS NULL THEN
    RAISE EXCEPTION 'ACCESS_OPERATOR_UNKNOWN: login "%" is not a registered active access operator', session_user;
  END IF;
END $$;

CREATE FUNCTION public.access_reason(p_reason text) RETURNS text LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'ACCESS_REASON_REQUIRED: a reason is required for every access change';
  END IF;
  IF char_length(btrim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'ACCESS_REASON_REQUIRED: the reason must be at most 500 characters';
  END IF;
  RETURN btrim(p_reason);
END $$;

-- Guards evaluated AFTER the change, inside the same transaction (a failure rolls the change back):
--  - self-escalation: an operator may not increase the effective permissions of their own Entra identity;
--  - last admin: never from >= 1 active administrative users to 0 (0 -> n bootstrap is allowed).
CREATE FUNCTION public.access_check_guards(
  p_user_id uuid, p_admins_before integer, p_permissions_before text[], p_operator_tenant uuid, p_operator_oid uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_self boolean;
  v_after integer;
BEGIN
  SELECT (u.entra_tenant_id = p_operator_tenant AND u.entra_object_id = p_operator_oid) INTO v_self
  FROM public.app_user u WHERE u.id = p_user_id;
  IF v_self AND NOT (public.access_effective_permissions(p_user_id) <@ p_permissions_before) THEN
    RAISE EXCEPTION 'ACCESS_SELF_ESCALATION: an operator cannot increase the Mini HRS permissions of their own Entra identity';
  END IF;
  v_after := public.access_admin_count();
  IF p_admins_before >= 1 AND v_after = 0 THEN
    RAISE EXCEPTION 'ACCESS_LAST_ADMIN: this change would leave no active administrative user';
  END IF;
  RETURN v_after;
END $$;

CREATE FUNCTION public.access_write_audit(
  p_environment text, p_operator_login text, p_operator_oid uuid, p_action text, p_user_id uuid, p_operator_target text,
  p_role_code text, p_previous jsonb, p_new jsonb, p_reason text, p_correlation_id uuid)
RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO public.access_audit_event (environment, operator_login, operator_entra_object_id, action, target_user_id,
    target_operator_login, role_code, previous_state, new_state, reason, correlation_id)
  VALUES (p_environment, p_operator_login, p_operator_oid, p_action, p_user_id, p_operator_target, p_role_code,
    p_previous, p_new, p_reason, COALESCE(p_correlation_id, gen_random_uuid()))
$$;

CREATE FUNCTION public.access_require_user(p_user_id uuid, p_expected_state jsonb) RETURNS jsonb LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_state jsonb := public.access_user_state(p_user_id);
BEGIN
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'ACCESS_USER_NOT_FOUND: application user % does not exist', p_user_id;
  END IF;
  IF p_expected_state IS NULL OR p_expected_state <> v_state THEN
    RAISE EXCEPTION 'ACCESS_STATE_CHANGED: the access state changed since it was previewed; review it and run the command again';
  END IF;
  RETURN v_state;
END $$;

-- ===================== Guarded mutation routines (EXECUTE: hrms_access_admin) =====================
CREATE FUNCTION public.access_user_create(
  p_environment text, p_entra_tenant_id uuid, p_entra_object_id uuid, p_display_name text, p_reason text, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  v_reason text;
  v_name text := btrim(p_display_name);
  v_id uuid;
  v_admins integer;
  v_state jsonb;
BEGIN
  SELECT * INTO c FROM public.access_begin(p_environment);
  v_reason := public.access_reason(p_reason);
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'ACCESS_INVALID_INPUT: the display name must be 1-150 characters';
  END IF;
  IF p_entra_object_id IS NULL OR p_entra_tenant_id IS DISTINCT FROM c.tenant_id THEN
    RAISE EXCEPTION 'ACCESS_TENANT_MISMATCH: application users of this environment belong to tenant %', c.tenant_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_user u WHERE u.entra_tenant_id = p_entra_tenant_id AND u.entra_object_id = p_entra_object_id) THEN
    RAISE EXCEPTION 'ACCESS_USER_EXISTS: an application user with this Entra identity already exists';
  END IF;
  v_admins := public.access_admin_count();
  INSERT INTO public.app_user (entra_tenant_id, entra_object_id, display_name, is_enabled)
  VALUES (p_entra_tenant_id, p_entra_object_id, v_name, true) RETURNING id INTO v_id;
  v_admins := public.access_check_guards(v_id, v_admins, '{}'::text[], c.operator_tenant, c.operator_oid);
  v_state := public.access_user_state(v_id);
  PERFORM public.access_write_audit(c.environment, c.operator_login, c.operator_oid, 'user_created', v_id, NULL, NULL,
    NULL, v_state, v_reason, p_correlation_id);
  RETURN jsonb_build_object('result', 'changed', 'user_id', v_id, 'previous_state', NULL, 'new_state', v_state, 'admins_after', v_admins);
END $$;

CREATE FUNCTION public.access_user_set_enabled(
  p_environment text, p_user_id uuid, p_enabled boolean, p_expected_state jsonb, p_reason text, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  v_reason text;
  v_prev jsonb;
  v_new jsonb;
  v_admins integer;
  v_perms text[];
BEGIN
  SELECT * INTO c FROM public.access_begin(p_environment);
  v_reason := public.access_reason(p_reason);
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'ACCESS_INVALID_INPUT: enabled must be true or false';
  END IF;
  v_prev := public.access_require_user(p_user_id, p_expected_state);
  v_admins := public.access_admin_count();
  IF (v_prev ->> 'enabled')::boolean = p_enabled THEN
    RETURN jsonb_build_object('result', 'no_change', 'user_id', p_user_id, 'previous_state', v_prev, 'new_state', v_prev, 'admins_after', v_admins);
  END IF;
  v_perms := public.access_effective_permissions(p_user_id);
  -- Role assignments are retained while disabled and reactivate on enable (C-93 D).
  UPDATE public.app_user SET is_enabled = p_enabled, updated_at = now() WHERE id = p_user_id;
  v_admins := public.access_check_guards(p_user_id, v_admins, v_perms, c.operator_tenant, c.operator_oid);
  v_new := public.access_user_state(p_user_id);
  PERFORM public.access_write_audit(c.environment, c.operator_login, c.operator_oid,
    CASE WHEN p_enabled THEN 'user_enabled' ELSE 'user_disabled' END, p_user_id, NULL, NULL, v_prev, v_new, v_reason, p_correlation_id);
  RETURN jsonb_build_object('result', 'changed', 'user_id', p_user_id, 'previous_state', v_prev, 'new_state', v_new, 'admins_after', v_admins);
END $$;

CREATE FUNCTION public.access_role_assign(
  p_environment text, p_user_id uuid, p_role_code text, p_expected_state jsonb, p_reason text, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  v_reason text;
  v_prev jsonb;
  v_new jsonb;
  v_admins integer;
  v_perms text[];
BEGIN
  SELECT * INTO c FROM public.access_begin(p_environment);
  v_reason := public.access_reason(p_reason);
  -- Supported allow-list = role codes present in the migration-controlled policy mirror (HR_VIEWER is not).
  IF NOT EXISTS (SELECT 1 FROM public.access_role_permission rp WHERE rp.role_code = p_role_code) THEN
    RAISE EXCEPTION 'ACCESS_ROLE_NOT_SUPPORTED: role "%" is not a supported role', p_role_code;
  END IF;
  v_prev := public.access_require_user(p_user_id, p_expected_state);
  v_admins := public.access_admin_count();
  IF EXISTS (SELECT 1 FROM public.app_user_role ur WHERE ur.user_id = p_user_id AND ur.role_code = p_role_code) THEN
    RETURN jsonb_build_object('result', 'no_change', 'user_id', p_user_id, 'previous_state', v_prev, 'new_state', v_prev, 'admins_after', v_admins);
  END IF;
  v_perms := public.access_effective_permissions(p_user_id);
  INSERT INTO public.app_user_role (user_id, role_code, granted_at, granted_by) VALUES (p_user_id, p_role_code, now(), NULL);
  v_admins := public.access_check_guards(p_user_id, v_admins, v_perms, c.operator_tenant, c.operator_oid);
  v_new := public.access_user_state(p_user_id);
  PERFORM public.access_write_audit(c.environment, c.operator_login, c.operator_oid, 'role_assigned', p_user_id, NULL,
    p_role_code, v_prev, v_new, v_reason, p_correlation_id);
  RETURN jsonb_build_object('result', 'changed', 'user_id', p_user_id, 'previous_state', v_prev, 'new_state', v_new, 'admins_after', v_admins);
END $$;

CREATE FUNCTION public.access_role_remove(
  p_environment text, p_user_id uuid, p_role_code text, p_expected_state jsonb, p_reason text, p_correlation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
  v_reason text;
  v_prev jsonb;
  v_new jsonb;
  v_admins integer;
  v_perms text[];
BEGIN
  SELECT * INTO c FROM public.access_begin(p_environment);
  v_reason := public.access_reason(p_reason);
  IF p_role_code IS NULL OR p_role_code !~ '^[A-Z][A-Z0-9_]{1,49}$' THEN
    RAISE EXCEPTION 'ACCESS_INVALID_INPUT: malformed role code';
  END IF;
  v_prev := public.access_require_user(p_user_id, p_expected_state);
  v_admins := public.access_admin_count();
  -- Any stored code may be removed, including unsupported ones such as HR_VIEWER (they grant nothing).
  IF NOT EXISTS (SELECT 1 FROM public.app_user_role ur WHERE ur.user_id = p_user_id AND ur.role_code = p_role_code) THEN
    RETURN jsonb_build_object('result', 'no_change', 'user_id', p_user_id, 'previous_state', v_prev, 'new_state', v_prev, 'admins_after', v_admins);
  END IF;
  v_perms := public.access_effective_permissions(p_user_id);
  DELETE FROM public.app_user_role ur WHERE ur.user_id = p_user_id AND ur.role_code = p_role_code;
  v_admins := public.access_check_guards(p_user_id, v_admins, v_perms, c.operator_tenant, c.operator_oid);
  v_new := public.access_user_state(p_user_id);
  PERFORM public.access_write_audit(c.environment, c.operator_login, c.operator_oid, 'role_removed', p_user_id, NULL,
    p_role_code, v_prev, v_new, v_reason, p_correlation_id);
  RETURN jsonb_build_object('result', 'changed', 'user_id', p_user_id, 'previous_state', v_prev, 'new_state', v_new, 'admins_after', v_admins);
END $$;

-- ===================== Owner-only provisioning routines (EXECUTE: the migration owner only) =====================
-- Infrastructure authority (IT, owner credentials): identify the environment and register operator logins.
CREATE FUNCTION public.access_environment_configure(p_environment text, p_entra_tenant_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reason text := public.access_reason(p_reason);
  v_prev jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7262013001);
  IF p_environment IS NULL OR p_environment NOT IN ('local', 'test', 'staging', 'production') OR p_entra_tenant_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_INVALID_INPUT: environment must be local, test, staging or production, with a tenant id';
  END IF;
  -- The development test tenant (test identity issuer) is never valid outside local/test.
  IF p_environment IN ('staging', 'production') AND p_entra_tenant_id = '11111111-1111-4111-8111-111111111111'::uuid THEN
    RAISE EXCEPTION 'ACCESS_TENANT_MISMATCH: the development test tenant cannot be used for %', p_environment;
  END IF;
  SELECT jsonb_build_object('environment', e.environment, 'entra_tenant_id', e.entra_tenant_id) INTO v_prev FROM public.access_environment e;
  INSERT INTO public.access_environment (singleton, environment, entra_tenant_id, configured_at)
  VALUES (true, p_environment, p_entra_tenant_id, now())
  ON CONFLICT (singleton) DO UPDATE SET environment = EXCLUDED.environment, entra_tenant_id = EXCLUDED.entra_tenant_id, configured_at = now();
  PERFORM public.access_write_audit(p_environment, session_user::text, NULL, 'environment_configured', NULL, NULL, NULL,
    v_prev, jsonb_build_object('environment', p_environment, 'entra_tenant_id', p_entra_tenant_id), v_reason, NULL);
END $$;

CREATE FUNCTION public.access_operator_register(
  p_db_login text, p_entra_tenant_id uuid, p_entra_object_id uuid, p_display_name text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reason text := public.access_reason(p_reason);
  v_env record;
  v_role record;
  v_prev jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7262013001);
  SELECT e.environment, e.entra_tenant_id INTO v_env FROM public.access_environment e;
  IF v_env.environment IS NULL THEN
    RAISE EXCEPTION 'ACCESS_ENVIRONMENT_MISMATCH: configure the access environment first';
  END IF;
  IF p_entra_tenant_id IS DISTINCT FROM v_env.entra_tenant_id OR p_entra_object_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_TENANT_MISMATCH: operators of this environment belong to tenant %', v_env.entra_tenant_id;
  END IF;
  SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolbypassrls INTO v_role FROM pg_catalog.pg_roles r WHERE r.rolname = p_db_login;
  IF v_role.rolname IS NULL OR NOT v_role.rolcanlogin THEN
    RAISE EXCEPTION 'ACCESS_INVALID_INPUT: "%" must be an existing LOGIN role', p_db_login;
  END IF;
  IF v_role.rolsuper OR v_role.rolcreaterole OR v_role.rolbypassrls
     OR NOT pg_catalog.pg_has_role(p_db_login, 'hrms_access_admin', 'MEMBER')
     OR pg_catalog.pg_has_role(p_db_login, 'hrms_access_function_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'ACCESS_INVALID_INPUT: an operator login must be a plain member of hrms_access_admin (no superuser, createrole, bypassrls or function-owner membership)';
  END IF;
  SELECT jsonb_build_object('entra_object_id', o.entra_object_id, 'display_name', o.display_name, 'active', o.is_active)
    INTO v_prev FROM public.access_operator o WHERE o.db_login = p_db_login;
  INSERT INTO public.access_operator (db_login, entra_tenant_id, entra_object_id, display_name, is_active)
  VALUES (p_db_login, p_entra_tenant_id, p_entra_object_id, btrim(p_display_name), true)
  ON CONFLICT (db_login) DO UPDATE SET entra_tenant_id = EXCLUDED.entra_tenant_id, entra_object_id = EXCLUDED.entra_object_id,
    display_name = EXCLUDED.display_name, is_active = true;
  PERFORM public.access_write_audit(v_env.environment, session_user::text, NULL, 'operator_registered', NULL, p_db_login, NULL, v_prev,
    jsonb_build_object('entra_object_id', p_entra_object_id, 'display_name', btrim(p_display_name), 'active', true), v_reason, NULL);
END $$;

CREATE FUNCTION public.access_operator_deactivate(p_db_login text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_reason text := public.access_reason(p_reason);
  v_env text;
  v_prev jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7262013001);
  SELECT e.environment INTO v_env FROM public.access_environment e;
  SELECT jsonb_build_object('entra_object_id', o.entra_object_id, 'display_name', o.display_name, 'active', o.is_active)
    INTO v_prev FROM public.access_operator o WHERE o.db_login = p_db_login;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'ACCESS_OPERATOR_UNKNOWN: "%" is not a registered operator', p_db_login;
  END IF;
  IF NOT (v_prev ->> 'active')::boolean THEN
    RETURN;
  END IF;
  UPDATE public.access_operator SET is_active = false WHERE db_login = p_db_login;
  PERFORM public.access_write_audit(COALESCE(v_env, 'unconfigured'), session_user::text, NULL, 'operator_deactivated', NULL, p_db_login, NULL,
    v_prev, v_prev || jsonb_build_object('active', false), v_reason, NULL);
END $$;

-- ===================== Ownership and privileges =====================
-- PostgreSQL lets a non-superuser hand a function to another owner only if it can SET ROLE to that owner and the
-- owner has CREATE on the schema. Fail closed with a clear message; CREATE is granted only for these statements.
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND NOT pg_has_role(current_user, 'hrms_access_function_owner', 'SET') THEN
    RAISE EXCEPTION 'the migration role must be a superuser or able to SET ROLE hrms_access_function_owner (see the access-administration runbook)';
  END IF;
END $$;
GRANT CREATE ON SCHEMA public TO hrms_access_function_owner;
ALTER FUNCTION public.access_admin_permissions() OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_effective_permissions(uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_admin_count() OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_user_state(uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_begin(text) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_reason(text) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_check_guards(uuid, integer, text[], uuid, uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_write_audit(text, text, uuid, text, uuid, text, text, jsonb, jsonb, text, uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_require_user(uuid, jsonb) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_user_create(text, uuid, uuid, text, text, uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_user_set_enabled(text, uuid, boolean, jsonb, text, uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_role_assign(text, uuid, text, jsonb, text, uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_role_remove(text, uuid, text, jsonb, text, uuid) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_environment_configure(text, uuid, text) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_operator_register(text, uuid, uuid, text, text) OWNER TO hrms_access_function_owner;
ALTER FUNCTION public.access_operator_deactivate(text, text) OWNER TO hrms_access_function_owner;
REVOKE CREATE ON SCHEMA public FROM hrms_access_function_owner;

REVOKE ALL ON FUNCTION
  public.access_admin_permissions(), public.access_effective_permissions(uuid), public.access_admin_count(),
  public.access_user_state(uuid), public.access_begin(text), public.access_reason(text),
  public.access_check_guards(uuid, integer, text[], uuid, uuid),
  public.access_write_audit(text, text, uuid, text, uuid, text, text, jsonb, jsonb, text, uuid),
  public.access_require_user(uuid, jsonb),
  public.access_user_create(text, uuid, uuid, text, text, uuid),
  public.access_user_set_enabled(text, uuid, boolean, jsonb, text, uuid),
  public.access_role_assign(text, uuid, text, jsonb, text, uuid),
  public.access_role_remove(text, uuid, text, jsonb, text, uuid),
  public.access_environment_configure(text, uuid, text),
  public.access_operator_register(text, uuid, uuid, text, text),
  public.access_operator_deactivate(text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION access_audit_event_append_only() FROM PUBLIC;

-- Function owner: only what the routines need; no Core HR table privilege.
GRANT USAGE ON SCHEMA public TO hrms_access_function_owner, hrms_access_admin;
GRANT SELECT, INSERT ON app_user TO hrms_access_function_owner;
GRANT UPDATE (is_enabled, updated_at) ON app_user TO hrms_access_function_owner;
GRANT SELECT, INSERT, DELETE ON app_user_role TO hrms_access_function_owner;
GRANT SELECT ON access_role_permission TO hrms_access_function_owner;
GRANT SELECT, INSERT, UPDATE ON access_environment, access_operator TO hrms_access_function_owner;
GRANT INSERT ON access_audit_event TO hrms_access_function_owner;

-- Operators: read access-control data, execute the four guarded routines and the read helpers. No DML anywhere.
GRANT SELECT ON app_user, app_user_role, access_role_permission, access_environment, access_operator, access_audit_event TO hrms_access_admin;
GRANT EXECUTE ON FUNCTION
  public.access_user_create(text, uuid, uuid, text, text, uuid),
  public.access_user_set_enabled(text, uuid, boolean, jsonb, text, uuid),
  public.access_role_assign(text, uuid, text, jsonb, text, uuid),
  public.access_role_remove(text, uuid, text, jsonb, text, uuid),
  public.access_admin_permissions(), public.access_effective_permissions(uuid), public.access_admin_count(),
  public.access_user_state(uuid)
TO hrms_access_admin;

-- Infrastructure provisioning: only the role running this migration (the schema owner).
GRANT EXECUTE ON FUNCTION
  public.access_environment_configure(text, uuid, text),
  public.access_operator_register(text, uuid, uuid, text, text),
  public.access_operator_deactivate(text, text)
TO CURRENT_USER;
