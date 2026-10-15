# Eme People — Access Administration Runbook

- Scope: provisioning and day-to-day use of the guarded access-administration command (C-89, C-93; design `docs/design/access-administration-command.md`). Synthetic data only until the Real-Data Go/No-Go (readiness plan Gate A8).
- Audience: IT (infrastructure provisioning with owner credentials) and the named operators (Technical Owner and deputy, PV-26 / PV-28 F).
- Rule: application accounts and role assignments change **only** through `npm run access -- …`. Direct SQL on access-control tables is not a supported workflow and is technically impossible for operator logins.

## 1. Roles involved

| Role | Kind | Who | Purpose |
|---|---|---|---|
| schema owner (e.g. `hrms_owner`) | LOGIN | IT | migrations and the provisioning routines below (attended) |
| `hrms_app` | LOGIN | the application | runtime; **reads** accounts only |
| `hrms_access_function_owner` | NOLOGIN | nobody | owns the guarded routines (created by the migration) |
| `hrms_access_admin` | NOLOGIN group | — | SELECT on access-control tables + EXECUTE on the four guarded routines (created by the migration) |
| personal operator logins (≤ 2) | LOGIN, member of `hrms_access_admin` | named operators | run the command |

## 2. Prerequisites for migration `20261013000000_access_administration` (staging / production)

The migration creates the two NOLOGIN roles if they do not exist and transfers the routines to `hrms_access_function_owner`. It **fails closed** unless:

- the migration login can create roles (`CREATEROLE`) **or** IT pre-creates them exactly as:
  ```sql
  CREATE ROLE hrms_access_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  CREATE ROLE hrms_access_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ```
- the migration login is a superuser **or** can `SET ROLE hrms_access_function_owner` (e.g. `GRANT hrms_access_function_owner TO <migration_login> WITH SET TRUE, INHERIT FALSE;` — PostgreSQL ≥ 16). Without this the migration stops with a clear message; the routines are never left owned by the schema owner or a superuser.
- the pre-existing roles have no LOGIN/SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS attribute and `hrms_access_function_owner` is not a member of any role.

The migration also: revokes `INSERT/UPDATE/DELETE/TRUNCATE` on `app_user`/`app_user_role` from `hrms_app`, `CREATE` on schema `public` and `TEMPORARY` on the database from `PUBLIC`.

## 3. One-time environment provisioning (IT, owner credentials)

Run in a SQL session as the schema owner, on the target database, with a recorded reason:

```sql
-- 1. Identify the database (environment + Entra tenant of application users). Re-running updates and is audited.
SELECT public.access_environment_configure('production', '<EmeSoft tenant id>', '<change ticket / reason>');

-- 2. Personal operator login (password from the IT secret store; never a development value).
CREATE ROLE <operator_login> LOGIN PASSWORD '<from secret store>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT hrms_access_admin TO <operator_login>;
GRANT CONNECT ON DATABASE <database> TO <operator_login>;   -- no TEMPORARY, no other grants

-- 3. Trusted mapping login -> the operator's own Entra identity (used for the audit actor and the self-escalation guard).
SELECT public.access_operator_register('<operator_login>', '<EmeSoft tenant id>', '<operator Entra object id>', '<Display Name>', '<reason>');
```

- Staging/production refuse the development test tenant `11111111-1111-4111-8111-111111111111`.
- Registration refuses logins that are superuser, CREATEROLE, BYPASSRLS, members of the function owner, or not members of `hrms_access_admin`.
- Deactivate an operator: `SELECT public.access_operator_deactivate('<operator_login>', '<reason>');` then `DROP ROLE` or `ALTER ROLE … NOLOGIN` per IT practice.

## 4. Operator usage

Connection: `ACCESS_ADMIN_DATABASE_URL=postgresql://<operator_login>:<password>@<host>:<port>/<database>` on an IT-approved machine. The command refuses superuser/owner logins and development credentials for staging/production.

```bash
npm run access -- env --env production
npm run access -- user list --env production
npm run access -- user show --env production --oid <entra-oid>
npm run access -- user create --env production --oid <entra-oid> --name "<Display Name>" --role HR_ADMIN --reason "<HR request ref>"
npm run access -- role assign --env production --oid <entra-oid> --role HR_EDITOR --reason "<HR request ref>"
npm run access -- role remove --env production --oid <entra-oid> --role HR_EDITOR --reason "<HR request ref>"
npm run access -- user disable --env production --oid <entra-oid> --reason "<leaver ref>"
npm run access -- user enable --env production --oid <entra-oid> --reason "<return ref>"
npm run access -- role preview --env production --oid <entra-oid> --add HR_ADMIN
```

- Every mutation shows environment, operator, target, enabled state, roles before → after, retained roles on enable, the effective-permission delta and the active-administrator count after, then asks to type the environment name and the target display name (`--confirm <env>:<oid>` for scripted use).
- `--json` gives machine-readable output. Exit codes: `0` ok/no change · `1` usage/validation · `2` guard (last admin, self-escalation, duplicate) · `3` environment/identity · `4` state changed since preview (re-run) · `5` internal.
- Supported roles: `HR_ADMIN`, `HR_EDITOR`, `API_DOCS_READER`. `HR_VIEWER` is unsupported: it cannot be assigned, grants nothing if present and may be removed.

## 5. Bootstrap (first administrators)

1. After §3, with zero application users, the HR System Owner requests the first administrators in writing (C-90: prefer two) with their Entra object ids (from IT).
2. The operator runs `user create … --role HR_ADMIN --reason "<request>"` for each. From zero administrators this is allowed; once one exists the system never returns to zero.
3. The operator may not grant access to their own Entra identity; if a Technical Owner must also be an HR administrator, the deputy operator performs that grant.

## 6. Joiner / mover / leaver

| Event | Steps |
|---|---|
| Joiner (HR staff) | IT confirms the Entra account → operator `user create` with the requested role(s) |
| Mover | `role assign` / `role remove` |
| Leaver | IT disables the Entra account **and** the operator runs `user disable` (takes effect on the next request; roles are retained for audit and quick reinstatement) |
| Return | `user enable` (preview shows the roles that reactivate; confirm) |

## 7. Quarterly entitlement review (C-93 E)

The HR System Owner reviews the output of `npm run access -- user list --env production --json` and the access audit of the quarter (the operator can read it):

```sql
SELECT occurred_at, operator_login, action, target_user_id, role_code, previous_state, new_state, reason
FROM public.access_audit_event WHERE occurred_at >= now() - interval '3 months' ORDER BY occurred_at;
```

Access-audit retention: **Pending Legal Review** (PV-28 H). Nothing is deleted meanwhile (the table is append-only).

## 8. Recovery

No break-glass account. Inaccessible administrator → create/enable another (guards still apply); application login outage → the command is unaffected; role removed by mistake → re-assign with a reason; operator login lost → IT re-creates and re-registers it (§3).

## 9. Local development and tests

- `npm run db:migrate` then `npm run access:provision-local` (hrms_dev only): creates `hrms_local_operator` (public development password), environment `local`, and registers it. `ACCESS_ADMIN_DATABASE_URL=postgresql://hrms_local_operator:hrms_local_dev_only@127.0.0.1:55432/hrms_dev`.
- `npm run db:seed` creates the development accounts through the guarded routines.
- Tests: the guarded test setup provisions `hrms_test` (environment `test`, operators `hrms_test_operator_a/_b`) and seeds accounts through the routines; fixtures the routines refuse on purpose (e.g. a stale `HR_VIEWER` row) use the test owner connection on `hrms_test` only.
