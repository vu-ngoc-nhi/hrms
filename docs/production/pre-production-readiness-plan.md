# Mini HRS — Pre-Production Readiness Plan

- Phase: **Pre-Production Readiness Planning** (started 2026-10-10). **Planning / gap assessment only**: no product code, configuration, deployment or data change was made to produce this plan.
- Current baseline: **`Core HR Phase 1 — UAT Passed With Pre-Production Actions`** (PV-25 Accepted / Closed). **UAT Passed is not Production Ready.** Production Ready requires the explicit human approvals in §18; engineering never self-declares it.
- Real employee data: **prohibited** until the Real-Data Go/No-Go checklist (§12) passes.
- Governing principles: C-84 (*strict on history and integrity, flexible on operations*; scale down process complexity, not engineering quality) and C-85 (*flexible role configuration, strict authorization enforcement*). Motto for this plan: **enterprise-quality controls with lightweight operations.**
- Context: EmeSoft, ~70–100 employees, technical company, lean HR team, internal Core HR system, English-first.
- Each control below names the **EmeSoft risk** it addresses. Controls that only exist because large HRIS products have them are excluded (see §1.3).

Contents (requested deliverables → section): master table §2 · 1 executive summary §1 · 2 P0 blockers §3 · 3 P1 actions §4 · 4 already-proven controls §5 · 5 Legal questions §6 · 6 IT/Entra checklist §7 · 7 Security checklist §8 · 8 Backup/restore plan §9 · 9 Deployment/rollback plan §10 · 10 Real-data Go/No-Go §12 · 11 RBAC recommendation §14 · 12 order of execution §17 · 13 Go-Live Gate §18. Additional domain sections: observability §11, data migration §13, environment/secrets §15, support §16.

Legend — **Priority**: P0 = must resolve before real production use · P1 = before or immediately after go-live · P2 = improvement / future hardening. **Status**: Proven (evidence exists in the repo) · Config (configuration/infrastructure work, no code) · Gap (code or document missing) · Decision (a human decision is needed) · Legal (counsel must answer). **Owner**: HR · IT · Development · Legal · Management · Shared.

---

## 1. Executive readiness summary

### 1.1 Where Mini HRS stands

The **application core is strong**: server-side capability-based authorization on every operation (permission-matrix test over every registered operation × six actor types), database-enforced history integrity (no DELETE grants, append-only audit, exclusion constraints, terminal dispositions, triggers), optimistic concurrency, idempotency, a read-only integrity scanner, a clean integrity baseline and 385 automated tests plus UAT suites. These are proven on synthetic data in local environments.

What is **not** ready is everything **around** the application for real use: there is no production environment, no real sign-in (the browser uses a development test identity; MSAL is not implemented), no way to provision real HR users or assign roles without SQL or seed scripts, no backup/restore procedure, no production deployment or migration runbook, no observability beyond a health endpoint, no data-import path, and the legal/privacy questions (PL-01, PL-02, PL-04, PL-05) are unanswered.

### 1.2 Readiness by domain

| # | Domain | Items | Proven (evidence exists) | P0 | P1 | P2 | N/A | Gate state today |
|---|---|---|---|---|---|---|---|---|
| 1 | Legal / Privacy | 12 | 1 | 6 | 3 | 1 | 2 | **BLOCKED** |
| 2 | Identity / Entra | 10 | 3 | 6 | 2 | 0 | 2 | **BLOCKED** |
| 3 | Security | 16 | 7 | 10 | 1 | 2 | 3 | **BLOCKED** |
| 4 | Backup / Restore | 6 | 0 | 6 | 0 | 0 | 0 | **BLOCKED** |
| 5 | Deployment / Rollback | 7 | 2 | 5 | 2 | 0 | 0 | **BLOCKED** |
| 6 | Observability / Operations | 7 | 1 | 2 | 4 | 1 | 0 | **BLOCKED** |
| 7 | Real-data Readiness | 3 | 1 | 2 | 0 | 0 | 1 | **BLOCKED** (depends on 1–5, 8, 10) |
| 8 | Data Migration / Import | 7 | 0 | 6 | 1 | 0 | 0 | **BLOCKED** |
| 9 | Configurable RBAC | 4 | 1 | 1 | 2 | 0 | 1 | **BLOCKED** (access provisioning only) |
| 10 | Production Environment / Secrets | 8 | 0 | 6 | 1 | 0 | 1 | **BLOCKED** |
| 11 | Business Continuity / Support | 3 | 1 | 2 | 1 | 0 | 0 | **BLOCKED** |
| 12 | Go-Live Acceptance | 3 | 0 | 3 | 0 | 0 | 0 | **BLOCKED** (by design until all gates pass) |
| | **Total** | **86** | **17** | **55** | **17** | **4** | **10** | |

Counting rules (computed from the §2 table): every item has exactly one priority (P0/P1/P2) or N/A; "Proven" counts items whose status starts with *Proven* — several of them are still **P0 because they must be re-verified in production** (e.g. SEC-03 DB grants, SEC-08 CORS, ID-10 test identity blocked). Many P0 items are small (a decision, a configuration value, a one-page runbook); the large ones are listed in §3.

### 1.3 Deliberately excluded (no demonstrated EmeSoft risk)

24×7 on-call rotation, SIEM / enterprise observability platform, multi-region high availability, blue-green or canary deployment, a dedicated DBA function, formal CAB/approval boards, generic policy engines or ABAC (C-85), rate limiting for an Entra-protected internal app with ~10 HR users, web application firewall, application-level field encryption for fields that are not stored (sensitive groups are rejected by the API), automated anonymization pipelines before PL-01 defines what to anonymize. Any of these may be revisited if a concrete risk appears.

---

## 2. Master table

| ID | Domain | Requirement | Current Status | Gap | Priority | Owner | Evidence Needed | Blocker? |
|---|---|---|---|---|---|---|---|---|
| LP-01 | Legal | Lawful processing basis per data group and employee notice (PL-05) | Legal | No basis or notice defined; `docs/legal/legal-review-s0-s3.md` lists fields as *Pending Legal Review* | P0 | Legal + HR | Written counsel answer; approved employee notice text and delivery method | Yes — before real data |
| LP-02 | Legal | Retention schedule per data group incl. terminated employees (PL-01) | Legal | No retention periods (correctly none assumed) | P0 | Legal + HR | Retention schedule (data group → period → basis → action at end) | Yes — before real data |
| LP-03 | Legal | Audit-log retention (PL-01, ADR-0004) | Legal | Audit is kept indefinitely by design; period undefined | P1 | Legal | Counsel answer; then a P2 purge/anonymization design | No (keep-all is the safe default until answered) |
| LP-04 | Legal | Production backup retention and deletion obligations reaching backups (PL-01) | Legal | Backup retention cannot be set without it | P0 | Legal + IT | Counsel answer feeding BR-03 | Yes — before real data |
| LP-05 | Legal | Hosting / vendor / cloud processing, processor contract, encryption at rest and in transit (PL-02) | Legal + Decision | Hosting not chosen; no processor assessment | P0 | Management + IT + Legal | Hosting decision (ENV-01) + counsel confirmation of contract/encryption requirements | Yes — before real data |
| LP-06 | Legal | Personal-data impact assessment applicability and owner (PL-04) | Legal | Unknown whether required; small-enterprise status not verified | P0 | Legal + Management | Counsel answer; if required, the assessment filed (timing per counsel) | Yes — before real data |
| LP-07 | Legal | Data-subject request process (access, correction, deletion) (PL-05) | Legal | No process | P1 | HR + Legal | One-page procedure: who receives, who answers, how data is extracted/corrected | No (required before go-live per counsel's timing) |
| LP-08 | Legal | Access to HR records: who may see personal fields (HR_EDITOR currently sees personal contact data) | Decision + Legal | Current bundles are MVP decisions, not a legal access policy | P0 | HR + Legal | Confirmed access policy mapped to existing permissions | Yes — before real data |
| LP-09 | Legal | Data export | Not applicable today | No export endpoint exists; only per-record screens | — | — | Re-assess when an export is proposed | No (N/A) |
| LP-10 | Legal | Sensitive groups / identity documents (PL-03) | Proven (not collected) | API rejects legal ID, tax, insurance, bank, health, dependants, contracts, salary | — | — | `422 PROTECTED_FIELD_NOT_ENABLED` tests | No (N/A while rejected) |
| LP-11 | Legal | Intern / Service Contractor classification and End Reason legal meaning (PL-07, PL-09) for real records | Legal | Product classifications only | P1 | Legal + HR | Counsel guidance used by HR when classifying imported records | No for go-live if HR classifies by fact and labels are not presented as legal grounds; Yes for any statutory reporting |
| LP-12 | Legal | HRMS as statutory labour management book (PL-06); Cancel Planned contractual meaning (PL-10); probation (PL-08) | Legal | Out of current scope | P2 | Legal + Management | Scope decision | No (not claimed) |
| ID-01 | Identity | Production Entra **API** app registration (tenant, client ID, `access_as_user` scope, `api.requestedAccessTokenVersion = 2`) (PV-11) | Config | Values not provided | P0 | IT | Registration created; values handed over through the secret/config channel | Yes |
| ID-02 | Identity | Production Entra **SPA** registration (separate), redirect URIs = production URL(s), PKCE, API permission granted with admin consent | Config | Not created | P0 | IT | Registration + redirect URI list + consent screenshot/record | Yes |
| ID-03 | Identity | **Browser sign-in with MSAL** (Authorization Code + PKCE), replacing the development login page in production | Gap (code) | `NEXT_PUBLIC_ENTRA_*` reserved, MSAL not implemented; `/login` is the test identity | P0 | Development | Implemented sign-in/sign-out, token acquisition/refresh; test against a non-production Entra registration | Yes |
| ID-04 | Identity | Verifier proven against **real** Entra tokens (iss, aud = API client ID, `ver = 2.0`, `scp`, `tid`, RS256 JWKS) | Gap (verification) | Logic tested with locally generated keys only (ADR-0003) | P0 | Development + IT | Test record of accepted/rejected real tokens (wrong audience, v1 token, missing scope, other tenant) | Yes |
| ID-05 | Identity | Who may sign in: Entra "assignment required" on the enterprise app, limited to HR users + technical admins | Config + Decision | Not configured | P1 | IT + HR | Enterprise app setting + assigned users list | No (HRMS already returns 403 to any account without an enabled HRMS user — defence in depth) |
| ID-06 | Identity | Account lifecycle: leaver/mover handling for HR staff (disable in Entra **and** disable/remove HRMS roles) | Decision | No procedure | P0 | HR + IT | Short joiner/mover/leaver procedure (see §7 E-10 and §16) | Yes |
| ID-07 | Identity | Token lifetime / session behaviour | Proven (API) / Config | API enforces `exp` (60 s skew); session length governed by Entra policy; no app idle timeout | P1 | IT | Confirm tenant default token lifetime and Conditional Access (MFA) applies to HRMS | No |
| ID-08 | Identity | Group / role claims | Decision (not used) | Roles come only from HRMS data (C-04, ADR-0003); Entra groups do not grant HRMS access (C-85 Q5) | — | IT | Confirmation that no app roles/group claims are configured | No (N/A by design) |
| ID-09 | Identity | Service accounts / app-only tokens | Proven (not supported) | Only delegated tokens with `scp` accepted | — | — | Verifier tests | No (N/A) |
| ID-10 | Identity | Test vs production separation: test identity impossible in production | Proven | `APP_ENV` defaults to production; test issuer needs `AUTH_MODE=test` + flag + local/test + non-production `NODE_ENV`; `/api/v1/dev/*` → 404 | P0 (verify in prod) | Development + IT | Smoke test on production: `/api/v1/dev/test-users` returns 404; test tokens rejected | Yes (verification step only) |
| SEC-01 | Security | Server-side authorization on every operation | Proven | — | — | — | `tests/integration/permission-matrix.test.ts` (every registry operation × 6 actors) | No |
| SEC-02 | Security | No role-name checks in business logic; unknown roles grant nothing; disabled users 403 | Proven | — | — | — | `docs/design/access-control-direction.md` §2; authenticate tests | No |
| SEC-03 | Security | DB application role least privilege: no DDL, no DELETE on HR tables, audit append-only, events column-level update | Proven (local) | Must be re-created identically in production | P0 (re-verify) | IT + Development | `db-schema-guarantees` test run as the production app role (read-only checks) | Yes (verification) |
| SEC-04 | Security | No hard delete of HR history; audit cannot be rewritten | Proven | — | — | — | Grants + triggers + tests | No |
| SEC-05 | Security | Logs and errors carry no personal data, tokens or payloads | Proven (app) / Config (proxy) | App logs only error type + request id; **reverse proxy/access logs must not record query strings** (search terms contain names — legal note §4.6) | P0 | IT | Proxy log format reviewed | Yes |
| SEC-06 | Security | Secrets management (DB passwords, `IDEMPOTENCY_HMAC_KEY`, any MSAL config) | Config | Only `.env` files locally | P0 | IT | Secrets in a secret store / protected env, not in Git; access list | Yes |
| SEC-07 | Security | Security headers for pages: HSTS, `frame-ancestors`/X-Frame-Options, Referrer-Policy, CSP (tokens live in browser session storage, so XSS impact is high) | Gap (code/config) | API responses set `nosniff` and `no-store`; pages set no security headers (no `next.config`) | P0 | Development | Header check on the production URL | Yes |
| SEC-08 | Security | CORS / origin | Proven | No CORS headers → browsers allow same-origin only | P0 (verify proxy) | IT | Confirm the proxy adds no CORS headers | No |
| SEC-09 | Security | TLS everywhere (browser → app, app → DB) | Config | Local only | P0 | IT | TLS certificate on the URL; DB connection with TLS or private network | Yes |
| SEC-10 | Security | Database not reachable from the internet; app role and owner role separated | Config | Local compose binds 127.0.0.1 only | P0 | IT | Network rule evidence | Yes |
| SEC-11 | Security | Dependency vulnerabilities | Gap (triage) | `npm audit --omit=dev` (2026-10-10): 4 high (prisma → `@prisma/config` → `deepmerge-ts`; `mysql2` transitive, unused with PostgreSQL), 7 low (API-docs UI AI packages; the agent is disabled in config) | P1 | Development | Triage note (exploitable or not), upgrades where non-breaking | No if triaged non-exploitable |
| SEC-12 | Security | Production admin access (DB owner credentials, server access) limited to named technical owner(s); break-glass only | Decision + Config | Not defined | P0 | Management + IT | Named list; owner credentials not used by the app | Yes |
| SEC-13 | Security | Data correction only through the application (no ad-hoc production SQL) | Proven (controls exist) / Decision (rule) | All S4 corrections exist in-app with reason + audit | P0 | Management | Written rule in the support model (§11) | Yes |
| SEC-14 | Security | Rate limiting | Optional | Not implemented; low risk (Entra-protected, few users) | P2 | Development | — | No |
| SEC-15 | Security | Idempotency records cleanup (24 h product TTL, ADR-0004) | Gap | `expires_at` stored, no purge job | P2 | Development | Scheduled purge | No |
| SEC-16 | Security | Backups protected (encryption, access) | See BR-04/BR-05 | — | P0 | IT | — | Yes |
| BR-01 | Backup | Define what is backed up: the PostgreSQL production database (all schemas incl. `_prisma_migrations`), plus the deployed artifact version and non-secret configuration; secrets backed up separately in the secret store | Gap (plan) | No backup exists | P0 | IT | Backup job definition | Yes |
| BR-02 | Backup | Frequency and RPO | Decision | — | P0 | Management + IT | Approved RPO (recommendation §9.1) | Yes |
| BR-03 | Backup | Retention | Legal + Decision | Depends on LP-04 | P0 | Legal + IT | Retention value with basis | Yes |
| BR-04 | Backup | Encryption + storage location separate from the database host | Config | — | P0 | IT | Encrypted backup in a separate location | Yes |
| BR-05 | Backup | Access to backups limited to technical owner(s); restore requires management approval | Decision | — | P0 | Management + IT | Access list | Yes |
| BR-06 | Backup | **Restore rehearsal passes** (synthetic data) and is repeated periodically | Gap | Never performed | P0 (first), P1 (periodic) | IT + Development | Signed restore-test record (§9.3) | Yes |
| DR-01 | Deployment | Environments: local, test (automated), **staging** (prod-like, synthetic only), production | Gap | Only local/test exist | P0 | IT + Development | Staging URL + DB | Yes |
| DR-02 | Deployment | Reproducible build artifact (pinned lockfile, Node 24, `next build`) identified by Git commit | Proven (build) / Gap (packaging) | Build passes locally; no packaging/registry | P0 | Development + IT | Artifact for a tagged commit | Yes |
| DR-03 | Deployment | Production migration runbook (manual, approved, `prisma migrate deploy` as owner, backup first, forward-only) | Gap (document) | `npm run db:migrate` intentionally refuses non-local targets; no production procedure | P0 | Development + IT | Runbook + staging rehearsal record | Yes |
| DR-04 | Deployment | Deployment order, health check and smoke test | Gap (document) | `/health` exists (DB check) | P0 | Development + IT | Runbook + smoke checklist | Yes |
| DR-05 | Deployment | Rollback / forward-fix policy (no down migrations; restore only as last resort) | Gap (document) | — | P0 | Development + Management | Approved policy (§10.3) | Yes |
| DR-06 | Deployment | Migration compatibility rule: each migration compatible with the previous app version (expand → migrate → contract) | Proven (practice) | All Phase 1 migrations are additive/forward | P1 | Development | Checklist item in PR template | No |
| DR-07 | Deployment | Maintenance window and user notice | Decision | — | P1 | HR + IT | Agreed window (e.g. outside HR working hours) | No |
| OBS-01 | Observability | Uptime check on `/health` with alert to IT | Config | Endpoint exists; no monitor | P0 | IT | Monitor configured, test alert received | Yes |
| OBS-02 | Observability | Backup job failure alert | Config | — | P0 | IT | Test alert received | Yes |
| OBS-03 | Observability | Application error logs (stdout JSON with request id) retained for troubleshooting; HR quotes the request id shown in error messages | Config | App emits logs; no retention/collection | P1 | IT | Log location + retention (non-personal) | No |
| OBS-04 | Observability | Production-safe read-only integrity scan (weekly, results to technical owner) | Gap | Scanner refuses non-loopback hosts by design | P1 | Development | Approved read-only production mode (separate read-only DB role) | No |
| OBS-05 | Observability | Failed sign-ins | Proven (Entra) | Entra sign-in logs cover authentication; HRMS audits 403 denials | P1 | IT | IT knows where to look | No |
| OBS-06 | Observability | DB availability / disk space alert | Config | — | P1 | IT | Alert configured | No |
| OBS-07 | Observability | Audit viewing for HR | Optional | No audit read API; IT can query read-only on request | P2 | HR + Development | — | No |
| RD-01 | Real data | Real-data Go/No-Go checklist (§10) passed and signed | Gap | — | P0 | Management + HR + IT + Legal | Signed checklist (§12) | Yes |
| RD-02 | Real data | Designated production administrators (HRMS HR_ADMIN holders, technical owner) | Decision | — | P0 | Management + HR | Named list | Yes |
| RD-03 | Real data | Synthetic-only rule enforced until lifted (C-03) | Proven | — | — | — | CLAUDE.md, C-03 | No |
| MIG-01 | Migration | Onboarding approach: import tool vs controlled manual entry (≈100 people) | Decision | No import tool exists | P0 | HR + Development | Decision (§13) | Yes |
| MIG-02 | Migration | Source mapping: legacy Excel columns, code format, catalogs (PV-05, PV-06, PV-08) | Decision | Open | P0 | HR | Mapping sheet approved by HR | Yes |
| MIG-03 | Migration | History depth to load (current period only vs full history) | Decision | — | P0 | HR | Decision | Yes |
| MIG-04 | Migration | Validation rules + dry-run report (duplicates, missing required fields, invalid dates, unknown catalog values, manager not employed on date) | Gap | — | P0 | Development | Dry-run report on synthetic source | Yes |
| MIG-05 | Migration | Synthetic rehearsal on staging, then (if legally acceptable) anonymized rehearsal | Gap | — | P0 | Development + HR | Rehearsal records; integrity scan 0/0 | Yes |
| MIG-06 | Migration | Reconciliation and HR sign-off of the final import | Gap | — | P0 | HR | Counts per status/department/type + sample review signed by HR | Yes |
| MIG-07 | Migration | Production reference data (departments, job titles EN/VI, levels, employee types, email domains) | Decision + Config | Employee types and catalogs come only from the **dev seed**; End Reasons come from a migration | P1 | HR | Catalog list approved; entered via the Catalog screens by HR_ADMIN | No (but needed before import) |
| RBAC-01 | RBAC | Capability-based enforcement | Proven | — | — | — | §2 of access-control direction | No |
| RBAC-02 | RBAC | **Access provisioning without SQL/code**: create/enable/disable HRMS user accounts (Entra tenant/object id) and assign/unassign existing roles, with a security audit trail and an "at least one active admin" guardrail | Gap (code) + Decision | Accounts/roles exist only through dev seed scripts; no production path except SQL | P0 | Development + Management | Smallest safe v1 (§14) approved and implemented | Yes |
| RBAC-03 | RBAC | Configurable role **definitions** (Access Roles as stored bundles) | Not needed for go-live | Fixed HR_ADMIN / HR_EDITOR / API_DOCS_READER bundles fit a lean HR team | P1/P2 | Management + HR | Trigger: HR needs a bundle that differs from the two fixed roles | No |
| RBAC-04 | RBAC | Who administers access (C-85 Q1) and anti-escalation rule (Q2) | Decision | Open | P1 → P0 if RBAC-02 includes an in-app screen | Management + HR + IT | Decision | Depends on RBAC-02 option |
| ENV-01 | Environment | Hosting decision (on-premise vs cloud; provider; region) | Decision | None | P0 | Management + IT (+ Legal via LP-05) | Decision record | Yes |
| ENV-02 | Environment | Production PostgreSQL (supported version 18.x, encrypted storage, automated backups/PITR if available) | Config | Only local Docker | P0 | IT | Instance + configuration record | Yes |
| ENV-03 | Environment | Production URL + TLS certificate | Config | — | P0 | IT | URL reachable over HTTPS from EmeSoft network | Yes |
| ENV-04 | Environment | Database users: owner (migrations only), `hrms_app` (runtime), optional read-only (integrity scan); new strong passwords — never the public dev password | Config | Local roles use the public dev password `hrms_local_dev_only` | P0 | IT | Role list + grants verified (SEC-03) | Yes |
| ENV-05 | Environment | Production configuration values: `APP_ENV=production`, `NODE_ENV=production`, `AUTH_MODE=entra`, no `AUTH_TEST_ISSUER_*`, real `COMPANY_EMAIL_DOMAINS` (currently `example.test`), Entra values, strong `IDEMPOTENCY_HMAC_KEY` | Config | Local values only | P0 | IT + Development | Config review checklist signed | Yes |
| ENV-06 | Environment | Environment isolation: separate DBs, secrets and Entra registrations for staging and production; dev/test secrets never reused | Config | — | P0 | IT | Inventory | Yes |
| ENV-07 | Environment | Config management: values documented (non-secret) and versioned; secrets only in the store | Config | `.env.example` documents local values | P1 | IT | Production config inventory | No |
| ENV-08 | Environment | Storage | Not applicable | No file uploads/attachments exist; DB is the only data store | — | — | — | No |
| SUP-01 | Support | Named roles: system owner (HR), technical owner, access administrator, incident contact, data-correction authority, backup/restore authority | Decision | None named | P0 | Management | Support model (§16) filled with names | Yes |
| SUP-02 | Support | Incident procedure (one page): how HR reports, request id, contact, communication | Gap (document) | — | P0 | IT + HR | Procedure | Yes |
| SUP-03 | Support | Business-rule issue path: decision register + Business Decision Gate | Proven (process) | Works in development | P1 | HR + Development | Kept after go-live | No |
| GL-01 | Go-live | Go-Live Gate review (§13) with every domain READY or READY WITH ACTION (no P0 open) | Gap | — | P0 | Shared | Gate record (§18) | Yes |
| GL-02 | Go-live | Production smoke acceptance with HR on real sign-in (before real data load) | Gap | — | P0 | HR + IT | Smoke record | Yes |
| GL-03 | Go-live | Explicit **human** Production Ready approval (Management + HR system owner + technical owner) | Decision | — | P0 | Management | Signed decision recorded in the register | Yes |

> Count note: §1.2 is computed from the rows above; rows marked `—` in Priority are N/A.

---

## 3. P0 blockers (must resolve before real production use)

Grouped by size. "Small" = a decision, a value or a short document; "Medium" = days of focused work; "Large" = a development slice.

| Size | P0 items |
|---|---|
| **Large (development)** | ID-03 MSAL sign-in · RBAC-02 access provisioning without SQL · MIG-04/05 import tool + dry-run (only if MIG-01 chooses an import) · SEC-07 security headers (small code, listed here because it touches every page) |
| **Medium (IT / Development)** | ENV-01–06 production environment and secrets · SEC-03/06/08/09/10/16 security configuration and production re-verification · ID-10 test identity verified blocked in production · DR-01 staging · DR-02/03/04/05 artifact, migration runbook, smoke test, rollback policy · BR-01–06 backup + **first restore rehearsal** · OBS-01/02 uptime + backup alerts · ID-01/02/04 Entra registrations and real-token verification |
| **Small (decisions / legal)** | LP-01, LP-02, LP-04, LP-05, LP-06, LP-08 legal answers · ID-06 leaver procedure · SEC-05 proxy logs · SEC-12/13 admin access + no-SQL rule · BR-02/03/05 RPO, retention, backup access · RD-02 named admins · MIG-01/02/03 onboarding decisions · SUP-01/02 support model · GL-01/02/03 gate |

## 4. P1 actions (before or immediately after go-live)

LP-03 audit retention · LP-07 data-subject procedure · LP-11 classification guidance for real records · ID-05 Entra assignment-required · ID-07 token lifetime / MFA confirmation · SEC-11 dependency triage · DR-06 migration compatibility checklist · DR-07 maintenance window · BR-06 periodic restore test (e.g. every 6 months and after major upgrades) · OBS-03 log retention · OBS-04 production-safe integrity scan · OBS-05/06 sign-in logs and DB alerts · MIG-07 production catalogs · RBAC-03/04 role-definition trigger and access-admin decision · ENV-07 config inventory · SUP-03 business-rule path.

P2 (future hardening): LP-12, SEC-14 rate limiting, SEC-15 idempotency purge, OBS-07 audit viewer, RBAC-03 if never triggered.

---

## 5. Already-proven controls (evidence in the repository)

| Control | Evidence |
|---|---|
| Capability-based server-side authorization on every operation; UI visibility is not a boundary | `src/lib/http/handler.ts`; `tests/integration/permission-matrix.test.ts` (every registry operation × anonymous/no-roles/disabled/docs/editor/admin) |
| No role-name checks; unknown/retired roles grant nothing; disabled account → 403; a valid token without an HRMS account → 403 | `src/modules/identity/authenticate.ts`, `permissions.ts`; access-control review |
| Token verification rules (RS256 JWKS, issuer, `aud` = API client ID, `ver` 2.0, `tid`, `oid`, `scp`), v1/ID/app-only tokens rejected — **with local keys only** | `token-verifiers.ts` + tests (real Entra still ID-04) |
| Test identity impossible in production configuration; `/api/v1/dev/*` 404 | `src/lib/config.ts` (`APP_ENV` defaults to production), `test-identity.ts` |
| DB least privilege: app role has no DDL, no DELETE on HR tables, cannot rewrite audit, can update only `employment_event.effective_date` | `tests/integration/db-schema-guarantees.test.ts` |
| History integrity: exclusion constraints (periods, assignments, Work Email), terminal dispositions (cancelled/voided), event insert rules, structural audit allow-list | migrations + DB tests |
| No hard delete; corrections via audited controlled actions (reason, revision, idempotency) | S4 workflows, PV-25 |
| Logs/errors without personal data; audit without personal values; idempotency stores an HMAC only | `handler.ts`, `audit.ts`, ADR-0004 |
| Strict input validation (unknown fields rejected); sensitive data groups rejected (`PROTECTED_FIELD_NOT_ENABLED`) | Zod contracts, tests |
| Read-only integrity scanner and clean baseline 0/0 | `scripts/integrity-checks.ts`, `tests/baseline` |
| Destructive DB operations guarded (test reset only on local `hrms_test`; migrations refuse non-local/production) | `src/lib/db-safety.ts`, C-05/C-07 |
| Minimal public health endpoint (no version/config details) | `src/app/health/route.ts` |
| API docs page without telemetry, external requests, try-it or AI agent | `src/app/internal/docs/ApiReference.tsx` |

---

## 6. Legal questions (to send to counsel — HR owns sending them)

No legal conclusion is drawn here. Classification: **BR** = blocker before real data · **GL** = required before go-live · **AF** = may follow go-live · **NA** = not applicable now.

| # | Topic | Class | Exact question for counsel |
|---|---|---|---|
| Q-L1 | Lawful purpose / basis and employee notice (PL-05) | BR | "For each data group in Annex A (identity, contact, employment periods and assignments, work email, audit/login data) processed by EmeSoft's internal HR system, what is the lawful basis under Law 91/2025/QH15 and Decree 356/2025/ND-CP, and must employees receive a specific notice or give consent? Please provide or approve the notice text and delivery method." |
| Q-L2 | Retention, including terminated employees (PL-01) | BR | "What retention period applies to each data group in Annex A, before and after an employee leaves EmeSoft, and what must happen at the end of the period (deletion, anonymization, archive)? Are there statutory minimum periods (e.g. Labour Code Art. 12, Decree 145 Art. 3) that override Law 91 Art. 25.2?" |
| Q-L3 | Audit-log retention | AF (keep-all meanwhile) | "Our audit log records who changed which field of which record and when (no field values). How long may/must it be kept, and is it subject to the same deletion obligations as the HR record?" |
| Q-L4 | Backup retention and deletion reaching backups | BR | "When personal data must be deleted, may it remain in encrypted backups until those backups expire, and what maximum backup retention is acceptable?" |
| Q-L5 | Hosting / vendor / cloud processing (PL-02) | BR | "If the system is hosted at <provider/on-premise, region>, what contractual terms (processor agreement), security measures (encryption at rest and in transit) and cross-border considerations apply? Is any filing required?" |
| Q-L6 | Impact assessment (PL-04) | BR | "Is EmeSoft required to prepare a personal-data processing impact assessment for this system, does any small-enterprise relief apply given that no sensitive data is processed, who must own it, and by when must it be filed?" |
| Q-L7 | Access to HR records | BR | "Is it acceptable that HR staff with the 'HR Editor' role (day-to-day HR operations) can view employees' personal contact data (date of birth, gender, mobile phone, personal email), or must access be restricted further?" |
| Q-L8 | Data-subject requests | GL | "What process and response deadlines apply to employee requests to access, correct or delete their data, and which requests may be refused because of other legal obligations?" |
| Q-L9 | Data export | NA | (Ask only when an export feature is proposed.) |
| Q-L10 | Identity documents / sensitive fields (PL-03) | NA | (Ask before enabling any sensitive group; currently rejected by the API.) |
| Q-L11 | Deletion / anonymization obligations | BR (part of Q-L2) | Covered by Q-L2; design of any deletion/anonymization process follows the answer (ADR-0004). |
| Q-L12 | Classification of Intern / Service Contractor and End Reasons (PL-07, PL-09) | AF / GL if used for statutory reporting | "Which criteria determine whether an intern or service-contractor arrangement is legally an employment relationship, and how do our End Reason categories (Annex B) relate to statutory termination grounds?" |

Annex A = the data-group table in `docs/legal/legal-review-s0-s3.md` §2; Annex B = the C-21 End Reason list.

---

## 7. IT / Entra checklist

| # | Item | Done |
|---|---|---|
| E-1 | Create the **API** registration (production): expose scope `access_as_user`; App ID URI `api://<API client ID>`; manifest `api.requestedAccessTokenVersion = 2` | ☐ |
| E-2 | Create the **SPA** registration (separate): platform *Single-page application*, redirect URI(s) = production URL (and staging URL on the staging registration), no implicit grant; API permission `access_as_user` with admin consent | ☐ |
| E-3 | Provide Tenant ID, API client ID, SPA client ID, scope through the configuration channel (never in Git) | ☐ |
| E-4 | Separate registrations (or at least separate redirect URIs and assignments) for staging and production | ☐ |
| E-5 | Enterprise application: *Assignment required = Yes*; assign HR users and technical admins only | ☐ |
| E-6 | Conditional Access / MFA applies to the HRMS SPA | ☐ |
| E-7 | Confirm token lifetime / sign-in frequency policy (tenant defaults acceptable unless HR requests shorter) | ☐ |
| E-8 | No app roles, group claims, client secrets or certificates are needed (public SPA client + delegated scope; roles live in HRMS) | ☐ |
| E-9 | Real-token test session with Development: valid token accepted; v1 token, wrong audience, missing scope, other tenant rejected | ☐ |
| E-10 | Leaver/mover procedure: disabling the Entra account blocks new tokens; HRMS access is also removed/disabled via RBAC-02; existing tokens expire within their lifetime | ☐ |
| E-11 | Production URL, DNS, TLS certificate | ☐ |
| E-12 | Reverse proxy access logs do **not** record query strings; no CORS headers added | ☐ |

---

## 8. Security checklist (pre-production gate)

**A. Already proven** — SEC-01, SEC-02, SEC-04, SEC-08 (app side), ID-09, ID-10 (config logic), LP-10, plus §5.

**B. Configuration required** — SEC-03 re-verify grants as the production app role · SEC-05 proxy logs · SEC-06 secrets store · SEC-09 TLS · SEC-10 DB network isolation · SEC-12 named admin access · ENV-04/05 roles and values · BR-04/05 backup encryption and access · ID-07 MFA/token policy.

**C. Code gaps** — ID-03 MSAL sign-in · RBAC-02 access provisioning with security audit · SEC-07 page security headers (HSTS, frame-ancestors, Referrer-Policy, CSP compatible with MSAL) · OBS-04 production-safe read-only integrity scan · SEC-11 dependency triage/upgrades.

**D. Optional hardening** — SEC-14 rate limiting · SEC-15 idempotency purge · app idle timeout · OBS-07 audit viewer.

Gate rule: all A re-verified on staging/production, all B and C closed (C may be READY WITH ACTION only for SEC-11 if triaged non-exploitable).

---

## 9. Backup / restore plan

### 9.1 Strategy (minimum safe)

| Question | Recommendation (for approval) | EmeSoft risk addressed |
|---|---|---|
| What | The production PostgreSQL database (full logical backup incl. `_prisma_migrations`); the deployed artifact version; non-secret configuration. Secrets backed up by the secret store itself | Loss of HR history; inability to rebuild the service |
| Frequency | Daily automated backup. If the chosen managed PostgreSQL offers point-in-time recovery at no extra process, enable it | Data loss after a failure or a bad change |
| RPO | **24 hours** with daily backups (≤ 15 min if PITR is available). Justification: low write volume (a few HR changes per day), each change traceable to HR source documents and re-enterable | Proportionate to the business impact |
| RTO | **1 business day** (target ≤ 8 working hours). No payroll or real-time dependency exists in Phase 1 | Proportionate; avoids HA infrastructure |
| Retention | Technical proposal: 14 daily + 6 monthly — **Pending Legal Review (Q-L4)**; final value set only after counsel answers | Deleted data lingering in backups; inability to recover older mistakes |
| Encryption | Encrypted at rest by the storage; dump additionally encrypted with a key held outside the backup location; TLS in transit | Backup theft exposes all employee data |
| Location | Separate from the database host (different storage account/server), same legal jurisdiction as approved in Q-L5 | Host loss destroys both data and backup |
| Access | Technical owner(s) only; restore to production requires management approval (restoring discards later changes) | Unauthorised data access via backups |
| Monitoring | Backup failure alert to IT (OBS-02) | Silent backup failure |

**A backup strategy is not accepted until a restore rehearsal succeeds (BR-06).**

### 9.2 Restore procedure (outline)

1. Approval recorded (who, why, which backup).
2. Stop or put the application in maintenance (if restoring production).
3. Restore into a **new** database instance first; never overwrite the only copy.
4. Verify (§9.3 checks 3–7); then switch the application's `DATABASE_URL` or promote the restored instance.
5. Smoke test, reopen, record the incident and the data window lost (HR re-enters from source documents).

### 9.3 Restore-test acceptance scenario (synthetic data only)

1. On **staging**, load the synthetic UAT dataset (demo seed + the workflow scenarios of the clean baseline, including cancelled and voided periods, reversed End events and corrections).
2. Record evidence: row counts per table, `max(revision)` per person sample, `_prisma_migrations` list, integrity scan result (0/0).
3. Take the backup with the production procedure; destroy/replace the staging database (or restore into a fresh instance).
4. Restore with the documented procedure; measure elapsed time.
5. Compare row counts and the `_prisma_migrations` list (identical); integrity scan 0/0; `prisma migrate status` up to date.
6. Application smoke: sign in, list employees, open a person with a voided period (Voided badge, history order), save a change with `expected_revision` (proves sequences/revisions), confirm the audit entry.
7. Pass criteria: all checks identical, elapsed time ≤ RTO, procedure followed without improvisation. Record date, operator, backup id, duration, result; signed by the technical owner.

---

## 10. Deployment / rollback plan

### 10.1 Environments

| Environment | Purpose | Data |
|---|---|---|
| local | development | synthetic |
| test (`hrms_test`) | automated tests, guarded reset | synthetic |
| **staging** (new, lightweight — same platform as production, smaller) | Entra sign-in test, migration rehearsal, restore rehearsal, import rehearsal, HR smoke | synthetic (anonymized only if Q-L5/legal allow) |
| production | real use after the Go-Live Gate | real (after §11 Go/No-Go) |

### 10.2 Release procedure (each production change)

1. Change merged; full quality gate green; Git tag on the commit (tags never moved).
2. Build the artifact once from the tag (pinned lockfile, Node 24); the same artifact goes to staging then production.
3. Staging: deploy, run pending migrations with the runbook, smoke test.
4. Production approval recorded (who/when/what), maintenance window agreed if a migration is included.
5. **Backup immediately before** any production migration.
6. Run migrations as the owner role (`prisma migrate deploy`), **manual and attended**; migrations are forward-only and committed migrations are immutable (CLAUDE.md). `npm run db:migrate` keeps refusing non-local targets — production uses the dedicated runbook command with explicit owner credentials.
7. Deploy the application with production configuration (ENV-05, §15); start.
8. Health check: `GET /health` → `{"status":"ok"}`.
9. Smoke test (10 minutes): sign in with a real HR account; `/api/v1/dev/test-users` → 404; list employees; open a profile; one harmless edit on a designated test record if agreed (or read-only smoke on production); `prisma migrate status` up to date.
10. Record the release (version, migration names, operator, result).

### 10.3 Rollback and forward-fix

- **Application rollback**: redeploy the previous artifact. Safe only when the new migrations are backward-compatible with it — hence the rule that every migration is additive/compatible (expand → migrate → contract across releases).
- **Database**: no down migrations. A faulty migration is corrected by a **new forward migration** (forward-fix).
- **Restore from backup** only as last resort (data written after the backup is lost) and only with management approval.
- **Maintenance window**: short, outside HR working hours, announced to HR; acceptable for an internal system.

---

## 11. Observability / operations (minimum useful)

| Signal | Who | Mechanism | Alert? |
|---|---|---|---|
| Service up / DB reachable | IT | External check of `/health` every 5 min | **Yes** (2 consecutive failures) |
| Backup success/failure | IT | Backup job status | **Yes** (any failure) |
| DB disk space / instance health | IT | Platform metrics | Yes (threshold) |
| Application errors (500) | IT / Development | JSON logs with request id and error type only | No — logs; review on incident or weekly |
| API business errors (4xx) | — | Not logged individually (normal HR validation) | No |
| Failed sign-ins | IT | Entra sign-in logs | No (Entra-native alerts optional) |
| Access denied (403) | Technical owner | Audit `outcome=denied` rows | No — reviewed on request |
| Migration failure | Development / IT | Attended runbook step | N/A (operator present) |
| Integrity scan | Technical owner | Weekly read-only run (after OBS-04) | Report findings to HR system owner |
| Audit access | HR system owner on request | Read-only query by technical owner (no audit UI in Phase 1) | No |

What HR sees: clear error messages with a **Request ID** to quote; nothing else technical. What IT sees: uptime, backups, DB health, logs.

---

## 12. Real-data readiness — **REAL DATA GO / NO-GO CHECKLIST**

Real employee data stays **prohibited** until **every mandatory item** is checked and the checklist is signed by Management, the HR system owner and the technical owner.

| # | Mandatory item | Ref | ☐ |
|---|---|---|---|
| 1 | Counsel answers received and actions done for Q-L1 (basis + notice), Q-L2 (retention), Q-L4 (backups), Q-L5 (hosting/vendor), Q-L6 (impact assessment), Q-L7 (HR access) | LP-01/02/04/05/06/08 | ☐ |
| 2 | Employee notice delivered (if counsel requires) | LP-01 | ☐ |
| 3 | Production environment hosted as approved; TLS; DB not internet-reachable; secrets in the store; no dev password or dev value anywhere | ENV-01–06, SEC-06/09/10 | ☐ |
| 4 | Real Entra sign-in working; test identity verified impossible (404) | ID-01–04, ID-10 | ☐ |
| 5 | Production access control: named HR_ADMIN/HR_EDITOR holders provisioned through RBAC-02; leaver procedure agreed; Entra assignment required | RBAC-02, RD-02, ID-05/06 | ☐ |
| 6 | Security gate §8 passed (A re-verified, B and C closed) | SEC-* | ☐ |
| 7 | Backup running, encrypted, alerting, and **restore rehearsal passed** | BR-01–06, OBS-02 | ☐ |
| 8 | Deployment runbook and rollback policy approved; staging rehearsal done | DR-01–05 | ☐ |
| 9 | Import/onboarding approach approved; synthetic rehearsal passed with integrity 0/0; reconciliation template ready | MIG-01–06 | ☐ |
| 10 | Support model with named people; incident procedure; rule "no ad-hoc production SQL" agreed | SUP-01/02, SEC-12/13 | ☐ |
| 11 | Uptime monitoring active | OBS-01 | ☐ |

Decision: **GO** only if all 11 are checked. Otherwise **NO-GO** — real employee data remains prohibited.

---

## 13. Data migration / import design (no real data imported)

**Decision first (HR, MIG-01).** For ≈100 people two lightweight options exist:

| Option | Fits when | Effort | Risk addressed / remaining |
|---|---|---|---|
| A. Controlled manual entry through the existing screens (Add profile, Initial Employment with Initial Data Capture reason, assignments), double-checked by a second HR person | HR wants only the **current** period and assignment per person | Low dev effort; ≈2–4 HR days | Every record passes the same validations, audit and reason rules; risk = typing errors → reconciliation (MIG-06) |
| B. Import tool driven **through the application services** (no direct SQL), with dry-run | HR wants **historical** periods/assignments or reliability at scale | Development slice | Repeatable rehearsals; validation report before any write |

Recommendation: **A for current-state onboarding** unless HR requires history; B if history depth (MIG-03) is "full".

Design points for either option:

| Topic | Approach |
|---|---|
| Source format | Legacy Excel → a cleaned, HR-approved mapping sheet (PV-05 columns; PV-08 code format) |
| Person matching / duplicates | Employee Code is the key; dry-run flags same name + same DOB, same Work Email, codes differing only by case |
| Employee Code | Legacy codes preserved via `employees.set_code` (HR_ADMIN); never reused (registry) |
| Employment Period history | Per MIG-03; periods must not overlap (DB-enforced); Rehire vs Relationship Change chosen by HR per actual relationship (C-26, C-63) |
| Employee Type | From HR classification per actual relationship, not legacy labels (C-13, PL-07) |
| Work Email | Real company domain configured (`COMPANY_EMAIL_DOMAINS`); uniqueness per overlapping period is DB-enforced |
| Department / Job Title / Level | Production catalogs created first (MIG-07) |
| Manager | Two-pass: create every person and period first, then assignments with managers (manager must be employed on the assignment date) |
| Start/End dates, End Reasons | Past dates entered as Initial Data Capture with a reason (C-25); End Reasons per HR (labels are not legal grounds) |
| Historical assignments | Only if MIG-03 = full history; otherwise the current assignment |
| Cancelled / voided records | **Not imported** — erroneous source rows are corrected in the mapping sheet instead |
| Validation failures | Row-level report; nothing written in dry-run; a failed final run stops and is fixed forward (no SQL patching) |
| Rehearsals | 1. synthetic source on staging · 2. anonymized source only if legally acceptable (Q-L1/Q-L5) · 3. final real import after the Go/No-Go checklist |
| Reconciliation | Counts per status, department, Employee Type; list of persons without Work Email/manager; HR samples ≥ 10 % of records; integrity scan 0/0; HR signs |

---

## 14. RBAC recommendation (C-85)

**Finding.** Capability-based enforcement is already in place (RBAC-01). The fixed bundles HR_ADMIN / HR_EDITOR / API_DOCS_READER fit a lean HR team. The actual pre-production problem is narrower: **today an HRMS user account and its roles can only be created by the development seed script or by SQL**, so adding, replacing or removing HR staff in production would require a developer or ad-hoc SQL — which C-85 and the no-ad-hoc-SQL rule exclude.

| Capability | Classification | Reason |
|---|---|---|
| Account provisioning + assignment of the **existing** roles, enable/disable, with security audit and "≥ 1 active admin" guardrail | **REQUIRED BEFORE FIRST PRODUCTION GO-LIVE** | Without it, staffing changes need SQL/code; leavers cannot be removed safely |
| Configurable role **definitions** (Access Roles as stored bundles, enable/disable roles) | **REQUIRED SOON AFTER GO-LIVE only if** HR needs a bundle different from HR_ADMIN/HR_EDITOR; otherwise **OPTIONAL FOR CURRENT SCALE** | No demonstrated need today; migration path is non-breaking (C-85 §6) |
| Scope (self/team/department), Position → suggested role, Entra group mapping | OPTIONAL / future | No demonstrated need |

**Smallest safe first version (RBAC-02), for approval** — two options:

- **Option 1 (lightest):** a guarded, audited administration **command** run by the technical owner: create user (display name, Entra tenant id + object id), enable/disable, assign/unassign one of the existing roles. Writes a separate security audit record (actor, target, action, before/after). Refuses to remove the last active HR_ADMIN. No UI, no new permission. Staffing changes need the technical owner but **no code change or deployment**.
- **Option 2:** a minimal in-app "Access" screen behind a new permission `access.manage` with the same operations and guardrails. Requires deciding C-85 Q1 (who administers access) and Q2 (anti-escalation) and **adding a permission is a business decision** (CLAUDE.md gate).

Recommendation: **Option 1 before go-live**; Option 2 when HR wants to manage access without IT. Both keep `ROLE_PERMISSIONS` unchanged (no role-definition change).

---

## 15. Production environment / secrets — local/dev assumptions found

| Local/dev assumption | Where | Production requirement |
|---|---|---|
| Public dev DB password `hrms_local_dev_only`; roles created by `docker/db-init` | `docker-compose.yml`, `docker/db-init`, `.env.example` | New owner/app/read-only roles with strong secrets in the store |
| Database on `127.0.0.1:55432` (Docker) | `.env`, compose | Managed or hardened PostgreSQL 18 on a private network, TLS |
| `AUTH_MODE=test`, test issuer secret, `/login` test identity | `.env.example`, `src/app/login` | `AUTH_MODE=entra`; no test variables; MSAL sign-in (ID-03) |
| `COMPANY_EMAIL_DOMAINS=example.test` | `.env.example` | Real EmeSoft domain(s) (PV-06) |
| Catalogs and Employee Types from the dev seed | `scripts/seed-data.ts` (local-only) | Entered by HR_ADMIN via Catalog screens (MIG-07) |
| User accounts/roles from the dev seed (test tenant) | `scripts/seed-data.ts` | RBAC-02 provisioning |
| Migrations and integrity scan refuse non-local hosts | `scripts/migrate.ts`, `scripts/integrity-scan.ts` | Keep the guards; add an approved production runbook (DR-03) and read-only scan mode (OBS-04) |
| `next dev` request logging shows query strings | dev server only | Production `next start` + proxy without query-string logging (SEC-05) |
| No security headers for pages | no `next.config` | SEC-07 |

Least privilege: the runtime uses only `hrms_app`; the owner role is used only by the attended migration step; a read-only role for the integrity scan; no shared credentials between staging and production.

---

## 16. Support / business continuity (lightweight)

| Role | Responsibility | Suggested holder (Management names people) |
|---|---|---|
| System owner | Owns HRMS use and business rules; approves releases with business impact; signs Go/No-Go | HR lead |
| Technical owner | Deployment, migrations, backups/restores, environment, incident handling | Development lead or IT |
| Business-rule issues | Raised to the system owner; decisions recorded in the decision register (Business Decision Gate) | HR lead + Development |
| Access issues | Entra sign-in (IT); HRMS roles via RBAC-02 (technical owner on HR lead's request) | IT + technical owner |
| Incident contact | First contact for "system down / error with Request ID" | Technical owner (backup: IT) |
| Data-correction authority | HR_ADMIN holders, **only through the application's audited correction workflows**; no ad-hoc SQL | HR_ADMIN holders |
| Backup/restore authority | Technical owner executes; production restore needs Management + system owner approval | Technical owner + Management |

Business-hours support only; no on-call rotation (no demonstrated need). Business continuity: if HRMS is unavailable, HR keeps working from source documents and enters changes when the service returns (RTO 1 business day).

---

## 17. Suggested order of execution

1. **Decisions & legal kickoff (week 1, parallel):** send Q-L1–Q-L8 to counsel; Management decides hosting (ENV-01), names owners (SUP-01, RD-02), approves RPO/RTO (BR-02); HR decides onboarding option and history depth (MIG-01/03) and starts the mapping sheet (MIG-02) and catalogs (MIG-07).
2. **IT foundation:** Entra registrations (E-1…E-8), staging environment, production-like DB, secrets store, TLS, network isolation.
3. **Development P0 slices (each through the normal gate and approval):** MSAL sign-in (ID-03) → access provisioning v1 (RBAC-02) → security headers (SEC-07) → runbooks (DR-03/04/05) → import tool only if MIG-01 = B.
4. **Staging rehearsals:** real-token verification (ID-04), migration rehearsal, **restore rehearsal (BR-06)**, import rehearsal on synthetic data (MIG-05), HR smoke.
5. **Production build-out:** environment, monitoring and alerts (OBS-01/02), backup running; deploy with the runbook; empty-database smoke with real sign-in (GL-02).
6. **Real-Data Go/No-Go (§12)** signed → final import + reconciliation (MIG-06).
7. **Go-Live Gate (§18)** → explicit human Production Ready decision.

---

## 18. Production Go-Live Gate

States per domain: **BLOCKED** (an open P0) · **READY WITH ACTION** (no open P0; open P1 items have owners and dates) · **READY** (no open P0 or P1).

| Domain | State today | Condition to move |
|---|---|---|
| Legal / Privacy | BLOCKED | Q-L1, Q-L2, Q-L4, Q-L5, Q-L6, Q-L7 answered and actioned |
| Identity / Entra | BLOCKED | ID-01–04, ID-06, ID-10 done |
| Security | BLOCKED | §8 B and C closed |
| Backup / Restore | BLOCKED | BR-01–05 + first restore rehearsal passed |
| Deployment / Rollback | BLOCKED | DR-01–05 |
| Observability | BLOCKED | OBS-01/02 |
| Real-data readiness | BLOCKED | §12 signed |
| Data migration / import | BLOCKED | MIG-01–06 |
| RBAC (access provisioning) | BLOCKED | RBAC-02 |
| Environment / secrets | BLOCKED | ENV-01–06 |
| Support | BLOCKED | SUP-01/02 |
| Go-live acceptance | BLOCKED | All above READY or READY WITH ACTION; GL-02 smoke |

**Production Ready** may be recorded only by an explicit, signed human decision of Management, the HR system owner and the technical owner, recorded in the decision register. Engineering (including Claude) never self-declares it. Until then the status stays **`Core HR Phase 1 — UAT Passed With Pre-Production Actions`**.
