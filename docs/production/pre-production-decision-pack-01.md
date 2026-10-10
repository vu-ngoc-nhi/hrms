# Mini HRS — Pre-Production Decision Pack 01

- Date: 2026-10-10. Type: **decision recording only** — nothing is implemented by this pack.
- Inputs: C-84 (EmeSoft design philosophy), C-85 (access control direction), `pre-production-readiness-plan.md` revision 2.
- Register entries: C-88 to C-92, M-12 to M-14, PV-26, PV-27 (`docs/decision-register.md`, revision 34).
- **Decisions are not evidence of implementation.** No Gate A or Gate B group is marked passed by this pack.
- Baseline unchanged: `Core HR Phase 1 — UAT Passed With Pre-Production Actions`. Not production ready. **Real employee data remains prohibited.**

## Decisions

| # | Decision | Register | Status | Gate effect |
|---|---|---|---|---|
| D1 | **Legal / privacy review starts immediately.** Q-L1 to Q-L8 (readiness plan Appendix A) are sent for external/internal legal review. Until the mandatory Gate A legal questions are resolved, **real employee data remains prohibited**. No legal conclusion is inferred by engineering. | C-88 | Confirmed Decision (process) — answers **Pending Legal Review** | A1 started; not passed |
| D2 | **Initial onboarding = Option B: a small one-time validated import utility**, run by the technical owner for controlled pre-production onboarding. Flow: source file → validation → dry run → validation/error report → approved import → reconciliation. **Not** a generic reusable import framework, an end-user import module or a configurable mapping engine. | M-12 | MVP Decision (direction) | A7 option decided; utility not built |
| D3 | **Initial migration depth = current operational truth**: Person, Employee Code, latest relevant valid Employment Period, Employee Type, current Work Email, current Assignment (Department, Job Title, Level where applicable, Manager), relevant Start/End dates. For employees with materially relevant Rehire / relationship history, the previous Employment Period(s) needed for correct lifecycle interpretation are included. Historical Assignment changes from prior years are **not** assumed to be imported. Detailed mapping stays **Pending Validation** until HR reviews the actual source data (PV-05, PV-06, PV-08). | M-13 | MVP Decision (scope); mapping Pending Validation | A7 depth decided; mapping open |
| D4 | **Access administration for first go-live = a guarded access-administration command** (not an in-app configurable-role editor). Before go-live it must support: create/enable application user, disable application user, assign existing role, remove existing role, audit every access change, preserve at least one active administrator. Normal staffing changes require **no product-code change**. Configurable Access Role definitions are not implemented now. | C-89 | Confirmed Decision | A4 form decided; command not built |
| D5 | **Named ownership required**: HR / System Owner, Technical Owner, primary HR administrator, backup HR administrator. Business and technical ownership do **not** automatically grant HR data privileges (C-85). At least two operational accounts able to perform the necessary HR administration, so production does not depend on one person. Names to be supplied by HR/Management. | C-90 (rule), PV-26 (names) | Confirmed Decision; names Pending Validation | A4 names open |
| D6 | **Provisional RPO ≤ 4 hours, RTO ≤ 1 business day** (planning target), subject to IT confirmation once hosting/database is selected. No enterprise HA purely to improve these numbers. A backup solution is not accepted until an actual restore rehearsal succeeds. | M-14 (target), PV-27 (IT confirmation) | MVP Decision; confirmation Pending IT Configuration | A5 target set; nothing built |
| D7 | **Maintenance**: production migrations that may affect availability normally run outside normal working hours with prior notice. No recurring maintenance process; the deployment runbook defines the procedure. | C-91 | Confirmed Decision | A6 input |
| D8 | **Full configurable Access Roles are not required for first go-live.** First-go-live requirement = user/account lifecycle + assignment/removal of existing role bundles + security audit (D4). Role editor / custom role configuration remains **P1** under C-85; not implemented now. | C-92 | Confirmed Decision | A4 scope fixed; Gate C item |

### Notes on interpretation (no new rule)

- **D4 and the gates.** D4 says "before go-live". The readiness plan keeps access administration in **Gate A (A4)** because granting the first real HR users access to real data would otherwise require SQL, which the no-ad-hoc-SQL rule excludes. This is stricter than D4, not contradictory; if HR prefers to treat it as Gate B only, that is a separate decision.
- **D6 vs the revision-1 proposal.** The plan proposed RPO 24 h with daily backups; D6 sets ≤ 4 h. A daily backup alone no longer meets the target: the backup design needs backups at least every 4 hours or continuous point-in-time recovery where the chosen database service offers it (IT to confirm, PV-27).
- **D2/D3 and the plan's §8.** Revision 2 recommended manual entry if only current state were needed and a utility if history were needed. HR chose the utility with current-truth depth plus relationship-relevant prior periods; the utility remains small and one-time.
- **D5 and the access command.** The technical owner may run the access command without holding any HR role; running it does not grant HR data access.

## Next workstreams and dependencies

| Track | Work | Can start | Depends on |
|---|---|---|---|
| HR / Legal | Send Q-L1 to Q-L8 to counsel; name the counsel contact | Now | — |
| HR | Prepare the source-data mapping from the actual source (PV-05, PV-08) and the real catalogs (PV-06) | Now | Access to the source file (real data is not loaded into any system) |
| HR | Confirm the actual data depth per D3 (which people need previous periods) | Now | Mapping review |
| HR / Management | Nominate System Owner, Technical Owner, primary and backup HR administrators (PV-26) | Now | — |
| IT | Hosting proposal (input to Q-L5) and database service capabilities for RPO ≤ 4 h (PITR/backup frequency) — confirm D6 (PV-27) | Now | — |
| IT | Non-production Entra configuration (topology per plan §7 invariants); tenant MFA confirmation | Now | — |
| IT | Secrets store, TLS, DNS for staging/production | Now | Hosting direction for production |
| IT | Database role model (owner / `hrms_app` / read-only) | Now | — |
| IT | Backup tooling, separate storage, failure alert | Now | Hosting direction |
| Development | **Guarded access-administration command (D4)** — design and implementation through the normal gate | **After this decision pack is approved** | Design detail (security audit storage, command guard) proposed for approval first |
| Development | MSAL / real Entra sign-in | Blocked | Non-production Entra registration |
| Development | One-time import utility (D2) | Blocked | Approved source mapping + a sample synthetic or (if counsel allows) anonymized source structure |
| Development | Deployment / migration runbook | Blocked | Hosting direction |
| Development | Production-safe integrity scan mode | Blocked | Read-only DB role design |
| Development | Final CSP | Blocked | Sign-in library integrated |
| Development | Configurable Access Role editor, PV-24, S5, new Core HR features | Not in scope | Separate approval |

## Gate A status after this pack

| Group | Status | What changed |
|---|---|---|
| A1 Legal / privacy | Not started → **Started (questions to be sent)** — not passed | D1 |
| A2 Secure platform | Partly in place (app side) | — |
| A3 Production identity | Partly in place | — |
| A4 Access administration + owners | Partly in place; **form and scope decided** (D4, D5, D8); command not built; names open | D4, D5, D8 |
| A5 Backup + restore | Not started; **target decided** (D6, provisional) | D6 |
| A6 Deployment & migration | Partly in place; **maintenance approach decided** (D7) | D7 |
| A7 Onboarding | Not started; **option and depth decided** (D2, D3); mapping open | D2, D3 |
| A8 Go/No-Go | Not started | — |

**Gate A: 0 / 8 passed. Gate B: 0 / 5 passed.** Real employee data remains prohibited.
