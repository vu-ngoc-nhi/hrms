# Mini HRS — Gate A Readiness Status (authoritative)

- Date: 2026-10-12. Type: **readiness review / status refresh only.** Nothing was implemented, provisioned, deployed or configured. No real employee data was used.
- Baseline: release status **`Core HR Phase 1 — UAT Passed With Pre-Production Actions`**; Product/UI baseline frozen for Gate A (no Phase 1 features, no Phase 2). Production Ready is never self-declared (readiness plan Appendix K).
- Sources: `pre-production-readiness-plan.md` (revision 2), `pre-production-decision-pack-01.md`, `it-pre-production-handoff.md`, `access-administration-runbook.md`, `docs/legal/legal-review-s0-s3.md`, `docs/decision-register.md` (revision 57), the repository code and a fresh local quality gate (§0).
- This document **supersedes the "Today" status line** of the readiness plan. The plan stays the reference for scope, appendices and checklists.

**Status model (only these values):** COMPLETE · DEVELOPMENT COMPLETE · PENDING EXTERNAL INPUT · PENDING REHEARSAL · BLOCKED · NOT REQUIRED.
Rules used: a gate is COMPLETE only when its closure evidence exists and the accountable owner accepted it. DEVELOPMENT COMPLETE = proven locally (code + tests), not on a real environment. PENDING EXTERNAL INPUT = the next step needs a person outside local engineering (including the owner's approval to start local work). PENDING REHEARSAL = all inputs exist; only the staging rehearsal remains. BLOCKED = cannot start until another listed item closes.

---

## 0. Fresh local evidence (2026-10-12, synthetic data, local only)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (guarded `hrms_test`: drop `public` schema → `prisma migrate deploy` of all 10 migrations from empty → suite) | **52 files, 629/629 pass** |
| `npm run test:integrity-baseline` | 1/1 pass (integrity scan 0/0 on the clean baseline) |
| `npm audit --omit=dev` | 11 advisories (4 high, 7 low) — see A2; no triage note exists yet |

Caveat: "from empty" is **schema-level** on a local cluster where the migration identity can create roles. A fresh cluster with a non-superuser migration identity (the real staging/production case, handoff §4) has **not** been proven.

---

## Gate A status table

| Gate | Status | Existing Evidence | Remaining Dependency | Owner | Next Action | Closure Evidence |
|---|---|---|---|---|---|---|
| **A1** Legal / privacy | PENDING EXTERNAL INPUT | Questions Q-L1…Q-L12 drafted (plan App. A); data-group table (legal review §2); sensitive groups rejected by the API; C-88 decision to start review. **No evidence the questions were sent; no counsel answer.** | Counsel answers to Q-L1, Q-L2, Q-L4, Q-L5, Q-L6, Q-L7; hosting choice (input to Q-L5); Management scoping of Q-L12 | Legal (answers) — HR Lead sends | HR Lead sends the question pack and names the counsel contact | Written counsel answers recorded in the register (PL items → decided); notice text + delivery record if required; retention values recorded |
| **A2** Secure production foundation | PENDING EXTERNAL INPUT | Code: least-privilege DB grants (tests), test identity off unless local/test (`/api/v1/dev/*` → 404), log/error hygiene, same-origin API, no CORS headers, minimal `/health`, migration/scan guards. **Gaps in code:** no page security headers; no fail-fast production config validation; no advisory triage note | IT-01…IT-07 (hosting, staging, network, DNS/TLS, secrets, proxy logs, dedicated DB) | IT | IT answers IT-01 (hosting) first; owner approves local items L1–L3 | Platform record; grants re-verified as the real app role; header check on the URL; proxy log sample; secrets inventory; advisory triage note; config review showing no development value |
| **A3** Production Entra | PENDING EXTERNAL INPUT | Verifier proven with local keys (v2 only, `aud` = API client ID, scope, `tid`/`oid`, RS256); test identity impossible in production config. **No browser sign-in exists** (production has no working login page) | IT-08 (non-prod registration E1–E10, PV-11); then MSAL implementation | IT | IT provides non-prod Entra inputs E1–E10 | Staging: real sign-in/sign-out; accepted valid token; rejected v1 / wrong audience / missing scope / other tenant; `/api/v1/dev/test-users` → 404; MFA prompt observed |
| **A4** Access administration + owners | DEVELOPMENT COMPLETE | C-94: guarded routines, protected operator mapping, audit, CLI, guards; 34 dedicated tests in the 629 suite; runbook with bootstrap and leaver steps | Names (PV-26), operators (PV-28 F), IT-09…IT-12, staging | Management (names) | Management names System Owner, Technical Owner, primary + backup HR admin, ≤ 2 operators | Named list in the register; supervised staging rehearsal record (§A4.3) |
| **A5** Backup + restore | PENDING EXTERNAL INPUT | Target only: RPO ≤ 4 h, RTO ≤ 1 business day (M-14, provisional); restore scenario defined (plan App. C.3) | IT-13 backup proposal (B1–B8), PV-27; hosting (IT-01); retention value Pending Legal (Q-L4) | IT | IT proposes the backup method that meets RPO/RTO | Signed restore-rehearsal record (§A5.2) |
| **A6** Deploy / migration rehearsal | PENDING EXTERNAL INPUT | Forward-only immutable migrations; 10 migrations applied from an empty schema locally; `db:migrate` refuses non-local; `/health`; maintenance rule C-91. **No deployment runbook; never run on a non-local cluster** | Hosting + staging + migration authority (IT-01, IT-02, IT-09); A3 sign-in for the auth step | IT (inputs) → Technical Owner (runbook, rehearsal) | IT answers IT-01/02/09; local engineering drafts the generic runbook (B-list) | Staging rehearsal record (§A6.2) |
| **A7** Synthetic onboarding rehearsal | PENDING EXTERNAL INPUT | Option and depth decided (M-12, M-13); schema supports `record_source = snapshot_import / legacy_import`; Initial Data Capture rule (C-25). **No import utility, no mapping, no production catalogs** | HR mapping PV-05, PV-08; real catalogs PV-06; (classification guidance PL-07 — see A1) | HR | HR prepares the source mapping and catalogs from the actual source (outside any system) | Synthetic rehearsal on staging: dry-run report, import, reconciliation sheet, integrity 0/0, HR sign-off (§A7.3) |
| **A8** Real-Data Go/No-Go | BLOCKED | Checklist exists (plan App. G); refined in §A8 | A1–A7 all COMPLETE | Management | None until A1–A7 close | Signed record: **REAL DATA ALLOWED** or **REAL DATA PROHIBITED** |

**Gate A: 0 / 8 COMPLETE. Real employee data remains PROHIBITED.**

---

## 1. Executive readiness summary

- The **application** is ready for a real environment: 629 tests, migrations from empty, integrity 0/0, access administration built. The **surroundings** are not: no hosting decision, no staging, no Entra registration, no backup, no counsel answer, no names.
- Nothing has moved since Decision Pack 01 on the external side: every IT decision IT-01…IT-15 is still *Open*, PV-26/PV-27/PV-28 F are open, and the repository holds no evidence that the legal questions were sent.
- **Three real code gaps remain** before Gate A can close, all small: (1) browser Entra sign-in (blocked on IT), (2) page security headers + fail-fast production configuration, (3) the one-time import utility (blocked on HR mapping). Plus documentation: deployment/migration runbook, restore runbook, rehearsal evidence templates.
- The **critical path** is the longer of: *counsel answers (A1)* and *IT hosting → staging → Entra → sign-in → rehearsals (A2/A3/A5/A6)*. Both start with one action this week: send the legal pack; decide hosting.
- One documentation inconsistency was found and corrected (handoff said `APP_ENV=staging`; the code accepts only `local | test | production`, so staging runs with `APP_ENV=production`).

---

## 2. Gate detail

### A1 — Legal / privacy approval

Status: **PENDING EXTERNAL INPUT.** Engineering draws no legal conclusion (C-88). Real data is blocked while any BR item below is open.

| Q | Topic | Classification | Blocks real data? | Note |
|---|---|---|---|---|
| Q-L1 | Lawful basis per data group + employee notice (PL-05) | **Pending Legal** | Yes | Includes data categories / minimisation: whether optional fields (date of birth, gender, mobile phone, personal email) are collected at all |
| Q-L2 | Retention incl. leavers; deletion/anonymisation (PL-01, Q-L11) | **Pending Legal** | Yes | No retention or deletion feature exists or is assumed (ADR-0004) |
| Q-L3 | Audit-log / access-audit retention (PV-28 H) | **Pending Legal** | No (plan: keep-all meanwhile, Gate C) | Owner may promote it to blocking; logs carry no personal values |
| Q-L4 | Backup retention; deletion reaching backups | **Pending Legal** | Yes | Feeds A5 retention value |
| Q-L5 | Hosting / vendor / cloud / encryption / cross-border (PL-02) | **Pending Legal** — needs **Pending Management** input first (hosting choice IT-01) | Yes | Cannot be answered until the hosting option is known |
| Q-L6 | Impact assessment applicability, owner, deadline (PL-04) | **Pending Legal** | Yes | Decree 356 Art. 41 relief not assumed |
| Q-L7 | HR_EDITOR access to personal contact fields | **Pending Legal** | Yes | No access change before the answer |
| Q-L8 | Data-subject requests | **Pending Legal** | No — Gate B4 | Send now with the pack (lead time) |
| Q-L9 | Data export | **Not required for Phase 1** | — | No export exists (D-UI-5) |
| Q-L10 | Sensitive / identity-document groups (PL-03) | **Not required for Phase 1** | — | Rejected by the API |
| Q-L12 | Intern / Service Contractor classification, End Reasons (PL-07, PL-09) | **Pending Management** (scoping) | Decision needed | **Conflict:** the legal review marks PL-09 "before real data" and PL-07 "before real classification"; the readiness plan classifies Q-L12 as Gate C. Management decides whether it is in A1; recommendation: send it with the pack (no cost) and decide blocking status when counsel replies |
| Logging | Error/app logs, proxy logs, Entra sign-in logs | Not a separate question | — | Technical control (A2: no personal data, no query strings); retention part is Q-L3 |

Next action: **HR Lead** sends Q-L1…Q-L8 + Q-L12 with Annex A/B and names the counsel contact (C-88). Closure evidence: written counsel answers for Q-L1, Q-L2, Q-L4, Q-L5, Q-L6, Q-L7 recorded in the register; notice text and proof of delivery if counsel requires it; retention values recorded as decided.

### A2 — Secure production foundation

Status: **PENDING EXTERNAL INPUT** (infrastructure), with three local code items awaiting approval.

| Area | Code ready? | Infrastructure | Status |
|---|---|---|---|
| Runtime (Node 24, `next build` / `next start`, one instance) | Yes | IT-01 (H1, H4) | PENDING EXTERNAL INPUT |
| PostgreSQL 18, encrypted storage, PITR if available | Yes (migrations) | IT-01 (H5) | PENDING EXTERNAL INPUT |
| Dedicated DB / PUBLIC TEMP+CREATE revocation compatible | Migration fails closed | IT-07 (H11) | PENDING EXTERNAL INPUT |
| Private DB network, TLS to DB | n/a | IT-03 (H6) | PENDING EXTERNAL INPUT |
| DNS + TLS for staging / production | n/a | IT-04 (H7, H8) | PENDING EXTERNAL INPUT |
| Reverse proxy: no query strings in logs, no CORS headers | App adds no CORS headers; app logs only request id + error type | IT-06 (H10) | PENDING EXTERNAL INPUT |
| Secrets store (DB logins, `IDEMPOTENCY_HMAC_KEY`, operator logins) | Values only from env | IT-05 (H9) | PENDING EXTERNAL INPUT |
| Environment isolation (separate DBs, secrets, registrations) | Access environment record refuses the dev tenant on staging/production | IT-02 | PENDING EXTERNAL INPUT |
| Least-privilege roles (owner / `hrms_app` / read-only) | Proven locally (`db-schema-guarantees`) | IT-09, IT-14 | DEVELOPMENT COMPLETE (re-verify on staging) |
| Dev/test endpoint isolation (`/api/v1/dev/*` → 404, test tokens rejected) | Yes — `isTestIdentityAllowed` requires `APP_ENV` local/test and `NODE_ENV≠production` | verify on staging | DEVELOPMENT COMPLETE |
| Sensitive-data leakage (logs, errors, audit, idempotency HMAC) | Yes | proxy logs (IT-06) | DEVELOPMENT COMPLETE |
| **L1 Page security headers** (HSTS, `frame-ancestors`/X-Frame-Options, `X-Content-Type-Options`, Referrer-Policy); final CSP after MSAL | **No** — no `next.config` | — | PENDING EXTERNAL INPUT (owner approval to start) |
| **L2 Fail-fast production configuration** — refuse to start when `APP_ENV=production` and: `AUTH_MODE≠entra`, Entra values missing, `AUTH_TEST_ISSUER_*` present, `COMPANY_EMAIL_DOMAINS` empty or `example.test`, dev password in `DATABASE_URL`. Today a missing Entra value fails *closed but silently* (every request 401) | **No** | — | PENDING EXTERNAL INPUT (owner approval to start) |
| **L3 Dependency advisory triage note** | **No** — 4 high in the Prisma CLI chain (`deepmerge-ts`, unused `mysql2`; migration-time tooling, not the request path), 7 low in the Scalar API-reference / `ai` chain (internal docs page; agent/telemetry disabled). Dev-only: `eslint-config-next` chain | — | PENDING EXTERNAL INPUT (owner approval to start) |

Closure evidence: platform record (hosting, network, TLS, secrets location); grants re-verified with the `db-schema-guarantees` checks as the real staging app role; response-header check on the staging URL; proxy log sample without query strings and no CORS header; secrets inventory (names and holders, no values); advisory triage note; configuration review showing no development value (`hrms_local_dev_only`, test tenant, `example.test`, `AUTH_MODE=test`).

### A3 — Production Entra authentication

Status: **PENDING EXTERNAL INPUT** (IT-08 / PV-11); the MSAL work is **BLOCKED** on it.

| Item | Classification |
|---|---|
| v2 tokens only; issuer `https://login.microsoftonline.com/<tenant>/v2.0`; `aud` = API client ID (App ID URI refused); scope `access_as_user` (configurable); `tid`/`oid`; RS256 via tenant JWKS | **Invariant enforced in code** (local keys only) |
| Test identity impossible in production config; `/api/v1/dev/*` → 404; account without an enabled HRMS user → 403; disabled HRMS user → 403 on next request | **Invariant enforced in code** |
| Tenant ID (E1); SPA client ID, redirect + post-logout URIs (E2); API client ID = `aud`, scope, v2 confirmation (E3); admin consent (E4); issuer confirmation (E5) | **Configuration required from IT** |
| Topology: two registrations (recommended) or an equivalent satisfying the invariants | **Decision required — IT** (Development confirms with real tokens) |
| MFA / Conditional Access (E6) | **Configuration required from IT** — observed in rehearsal |
| "Assignment required" (E7) | **Decision required — IT**; recommended later (Gate C) — HRMS already denies unknown accounts |
| Account-disable expectation and token lifetime (E8) | **Configuration required from IT**; accepted residual: remaining token lifetime |
| 2–3 non-prod synthetic test accounts (E9) | **Configuration required from IT** |
| Support owner for Entra changes (E10) | **Configuration required from IT** |
| Browser sign-in (MSAL, Auth Code + PKCE) replacing the dev `/login` page | **Local engineering — BLOCKED** on E1–E5 |
| Real-token accept/reject test; sign-in/sign-out; MFA observed | **Rehearsal required** |

Closure evidence: staging rehearsal record with a successful sign-in/sign-out, one accepted valid token, and rejections of a v1 token, wrong audience, missing scope and another tenant's token; `/api/v1/dev/test-users` → 404; MFA prompt observed; disabled-account behaviour demonstrated (Entra disable blocks new sign-in; `user disable` → 403 on next request).

### A4 — Minimum access administration and named owners

Status: **DEVELOPMENT COMPLETE.** Configurable Access Roles stay P1 / Gate C (C-92) — not reopened.

**A4.1 Development-complete (C-94, verified by the 629-test run):** access tables (`access_operator`, `access_environment`, append-only `access_audit_event`); SECURITY DEFINER routines owned by NOLOGIN `hrms_access_function_owner`, pinned `search_path`, EXECUTE revoked from PUBLIC; operator identity from `session_user` → protected mapping (no operator-settable actor); administrative semantics by effective permissions (`ADMINISTRATIVE_PERMISSIONS`, drift-tested), never role names; operators have no DML on HR or access tables and `hrms_app` is read-only on accounts; mandatory reason; race-safe last-admin guard; self-escalation guard; environment guard (dev tenant refused on staging/production); preview + typed confirmation + stale-preview refusal; CLI with exit codes; 34 dedicated tests; runbook with bootstrap, joiner/mover/leaver, quarterly review, recovery.

**A4.2 Remaining operational requirements:**

| Item | Owner | Status |
|---|---|---|
| Named System Owner (PV-26) | Management | PENDING EXTERNAL INPUT |
| Named Technical Owner (PV-26, P1) | Management | PENDING EXTERNAL INPUT |
| Primary + backup HR administrator (PV-26, C-90: ≥ 2 operational admins) | HR Lead | PENDING EXTERNAL INPUT |
| Access operators, maximum two (P2, PV-28 F) | Management | PENDING EXTERNAL INPUT |
| Operator Entra object IDs (P4) and admins' Entra object IDs | IT | PENDING EXTERNAL INPUT |
| Operator PostgreSQL logins (P3), personal, `CONNECT` only | IT | PENDING EXTERNAL INPUT |
| Approved operator machine(s) (P5) | IT | PENDING EXTERNAL INPUT |
| Credential handling in the secret store (P6) | IT | PENDING EXTERNAL INPUT |
| Operator registration / revocation authority (P7–P9) | IT | PENDING EXTERNAL INPUT |
| Leaver procedure sign-off (runbook §6) and no-ad-hoc-SQL rule acknowledged | HR Lead | PENDING EXTERNAL INPUT |
| Supervised staging rehearsal | Technical Owner | BLOCKED (staging, A3 identities) |

**A4.3 Closure evidence:** named list recorded in the register; staging rehearsal record: environment configured, operator registered, first two HR_ADMIN bootstrapped, role assign/remove, disable/enable, last-admin removal refused (exit 2), operator self-grant refused (exit 2), audit rows show operator, reason, before/after; one admin signs in through Entra (A3) and sees data permitted by the role.

### A5 — Backup + successful restore rehearsal

Status: **PENDING EXTERNAL INPUT** (IT-13, PV-27). Configured backups do **not** close A5.

**A5.1 IT must provide:** method (managed snapshot/PITR, `pg_dump`, WAL archiving); frequency ≤ 4 h or PITR (RPO); encryption at rest + in transit and key custody; storage separate from the DB host in the approved jurisdiction; access limited to the Technical Owner(s), production restore only with Management + System Owner approval; failure alert target; restore procedure and expected duration vs RTO; retention proposal (final value Pending Legal, Q-L4).

**A5.2 Exact rehearsal evidence (synthetic data, staging):**
1. Before: synthetic dataset loaded (demo seed + clean-baseline scenarios incl. cancelled/voided periods, reversed End, corrections, access-admin rows); recorded row counts per table, `_prisma_migrations` list, `max(revision)` for a sample, integrity scan 0/0, access-audit row count.
2. Backup taken with the production procedure; backup id and timestamp recorded; the failure alert is test-fired once and its receipt recorded.
3. Restore into a **new** instance (never over the only copy); elapsed time measured.
4. After: identical row counts and migration list; `prisma migrate status` up to date; integrity 0/0; access audit intact; access routines still owned by `hrms_access_function_owner`.
5. App smoke on the restored DB: Entra sign-in, list, open a voided-period person, a write with `expected_revision`, audit entry present.
6. Record: date, operator, backup id, duration ≤ RTO, result; signed by the Technical Owner. A restore that needed improvisation **fails** the rehearsal.

### A6 — Deployment / migration rehearsal

Status: **PENDING EXTERNAL INPUT** (IT-01, IT-02, IT-09).

| Topic | Current state |
|---|---|
| Migration model | Forward-only, committed migrations immutable; 10 migrations; latest `20261014000000_cancel_planned_assignment` |
| Migration authority | Owner login only for the attended step (`MIGRATION_DATABASE_URL`); never in the running app |
| Function-owner requirement | Migration identity must create (or IT pre-creates) the two NOLOGIN roles and be able to `SET ROLE hrms_access_function_owner`; otherwise the migration stops (fail closed) — handoff §4 |
| Runbook | **Missing.** Generic procedure exists (plan App. D); environment-specific runbook waits for hosting |
| Rollback / forward-fix | App rollback = redeploy previous artifact; DB = forward-fix migration; restore only as last resort with approval |
| Startup / health | `/health` → `{"status":"ok"}` or 503; no fail-fast config validation yet (A2 L2) |
| Migration failure | `prisma migrate deploy` stops on the failing migration and records it; recovery = forward-fix or restore (with approval); never edit a committed migration |
| From-zero evidence | Local only, schema-level (§0); fresh-cluster, non-superuser path not proven |
| Maintenance | Outside working hours with notice (C-91); no CAB, no recurring process |

**A6.2 Staging rehearsal (closure evidence):** known empty staging DB (fresh cluster) → build the artifact once from a Git tag → deploy with staging config (`APP_ENV=production`, `NODE_ENV=production`, `AUTH_MODE=entra`) → backup → attended `prisma migrate deploy` with owner credentials (all 10 migrations, function-owner path verified) → app starts; `/health` ok; config review shows no dev value → Entra sign-in works (A3) → access-admin bootstrap works (A4) → synthetic data load → integrity scan (read-only role) 0/0 → `/api/v1/dev/test-users` 404 → rollback drill: redeploy the previous artifact and confirm it starts against the migrated schema → record version, migrations, operator, timings, result. Signed by the Technical Owner.

### A7 — Synthetic data onboarding rehearsal

Status: **PENDING EXTERNAL INPUT** (HR mapping PV-05, PV-08; catalogs PV-06).

**Is the import utility Gate A work?** Yes, under M-12 (approved). A7 cannot close without either the utility or an owner decision to replace it. Controlled manual entry is *technically* acceptable at ~100 people for current-state records (≈ 10–15 HR hours + second-person check), but entering prior Employment Periods for rehire/relationship history by hand is error-prone. Switching to manual entry would reverse an approved MVP decision → **HR decision, not taken here.** Recommendation: keep M-12; build the utility only after the mapping is approved (it is small and throw-away).

**Source fields implied by the frozen Phase 1 model** (which optional fields are actually loaded is HR + Legal Q-L1):

| Group | Required by the model | Optional |
|---|---|---|
| Person | Full name; Employee Code (legacy code preserved, PV-08) | Date of birth, gender, mobile phone, personal email |
| Employment Period (per period) | Start date; Employee Type code; for prior periods: end date + End Reason code (note for `OTHER`) + how the next period relates (Rehire vs Relationship Change, C-26/C-63) | Work Email (company domain; expected per Employee Type `requires_work_email`) |
| Assignment (current, per period) | Effective-from date, Department code, Job Title code, change reason | Level code, Manager (by Employee Code; employed on the date; second pass) |
| Catalogs (before import) | Departments, Job Titles (EN, VI where official), Levels, Employee Types + Work-Email policy, company email domain(s) | — |
| Excluded | Cancelled/erroneous source rows (fixed in the sheet), historical assignment changes (M-13), sensitive groups (rejected) | — |

**A7.3 Minimum synthetic rehearsal (closure evidence):** synthetic source file in the approved mapping format (incl. a rehire, an ended period, a manager chain, deliberate errors) → validation report (row-level errors, duplicates by code / name+DOB / Work Email, unknown catalog values, manager not employed on date) → dry-run preview, nothing written → corrected file → approved import through the application services (no SQL) → reconciliation sheet (counts per status / department / Employee Type, persons without Work Email or manager, ≥ 10 % sample) → integrity scan 0/0 → HR Lead signs the rehearsal and the reconciliation template.

### A8 — Signed Real-Data Go / No-Go

Status: **BLOCKED** until A1–A7 are COMPLETE.

| # | Condition (all mandatory) | Evidence referenced |
|---|---|---|
| 1 | A1 COMPLETE — counsel answers Q-L1, Q-L2, Q-L4, Q-L5, Q-L6, Q-L7 recorded; notice delivered if required; Q-L12 scoping decided | Register entries |
| 2 | A2 COMPLETE — production platform matches the staging-verified configuration | Platform record, header/proxy checks, triage note |
| 3 | A3 COMPLETE — production registration configured; staging real-token rehearsal passed | Rehearsal record |
| 4 | A4 COMPLETE — names recorded; operators provisioned; staging access rehearsal passed | Named list, rehearsal record |
| 5 | A5 COMPLETE — production backups running and alerting; restore rehearsal passed within RTO | Signed restore record |
| 6 | A6 COMPLETE — runbook approved; staging deploy/migrate/rollback rehearsal passed | Rehearsal record |
| 7 | A7 COMPLETE — mapping + catalogs approved; synthetic import rehearsal passed with integrity 0/0; reconciliation template signed | Rehearsal record |

**Signatories (minimum sufficient):** (1) **Management** — accountable for the legal and business risk of processing real data; (2) **HR System Owner** — accountable for the HR data and its use; (3) **Technical Owner** — attests the A2–A7 evidence. No other approver adds a meaningful control. Legal does not sign A8; its answers are a precondition (item 1).

**Outcome:** exactly one of **REAL DATA ALLOWED** (all seven items checked, three signatures, date) or **REAL DATA PROHIBITED** (list of failing items). No partial or conditional outcome.

---

## 3. Ownership matrix (one accountable owner each)

| Item | Accountable | Supports |
|---|---|---|
| Send legal pack, name counsel contact | HR Lead | Management |
| Counsel answers Q-L1…Q-L8 (+ Q-L12) | Legal | HR Lead |
| Q-L12 scoping (blocking or not) | Management | Legal |
| Hosting decision IT-01 | Management | IT |
| IT-02…IT-07 platform, network, DNS/TLS, secrets, proxy, dedicated DB | IT | Technical Owner |
| IT-08 Entra non-prod inputs E1–E10 / PV-11 | IT | Technical Owner |
| IT-09 migration authority / function-owner provisioning | IT | Technical Owner |
| IT-10 names: Technical Owner, operators (PV-26, PV-28 F) | Management | IT |
| System Owner, primary + backup HR admins (PV-26) | Management | HR Lead |
| IT-11/IT-12 operator machines, credentials, revocation authority | IT | Technical Owner |
| IT-13 backup proposal / PV-27 | IT | Technical Owner |
| IT-14 read-only DB role for integrity scan | IT | Technical Owner |
| Source mapping PV-05, PV-08; real catalogs PV-06 | HR | Claude/local engineering (format) |
| Leaver procedure sign-off; no-ad-hoc-SQL rule | HR Lead | Technical Owner |
| L1 headers, L2 config validation, L3 advisory triage | Claude/local engineering | Technical Owner (review) |
| MSAL sign-in | Claude/local engineering | IT |
| Deployment/migration runbook, restore runbook, evidence templates | Technical Owner | Claude/local engineering (drafts) |
| Import utility | Claude/local engineering | HR |
| Staging rehearsals (A3–A7) | Technical Owner | IT, HR |
| A8 decision | Management | HR System Owner, Technical Owner |

---

## 4. Critical path

```
Week 0 ─┬─ HR Lead: send legal pack ──► Legal: answers (counsel lead time) ───────────────┐
        ├─ Management: hosting (IT-01) ─► IT: staging, DB, TLS, secrets ─┐                  │
        │                                └─► Legal Q-L5 needs hosting ──┘ (joins A1 path)  │
        ├─ IT: Entra non-prod (IT-08) ─► Dev: MSAL sign-in ─┐                               │
        ├─ Management: names (PV-26, PV-28 F) ─► IT: operator logins ─┐                     │
        ├─ HR: mapping + catalogs (PV-05/06/08) ─► Dev: import utility ─┐                   │
        └─ Dev (on approval): L1, L2, L3, runbook drafts ─────────────┐ │                   │
                                                                      ▼ ▼                   │
           Staging rehearsals: deploy+migrate (A6) → sign-in (A3) → access admin (A4)       │
                                → synthetic import (A7) → backup + RESTORE (A5)             │
                                                                      └──► A8 Go/No-Go ◄───┘
```

The critical path is the **longer** of (a) counsel lead time, which cannot finish before the hosting choice because Q-L5 depends on it, and (b) hosting → staging → Entra → MSAL → the combined staging rehearsal. Names and mapping are short HR/Management tasks but **block rehearsals** if late. The evidence confirms the expected shape, with one refinement: **A1 depends on the hosting decision** (Q-L5), so IT-01 sits on both branches and is the single most valuable early decision.

## 5. Work that can run in parallel now

- Legal pack sent and answered (HR Lead → Legal).
- Hosting decision and staging build (Management → IT).
- Entra non-prod registration (IT).
- Names for owners, HR admins and operators (Management, HR Lead).
- Source mapping and catalogs prepared offline (HR).
- Local engineering items L1–L3 and documentation drafts (Claude, on approval).

The staging rehearsals can run as **one combined session** (A6 → A3 → A4 → A7 → A5) once staging, Entra and names exist — no separate ceremony per gate.

## 6. External questions / inputs required

| To | Inputs |
|---|---|
| Legal | Q-L1, Q-L2, Q-L4, Q-L5, Q-L6, Q-L7 (blocking); Q-L3, Q-L8 (non-blocking, send now); Q-L12 (scoping) |
| Management | Hosting choice (IT-01); System Owner, Technical Owner, operators (≤ 2); Q-L12 scoping; A8 signature |
| HR Lead | Send legal pack + counsel contact; primary + backup HR admin; leaver procedure sign-off; mapping PV-05/PV-08; catalogs PV-06 (departments, job titles EN/VI, levels, Employee Types with Work-Email policy, company email domain); which people need prior periods (M-13) |
| IT | IT-01…IT-15 (handoff §7), E1–E10, PV-11, PV-27, B1–B8, P3–P9 |

## 7. Local engineering tasks

| Cat. | Task | Notes |
|---|---|---|
| **A — can complete now (on approval)** | L1 page security-header baseline (no CSP yet) | Security hardening; no permission change |
| A | L2 fail-fast production configuration validation | Refuses dev values in `APP_ENV=production`; unit-tested |
| A | L3 dependency advisory triage note | Documentation; upgrades remain Gate C |
| **B — prepare, external execution** | Generic deployment/migration runbook (from plan App. D + handoff §4) | Finalised after hosting |
| B | Restore runbook + restore rehearsal record template (§A5.2) | IT executes |
| B | Combined staging rehearsal checklist / evidence record (A3–A7) | Technical Owner executes |
| B | Legal pack as a send-ready document (Q-L1…Q-L12 + Annex A/B) | HR Lead sends; no answers drafted |
| B | Mapping template with the model's fields (§A7) for HR to fill offline | HR decides optional fields with Legal |
| B | A8 Go/No-Go record template | Management signs |
| **C — external owner must act** | Everything in §6 | — |
| **D — blocked** | MSAL sign-in; final CSP | IT-08 |
| D | Import utility | PV-05/06/08 approved |
| D | Production-safe read-only integrity scan mode | IT-14 |
| D | Environment-specific runbook | IT-01/02/09 |

Claude has not performed, and will not report as done, any external action (sending, provisioning, configuring, naming).

## 8. Real Data Gate conditions

Real employee data may enter **any** system (staging included) only after A8 records **REAL DATA ALLOWED**. Until then: synthetic data only; anonymised rehearsal data only if counsel explicitly allows it (Q-L1/Q-L5); real source files stay outside every Mini HRS environment and every AI tool.

## 9. Recommended execution order

1. **This week, external:** HR Lead sends the legal pack; Management decides hosting (IT-01) and names owners/operators; IT starts Entra non-prod (IT-08); HR starts mapping + catalogs.
2. **This week, local (on approval):** L2 → L1 → L3; then category-B drafts (legal pack document, rehearsal checklist, restore template, generic runbook, mapping template).
3. **When IT-08 arrives:** MSAL sign-in, then final CSP.
4. **When mapping is approved:** import utility (M-12) with dry-run report.
5. **When staging + names exist:** one combined staging rehearsal (A6 → A3 → A4 → A7 → A5), evidence recorded per §A3–A7.
6. **When counsel answers:** record decisions; adjust optional-field loading or access if required (separate approval).
7. **A8 Go/No-Go** signed by Management, HR System Owner, Technical Owner.

Product scope stays frozen throughout: no richer dashboard/analytics, Leave, Documents/Contracts, Export, Reports, Notifications, org chart, configurable Access Roles, duplicate-person engine, AI features or broader audit viewer — unless a P0 production blocker is found.
