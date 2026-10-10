# Mini HRS — Pre-Production Readiness Plan (revision 2: gated)

- Phase: **Pre-Production Readiness Planning** — planning only; nothing in this document has been implemented.
- Baseline: **`Core HR Phase 1 — UAT Passed With Pre-Production Actions`** (PV-25 Accepted / Closed). **UAT Passed ≠ Production Ready.**
- Target: **minimum safe production** for EmeSoft (~70–100 employees, lean HR team) — not enterprise completeness before launch. C-84: *reduce process complexity, not engineering quality*. C-85: *flexible role configuration, strict authorization enforcement*.
- **Decision Pack 01 (2026-10-10, `pre-production-decision-pack-01.md`)** resolved several open questions (onboarding option and depth, access-administration form, ownership rule, RPO/RTO target, maintenance, RBAC scope). Updated below where relevant. **Decisions are not evidence: no gate group is passed.**
- Revision 2 (2026-10-10) replaces the flat list of 55 P0 items (revision 1) with **three gates and 13 requirement groups**. Nothing was weakened in legal/privacy, authentication/authorization, secrets/isolation, data integrity, backup/restore, deployment safety or real-data validation; duplicated or speculative P0s were grouped or downgraded (§4, §5). The full revision-1 item list stays traceable in Appendix J.

---

## Page 1 — What exactly prevents us from putting Mini HRS into real use?

**The application is ready; its production surroundings are not.** Authorization, history integrity, audit, concurrency and correction workflows are proven by tests and two UAT rounds. What is missing is the environment and the operating conditions to hold real employee data safely.

**GATE A — Before real data.** Until all eight groups pass, *real employee data remains prohibited.*

| # | What is missing | Why it blocks |
|---|---|---|
| A1 | **Legal / privacy approval** (processing basis + notice, retention incl. backups, hosting/vendor, impact assessment, HR access to personal fields) | Processing real employee data without a confirmed basis is a legal risk no engineering control removes |
| A2 | **Secure production platform** (hosting decided, private DB, TLS, secrets store, least-privilege DB roles, production config, web security baseline, log hygiene) | Today only local Docker with a public development password exists |
| A3 | **Production sign-in with Entra** (browser sign-in, real v2 tokens validated, test identity provably off) | The browser still uses the development test identity; real tokens were never tested |
| A4 | **Access administration + named owners** (create/disable users and assign the existing roles without SQL; leaver procedure; named admins; no-ad-hoc-SQL rule) | HR users can today only be created by a developer seed script or SQL |
| A5 | **Backup + a successful restore rehearsal** | No backup exists; a backup is not accepted until a restore has worked |
| A6 | **Deployment & migration rehearsal** (runbook, staging rehearsal, rollback/forward-fix policy) | Production migrations are manual by design and have never been rehearsed |
| A7 | **Onboarding approach validated on synthetic data** (decision, mapping, catalogs, rehearsal, reconciliation template) | Loading ~100 real records without a rehearsed, reconcilable method risks wrong history from day 1 |
| A8 | **Signed Real-Data Go/No-Go** (Management + HR system owner + technical owner) | Real data is a deliberate human decision, never implied |

**GATE B — Before go-live** (real data may be loaded and checked; HR must not rely on the system operationally yet):

| # | What is missing |
|---|---|
| B1 | Real-data load **reconciled and signed by HR** (counts, samples, integrity scan 0/0) |
| B2 | **Minimum operations visibility** (availability alert, actionable error logs, integrity scan on production) |
| B3 | **Support model in writing** (who to call, incident steps, data-correction and restore authority) |
| B4 | **HR smoke acceptance on production** with real sign-in, plus any legal obligation counsel ties to go-live (e.g. data-subject request procedure) |
| B5 | **Explicit human Production Ready decision** — never self-declared by engineering |

**GATE C — Post-go-live hardening** (important, not blocking first use at EmeSoft's scale): configurable Access Role editor / self-service access screen, dependency upgrades, periodic restore tests, audit retention answer, Entra "assignment required", idle timeout, rate limiting, idempotency purge, audit viewer, config inventory, migration-compatibility checklist, legal classification guidance (§3).

**Today: Gate A 0/8, Gate B 0/5** (decisions recorded for A1, A4, A5, A6, A7; A4 development evidence complete since C-94 — nothing passed). The longest lead times are A1 (counsel) and A2/A3 (IT platform + Entra). HR decisions in §10 unblock most of the rest.

---

## 1. Master view

Status values: **Not started** · **Partly in place** (some evidence exists) · **Proven** · **Passed** (gate evidence accepted by a human).

| Gate | Requirement Group | Risk Addressed | Current State | Owner | Evidence | Status |
|---|---|---|---|---|---|---|
| A | **A1 Legal / privacy approval for real data** — Q-L1 basis + notice, Q-L2 retention incl. leavers, Q-L4 backup retention, Q-L5 hosting/vendor/encryption, Q-L6 impact assessment, Q-L7 HR access to personal fields (Appendix A) | Unlawful processing of employee data; retention/deletion obligations; vendor exposure | Review started by decision (C-88); questions to be sent; no counsel answers; no data or retention assumed in code | Legal + HR (+ Management for hosting) | Written counsel answers; notice text/delivery if required; retention values recorded (Pending Legal Review → decided) | Not started |
| A | **A2 Secure production platform** — hosting decision; private PostgreSQL 18 with encrypted storage and TLS; separate owner / `hrms_app` / read-only roles with new secrets; grants re-verified; secrets store; staging/production isolation; production config (`APP_ENV`/`NODE_ENV=production`, `AUTH_MODE=entra`, real `COMPANY_EMAIL_DOMAINS`, strong HMAC key); **Production Web Security** (HSTS, frame protection, CSP compatible with sign-in, same-origin/no CORS, proxy logs without query strings); dependency advisories triaged | Data exposure through the network, leaked credentials, dev values in production, XSS/clickjacking with tokens in the browser, names leaking into access logs | Local Docker only; public dev password; no page security headers; app-side log hygiene and same-origin API proven | IT (platform) + Development (headers, config review) | Platform record; role/grant check (`db-schema-guarantees` checks re-run as the production app role); header check on the URL; proxy log sample; secrets inventory; advisory triage note | Partly in place (app side) |
| A | **A3 Production identity** — invariants in §7 (Entra sign-in in the browser, real v2 tokens validated for issuer/audience/scope/tenant, test identity impossible, secure redirect/origin, disable/revoke behaviour, tenant MFA applies) | Unauthorised access to HR data; test identity reachable in production | Verifier rules proven with local keys; test identity blocked by configuration logic; **no browser sign-in (MSAL)**; no registration values (PV-11) | IT (Entra) + Development (sign-in) | Real-token test record (accepted/rejected cases); `/api/v1/dev/*` → 404 on production; sign-in/sign-out demo | Partly in place |
| A | **A4 Access administration + named owners** — minimum RBAC (§6); named HR_ADMIN/HR_EDITOR holders, system owner, technical owner; joiner/mover/leaver procedure; production admin access list; rule: data is corrected only through audited app workflows, never ad-hoc SQL | Wrong people keep access after leaving; HR depends on SQL for staffing; untraceable data changes | Capability enforcement proven; **guarded access-administration command implemented (C-94, 2026-10-10)**: create/enable/disable, fixed-role assign/remove, mandatory reason, append-only security audit, race-safe capability-based last-admin guard, self-escalation guard, environment guard, operator identity from `session_user` → protected mapping, `hrms_app` read-only on accounts — 32 dedicated tests + full regression; local `hrms_dev` provisioned. **Still open:** IT provisioning in staging/production (roles, operator logins, environment, registration — runbook), named owners (PV-26) and operators (PV-28 F), leaver procedure sign-off, staging rehearsal incl. bootstrap of the first two administrators | Management + HR + Development + IT | Named list; leaver procedure (½ page); access-admin capability demonstrated on staging incl. audit record and "last admin" refusal | Partly in place — development evidence complete |
| A | **A5 Backup + restore rehearsal** — encrypted backups meeting **RPO ≤ 4 h** (every 4 h or point-in-time recovery) in a separate location, retention per Q-L4, access restricted, failure alert; **restore rehearsal passed** (Appendix C) | Permanent loss of HR history; unrecoverable mistakes | None; **target decided: RPO ≤ 4 h, RTO ≤ 1 business day (M-14, provisional; IT confirmation PV-27)** | IT (+ Management approves RPO/RTO) | Backup job + failure-alert test; signed restore-rehearsal record within RTO | Not started |
| A | **A6 Deployment & migration rehearsal** — staging (may be lightweight/temporary), one artifact per tag, attended migration runbook (backup first, forward-only), health + smoke, rollback/forward-fix policy, maintenance window | A failed or improvised migration against real data; no way back | Build and forward-only migrations proven locally; `db:migrate` refuses non-local targets by design; no runbook; maintenance approach decided (C-91: outside working hours with notice) | Development + IT | Runbook; staging rehearsal record (deploy, migrate, smoke, rollback of the app version) | Partly in place |
| A | **A7 Onboarding validated on synthetic data** — onboarding option and history depth decided (§8); mapping sheet (PV-05/06/08); production catalogs; synthetic rehearsal on staging with integrity 0/0; reconciliation template | Wrong or duplicate people, wrong periods/managers from day 1 | **Option decided: one-time validated import utility (M-12); depth decided: current operational truth + relationship-relevant prior periods (M-13)**; mapping Pending Validation (PV-05/06/08); utility not built | HR (+ Development if option B) | Approved mapping; rehearsal record; template | Not started |
| A | **A8 Real-Data Go/No-Go signed** (Appendix G) | Real data entering before A1–A7 are true | — | Management + HR + technical owner | Signed checklist recorded in the decision register | Not started |
| B | **B1 Real-data load reconciled** — counts per status/department/type, ≥ 10 % sampled by HR, persons without Work Email/manager listed, integrity scan 0/0 | Silent import/entry errors becoming operational truth | — | HR (+ technical owner) | Signed reconciliation | Not started |
| B | **B2 Minimum operations visibility** — `/health` availability alert to IT; application error logs (request id + error type) retained; backup alert (from A5); integrity scan runnable read-only on production; Entra sign-in logs known to IT | Outage or failure noticed only by HR; integrity drift unnoticed | `/health` and log hygiene proven; scanner refuses non-local hosts by design | IT + Development | Test alert received; log location; first production scan result | Partly in place |
| B | **B3 Support model** — system owner, technical owner, incident contact, access administrator, data-correction authority (HR_ADMIN via app only), backup/restore authority (Management approval for production restore); one-page incident procedure | Nobody owns an incident; risky ad-hoc fixes | Business-rule path (decision register + gate) proven in development | Management + HR + IT | Filled support table (Appendix H); procedure | Not started |
| B | **B4 HR production smoke + go-live legal obligations** — HR signs in for real, performs read and a harmless agreed write; data-subject request procedure and any notice timing as counsel requires | System unusable for HR on day 1; legal duties starting at go-live | — | HR + Legal | Smoke record; procedure | Not started |
| B | **B5 Production Ready decision** | Self-declared readiness | — | Management + HR system owner + technical owner | Signed decision in the decision register | Not started |
| C | Gate C hardening list (§3) | Long-term robustness | — | Shared | Tracked as normal backlog | — |

---

## 2. TRUE Gate A blockers (before real data)

A1 Legal / privacy approval · A2 Secure production platform · A3 Production identity · A4 Access administration + named owners · A5 Backup + restore rehearsal · A6 Deployment & migration rehearsal · A7 Onboarding validated on synthetic data · A8 Signed Real-Data Go/No-Go.

Why each is genuinely "before real data": A1 is a legal precondition; A2–A4 decide who and what can reach the data; A5–A6 decide whether a failure after loading real data is recoverable; A7 decides whether the data loaded is right; A8 makes the decision explicit.

## 3. TRUE Gate B blockers (before go-live) and Gate C hardening

**Gate B:** B1 reconciliation · B2 minimum visibility · B3 support model · B4 HR production smoke + go-live legal duties · B5 explicit Production Ready decision.

**Gate C (post-go-live hardening, tracked as backlog; none blocks first use):**

| Item | Why it can wait |
|---|---|
| Configurable Access Role editor, custom roles, permission-membership UI, in-app access screen (`access.manage`) | Fixed HR_ADMIN/HR_EDITOR fit a lean HR team; A4 already removes the need for code/SQL (C-85 migration path is non-breaking) |
| Scope engine, ABAC, Job Title → automatic role | No demonstrated need (C-85 §10) |
| Dependency **upgrades** (triage itself is in A2) | Current high advisories are in tooling dependencies (prisma CLI → `deepmerge-ts`; unused `mysql2`); upgrade on the normal cadence |
| Periodic restore test (every 6 months / after major upgrades) | First rehearsal is in A5 |
| Audit-log retention answer (Q-L3) | Keeping audit is the safe default meanwhile |
| Entra "assignment required" on the enterprise app | HRMS already returns 403 to any account without an enabled HRMS user |
| App idle timeout / shorter token lifetime | Entra session policy and MFA (A3) cover the main risk |
| Rate limiting, WAF | Entra-protected internal app with ~10 HR users |
| Idempotency record purge | Records contain only an HMAC; volume tiny |
| Audit viewer for HR | Technical owner can query on request |
| DB disk/instance alerts beyond the platform defaults | Low volume; availability alert (B2) catches outages |
| Config inventory, migration-compatibility checklist | Practice already followed; formalise later |
| Legal guidance on Intern/Contractor classification and End Reasons (Q-L12), labour book scope, probation | Not claimed by the product; needed before statutory reporting or new modules |

## 4. Items downgraded from P0 (revision 1) and why

| Revision-1 P0 | New place | Reason |
|---|---|---|
| OBS-01 uptime alert | Gate B (B2) | Needed when HR relies on the system, not to hold data safely |
| SUP-02 incident procedure | Gate B (B3) | Same |
| GL-02 production smoke | Gate B (B4) | Done after the environment exists, before reliance |
| MIG-06 reconciliation | Gate B (B1) | Happens after the real load; its *template* stays in A7 |
| MIG-04 dry-run import tool | Conditional (only if option B is chosen) | For ~100 people controlled manual entry may be safer (§8) |
| ID-01/ID-02 "two separate registrations" | Recommendation, not invariant (§7) | The invariants matter; IT may provide an equivalent secure topology |
| BR-06 periodic restore testing | Gate C | The *first* successful rehearsal stays in A5 |
| DR-01 "full staging environment" | Part of A6, may be lightweight/temporary | Needed for rehearsals, not as a permanent enterprise tier |
| SEC-11 dependency remediation | Triage in A2; upgrades Gate C | No known exploitable runtime path; triage note is the proportionate control |
| RBAC-04 access-admin ownership | Inside A4 (decision) | Only needed for the chosen access-admin option |

## 5. Grouped controls replacing duplicated P0s

| Group | Revision-1 items merged |
|---|---|
| **A1 Legal / privacy approval** | LP-01, LP-02, LP-04, LP-05, LP-06, LP-08 |
| **A2 Production Web Security** (inside A2) | SEC-05 log hygiene, SEC-07 headers/CSP, SEC-08 CORS/origin |
| **A2 Production DB Security** (inside A2) | SEC-03 grants re-verified, SEC-10 network isolation, ENV-02 DB instance, ENV-04 DB roles |
| **A2 Secrets & environment isolation** (inside A2) | SEC-06, SEC-09 TLS, ENV-01, ENV-03, ENV-05, ENV-06 |
| **A3 Production identity** | ID-01, ID-02, ID-03, ID-04, ID-10 (+ ID-07 MFA confirmation) |
| **A4 Access administration + named owners** | RBAC-02, RD-02, ID-06, SEC-12, SEC-13, SUP-01 |
| **A5 Backup + restore** | BR-01–BR-06 (first rehearsal), SEC-16, OBS-02 |
| **A6 Deployment & migration** | DR-01–DR-05, DR-07 |
| **A7 Onboarding** | MIG-01, MIG-02, MIG-03, MIG-05, MIG-07 (+ MIG-04 if option B) |
| **A8 Go/No-Go** | RD-01 |
| **B5 Production Ready** | GL-01, GL-03 |

Result: 55 flat P0s → **8 Gate A groups + 5 Gate B groups**; nothing previously P0 was dropped without a stated home (Appendix J).

## 6. Minimum RBAC before first go-live (C-85)

**Required (inside A4):**

1. Create an application user (display name, Entra tenant id + object id), enable, disable.
2. Assign / remove the **existing fixed roles** (HR_ADMIN, HR_EDITOR, API_DOCS_READER); `ROLE_PERMISSIONS` unchanged.
3. Every access change recorded in a **security audit trail** separate from employee history (actor, target user, action, before/after, time, request id).
4. Guardrail: refuse any change that leaves **zero active HR_ADMIN** accounts.
5. Normal HR staffing changes need **no code change and no deployment**.

**Smallest safe form — DECIDED (C-89, C-92): Option 1.** Option 2 stays a Gate C option.
- **Option 1 (chosen for first go-live):** guarded, audited administration command run by the technical owner on the HR system owner's request. No UI, **no new permission**.
- **Option 2:** minimal in-app access screen behind a new permission `access.manage` (self-service for HR). Adding a permission is a business decision (CLAUDE.md gate) and needs C-85 Q1 (who administers) and Q2 (anti-escalation) answered. Fits Gate C unless HR wants self-service from day 1.

**Not required before first go-live:** configurable Access Role editor, create/clone custom roles, permission-membership UI, scope engine, ABAC, Job Title → automatic role (Gate C, only on a demonstrated need).

## 7. Minimum identity requirements (topology-neutral)

**Invariants (must hold, whatever the Entra topology):**

1. Production users sign in with **Microsoft Entra ID** (Authorization Code + PKCE in the browser).
2. The API accepts only **v2 access tokens** from the EmeSoft tenant: issuer `https://login.microsoftonline.com/<tenant>/v2.0`, `aud` = the API's client ID, required delegated scope (`access_as_user` by default), `tid`/`oid` present, RS256 signed by the tenant keys. *(Current code expects exactly this; any topology satisfying it needs no code change.)*
3. **Production / test separation:** the development test identity is impossible in production (`/api/v1/dev/*` → 404, test tokens rejected) and staging uses its own registration values or redirect URIs.
4. **Disable / revoke:** disabling the Entra account stops new sign-ins; disabling the HRMS user (A4) takes effect on the next request; remaining token lifetime is understood and accepted.
5. **Secure redirect / origin:** redirect URIs limited to the production (and staging) HTTPS URLs; API same-origin; no wildcard.
6. Tenant **MFA / Conditional Access** applies to HRMS sign-in.

**Recommended topology (not an invariant):** two app registrations — API (exposes `access_as_user`, `api.requestedAccessTokenVersion = 2`) and SPA (public client, redirect URIs, consented to the API scope). IT may propose an equivalent secure architecture (e.g. a single registration acting as both) if it satisfies 1–6; Development confirms with a real-token test.

## 8. Recommended data-onboarding strategy

| Criterion | A. Controlled manual / current-state entry | B. Small one-time validated import utility | C. Reusable generic import framework |
|---|---|---|---|
| ~100 employees | Feasible: ≈ 10–15 HR hours + second-person check | Feasible | Over-built |
| History depth: current period only | **Best fit** | Fits | Over-built |
| History depth: prior periods / assignment history | Error-prone by hand | **Best fit** | Over-built |
| Source-data quality low (needs cleaning) | Cleaning happens while entering; slower | Cleaning in the mapping sheet; dry-run shows errors | Same as B, more cost |
| Reconciliation effort | Per-record check by a second person + counts | Dry-run report + counts + sample | Same as B |
| Import-error risk | Typing errors; every record passes the same app validations, reasons and audit | Systematic errors possible but visible in dry-run; uses the **application services**, no direct SQL | Same as B plus framework bugs |
| Development effort | None (existing screens) | Small, throw-away after use | Large, ongoing |

**Decision (M-12, M-13): option B — a small one-time validated import utility, run by the technical owner (source file → validation → dry run → error report → approved import → reconciliation), loading current operational truth plus prior periods only where needed for correct lifecycle interpretation; no generic framework, end-user import module or mapping engine.** Original revision-2 recommendation, kept for context: **A** if HR decides current-state onboarding (current period, current assignment, manager); **B** only if HR needs historical periods/assignments loaded. **C is not recommended** at EmeSoft's scale. Either way: synthetic rehearsal on staging (A7), anonymized rehearsal only if counsel allows, real load only after A8, reconciliation in B1. Design notes (matching, codes, managers in two passes, no import of erroneous/cancelled rows) are in Appendix F.

## 9. Critical execution path

```
Week 0 ─┬─ HR/Management decisions (§10) ──────────────┐
        ├─ Legal questions sent (A1) ──── counsel lead time ───────────────┐
        └─ IT platform + Entra (§11) ──┐                                   │
                                       ├─► Dev: Entra sign-in (A3)         │
                                       ├─► Dev: access admin minimum (A4)  │
                                       ├─► Dev: web security baseline (A2) │
                                       └─► Dev/IT: runbooks (A6)           │
Staging rehearsals: real tokens · migration · RESTORE (A5) · onboarding (A7)
                                       └──────────────► A8 Go/No-Go ◄──────┘
Real-data load ─► B1 reconcile ─► B2–B4 ─► B5 Production Ready decision (human)
```

The critical path is the **longest of**: counsel answers (A1) and IT platform + Entra → sign-in → rehearsals (A2/A3/A5/A6). Everything else fits inside those.

## 10. Decisions HR must make first

1. **Send the legal questions** (Appendix A) and name the counsel contact — longest lead time.
2. ~~Onboarding option and history depth~~ — **decided** (M-12, M-13); remaining: the actual mapping and which people need prior periods.
3. **Named people:** rule decided (C-90: System Owner, Technical Owner, primary + backup HR administrator, ≥ 2 operational admin accounts); **names still needed (PV-26)**.
4. ~~Access administration form~~ — **decided** (C-89: guarded command; C-92: no configurable roles for first go-live).
5. **Source mapping and real catalogs** (PV-05, PV-06, PV-08): departments, job titles EN/VI, levels, Employee Types, company email domain.
6. ~~RPO/RTO and maintenance~~ — **decided** (M-14: RPO ≤ 4 h, RTO ≤ 1 business day, provisional pending IT confirmation PV-27; C-91 maintenance outside working hours with notice).
7. Note: whether HR Editor keeps access to personal contact fields waits for counsel (Q-L7); no change before that.

## 11. Tasks IT can start immediately (in parallel)

- Hosting proposal with Management (on-premise vs cloud; PostgreSQL 18 with encrypted storage, PITR if available) — input to Q-L5.
- Non-production Entra registration(s) for staging (enables Development's sign-in work); confirm tenant MFA/Conditional Access.
- Secrets store; staging environment (can be small/temporary); DNS + TLS for staging and production URLs.
- Backup tooling and storage location; backup-failure alert channel.
- Uptime check tooling for `/health`; reverse-proxy log format without query strings; no CORS headers.
- DB role design (owner / `hrms_app` / read-only) for staging and production.

## 12. Tasks Development should NOT start until dependencies are resolved

| Task | Wait for |
|---|---|
| Browser Entra sign-in (MSAL) | Non-production Entra registration + agreed topology (§7) |
| Access-administration command (C-89) | **Done (C-94, 2026-10-10)** — remaining A4 work is IT provisioning, named owners and the staging rehearsal (runbook `access-administration-runbook.md`) |
| One-time import utility (M-12) | Approved source mapping (PV-05/06/08) and a sample synthetic or (if counsel allows) anonymized source structure |
| Migration/deployment runbook details | Hosting/platform decision (A2) |
| Production-safe integrity scan mode | DB read-only role design from IT |
| CSP final policy | Sign-in library choice (CSP must allow the Entra endpoints) — a baseline of HSTS/frame protection can be prepared earlier |
| Any retention, deletion or anonymization feature | Counsel answers (Q-L2, Q-L4) |
| Configurable Access Role editor / custom roles / scope | Not before go-live (Gate C); only on a demonstrated need |
| PV-24, S5, new Core HR features | Separate approval; outside this plan |

Development work that **can** start once approved (no external dependency): advisory triage note (A2), the security-header baseline (A2), the draft deployment/restore runbooks based on the generic procedure in Appendices C/D.

---

# Appendices (detail; unchanged in substance from revision 1 unless noted)

## Appendix A — Legal questions for counsel (A1, B4, C)

No legal conclusion is drawn here. Classification: **BR** = blocker before real data (Gate A1) · **GL** = required before go-live (Gate B4) · **AF** = may follow go-live (Gate C) · **NA** = not applicable now.

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

## Appendix B — IT / Entra checklist (A3)

Invariants are in §7; items E-1/E-2 describe the recommended topology and may be replaced by an equivalent secure architecture that satisfies the invariants.

| # | Item | Done |
|---|---|---|
| E-1 | *(Recommended topology, §7)* Create the **API** registration (production): expose scope `access_as_user`; App ID URI `api://<API client ID>`; manifest `api.requestedAccessTokenVersion = 2` | ☐ |
| E-2 | *(Recommended topology, §7)* Create the **SPA** registration (separate): platform *Single-page application*, redirect URI(s) = production URL (and staging URL on the staging registration), no implicit grant; API permission `access_as_user` with admin consent | ☐ |
| E-3 | Provide Tenant ID, API client ID, SPA client ID, scope through the configuration channel (never in Git) | ☐ |
| E-4 | Separate registrations (or at least separate redirect URIs and assignments) for staging and production | ☐ |
| E-5 | *(Gate C)* Enterprise application: *Assignment required = Yes*; assign HR users and technical admins only | ☐ |
| E-6 | Conditional Access / MFA applies to the HRMS SPA | ☐ |
| E-7 | Confirm token lifetime / sign-in frequency policy (tenant defaults acceptable unless HR requests shorter) | ☐ |
| E-8 | No app roles, group claims, client secrets or certificates are needed (public SPA client + delegated scope; roles live in HRMS) | ☐ |
| E-9 | Real-token test session with Development: valid token accepted; v1 token, wrong audience, missing scope, other tenant rejected | ☐ |
| E-10 | Leaver/mover procedure: disabling the Entra account blocks new tokens; HRMS access is also removed/disabled via the A4 access-administration capability; existing tokens expire within their lifetime | ☐ |
| E-11 | Production URL, DNS, TLS certificate | ☐ |
| E-12 | Reverse proxy access logs do **not** record query strings; no CORS headers added | ☐ |

---

## Appendix C — Backup / restore plan (A5)

#### C.1 Strategy (minimum safe)

| Question | Recommendation (for approval) | EmeSoft risk addressed |
|---|---|---|
| What | The production PostgreSQL database (full logical backup incl. `_prisma_migrations`); the deployed artifact version; non-secret configuration. Secrets backed up by the secret store itself | Loss of HR history; inability to rebuild the service |
| Frequency | **At least every 4 hours** (M-14), or continuous point-in-time recovery where the chosen PostgreSQL service offers it — IT to confirm (PV-27) | Data loss after a failure or a bad change |
| RPO | **≤ 4 hours** (M-14, provisional planning target; revision 1 proposed 24 h). Justification: low write volume (a few HR changes per day), each change traceable to HR source documents and re-enterable | Proportionate to the business impact |
| RTO | **≤ 1 business day** (M-14). No payroll or real-time dependency exists in Phase 1 | Proportionate; avoids HA infrastructure |
| Retention | Technical proposal: 14 daily + 6 monthly — **Pending Legal Review (Q-L4)**; final value set only after counsel answers | Deleted data lingering in backups; inability to recover older mistakes |
| Encryption | Encrypted at rest by the storage; dump additionally encrypted with a key held outside the backup location; TLS in transit | Backup theft exposes all employee data |
| Location | Separate from the database host (different storage account/server), same legal jurisdiction as approved in Q-L5 | Host loss destroys both data and backup |
| Access | Technical owner(s) only; restore to production requires management approval (restoring discards later changes) | Unauthorised data access via backups |
| Monitoring | Backup failure alert to IT (B2 / A5) | Silent backup failure |

**A backup strategy is not accepted until a restore rehearsal succeeds (A5).**

#### C.2 Restore procedure (outline)

1. Approval recorded (who, why, which backup).
2. Stop or put the application in maintenance (if restoring production).
3. Restore into a **new** database instance first; never overwrite the only copy.
4. Verify (C.3 checks 3–7); then switch the application's `DATABASE_URL` or promote the restored instance.
5. Smoke test, reopen, record the incident and the data window lost (HR re-enters from source documents).

#### C.3 Restore-test acceptance scenario (synthetic data only)

1. On **staging**, load the synthetic UAT dataset (demo seed + the workflow scenarios of the clean baseline, including cancelled and voided periods, reversed End events and corrections).
2. Record evidence: row counts per table, `max(revision)` per person sample, `_prisma_migrations` list, integrity scan result (0/0).
3. Take the backup with the production procedure; destroy/replace the staging database (or restore into a fresh instance).
4. Restore with the documented procedure; measure elapsed time.
5. Compare row counts and the `_prisma_migrations` list (identical); integrity scan 0/0; `prisma migrate status` up to date.
6. Application smoke: sign in, list employees, open a person with a voided period (Voided badge, history order), save a change with `expected_revision` (proves sequences/revisions), confirm the audit entry.
7. Pass criteria: all checks identical, elapsed time ≤ RTO, procedure followed without improvisation. Record date, operator, backup id, duration, result; signed by the technical owner.

---

## Appendix D — Deployment / rollback plan (A6)

#### D.1 Environments

| Environment | Purpose | Data |
|---|---|---|
| local | development | synthetic |
| test (`hrms_test`) | automated tests, guarded reset | synthetic |
| **staging** (new, lightweight — same platform as production, smaller) | Entra sign-in test, migration rehearsal, restore rehearsal, import rehearsal, HR smoke | synthetic (anonymized only if Q-L5/legal allow) |
| production | real use after Gate B | real (after the A8 Go/No-Go) |

#### D.2 Release procedure (each production change)

1. Change merged; full quality gate green; Git tag on the commit (tags never moved).
2. Build the artifact once from the tag (pinned lockfile, Node 24); the same artifact goes to staging then production.
3. Staging: deploy, run pending migrations with the runbook, smoke test.
4. Production approval recorded (who/when/what), maintenance window agreed if a migration is included.
5. **Backup immediately before** any production migration.
6. Run migrations as the owner role (`prisma migrate deploy`), **manual and attended**; migrations are forward-only and committed migrations are immutable (CLAUDE.md). `npm run db:migrate` keeps refusing non-local targets — production uses the dedicated runbook command with explicit owner credentials.
7. Deploy the application with production configuration (A2; Appendix I); start.
8. Health check: `GET /health` → `{"status":"ok"}`.
9. Smoke test (10 minutes): sign in with a real HR account; `/api/v1/dev/test-users` → 404; list employees; open a profile; one harmless edit on a designated test record if agreed (or read-only smoke on production); `prisma migrate status` up to date.
10. Record the release (version, migration names, operator, result).

#### D.3 Rollback and forward-fix

- **Application rollback**: redeploy the previous artifact. Safe only when the new migrations are backward-compatible with it — hence the rule that every migration is additive/compatible (expand → migrate → contract across releases).
- **Database**: no down migrations. A faulty migration is corrected by a **new forward migration** (forward-fix).
- **Restore from backup** only as last resort (data written after the backup is lost) and only with management approval.
- **Maintenance window**: short, outside HR working hours, announced to HR; acceptable for an internal system.

---

## Appendix E — Observability minimum (B2)

Minimum visibility for B2 (alerts only where action is needed; everything else stays in logs):

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
| Integrity scan | Technical owner | Weekly read-only run (production-safe mode, B2) | Report findings to HR system owner |
| Audit access | HR system owner on request | Read-only query by technical owner (no audit UI in Phase 1) | No |

What HR sees: clear error messages with a **Request ID** to quote; nothing else technical. What IT sees: uptime, backups, DB health, logs.

---

## Appendix F — Data onboarding design notes (A7, B1)

Design points for either option:

| Topic | Approach |
|---|---|
| Source format | Legacy Excel → a cleaned, HR-approved mapping sheet (PV-05 columns; PV-08 code format) |
| Person matching / duplicates | Employee Code is the key; dry-run flags same name + same DOB, same Work Email, codes differing only by case |
| Employee Code | Legacy codes preserved via `employees.set_code` (HR_ADMIN); never reused (registry) |
| Employment Period history | Per the history-depth decision (§8, A7); periods must not overlap (DB-enforced); Rehire vs Relationship Change chosen by HR per actual relationship (C-26, C-63) |
| Employee Type | From HR classification per actual relationship, not legacy labels (C-13, PL-07) |
| Work Email | Real company domain configured (`COMPANY_EMAIL_DOMAINS`); uniqueness per overlapping period is DB-enforced |
| Department / Job Title / Level | Production catalogs created first (A7) |
| Manager | Two-pass: create every person and period first, then assignments with managers (manager must be employed on the assignment date) |
| Start/End dates, End Reasons | Past dates entered as Initial Data Capture with a reason (C-25); End Reasons per HR (labels are not legal grounds) |
| Historical assignments | Only if history depth = full; otherwise the current assignment |
| Cancelled / voided records | **Not imported** — erroneous source rows are corrected in the mapping sheet instead |
| Validation failures | Row-level report; nothing written in dry-run; a failed final run stops and is fixed forward (no SQL patching) |
| Rehearsals | 1. synthetic source on staging · 2. anonymized source only if legally acceptable (Q-L1/Q-L5) · 3. final real import after the Go/No-Go checklist |
| Reconciliation | Counts per status, department, Employee Type; list of persons without Work Email/manager; HR samples ≥ 10 % of records; integrity scan 0/0; HR signs |

---

## Appendix G — REAL DATA GO / NO-GO CHECKLIST (A8)

Real employee data stays **prohibited** until every item is checked and signed by Management, the HR system owner and the technical owner (A8).

| # | Mandatory item | Group | ☐ |
|---|---|---|---|
| 1 | Counsel answers received and actioned for Q-L1 (basis + notice), Q-L2 (retention), Q-L4 (backups), Q-L5 (hosting/vendor), Q-L6 (impact assessment), Q-L7 (HR access); employee notice delivered if required | A1 | ☐ |
| 2 | Production platform as approved: private DB, TLS, secrets in the store, least-privilege roles re-verified, production config reviewed, web security baseline and proxy log hygiene checked, advisories triaged; no development value anywhere | A2 | ☐ |
| 3 | Real Entra sign-in working; real-token test passed; test identity verified impossible (404); MFA applies | A3 | ☐ |
| 4 | Access administration capability in place (audited, last-admin guardrail); named admins provisioned; leaver procedure agreed; no-ad-hoc-SQL rule agreed | A4 | ☐ |
| 5 | Backup running, encrypted, alerting; **restore rehearsal passed** | A5 | ☐ |
| 6 | Deployment/migration runbook and rollback/forward-fix policy approved; staging rehearsal done | A6 | ☐ |
| 7 | Onboarding option decided; mapping and catalogs approved; synthetic rehearsal passed (integrity 0/0); reconciliation template ready | A7 | ☐ |

**GO** only if 1–7 are all checked; otherwise **NO-GO** — real employee data remains prohibited.

## Appendix H — Support model (A4 names, B3)

| Role | Responsibility | Suggested holder (Management names people) |
|---|---|---|
| System owner | Owns HRMS use and business rules; approves releases with business impact; signs Go/No-Go | HR lead |
| Technical owner | Deployment, migrations, backups/restores, environment, incident handling | Development lead or IT |
| Business-rule issues | Raised to the system owner; decisions recorded in the decision register (Business Decision Gate) | HR lead + Development |
| Access issues | Entra sign-in (IT); HRMS roles via the A4 capability (technical owner on HR lead's request) | IT + technical owner |
| Incident contact | First contact for "system down / error with Request ID" | Technical owner (backup: IT) |
| Data-correction authority | HR_ADMIN holders, **only through the application's audited correction workflows**; no ad-hoc SQL | HR_ADMIN holders |
| Backup/restore authority | Technical owner executes; production restore needs Management + system owner approval | Technical owner + Management |

Business-hours support only; no on-call rotation (no demonstrated need). Business continuity: if HRMS is unavailable, HR keeps working from source documents and enters changes when the service returns (RTO 1 business day).

---

## Appendix I — Already-proven controls and local/dev assumptions

### I.1 Already-proven controls

| Control | Evidence |
|---|---|
| Capability-based server-side authorization on every operation; UI visibility is not a boundary | `src/lib/http/handler.ts`; `tests/integration/permission-matrix.test.ts` (every registry operation × anonymous/no-roles/disabled/docs/editor/admin) |
| No role-name checks; unknown/retired roles grant nothing; disabled account → 403; a valid token without an HRMS account → 403 | `src/modules/identity/authenticate.ts`, `permissions.ts`; access-control review |
| Token verification rules (RS256 JWKS, issuer, `aud` = API client ID, `ver` 2.0, `tid`, `oid`, `scp`), v1/ID/app-only tokens rejected — **with local keys only** | `token-verifiers.ts` + tests (real Entra still open — A3) |
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

### I.2 Local/development assumptions that must not reach production (A2)

| Local/dev assumption | Where | Production requirement |
|---|---|---|
| Public dev DB password `hrms_local_dev_only`; roles created by `docker/db-init` | `docker-compose.yml`, `docker/db-init`, `.env.example` | New owner/app/read-only roles with strong secrets in the store |
| Database on `127.0.0.1:55432` (Docker) | `.env`, compose | Managed or hardened PostgreSQL 18 on a private network, TLS |
| `AUTH_MODE=test`, test issuer secret, `/login` test identity | `.env.example`, `src/app/login` | `AUTH_MODE=entra`; no test variables; MSAL sign-in (A3) |
| `COMPANY_EMAIL_DOMAINS=example.test` | `.env.example` | Real EmeSoft domain(s) (PV-06, A7) |
| Catalogs and Employee Types from the dev seed | `scripts/seed-data.ts` (local-only) | Entered by HR_ADMIN via Catalog screens (A7) |
| User accounts/roles from the dev seed (test tenant) | `scripts/seed-data.ts` | A4 access administration |
| Migrations and integrity scan refuse non-local hosts | `scripts/migrate.ts`, `scripts/integrity-scan.ts` | Keep the guards; add an approved production runbook (A6) and read-only scan mode (B2) |
| `next dev` request logging shows query strings | dev server only | Production `next start` + proxy without query-string logging (A2) |
| No security headers for pages | no `next.config` | A2 Production Web Security |

Least privilege: the runtime uses only `hrms_app`; the owner role is used only by the attended migration step; a read-only role for the integrity scan; no shared credentials between staging and production.

---

## Appendix J — Revision-1 item traceability

Every revision-1 item and where it lives now (revision-1 priorities kept for traceability).

| ID | Requirement (revision 1) | Rev-1 priority | Revision 2 |
|---|---|---|---|
| LP-01 | Lawful processing basis per data group and employee notice (PL-05) | P0 | A1 |
| LP-02 | Retention schedule per data group incl. terminated employees (PL-01) | P0 | A1 |
| LP-03 | Audit-log retention (PL-01, ADR-0004) | P1 | C |
| LP-04 | Production backup retention and deletion obligations reaching backups (PL-01) | P0 | A1 |
| LP-05 | Hosting / vendor / cloud processing, processor contract, encryption at rest and in transit (PL-02) | P0 | A1 |
| LP-06 | Personal-data impact assessment applicability and owner (PL-04) | P0 | A1 |
| LP-07 | Data-subject request process (access, correction, deletion) (PL-05) | P1 | B4 |
| LP-08 | Access to HR records: who may see personal fields (HR_EDITOR currently sees personal contact data) | P0 | A1 |
| LP-09 | Data export | — | N/A |
| LP-10 | Sensitive groups / identity documents (PL-03) | — | N/A (proven: rejected) |
| LP-11 | Intern / Service Contractor classification and End Reason legal meaning (PL-07, PL-09) for real records | P1 | C |
| LP-12 | HRMS as statutory labour management book (PL-06); Cancel Planned contractual meaning (PL-10); probation (PL-08) | P2 | C |
| ID-01 | Production Entra **API** app registration (tenant, client ID, `access_as_user` scope, `api.requestedAccessTokenVersion = 2`) (PV-11) | P0 | A3 (topology = recommendation) |
| ID-02 | Production Entra **SPA** registration (separate), redirect URIs = production URL(s), PKCE, API permission granted with admin consent | P0 | A3 (topology = recommendation) |
| ID-03 | **Browser sign-in with MSAL** (Authorization Code + PKCE), replacing the development login page in production | P0 | A3 |
| ID-04 | Verifier proven against **real** Entra tokens (iss, aud = API client ID, `ver = 2.0`, `scp`, `tid`, RS256 JWKS) | P0 | A3 |
| ID-05 | Who may sign in: Entra "assignment required" on the enterprise app, limited to HR users + technical admins | P1 | C |
| ID-06 | Account lifecycle: leaver/mover handling for HR staff (disable in Entra **and** disable/remove HRMS roles) | P0 | A4 |
| ID-07 | Token lifetime / session behaviour | P1 | A3 (MFA) / C (lifetime, idle timeout) |
| ID-08 | Group / role claims | — | N/A |
| ID-09 | Service accounts / app-only tokens | — | N/A |
| ID-10 | Test vs production separation: test identity impossible in production | P0 (verify in prod) | A3 |
| SEC-01 | Server-side authorization on every operation | — | Proven |
| SEC-02 | No role-name checks in business logic; unknown roles grant nothing; disabled users 403 | — | Proven |
| SEC-03 | DB application role least privilege: no DDL, no DELETE on HR tables, audit append-only, events column-level update | P0 (re-verify) | A2 (DB security) |
| SEC-04 | No hard delete of HR history; audit cannot be rewritten | — | Proven |
| SEC-05 | Logs and errors carry no personal data, tokens or payloads | P0 | A2 (web security) |
| SEC-06 | Secrets management (DB passwords, `IDEMPOTENCY_HMAC_KEY`, any MSAL config) | P0 | A2 (secrets) |
| SEC-07 | Security headers for pages: HSTS, `frame-ancestors`/X-Frame-Options, Referrer-Policy, CSP (tokens live in browser session storage, so XSS impact is high) | P0 | A2 (web security) |
| SEC-08 | CORS / origin | P0 (verify proxy) | A2 (web security) |
| SEC-09 | TLS everywhere (browser → app, app → DB) | P0 | A2 (secrets/TLS) |
| SEC-10 | Database not reachable from the internet; app role and owner role separated | P0 | A2 (DB security) |
| SEC-11 | Dependency vulnerabilities | P1 | A2 (triage) / C (upgrades) |
| SEC-12 | Production admin access (DB owner credentials, server access) limited to named technical owner(s); break-glass only | P0 | A4 |
| SEC-13 | Data correction only through the application (no ad-hoc production SQL) | P0 | A4 |
| SEC-14 | Rate limiting | P2 | C |
| SEC-15 | Idempotency records cleanup (24 h product TTL, ADR-0004) | P2 | C |
| SEC-16 | Backups protected (encryption, access) | P0 | A5 (duplicate merged) |
| BR-01 | Define what is backed up: the PostgreSQL production database (all schemas incl. `_prisma_migrations`), plus the deployed artifact version and non-secret configuration; secrets backed up separately in the secret store | P0 | A5 |
| BR-02 | Frequency and RPO | P0 | A5 |
| BR-03 | Retention | P0 | A5 |
| BR-04 | Encryption + storage location separate from the database host | P0 | A5 |
| BR-05 | Access to backups limited to technical owner(s); restore requires management approval | P0 | A5 |
| BR-06 | **Restore rehearsal passes** (synthetic data) and is repeated periodically | P0 (first), P1 (periodic) | A5 (first) / C (periodic) |
| DR-01 | Environments: local, test (automated), **staging** (prod-like, synthetic only), production | P0 | A6 (lightweight staging) |
| DR-02 | Reproducible build artifact (pinned lockfile, Node 24, `next build`) identified by Git commit | P0 | A6 |
| DR-03 | Production migration runbook (manual, approved, `prisma migrate deploy` as owner, backup first, forward-only) | P0 | A6 |
| DR-04 | Deployment order, health check and smoke test | P0 | A6 |
| DR-05 | Rollback / forward-fix policy (no down migrations; restore only as last resort) | P0 | A6 |
| DR-06 | Migration compatibility rule: each migration compatible with the previous app version (expand → migrate → contract) | P1 | C |
| DR-07 | Maintenance window and user notice | P1 | A6 |
| OBS-01 | Uptime check on `/health` with alert to IT | P0 | B2 (downgraded) |
| OBS-02 | Backup job failure alert | P0 | A5 |
| OBS-03 | Application error logs (stdout JSON with request id) retained for troubleshooting; HR quotes the request id shown in error messages | P1 | B2 |
| OBS-04 | Production-safe read-only integrity scan (weekly, results to technical owner) | P1 | B2 |
| OBS-05 | Failed sign-ins | P1 | B2 |
| OBS-06 | DB availability / disk space alert | P1 | C |
| OBS-07 | Audit viewing for HR | P2 | C |
| RD-01 | Real-data Go/No-Go checklist (§10) passed and signed | P0 | A8 |
| RD-02 | Designated production administrators (HRMS HR_ADMIN holders, technical owner) | P0 | A4 |
| RD-03 | Synthetic-only rule enforced until lifted (C-03) | — | Proven |
| MIG-01 | Onboarding approach: import tool vs controlled manual entry (≈100 people) | P0 | A7 |
| MIG-02 | Source mapping: legacy Excel columns, code format, catalogs (PV-05, PV-06, PV-08) | P0 | A7 |
| MIG-03 | History depth to load (current period only vs full history) | P0 | A7 |
| MIG-04 | Validation rules + dry-run report (duplicates, missing required fields, invalid dates, unknown catalog values, manager not employed on date) | P0 | A7 only if option B (downgraded) |
| MIG-05 | Synthetic rehearsal on staging, then (if legally acceptable) anonymized rehearsal | P0 | A7 |
| MIG-06 | Reconciliation and HR sign-off of the final import | P0 | B1 (downgraded) |
| MIG-07 | Production reference data (departments, job titles EN/VI, levels, employee types, email domains) | P1 | A7 |
| RBAC-01 | Capability-based enforcement | — | Proven |
| RBAC-02 | **Access provisioning without SQL/code**: create/enable/disable HRMS user accounts (Entra tenant/object id) and assign/unassign existing roles, with a security audit trail and an "at least one active admin" guardrail | P0 | A4 |
| RBAC-03 | Configurable role **definitions** (Access Roles as stored bundles) | P1/P2 | C |
| RBAC-04 | Who administers access (C-85 Q1) and anti-escalation rule (Q2) | P1 → P0 if RBAC-02 includes an in-app screen | A4 (decision) |
| ENV-01 | Hosting decision (on-premise vs cloud; provider; region) | P0 | A2 |
| ENV-02 | Production PostgreSQL (supported version 18.x, encrypted storage, automated backups/PITR if available) | P0 | A2 (DB security) |
| ENV-03 | Production URL + TLS certificate | P0 | A2 |
| ENV-04 | Database users: owner (migrations only), `hrms_app` (runtime), optional read-only (integrity scan); new strong passwords — never the public dev password | P0 | A2 (DB security) |
| ENV-05 | Production configuration values: `APP_ENV=production`, `NODE_ENV=production`, `AUTH_MODE=entra`, no `AUTH_TEST_ISSUER_*`, real `COMPANY_EMAIL_DOMAINS` (currently `example.test`), Entra values, strong `IDEMPOTENCY_HMAC_KEY` | P0 | A2 |
| ENV-06 | Environment isolation: separate DBs, secrets and Entra registrations for staging and production; dev/test secrets never reused | P0 | A2 |
| ENV-07 | Config management: values documented (non-secret) and versioned; secrets only in the store | P1 | C |
| ENV-08 | Storage | — | N/A |
| SUP-01 | Named roles: system owner (HR), technical owner, access administrator, incident contact, data-correction authority, backup/restore authority | P0 | A4 (names) + B3 |
| SUP-02 | Incident procedure (one page): how HR reports, request id, contact, communication | P0 | B3 (downgraded) |
| SUP-03 | Business-rule issue path: decision register + Business Decision Gate | P1 | B3 |
| GL-01 | Go-Live Gate review (§13) with every domain READY or READY WITH ACTION (no P0 open) | P0 | B5 |
| GL-02 | Production smoke acceptance with HR on real sign-in (before real data load) | P0 | B4 (downgraded) |
| GL-03 | Explicit **human** Production Ready approval (Management + HR system owner + technical owner) | P0 | B5 |

## Appendix K — Gate states and the Production Ready rule

States per group: **Not started** · **Partly in place** · **Passed** (evidence accepted by the owner). Gate state: Gate A **BLOCKED** while any A-group is not Passed; Gate B **BLOCKED** while any B-group is not Passed; Gate C never blocks.

**Production Ready** may be recorded only by an explicit, signed human decision of Management, the HR system owner and the technical owner (B5), recorded in the decision register. Engineering (including Claude) never self-declares it. Until then the status stays **`Core HR Phase 1 — UAT Passed With Pre-Production Actions`**.
