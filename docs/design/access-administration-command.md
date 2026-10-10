# Mini HRS — Guarded Access Administration Command (design)

- Status: **DESIGN / SECURITY REVIEW — awaiting approval. Nothing is implemented.** Open decisions: PV-28 (§19).
- Scope: the smallest safe access-management mechanism required for **Gate A4** of the readiness plan. Decisions applied: C-84, C-85, C-89 (guarded command), C-90 (named ownership, ≥ 2 HR admin accounts preferred), C-92 (no configurable roles for first go-live). Real employee data remains prohibited (C-88).
- Out of scope: role editor, custom roles, permission-membership administration, `access.manage` UI, scope/ABAC, Position → role mapping, Entra group provisioning (Gate C).

## 0. Current state (verified in the repository, 2026-10-10)

| Fact | Evidence |
|---|---|
| `app_user(id uuid PK, entra_tenant_id uuid, entra_object_id uuid, display_name, is_enabled, created_at, updated_at)`, unique `(entra_tenant_id, entra_object_id)` | init migration, `prisma/schema.prisma` |
| `app_user_role(user_id, role_code, granted_at, granted_by → app_user)`, PK `(user_id, role_code)` | init migration |
| Role-code constraint is a **format** CHECK `^[A-Z][A-Z0-9_]{1,49}$` (migration `20261008000000_mvp_decisions` replaced the original `IN (... 'HR_VIEWER' ...)` list). The database therefore accepts any well-formed code, including `HR_VIEWER` | migration SQL |
| Allow-list in code: `ROLE_CODES = HR_ADMIN, HR_EDITOR, API_DOCS_READER`; `permissionsForRoles` ignores unknown codes (fail closed) | `src/modules/identity/permissions.ts` |
| Authentication matches `(tid, oid)` of the token to `app_user`; no user or a disabled user → 403; the app never creates users | `authenticate.ts` |
| Accounts and roles are written **only by the development seed** (`scripts/seed-data.ts`, local-only); there is no production path except SQL | repository search |
| The runtime role `hrms_app` holds `SELECT, INSERT, UPDATE` on `app_user`/`app_user_role` and `DELETE` on `app_user_role`, although the application only reads them | init migration grants |
| `audit_event` is the employee/business audit: `actor_user_id → app_user`, structural old/new allow-list (C-24) | audit migrations |

Correction: `docs/design/access-control-direction.md` §2 described the role CHECK as the original `IN (...)` list; it is the format CHECK above (corrected in that document).

## 1. Proposed architecture

```
Technical Owner (named operator)
   │  runs on the protected operations host, with a personal DB login
   ▼
access-admin command (TypeScript, repo `scripts/access-admin.ts`, same build as the app)
   │  1. environment guard (fail closed)            ── §9
   │  2. parse + validate (role allow-list from code) ── §11
   │  3. preview (current → proposed, effective permissions)
   │  4. typed confirmation for sensitive changes
   │  5. ONE transaction: global access lock → re-read → guards → write → security audit
   ▼
PostgreSQL: app_user, app_user_role, access_audit_event (new)
   (operator login = member of hrms_access_admin: no access to any HR table)
```

- **Service layer, not table editing.** All rules live in one module (e.g. `src/modules/identity/access-admin.ts`): allow-list, last-admin guard, self-grant guard, audit. The CLI is a thin shell over it, so a future in-app screen (Gate C) reuses the same service.
- **Single source for permissions:** previews and the admin definition use `permissionsForRoles` from `permissions.ts`; no role semantics are re-implemented.

### Supported operations

| Area | Operation | Writes | Confirmation |
|---|---|---|---|
| Context | `env` — show environment, database, operator | no | — |
| User | `user list` — enabled/disabled users with roles (optional but useful for access reviews) | no | — |
| User | `user show <user>` — identity, enabled, roles (flagging ineffective codes), effective permissions | no | — |
| User | `user create --oid --name [--roles]` — register a pre-provisioned account | yes | typed (production) |
| User | `user enable <user>` / `user disable <user>` | yes | typed |
| Role | `role assign <user> <ROLE>` / `role remove <user> <ROLE>` | yes | typed for `HR_ADMIN` and for any removal |
| Role | `role preview <user> --add/--remove` — resulting effective permissions, no write (also shown before every write) | no | — |

Not included: create role, edit role permissions, custom permissions, scope, Entra group sync, display-name editing beyond `create` (optional later).

## 2. Application-user identity

- **Security identity = `(entra_tenant_id, entra_object_id)`** — the Entra object id (`oid`) is immutable for the account within the tenant and is exactly what the API verifies (`tid` + `oid` claims). It is already the unique key.
- **Not identity:** email/UPN (can change, may be reused); `display_name` (informational only); the internal `app_user.id` (internal key, shown for reference).
- No UPN/email column is added (no need; avoids storing more personal data). The operator obtains the `oid` from the Entra admin center (IT) and may show the UPN in the confirmation **only from the command line input**, not stored.
- **Tenant is not typed by the operator in production**: it is taken from the configured `ENTRA_TENANT_ID`; `user create` in production refuses any other tenant. The development test tenant (`11111111-…`) is refused outside local/test.
- **Non-prod → production transition:** each environment has its own database; production starts with **no** users (migrations seed none, the dev seed refuses non-local databases). Staging uses the same EmeSoft tenant with a non-production app registration, so HR users' `oid`s are the same in staging and production — but accounts are created separately in each environment with the command; nothing is copied. Seeded test accounts never reach production; `user list` in production flags any account outside the configured tenant as an anomaly.

## 3. Bootstrap (first production administrator)

**No separate bootstrap mechanism.** Operator authority comes from infrastructure (§4), not from an application login, so the normal command works when zero administrators exist:

1. IT creates the Technical Owner's personal DB login as a member of `hrms_access_admin` (stored in the secrets store; never the owner role, never a development password).
2. HR System Owner requests, in writing, the first two HR administrators (C-90) with their Entra `oid`s (provided by IT).
3. Technical Owner runs `user create … --roles HR_ADMIN` for each, with `--env production`, typed confirmation and the request reference as reason.
4. The command records both in the security audit, then prints the access summary for the HR System Owner.

The last-admin guard only forbids going **from ≥ 1 to 0** administrators; creating the first one is allowed. The Technical Owner never needs HR roles or HR data for this.

## 4. Operator authority (A) vs application roles (B)

| | A. Who may run the command | B. What users can do in Mini HRS |
|---|---|---|
| Established by | **Infrastructure**: a personal DB login per operator, member of the group role `hrms_access_admin`, plus access to the protected operations host and the secrets store | `app_user_role` rows → `permissionsForRoles` (code) |
| Granted by | IT (on Management's naming, PV-26) | the operator, on the HR System Owner's request |
| Gives HR data access? | **No** — `hrms_access_admin` has no privilege on any HR table | Yes, per role |

- No application-level IAM layer is added: the database already authenticates the operator and the group role limits what the session can touch.
- **Operator identity in the audit is captured by the database (`session_user`)**, not typed by the operator, so it cannot be forged by the CLI. An optional per-login setting `hrms.operator_oid` (IT sets `ALTER ROLE … SET hrms.operator_oid = '<oid>'`) links the operator to their own Entra account for the self-grant guard (§6).
- Recommended: at most two named operators (Technical Owner + deputy).

## 5. Last-admin rule

**Administrative user (Phase 1) = an enabled `app_user` whose effective permissions include every permission in `ADMINISTRATIVE_PERMISSIONS`**, a code constant in `permissions.ts` defined as the capabilities needed to keep HR operations correctable: `employment.correct`, `catalogs.manage`, `employees.set_code`. With the fixed bundles this is exactly the set of enabled HR_ADMIN holders — but expressed through permissions (C-85, no role-name check), so a future configurable role that carries these capabilities counts automatically; when `access.manage` exists the constant is extended to include it.

Rule: **a change is rejected if, after it, the number of administrative users would be 0 while it was ≥ 1 before.** Evaluated for `user disable`, `role remove` (and any future operation that reduces permissions).

- "At least two administrators" stays an **operational recommendation** (C-90): the command prints a warning when the result is exactly one administrator; it does not block. No DB constraint (the admin definition depends on code-defined permissions; a DB trigger would hard-code role names).

| Case | Result |
|---|---|
| Disable the only remaining admin | Rejected (exit 2), nothing written |
| Remove `HR_ADMIN` from the only remaining admin | Rejected |
| Disable one of two admins | Allowed; warning "1 administrator remains" |
| Role change leaving another active admin | Allowed |
| Create / enable / assign when 0 admins exist | Allowed (bootstrap) |
| Remove an ineffective code (e.g. `HR_VIEWER`) from the only admin | Allowed (no permission change) |

## 6. Privilege-escalation safeguards (proportional, no approval chain)

| Risk | Control |
|---|---|
| Operator grants themselves HR access | **Self-grant guard**: if `hrms.operator_oid` is set for the session, any create/enable/assign targeting that `oid` is rejected. In production the setting is **required** (the command refuses to run without it). Detective control: every grant is audited with the DB-verified operator and summarised to the HR System Owner |
| A user changes their own roles | No application endpoint writes roles; HR users have no DB access; only operators can (and not for themselves) |
| Disabled account re-enabled incorrectly | `user enable` shows the roles that will become effective again, requires typed confirmation and a reason; audited (`user_enabled` with previous/new state) |
| Unknown / retired / malformed role | Only codes in `ROLE_CODES` can be assigned; anything else → usage error (exit 1). The DB format CHECK remains as the second line |
| Bypassing permission definitions | Roles are bundles defined only in code; the command cannot create or edit them; previews use the same function the API uses |
| Runtime app compromise used to edit roles | Recommended hardening in implementation: revoke `INSERT/UPDATE/DELETE` on `app_user`/`app_user_role` from `hrms_app` (it only reads them); see §12 |
| Operator without HR role reads HR data | Impossible by grants: `hrms_access_admin` has no privilege on HR tables (§12) |

## 7. Security audit

**Recommendation: a small dedicated append-only table `access_audit_event`**, not the existing `audit_event`. Reasons: `audit_event.actor_user_id` must reference an application user, but operators are not application users; the employee audit has a structural allow-list designed for HR fields; C-85 requires a separate security trail; retention may differ (Pending Legal Review).

| Column | Meaning |
|---|---|
| `id` bigint identity | event id |
| `occurred_at` timestamptz default `now()` | timestamp |
| `operator` text default `session_user` | DB-verified operator login (not client-supplied) |
| `operator_oid` uuid null | from `hrms.operator_oid`, when set |
| `environment` text | from the database environment identifier (§9) |
| `target_user_id` uuid → `app_user` | affected application user |
| `action` text CHECK in (`user_created`, `user_enabled`, `user_disabled`, `role_assigned`, `role_removed`) | action |
| `role_code` text null | role for role actions |
| `previous_state` / `new_state` jsonb | `{ "enabled": bool, "roles": [codes] }` only — no HR profile data |
| `reason` text | request reference / reason (mandatory — PV-28 a) |
| `correlation_id` uuid | one id per command invocation (a create with roles = several events, same id) |

Append-only: `hrms_access_admin` gets `INSERT, SELECT`; nobody gets `UPDATE/DELETE` (owner only, as for `audit_event`); `hrms_app` gets no privilege (not needed). Writes happen in the **same transaction** as the change. No-op commands write nothing.

## 8. Atomicity and concurrency

- **One transaction per command** containing the guard evaluation, the writes and the audit rows; any failure rolls back everything.
- **Global access lock:** every mutating command first takes `pg_advisory_xact_lock(<constant key 'hrms.access_admin'>)`. All access changes are therefore serialised (volume: a few per month), which makes the last-admin count race-free without SERIALIZABLE isolation or triggers. Two operators disabling the last two admins concurrently: the second waits, re-reads, sees one admin left → rejected.
- **Preview-then-commit check:** the preview shows a state fingerprint (enabled + sorted roles). After confirmation, the transaction re-reads under the lock; if the state differs, it aborts with "state changed, re-run" (exit 4). This is the optimistic-concurrency check; no revision column is needed.
- **Idempotency by state:** assigning an already-assigned role, removing an absent role, enabling an enabled or disabling a disabled user → "no change" (exit 0, no write, no audit). `user create` for an existing `(tenant, oid)` → refused with a pointer to `user show` (exit 2).
- `app_user.updated_at` is set on every user write.

## 9. Environment safety (fail closed)

| Guard | Behaviour |
|---|---|
| Explicit target | `--env local|test|staging|production` is mandatory; no default |
| Database environment identifier | Each database carries `hrms.environment` (set once by IT/owner: `ALTER DATABASE … SET hrms.environment = 'production'`). The command reads `current_setting('hrms.environment', true)`; missing or different from `--env` → refuse (exit 3) |
| Operator role | `session_user` must be a member of `hrms_access_admin` and must not be the schema owner or a superuser → otherwise refuse |
| Dev/default credentials | Refuse non-local environments when the connection uses a development role/password (`hrms_owner`, `hrms_app`, `hrms_local_dev_only`) or a loopback dev port marker; refuse `production` if `APP_ENV`/`NODE_ENV` of the shell says test/local |
| Tenant | `production`/`staging`: tenant = configured `ENTRA_TENANT_ID` (required); the test tenant is refused |
| Production confirmation | Sensitive changes require typing the environment name and the target display name; a non-interactive `--confirm <env>:<oid>` exists for scripted tests only and must match exactly |
| Ambiguity | Several DB URL variables, malformed URL, missing operator OID in production → refuse |

## 10. Entra relationship

- **Entra authenticates; Mini HRS authorizes.** The command never creates, changes or disables Entra accounts.
- **Pre-provisioning:** an account is created with the expected `oid` before the person's first sign-in; on sign-in the API matches `(tid, oid)` — a different account cannot claim it.
- **Disabling in Mini HRS** denies access on the next request (authenticate re-reads `is_enabled` per request) even if the Entra account stays valid.
- **Disabling in Entra** stops new tokens; an already issued access token remains valid until expiry (typically 60–90 min). The leaver procedure therefore disables both (Entra by IT, Mini HRS by the operator). Immediate revocation beyond that is not designed (no demonstrated need).
- **Before real Entra integration (today):** the command works the same against local/test databases with the test tenant only; production/staging refuse the test tenant.

## 11. Fixed-role validation and stale `HR_VIEWER`

- Assignable roles = `ROLE_CODES` (code). The DB format CHECK accepts `HR_VIEWER`, but the command **rejects** it (and any code outside the allow-list) for `assign`.
- `user show/list` display any stored code outside the allow-list as **"ineffective — grants nothing"**; `role remove` **may** remove such codes (cleanup, audited). No migration is proposed now; no `HR_VIEWER` row exists in any seeded database.

## 12. DB privilege model

| Role | Purpose | Privileges |
|---|---|---|
| owner (`hrms_owner` or production equivalent) | migrations only (attended) | schema owner |
| `hrms_app` | runtime | unchanged for HR tables; **recommended:** reduce `app_user`/`app_user_role` to `SELECT` (no write path exists); `SELECT` on nothing in `access_audit_event` |
| `hrms_access_admin` (NOLOGIN group) | access administration | `SELECT, INSERT, UPDATE (display_name, is_enabled, updated_at)` on `app_user`; `SELECT, INSERT, DELETE` on `app_user_role`; `SELECT, INSERT` on `access_audit_event`; **no privilege on any HR table** |
| personal operator logins (≤ 2) | Technical Owner + deputy | `LOGIN`, member of `hrms_access_admin`, `hrms.operator_oid` set |

Database-owner credentials are **not** needed for normal role administration.

## 13. Command UX (conceptual)

```
$ npm run access -- role assign --env production --oid 6f1c…  --role HR_ADMIN --reason "HR request 2026-11-02 #12"
Environment : PRODUCTION  (database hrms, identifier 'production')
Operator    : op_minh  (Entra oid 2b7e…)
Target      : Nguyễn Thị Lan  oid 6f1c…  enabled
Roles       : HR_EDITOR  →  HR_EDITOR, HR_ADMIN
Permissions : + employment.correct, + catalogs.manage, + employees.set_code
Admins after: 3
Type "production" to confirm: production
Type the target display name to confirm: Nguyễn Thị Lan
OK  role_assigned  correlation 9d0e…   (exit 0)
```

- Always shows environment, operator, target, current → proposed roles, permission diff, admin count after.
- Exit codes: `0` success / no change · `1` usage or validation error · `2` refused by a guard (last admin, self-grant, duplicate user) · `3` environment guard · `4` state changed since preview · `5` internal error.
- `--json` for machine-readable output; never prints HR profile data (it cannot read it).

## 14. Data / privacy boundary

The command reads only `app_user`, `app_user_role` and `access_audit_event`; the operator's DB role cannot read `person`, `employment`, `job_assignment`, `audit_event` or any HR table. Administering access therefore never requires browsing Core HR records, and the Technical Owner does not become an HR data processor through this tool. Display names of HR staff accounts are the only personal data shown.

## 15. Recovery / break-glass

**No separate break-glass account or framework.** The command already provides recovery because it depends on infrastructure credentials, not on application login:

| Case | Recovery |
|---|---|
| Only admin account inaccessible (person absent, Entra account locked) | Operator creates/enables another admin on the HR System Owner's request (the guard only blocks reaching zero) |
| Entra misconfiguration / application login unavailable | HR data unaffected; IT fixes Entra; the command keeps working |
| Role accidentally removed | Re-assign with a reason; both events stay in the audit |
| Operator credential lost | IT recreates the personal login (owner/infra procedure); audited at DB level |

## 16. Test plan (for implementation)

Service-level and CLI tests against `hrms_test` under the existing guard:

1. Create user (valid tenant/oid) → row + `user_created` audit with DB-captured operator.
2. Duplicate user `(tenant, oid)` → exit 2, no write, no audit.
3. Enable / disable → state + audit; no-op repeat → exit 0, no audit.
4. Assign / remove role → rows + audit with previous/new state; duplicate assignment → no change.
5. Invalid role (`HR_VIEWER`, `FOO`, malformed) → exit 1; `HR_VIEWER` present in DB → shown as ineffective, removable.
6. Disabled user → API returns 403 on next request.
7. Effective-permission preview equals `permissionsForRoles` for every role combination.
8. Last-admin: disable only admin → rejected; remove HR_ADMIN from only admin → rejected; disable one of two → allowed with warning; change leaving another admin → allowed.
9. Concurrent last-admin changes (two parallel transactions disabling the last two admins) → exactly one succeeds; repeated runs.
10. Preview fingerprint changed before commit → exit 4, nothing written.
11. Security audit append-only: `UPDATE/DELETE` on `access_audit_event` denied for `hrms_access_admin` and `hrms_app`.
12. Wrong environment: missing/different `hrms.environment`, owner/superuser login, dev credentials for staging/production, test tenant in production, missing operator OID in production → exit 3.
13. Operator gains no HR permissions: `hrms_access_admin` cannot `SELECT` from `person`/`employment`/`audit_event`; self-grant to `hrms.operator_oid` rejected.
14. Bootstrap: empty `app_user` → create first HR_ADMIN succeeds; the account can then call the API (test identity in `hrms_test`).
15. Unknown role in DB grants nothing (existing behaviour) and cannot be assigned.
16. Rollback: injected failure after the first write → no row and no audit committed.

## 17. Gate A minimum vs later

| Required for Gate A4 | Not required before first go-live (Gate C) |
|---|---|
| Guarded command (service + CLI) | Role editor UI, configurable permission bundles |
| User create / enable / disable | `access.manage` in-app screen |
| Fixed-role assign / remove with allow-list | Scope (self/team/department) |
| Security audit (append-only, DB-captured operator) | ABAC |
| Race-safe last-admin guard | Position / Job Title → role mapping |
| Environment guard + operator DB role | Entra group provisioning |
| Documented bootstrap procedure (§3) | Display-name editing, bulk import of accounts |

## 18. Expected migration / schema impact (for the implementation step — needs approval)

One forward, non-destructive migration plus infrastructure steps; no existing data transformed:

1. **Migration:** create `access_audit_event` (append-only, CHECKs, indexes on `target_user_id`, `occurred_at`); grants to `hrms_access_admin`.
2. **Migration (security hardening, recommended):** `REVOKE INSERT, UPDATE, DELETE ON app_user, app_user_role FROM hrms_app`. Impact: the development seed and test setup currently write accounts as `hrms_app`; they would run through the new service as `hrms_access_admin` (or the owner for test fixtures). To be confirmed during implementation.
3. **Infrastructure (not a migration; IT for staging/production, `docker/db-init` + a one-off local step for development):** create NOLOGIN role `hrms_access_admin` and personal operator logins; `ALTER DATABASE … SET hrms.environment`; `ALTER ROLE … SET hrms.operator_oid`. Roles are cluster objects, so the migration must run after the role exists (the migration fails closed otherwise).
4. No change to `app_user` / `app_user_role` columns; no change to `ROLE_PERMISSIONS` or permissions.

## 19. Open decisions (PV-28)

| # | Decision needed | Recommendation | Who |
|---|---|---|---|
| a | Is a reason / request reference mandatory for every access change? | Yes (short free text, e.g. HR request id) | HR |
| b | Definition of "administrative user" for the last-admin rule | Users with `employment.correct` + `catalogs.manage` + `employees.set_code` (= HR_ADMIN today) | HR |
| c | Self-grant prohibition: operators may never grant roles to their own Entra account | Yes; if the Technical Owner must also be an HR administrator, the deputy operator performs that grant | HR + Management |
| d | Disable semantics: keep role rows (reactivated on enable, with confirmation) vs strip roles on disable | Keep roles (quick, audited reinstatement) | HR |
| e | Access review: summary to HR System Owner after each change + periodic review cadence | After each change + quarterly `user list` review | HR |
| f | Named operators (≤ 2), personal DB logins, where the command runs (operations host), secret storage | Technical Owner + deputy; IT-managed host | IT + Management (PV-26) |
| g | Revoke account-table writes from `hrms_app` | Yes (hardening) | Development (technical; reported for visibility) |
| h | Retention of the access security audit | Pending Legal Review (with Q-L3) | Legal |
