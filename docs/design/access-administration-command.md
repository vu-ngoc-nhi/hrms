# Eme People — Guarded Access Administration Command (design, revision 2)

- Status: **IMPLEMENTED (2026-10-10, C-94)** — forward migration `20261013000000_access_administration`, CLI `npm run access`, runbook `docs/production/access-administration-runbook.md`. Development evidence for Gate A4 is complete; IT provisioning, named owners (PV-26) and a staging rehearsal are still required (readiness plan A4). See §18 for differences from the text above.
- Scope: the smallest safe access-management mechanism for **Gate A4**. Applies C-84, C-85, C-89, C-90, C-92 and the PV-28 decisions (§2). Real employee data remains prohibited (C-88).
- Out of scope (Gate C): role editor, custom roles, permission-membership administration, `access.manage` UI, scope/ABAC, Position → role mapping, Entra group provisioning.
- Revision 2 changes: (1) the operator no longer holds any raw DML on access-control tables — the **only mutation path is a small set of guarded database routines**; (2) the operator's identity, environment and Entra OID come from **protected, owner-maintained data keyed by `session_user`**, never from operator-settable values (the revision-1 `hrms.operator_oid` and `hrms.environment` settings are withdrawn — see §5).

## 1. Current state (verified 2026-10-10)

| Fact | Evidence |
|---|---|
| `app_user(id, entra_tenant_id, entra_object_id, display_name, is_enabled, created_at, updated_at)`, unique `(entra_tenant_id, entra_object_id)`; `app_user_role(user_id, role_code, granted_at, granted_by)` | init migration |
| Role-code DB constraint is a **format** CHECK `^[A-Z][A-Z0-9_]{1,49}$` (migration `20261008000000`); it accepts `HR_VIEWER` | migration SQL |
| Supported roles live in code: `ROLE_CODES = HR_ADMIN, HR_EDITOR, API_DOCS_READER`; unknown codes grant nothing | `src/modules/identity/permissions.ts` |
| The application only **reads** `app_user`/`app_user_role` (`authenticate.ts`, `test-identity.ts`); accounts are written only by the dev seed | repository search |
| `hrms_app` currently holds `SELECT, INSERT, UPDATE` on both tables and `DELETE` on `app_user_role` | init migration grants |
| Any PostgreSQL login can `SET` a custom setting (`hrms.operator_oid`) and override a database-level one (`hrms.environment`) in its own session; it **cannot** change `session_user` (`SET SESSION AUTHORIZATION` → 42501) | probe on `hrms_test` (read-only, rolled back), 2026-10-10 |

## 2. PV-28 decisions (recorded 2026-10-10)

| | Decision |
|---|---|
| A | **Reason mandatory** for user create, enable, disable, role assign, role remove. A concise operational reason is enough; no approval workflow. |
| B | **Capability-based administrator**: an active administrative user is an **enabled** application user whose **effective permissions** include all current critical admin capabilities `employment.correct`, `catalogs.manage`, `employees.set_code`. Never defined by role name. **One central definition** (§7), not scattered checks. |
| C | **No self-grant**: an operator must not grant application HR access to their own Entra identity. The operator identity used must come from a trustworthy source — never a CLI argument, an operator-controlled environment value or a writable session variable (§5). |
| D | **Disable retains role assignments**; enable reactivates them. Before enable: preview retained roles and effective permissions after enable; explicit confirmation required. |
| E | Every access mutation is **immediately audited**; formal entitlement review **quarterly**; no human approval/review per transaction. |
| F | Operator identities, DB/login identities and approved execution machines: **IT / Management decision** (open). |
| G | **Revoke mutation privileges** on access-control tables from `hrms_app` (it only reads them); adapt seed/test architecture in implementation. |
| H | Access-audit retention: **Pending Legal Review**; no period invented. |

## 3. Authoritative mutation path — options and choice

Requirement: *the guarded administration path must be the authoritative mutation path* — no raw `INSERT/UPDATE/DELETE` on `app_user`, `app_user_role`, `access_audit_event` (or any access-control table) for the human operator.

| | A. Guarded database routines (SECURITY DEFINER) | B. Separate guarded service with a restricted service credential |
|---|---|---|
| Enforcement point | PostgreSQL grants: operator login has `EXECUTE` on a few routines and `SELECT` on access tables only | The service process; the operator authenticates to the service |
| Bypass by a technical owner who administers the host | **Not possible with the operator login** (no DML privilege at all); only the separately held owner/superuser credential could bypass | Possible if the operator can read the service credential on the host — likely at EmeSoft, where the same people run the host |
| Extra infrastructure | None (functions ship in a migration) | A running service, an operator authentication channel, credential isolation |
| Transaction + lock + audit atomicity | Inside each routine, one transaction | In the service |
| Logic location | Security invariants in SQL; UX in the TypeScript CLI | All in TypeScript |
| Cost | PL/pgSQL to test; role/capability reference data mirrored in the DB (drift-tested) | New process and auth layer — closer to an "admin platform" |

**Chosen: A — guarded database routines.** It is the smallest design whose boundary holds even against an operator who administers the application host, and it adds no running component. Security invariants (allow-list, last-admin, self-grant, reason, audit) live in the database — consistent with C-84 ("database for invariants") — while the TypeScript CLI provides the preview/confirmation UX and calls the routines.

## 4. Architecture

```
Operator (named; personal DB login, member of hrms_access_admin)
   │ runs on an IT-approved machine
   ▼
CLI  scripts/access-admin.ts  (TypeScript)
   - pre-checks (target environment, login is not owner/superuser)
   - reads current state (SELECT only) and shows preview + effective permissions (code: permissionsForRoles)
   - typed confirmation for sensitive changes
   - BEGIN (READ COMMITTED) → SELECT access_*(...) → COMMIT
   ▼
PostgreSQL — guarded routines (SECURITY DEFINER, owned by the schema owner, fixed search_path)
   1. assert READ COMMITTED; take pg_advisory_xact_lock(<access key>)
   2. resolve operator from session_user via access_operator (must exist, active)
   3. assert caller's environment matches access_environment
   4. validate input (reason, role allow-list from access_role, tenant)
   5. compare expected state fingerprint
   6. guards: last-admin, self-grant
   7. mutate app_user / app_user_role
   8. INSERT access_audit_event (same transaction)
```

### Routines (the complete mutation surface)

| Routine | Effect |
|---|---|
| `access_user_create(tenant, oid, display_name, reason, correlation_id)` | creates an enabled user without roles |
| `access_user_set_enabled(user_id, enabled, expected_state, reason, correlation_id)` | disable (roles retained) / enable (roles reactivate) |
| `access_role_assign(user_id, role_code, expected_state, reason, correlation_id)` | adds a supported role |
| `access_role_remove(user_id, role_code, expected_state, reason, correlation_id)` | removes any stored code (incl. ineffective ones such as `HR_VIEWER`) |

- `expected_state` = fingerprint of `{enabled, sorted roles}` shown in the preview; mismatch → `ACCESS_STATE_CHANGED`.
- A "create with roles" CLI invocation calls `access_user_create` then `access_role_assign` in **one** transaction with one `correlation_id`.
- Errors are raised with stable codes (`ACCESS_REASON_REQUIRED`, `ACCESS_ROLE_NOT_SUPPORTED`, `ACCESS_LAST_ADMIN`, `ACCESS_SELF_GRANT`, `ACCESS_OPERATOR_UNKNOWN`, `ACCESS_ENVIRONMENT_MISMATCH`, `ACCESS_TENANT_MISMATCH`, `ACCESS_USER_EXISTS`, `ACCESS_STATE_CHANGED`, `ACCESS_ISOLATION`), mapped to CLI exit codes (§12).
- No-op requests (assign an assigned role, disable a disabled user…) return "no change" and write nothing, including no audit row.
- Hardening: `SECURITY DEFINER` with `SET search_path = public, pg_temp` (pg_temp last), schema-qualified references, `REVOKE EXECUTE … FROM PUBLIC`, `GRANT EXECUTE … TO hrms_access_admin` only.
- Read operations (`env`, `user list`, `user show`, `role preview`) use plain `SELECT` on access tables (read-only, no HR data).

## 5. Trusted operator identity and environment

**Why the revision-1 approach was unsafe:** `hrms.operator_oid` and `hrms.environment` are PostgreSQL settings any session can set or override (probe in §1). Neither can be trusted.

**Revision 2 — identity derived from authenticated infrastructure identity:**

- **`session_user`** is the PostgreSQL login authenticated by the server; a non-superuser cannot change it (`SET ROLE` changes only `current_user`; inside a SECURITY DEFINER routine `current_user` is the owner but `session_user` stays the caller).
- **`access_operator`** (protected mapping, owner-maintained):

  | Column | Meaning |
  |---|---|
  | `db_login` text PK | the operator's PostgreSQL login (`session_user`) |
  | `entra_tenant_id`, `entra_object_id` uuid NOT NULL | the operator's own Entra identity (for the self-grant guard) |
  | `display_name` text | for audit readability |
  | `is_active` boolean | deactivated operators are refused |
  | `registered_at` timestamptz | |

  Written **only** by the schema owner through two owner-only routines `access_operator_register` / `access_operator_deactivate` (no `EXECUTE` granted to anyone; run by IT as an infrastructure step) that also write an audit row (`operator_registered`, `operator_deactivated`). `hrms_access_admin` has `SELECT` only. The CLI never accepts an operator OID.

- **`access_environment`** (single row, owner-maintained at provisioning): `environment` (`local|test|staging|production`), `entra_tenant_id` (expected tenant for application users). The CLI's mandatory `--env` must equal it; routines also use its tenant to refuse other tenants (the development test tenant is only accepted where the row says `local`/`test`).
- **Audit actor** = `session_user` (DB-captured) + the mapped operator OID — both from trustworthy sources.
- Self-grant guard: `access_user_create`, `access_user_set_enabled(enable)` and `access_role_assign` reject a target whose `(tenant, oid)` equals the calling operator's mapped identity. The preview warns when the target is another registered operator (detective control, reviewed quarterly).

## 6. Bootstrap

1. Production is migrated (no users exist; migrations seed none).
2. IT, with owner credentials, inserts the `access_environment` row (`production`, EmeSoft tenant) and registers the named operator login(s) via `access_operator_register` (PV-28 F).
3. The operator creates the first administrators (C-90: prefer two) with `user create … --roles HR_ADMIN` and a reason; each step is audited.

Rule: when the system has **zero** active administrators (never initialised), creating/enabling/assigning that produces an administrator is allowed. Once **≥ 1** exists, no mutation may produce **0**. "At least two" remains an operational recommendation (warning when exactly one remains), not a constraint. No separate break-glass framework: recovery goes through the same guarded routines (§13).

## 7. Last-admin invariant and the central admin definition

- **Definition (one place):** `ADMINISTRATIVE_PERMISSIONS = ["employment.correct", "catalogs.manage", "employees.set_code"]` and `isAdministrative(effectivePermissions)` in `src/modules/identity/permissions.ts` — the only TypeScript definition, used by the CLI preview.
- **Enforcement data (mirror):** the routines need the same knowledge without trusting the caller, so the migration creates code-controlled reference tables, changed only by migrations:
  - `access_role(code PK, assignable boolean)` — `HR_ADMIN`, `HR_EDITOR`, `API_DOCS_READER` assignable;
  - `access_role_permission(role_code, permission)` — mirror of `ROLE_PERMISSIONS`;
  - `access_admin_capability(permission)` — mirror of `ADMINISTRATIVE_PERMISSIONS`.

  A **contract test** fails if any mirror differs from the code. Runtime authorization of the API is unchanged (still the code map). These tables are not configurable RBAC: no routine edits them; they are also the natural seed for C-85's future stored role definitions.
- **Invariant:** for every mutating routine, `admins_before ≥ 1 ∧ admins_after = 0 ⇒ reject (ACCESS_LAST_ADMIN)`, where admins = enabled users whose union of `access_role_permission` over their **supported** roles ⊇ `access_admin_capability`. Ineffective stored codes (e.g. `HR_VIEWER`) contribute nothing.

## 8. Concurrency proof

Every mutating routine starts with `pg_advisory_xact_lock(<constant access key>)` and asserts `transaction_isolation = 'read committed'` (otherwise `ACCESS_ISOLATION`). Under READ COMMITTED each statement after acquiring the lock sees all transactions committed before it. Since **every** mutation goes through these routines (no DML exists for the operator, `hrms_app` or anyone but the owner), all access mutations are totally ordered by the lock.

| Scenario (2 admins A, B unless stated) | Outcome |
|---|---|
| T1 disables A, T2 disables B concurrently | T1 holds the lock, 2→1, commits; T2 acquires the lock, counts 1 (B), disabling B → 0 → `ACCESS_LAST_ADMIN`, rolled back |
| T1 removes HR_ADMIN from A, T2 removes it from B | Same ordering; the second is rejected |
| T1 disables A, T2 removes B's HR_ADMIN | Same; the second is rejected |
| Only A exists; T1 disables A | Rejected immediately (1→0) |
| Bootstrap: zero admins; two operators create two different first admins | Both succeed (0→1, 1→2) |
| Bootstrap: both create the **same** `(tenant, oid)` | Second waits, then sees the row → `ACCESS_USER_EXISTS` |
| Preview taken, state changed by another operator before commit | `ACCESS_STATE_CHANGED`, nothing written |
| Failure after the first write (e.g. audit insert error) | Whole transaction rolls back; no partial state |

The lock is transaction-scoped (released at commit/rollback), so a crashed client cannot leave it held.

## 9. Why raw SQL cannot bypass the guards

| Attempt by an operator login | Result |
|---|---|
| `INSERT/UPDATE/DELETE` on `app_user`, `app_user_role` | permission denied (no grant) |
| Insert/alter/delete `access_audit_event` rows | permission denied (SELECT only); a trigger additionally rejects `UPDATE/DELETE` (only the owner could remove it — infrastructure trust, §9 last line) |
| Edit `access_operator`, `access_environment`, `access_role*`, `access_admin_capability` | permission denied |
| Spoof identity with `SET hrms.operator_oid` / `SET hrms.environment` | irrelevant — routines never read settings; identity = `session_user` → `access_operator` |
| `SET SESSION AUTHORIZATION` / `SET ROLE` to the owner | denied / not a member |
| Hijack `search_path` (temp objects) | routines pin `search_path = public, pg_temp` and qualify names; operator cannot create objects in `public` |
| Call a routine with `HR_VIEWER` or a made-up role | `ACCESS_ROLE_NOT_SUPPORTED` |
| Call a routine without a reason / with REPEATABLE READ | rejected |
| Read HR tables | permission denied (no grant on any HR table) |
| `hrms_app` (runtime) writes accounts | denied after PV-28 G (SELECT only) |

Remaining trust: the schema owner and the database superuser can bypass anything — they are infrastructure credentials held by IT, separate from operator logins, used only for migrations/provisioning (C-07, SEC-12).

## 10. DB privilege model

| Role | Kind | Privileges |
|---|---|---|
| schema owner (`hrms_owner` / production equivalent) | migrations + provisioning (attended) | owns tables and routines; registers operators |
| `hrms_app` | runtime | HR tables unchanged; **`SELECT` only** on `app_user`, `app_user_role`; nothing on `access_*` tables or routines |
| `hrms_access_admin` | NOLOGIN group | `SELECT` on `app_user`, `app_user_role`, `access_audit_event`, `access_operator`, `access_environment`, `access_role`, `access_role_permission`, `access_admin_capability`; `EXECUTE` on the four mutation routines; **no DML anywhere; no HR-table privilege** |
| operator logins (≤ 2, named) | LOGIN, member of `hrms_access_admin` | inherited only |

## 11. Security audit — `access_audit_event`

| Column | Source |
|---|---|
| `id` bigint identity, `occurred_at` timestamptz `now()` | DB |
| `operator_login` | `session_user` (DB) |
| `operator_entra_object_id` | `access_operator` (protected) |
| `environment` | `access_environment` (protected) |
| `target_user_id` → `app_user` (null for operator events) | routine |
| `action` CHECK in `user_created, user_enabled, user_disabled, role_assigned, role_removed, operator_registered, operator_deactivated` | routine |
| `role_code` | routine |
| `previous_state`, `new_state` jsonb `{enabled, roles}` | routine (no HR profile data) |
| `reason` NOT NULL (1–500 chars, trimmed) | caller, validated |
| `correlation_id` uuid | caller (groups one CLI invocation) |

Append-only: inserted only inside the mutation routines in the same transaction as the change (no change → no row); `SELECT` for `hrms_access_admin`; no privilege for `hrms_app`; `UPDATE/DELETE` blocked by grants and by a trigger. A fabricated audit row cannot be inserted independently of a real mutation. Retention: **Pending Legal Review** (PV-28 H).

## 12. CLI / command UX (unchanged in intent)

- Verbs: `env`, `user list`, `user show`, `user create`, `user enable`, `user disable`, `role assign`, `role remove`, `role preview`. `--env` and `--reason` mandatory for mutations; `--json` output.
- Always shows: environment (from `access_environment`), operator (from `access_operator` via the login), target, current → proposed roles, retained roles on enable (PV-28 D), effective-permission diff (code `permissionsForRoles`), administrators after.
- Typed confirmation (environment name + target display name) for: enable, disable, assign `HR_ADMIN`, any remove; `--confirm <env>:<oid>` for scripted tests.
- Exit codes: `0` success/no change · `1` usage/validation (`ACCESS_REASON_REQUIRED`, `ACCESS_ROLE_NOT_SUPPORTED`) · `2` guard (`ACCESS_LAST_ADMIN`, `ACCESS_SELF_GRANT`, `ACCESS_USER_EXISTS`) · `3` environment/identity (`ACCESS_ENVIRONMENT_MISMATCH`, `ACCESS_OPERATOR_UNKNOWN`, `ACCESS_TENANT_MISMATCH`, owner/superuser login) · `4` `ACCESS_STATE_CHANGED` · `5` internal.
- Connection: `ACCESS_ADMIN_DATABASE_URL` for the personal login; password from the IT secret store or prompt, never in the repository. The CLI refuses owner/superuser logins and development credentials for `staging`/`production` (defence in depth; the routines enforce the real rules).
- Never prints HR data (the login cannot read it).

## 13. Entra relationship, privacy boundary, recovery (unchanged)

- Entra authenticates; Eme People authorizes. Accounts are pre-provisioned by `(tenant, oid)`; sign-in must match. Disabling in Eme People denies on the next request; disabling in Entra stops new tokens (existing ones expire); the leaver procedure does both.
- The operator can administer access without any access to Core HR records (no grant).
- Recovery without break-glass: inaccessible admin → operator creates/enables another; Entra/login outage → command unaffected; role removed by mistake → re-assign with reason; operator login lost → IT re-registers via owner routine.

## 14. HR_VIEWER and role validation

The routines enforce the supported allow-list (`access_role.assignable`). `HR_VIEWER` cannot be newly assigned; if stored it has no effective permissions (absent from `access_role_permission` and from the code map) and may be removed. No cleanup migration.

## 15. Expected implementation impact (for approval)

| Area | Change |
|---|---|
| Migration (one, forward, non-destructive) | Tables `access_audit_event`, `access_operator`, `access_environment`, `access_role`, `access_role_permission`, `access_admin_capability` (reference rows = code); four mutation routines + two owner-only operator routines (SECURITY DEFINER, pinned search_path); audit UPDATE/DELETE trigger; grants to `hrms_access_admin`; **revoke `INSERT, UPDATE, DELETE` on `app_user`, `app_user_role` from `hrms_app`**. Fails closed if `hrms_access_admin` does not exist |
| Infrastructure | Create NOLOGIN `hrms_access_admin`; named operator logins; insert `access_environment` row; register operators (owner) — IT for staging/production; `docker/db-init` + a documented one-off local step for development; test reset creates them for `hrms_test` |
| Code | `ADMINISTRATIVE_PERMISSIONS` + `isAdministrative` in `permissions.ts`; `scripts/access-admin.ts` CLI (pg client, READ COMMITTED transaction, preview, confirmation); no API change; runtime authorization unchanged |
| Seed / tests | Development seed and test setup create accounts **through the routines** using a local/test-only operator login (public dev password, like the other dev roles; refused outside local/test by `access_environment`); fixtures needing odd states (disabled account) use the routines too; any direct account writes in tests move to the owner connection for fixture setup only |
| Contract tests | Mirrors (`access_role*`, `access_admin_capability`) equal the code; routine list and grants as expected |
| Docs | Operator runbook (bootstrap, joiner/leaver, quarterly review query) |

## 16. Implementation test plan

1. Create user → row + `user_created` audit with `session_user` and mapped operator OID.
2. Duplicate `(tenant, oid)` → `ACCESS_USER_EXISTS`; no audit.
3. Enable/disable; roles retained on disable; enable reactivates; no-op → no audit.
4. Assign/remove; duplicate assignment → no change; remove of stored `HR_VIEWER` allowed.
5. Unsupported role (`HR_VIEWER`, `FOO`) → `ACCESS_ROLE_NOT_SUPPORTED`; malformed → rejected.
6. Reason missing/blank → `ACCESS_REASON_REQUIRED` for each of the five mutations.
7. Last-admin: disable only admin, remove HR_ADMIN from only admin → rejected; disable one of two → allowed with warning; change leaving another admin → allowed; bootstrap from zero → allowed.
8. Concurrency (two operator connections, repeated): disable/disable, remove/remove, disable/remove on the last two admins → exactly one succeeds; concurrent bootstrap of different users → both; of the same user → one.
9. `ACCESS_STATE_CHANGED` when the fingerprint is stale; `ACCESS_ISOLATION` under REPEATABLE READ.
10. Bypass attempts as the operator login: DML on every access table denied; audit insert/update/delete denied; edits to `access_operator`/`access_environment`/reference tables denied; `SET hrms.operator_oid`/`hrms.environment` has no effect; `SET SESSION AUTHORIZATION` denied; SELECT on `person`/`employment`/`audit_event` denied.
11. Self-grant: operator targeting own mapped OID → `ACCESS_SELF_GRANT` (create, enable, assign).
12. Unknown/deactivated operator login → `ACCESS_OPERATOR_UNKNOWN`; environment row missing/mismatch → `ACCESS_ENVIRONMENT_MISMATCH`; foreign tenant (incl. test tenant in staging/production) → `ACCESS_TENANT_MISMATCH`.
13. `hrms_app` cannot write `app_user`/`app_user_role`; authentication still works (SELECT); disabled user → 403.
14. Effective permissions shown by the CLI equal `permissionsForRoles`; mirror contract test.
15. Rollback: failure after the first write → nothing committed.
16. Full quality gate after the seed/test architecture change (main suite, UAT suites, clean baseline, integrity scan).

## 17. Remaining decisions

| Area | Item | Owner | Blocks implementation? |
|---|---|---|---|
| IT / Management | Named operators (≤ 2), their DB logins and Entra OIDs, approved execution machines, credential storage (PV-28 F, PV-26) | IT + Management | **No** — needed before staging/production use; implementation and tests use a local/test operator |
| IT | Who holds owner credentials and performs operator registration / `access_environment` provisioning per environment | IT | No (same) |
| Legal | Access-audit retention (PV-28 H; with Q-L3) | Legal | No (keep-all meanwhile) |
| HR | — (PV-28 A–E and G decided) | — | — |

**No business decision blocks implementation.** Implementation still requires explicit approval of this revision.

## 18. Implementation notes (2026-10-10)

Implemented as designed in revision 2 with the final technical constraints of the implementation approval:

| Topic | As implemented |
|---|---|
| SECURITY DEFINER owner | Dedicated `hrms_access_function_owner` (NOLOGIN, NOSUPERUSER, NOINHERIT, no members, no CREATE/TEMP). Grants: `app_user` SELECT, INSERT, UPDATE(`is_enabled`, `updated_at`); `app_user_role` SELECT, INSERT, DELETE; `access_role_permission` SELECT; `access_environment`/`access_operator` SELECT, INSERT, UPDATE; `access_audit_event` INSERT. No Core HR table. The migration fails closed if it cannot transfer ownership (non-superuser without `SET ROLE` on the owner); routines are never left owned by the schema owner. |
| Policy mirror — reduced from three tables to **one** | `access_role_permission(role_code, permission)` only. Its distinct role codes are the supported allow-list; its rows give effective permissions. The administrative capability set is an `IMMUTABLE` migration-defined function `access_admin_permissions()` (no table). `access_role` and `access_admin_capability` from revision 2 were unnecessary. Contract test: equal to `ROLE_PERMISSIONS` / `ADMINISTRATIVE_PERMISSIONS`; the CLI also refuses to run on drift. |
| Central admin definition | `ADMINISTRATIVE_PERMISSIONS` + `isAdministrative()` in `permissions.ts` (code) and `access_admin_count()` in the DB; no role-name checks (test asserts the access modules contain no role name or admin permission literal). |
| Self-escalation (generalised) | Rule: an operator may not perform any access action after which the effective permissions of **their own** Entra identity contain a permission they did not have before. Covers own role assignment and enabling an own disabled account whose retained roles would reactivate. Self-reducing actions (remove own role, disable own account) are allowed subject to the last-admin rule. Creating one's own account **without roles** adds no permission and is therefore allowed. |
| Operator identity / environment | `session_user` → `access_operator` (owner-maintained); `access_environment` single row. No custom setting is read. Routines also take the target environment as a parameter and compare it. |
| Privilege boundary | Operators: exactly SELECT on the six access-control tables, EXECUTE on four mutation routines and four read helpers; no DML, no CREATE on `public`, no TEMP. The migration additionally revokes `TEMPORARY` on the database from `PUBLIC` (defence in depth; no role needs temporary objects). |
| Routine hardening | `SET search_path = pg_catalog, pg_temp` on every routine; all access tables and routines referenced as `public.…` (tested); a test operator granted TEMP solely for the test proves that shadow tables in `pg_temp` and a caller `search_path` do not change behaviour. |
| Concurrency | `pg_advisory_xact_lock` in every routine + READ COMMITTED assertion; tests: overlapping transactions on the last two administrators (disable/disable, remove/remove, mixed) → exactly one succeeds; uncoordinated races never reach zero; concurrent bootstrap from zero → both succeed with consistent audit; same identity twice → one `ACCESS_USER_EXISTS`. |
| Error codes | `ACCESS_REASON_REQUIRED`, `ACCESS_ROLE_NOT_SUPPORTED`, `ACCESS_INVALID_INPUT`, `ACCESS_USER_NOT_FOUND`, `ACCESS_USER_EXISTS`, `ACCESS_LAST_ADMIN`, `ACCESS_SELF_ESCALATION`, `ACCESS_ENVIRONMENT_MISMATCH`, `ACCESS_OPERATOR_UNKNOWN`, `ACCESS_TENANT_MISMATCH`, `ACCESS_STATE_CHANGED`, `ACCESS_ISOLATION`; CLI-only `ACCESS_UNSAFE_CONNECTION`, `ACCESS_POLICY_DRIFT`, `ACCESS_CONFIRMATION_REQUIRED`. |
| Seeds / tests | `hrms_app` lost account-table DML; development and test accounts are created through the routines by development operator logins (`npm run access:provision-local`; test global setup). Fixtures the routines refuse on purpose (stale `HR_VIEWER`) use the test owner connection on `hrms_test` only. |
| Not built | Role editor, `access.manage` UI, custom roles, scope/ABAC, Position → role, Entra group provisioning (Gate C). |

