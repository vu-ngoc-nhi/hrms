# Mini HRS — IT Pre-Production Handoff Pack

- Date: 2026-10-10. Type: **documentation only** — nothing has been provisioned; no real data is used.
- Status: `Core HR Phase 1 — UAT Passed With Pre-Production Actions`. PV-25 Accepted / Closed. Access administration implemented (C-94). **Gate A is open (0/8 passed); this pack passes nothing.**
- Purpose: one working-session document for HR, Development and IT covering the IT-owned / IT-co-owned work for readiness groups **A2** (platform & security), **A3** (Entra), **A4** (access-administration provisioning), **A5** (backup/restore) and **A6** (deploy/migrate rehearsal). Full context: `pre-production-readiness-plan.md`; access procedures: `access-administration-runbook.md`.
- Principles: C-84 (lightweight operations, strong integrity), C-85 (roles and permissions, never people or job titles), C-89/C-93/C-94 (guarded access administration). **Real employee data stays prohibited** until the Real-Data Go/No-Go (A8).

## 0. What Mini HRS is (technical facts IT needs)

| Item | Fact |
|---|---|
| Application | One Next.js 16 app (UI + REST API in one process), Node.js 24, built with `npm run build`, started with `next start`; health check `GET /health` → `{"status":"ok"}` (DB reachable) |
| Database | PostgreSQL 18; one database; forward-only migrations (`prisma migrate deploy`), never edited once committed |
| Data stored | Only in PostgreSQL (no file uploads, no object storage) |
| Sign-in | Microsoft Entra ID (browser sign-in not yet built — waits for §2); the API validates Entra **v2** access tokens |
| Authorization | Mini HRS roles/permissions in its own database (C-85); Entra groups/app roles are **not** used |
| Users | ~10 HR / technical accounts; ~100 employee records later |

Runtime configuration (values come from the secret store / environment, never from Git):

| Variable | Notes |
|---|---|
| `APP_ENV=production`, `NODE_ENV=production` | **also on staging**: the application accepts only `local`, `test` or `production` and refuses to start otherwise; staging is distinguished by its own database, secrets, Entra values and the access environment record `staging` (runbook §3). The development test identity is impossible in this mode (`/api/v1/dev/*` → 404) |
| `DATABASE_URL` | runtime login `hrms_app` (least privilege; reads accounts only) |
| `MIGRATION_DATABASE_URL` | schema-owner login, **only** for the attended migration step, never in the running app |
| `AUTH_MODE=entra`, `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_API_SCOPE` | from §2 |
| `NEXT_PUBLIC_ENTRA_TENANT_ID`, `NEXT_PUBLIC_ENTRA_SPA_CLIENT_ID`, `NEXT_PUBLIC_ENTRA_API_SCOPE` | browser sign-in values (§2) |
| `IDEMPOTENCY_HMAC_KEY` | random, ≥ 32 characters, per environment |
| `COMPANY_EMAIL_DOMAINS` | EmeSoft company e-mail domain(s) |
| `ACCESS_ADMIN_DATABASE_URL` | **only on the approved operator machine**, personal operator login (§3) |

## 1. Environment / hosting inputs (A2, A6)

| # | IT to provide / decide | Notes |
|---|---|---|
| H1 | Hosting platform (on-premise / cloud provider, region) | Also input to legal question Q-L5 (hosting/vendor) |
| H2 | Staging approach | Lightweight or temporary is fine; must be isolated from production; synthetic data only |
| H3 | Production approach | Same platform as staging; deployed only after the staging rehearsal (§6) succeeds |
| H4 | Application runtime (VM, container, PaaS) able to run Node.js 24 | One instance is sufficient at EmeSoft scale |
| H5 | PostgreSQL 18 hosting (managed service or server) | Encrypted storage; point-in-time recovery if available (§5) |
| H6 | Network model | Database **not** reachable from the internet; only the app host and the approved operator machine connect; TLS to the database or a private network |
| H7 | DNS names | Staging URL, production URL |
| H8 | TLS certificates | HTTPS for both URLs; renewal owner |
| H9 | Secret storage | Where DB passwords, `IDEMPOTENCY_HMAC_KEY` and operator credentials live; who can read them |
| H10 | Reverse proxy / access logs | Must **not** record URL query strings (search terms can contain names); must not add CORS headers |
| H11 | Is the Mini HRS database dedicated to Mini HRS? | See the flag below |

> **Flag — default privileges revoked by the access-administration migration (`20261013000000`).** On the Mini HRS database the migration runs `REVOKE TEMPORARY ON DATABASE <db> FROM PUBLIC` and `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. **IT must confirm** this is compatible with the chosen topology: ideally the database (or at least the cluster's use of it) is dedicated to Mini HRS, and no unrelated workload, monitoring agent or tool relies on PUBLIC TEMP/CREATE there. Agents that need specific rights should get explicit grants.

## 2. Entra non-production inputs (A3)

### 2.1 Security requirements (invariants — any topology must satisfy them)

1. Users sign in with Microsoft Entra ID in the browser (Authorization Code + PKCE).
2. The API accepts only **v2** access tokens from the EmeSoft tenant: issuer `https://login.microsoftonline.com/<tenant-id>/v2.0`; `aud` = the client ID of the API resource (the App ID URI is **not** accepted as audience); the required delegated scope in `scp` (default `access_as_user`); `tid` and `oid` present; RS256 signed by the tenant keys.
3. Staging and production are separated (own redirect URIs, or own registrations) and the development test identity is never enabled there.
4. Redirect / post-logout URIs limited to the staging/production HTTPS URLs; no wildcards.
5. Disabling an account in Entra stops new sign-ins; HRMS access is also removed with the access command (§3); remaining token lifetime is accepted.
6. MFA / Conditional Access applies to Mini HRS sign-in.

### 2.2 Recommended topology (not an invariant)

Two registrations: an **API** registration exposing the delegated scope `access_as_user` with `api.requestedAccessTokenVersion = 2`, and a **SPA** registration (public client, PKCE, redirect URIs) granted that scope with admin consent. IT may propose an equivalent design (e.g. one registration acting as both) if it satisfies 2.1; Development confirms with real tokens.

### 2.3 Inputs requested from IT (non-production first)

| # | Input |
|---|---|
| E1 | Tenant ID |
| E2 | Proposed application (SPA) registration: client ID, platform type, redirect URI for staging/non-prod, post-logout URI if used |
| E3 | Proposed API/resource registration: client ID (= expected `aud`), exposed scope name(s), confirmation that v2 tokens are issued |
| E4 | Admin consent / permission grant for the scope |
| E5 | Issuer confirmation (`https://login.microsoftonline.com/<tenant>/v2.0`) |
| E6 | MFA / Conditional Access expectations for the app |
| E7 | "Assignment required" on the enterprise app: now or later (recommended later, Gate C — HRMS already denies accounts it does not know) |
| E8 | Account-disable expectations (who disables, typical delay) and token lifetime / sign-in frequency policy |
| E9 | 2–3 non-production test accounts in the tenant for the rehearsal (synthetic people, no real HR data) |
| E10 | Owner / contact for Entra configuration changes |

No client secret, certificate, app role or group claim is needed.

## 3. Access-administration provisioning (A4)

**Infrastructure authority ≠ HR data authority.** Operators administer *who may use* Mini HRS; their database role cannot read any HR table, and they never need `HR_ADMIN` or `HR_EDITOR`. An operator also cannot grant permissions to their own Entra identity (C-93 C, C-94).

Already implemented (created by the migration, no action except §4): `hrms_access_function_owner` (NOLOGIN owner of the guarded routines), `hrms_access_admin` (NOLOGIN operator group), tables `access_operator` and `access_environment`, owner-only routines `access_environment_configure`, `access_operator_register`, `access_operator_deactivate`.

| # | IT / Management to decide or provide | Notes |
|---|---|---|
| P1 | Technical Owner (name) | With Management (PV-26) |
| P2 | Access Operators — **maximum two** (names) | PV-28 F |
| P3 | PostgreSQL login name per operator | Lowercase, e.g. `op_<name>`; personal, never shared |
| P4 | Trusted Entra object ID of each operator | Used for the audit actor and the self-escalation guard |
| P5 | Approved machine(s) / execution environment for the command | Network access to the DB; Node.js 24 + repository checkout of the deployed version |
| P6 | Credential storage for operator logins | Secret store; never in `.env` files on shared machines |
| P7 | Infrastructure owner / migration authority | Holds schema-owner credentials; runs migrations and the provisioning routines |
| P8 | Who may register / deactivate operators | Normally P7 |
| P9 | Revocation when duties change | `access_operator_deactivate` + disable/drop the login; Entra account handled separately |

Provisioning commands are in `access-administration-runbook.md` §3 (environment record, operator login with `CONNECT` only, registration).

## 4. Migration authority (A2, A6)

The access-administration migration must end in this state (verifiable with the queries used by `tests/integration/access-admin.test.ts`):

| Required final state | Check |
|---|---|
| `hrms_access_function_owner` is NOLOGIN, NOSUPERUSER, no CREATEROLE/CREATEDB/BYPASSRLS/REPLICATION, no members | `pg_roles`, `pg_auth_members` |
| All `public.access_*` routines owned by `hrms_access_function_owner`; mutating ones SECURITY DEFINER with `search_path=pg_catalog, pg_temp` | `pg_proc` |
| `PUBLIC` cannot EXECUTE any `access_*` routine; `hrms_access_admin` only the four mutation routines and four read helpers | `has_function_privilege` |
| Operators (members of `hrms_access_admin`) have no DML on `app_user`, `app_user_role`, `access_*`; no CREATE/TEMP | `has_table_privilege`, `has_database_privilege` |
| `hrms_app` is read-only on `app_user` / `app_user_role` and has no access to `access_*` tables | `has_table_privilege` |

**Prerequisite:** the migration identity must be a superuser **or** (a) able to create roles — or IT pre-creates the two NOLOGIN roles exactly as in the runbook §2 — and (b) able to `SET ROLE hrms_access_function_owner`. Otherwise the migration **stops** (fail closed); it never leaves the routines owned by the schema owner.

If the application's migration identity cannot do this, use an **explicit infrastructure provisioning step** (IT creates the roles and grants membership to the migration identity before the migration). **Do not** give the runtime `hrms_app` or operator logins broader rights to make migrations easier. `npm run db:migrate` intentionally refuses non-local targets; staging/production migrations are an attended step with owner credentials (detailed in the A6 deployment runbook, still to be written once hosting is chosen).

## 5. Backup inputs (A5)

Planning target (M-14, provisional): **RPO ≤ 4 hours, RTO ≤ 1 business day.** IT proposes the smallest solution that meets it — or challenges the target with reasons (PV-27). No enterprise HA is expected.

| # | IT to propose |
|---|---|
| B1 | Backup method (managed snapshots / PITR, `pg_dump`, WAL archiving …) |
| B2 | Frequency or PITR capability meeting RPO ≤ 4 h |
| B3 | Encryption at rest and in transit; key custody |
| B4 | Storage location separate from the database host (same approved jurisdiction) |
| B5 | Access control: who can read / restore backups (restore to production needs Management approval) |
| B6 | Failure alert (to whom, how) |
| B7 | Restore procedure and **expected restore duration** vs RTO |
| B8 | Retention proposal — final value **Pending Legal Review** (Q-L4) |

**A5 is not passed by configuration.** It passes only after a **successful restore rehearsal with synthetic data** (readiness plan Appendix C.3).

## 6. Staging rehearsal — evidence to produce (no real employee data)

| Area | Evidence | By |
|---|---|---|
| Environment | Staging app reachable over HTTPS; staging DB isolated (not internet-reachable); no development default (passwords, `hrms_local_dev_only`, test tenant, `example.test`) anywhere; `/api/v1/dev/test-users` → 404 | IT + Dev |
| Identity | Real Entra non-prod sign-in; API accepts the expected token; tokens with wrong tenant, wrong audience, v1 format or missing scope are rejected | IT + Dev |
| Database | Migrations run with the attended procedure; application starts; `/health` ok; grants match §4 | Dev + IT |
| Access administration | Environment record configured; operator registered; bootstrap first HR admin; create second admin; assign/remove a role; disable/enable an account; removing/disabling the last admin rejected; operator self-escalation rejected; access audit rows verified (actor, reason, before/after) | Operator + Dev |
| Backup | Backup taken; restored to a controlled target; synthetic records, schema (`prisma migrate status`), integrity scan 0/0 and access audit verified after restore; restore duration recorded | IT + Dev |

Each item is recorded (date, who, result) and attached to the readiness plan as gate evidence.

## 7. IT decision table

| ID | IT Decision / Input | Why Needed | Blocks | Owner | Target Date | Status |
|---|---|---|---|---|---|---|
| IT-01 | Hosting platform and region (H1, H4, H5) | Everything runs on it; legal Q-L5 | A2, A5, A6, deployment runbook | IT + Management | TBD | Open |
| IT-02 | Staging approach (H2) | Rehearsals need an isolated non-prod environment | §6 rehearsal | IT | TBD | Open |
| IT-03 | Network / DB exposure model (H6) | DB must not be internet-reachable | A2 | IT | TBD | Open |
| IT-04 | DNS + TLS (H7, H8) | HTTPS URLs; Entra redirect URIs depend on them | A2, A3 | IT | TBD | Open |
| IT-05 | Secret storage (H9) | Credentials and keys outside Git and shared machines | A2, A4 | IT | TBD | Open |
| IT-06 | Proxy logging without query strings, no CORS (H10) | Names in search terms; same-origin API | A2 | IT | TBD | Open |
| IT-07 | Dedicated database / compatibility of the PUBLIC TEMP/CREATE revocation (H11) | Migration changes default privileges | A2, migration | IT | TBD | Open |
| IT-08 | Entra non-prod configuration (E1–E10) | Development cannot start real sign-in without it | A3, MSAL work | IT (Entra admin) | TBD | Open |
| IT-09 | Migration authority (P7, §4) | SECURITY DEFINER ownership must be established safely | A2, A4, A6 | IT | TBD | Open |
| IT-10 | Technical Owner + ≤ 2 operators, logins, Entra OIDs (P1–P4) | Trusted operator mapping | A4 | IT + Management | TBD | Open (PV-26, PV-28 F) |
| IT-11 | Operator machine(s) and credential storage (P5, P6) | Where the command may run | A4 | IT | TBD | Open |
| IT-12 | Operator registration / revocation authority (P8, P9) | Duty changes | A4 | IT | TBD | Open |
| IT-13 | Backup proposal (B1–B8) incl. RPO/RTO confirmation | Recovery | A5 (PV-27) | IT | TBD | Open |
| IT-14 | Read-only DB role approach for the production integrity scan | Integrity monitoring (B2) | Production-safe scan | IT | TBD | Open |
| IT-15 | Staging rehearsal participation (§6) | Gate evidence | A3–A6 | IT + Dev | TBD | Open |

## 8. Development unblock conditions

| Development task | Starts when |
|---|---|
| Browser sign-in (MSAL) / real Entra integration | Non-production Entra configuration is supplied (IT-08) |
| Production deployment / migration runbook (A6) | Hosting topology is selected (IT-01, IT-02, IT-09) |
| Production-safe integrity scan | Read-only DB role approach is approved (IT-14) |
| Staging access-administration rehearsal | Staging DB, an operator login, the environment record and a non-prod Entra identity exist (IT-02, IT-09, IT-10, IT-08) |
| Final CSP / web security headers | Sign-in library integrated (after IT-08) |

## 9. Not required from IT now

Configurable RBAC, ABAC, a role editor, Entra group-to-role synchronisation, enterprise high availability, an advanced observability platform, and any production deployment **before** the staging rehearsal succeeds.
