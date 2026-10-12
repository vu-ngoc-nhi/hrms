# Mini HRS — Coordinated Staging Rehearsal Checklist (TEMPLATE)

- Gates A2, A3, A4, A5, A6. **A7 is not closed by this rehearsal unless step 12 is run with the approved import utility** (see §1a). **Template — closes nothing until executed, passed and signed.** One coordinated session, synthetic data only. Do not schedule it before §0 is complete.
- Procedures: `deployment-migration-runbook.md`, `access-administration-runbook.md`, `restore-rehearsal-record.md`. Status map: `gate-a-readiness-status.md`.

## 0. Prerequisites (all required before scheduling)

| # | Prerequisite | Owner | Ready |
|---|---|---|---|
| P-1 | Staging platform, dedicated DB, private network, DNS/TLS, secret store, proxy configured (IT-01…IT-07) | IT | ☐ |
| P-2 | Migration authority and function-owner prerequisites (IT-09) | IT | ☐ |
| P-3 | Non-prod Entra registration E1–E6 + 2–3 synthetic test accounts (E9) | IT | ☐ |
| P-4 | **Browser Entra sign-in (MSAL) built and tested locally against the non-prod registration**; final CSP prepared | Local engineering (after P-3) | ☐ |
| P-5 | Named Technical Owner and operators; operator logins, Entra object IDs, approved machine (PV-26, PV-28 F) | Management / IT | ☐ |
| P-6 | Backup tooling, separate storage, failure alert (IT B1–B7) | IT | ☐ |
| P-7 | **Read-only DB login (IT-14) and a production-safe integrity-scan mode** — today `npm run integrity:scan` refuses any non-local database by design | IT (login) → local engineering (scan mode) | ☐ |
| P-8 | **A way to put the synthetic dataset on staging.** The seed and demo scripts refuse anything but local `hrms_dev` by design. Default: the rehearsal HR admin enters a short scripted synthetic set through the app (incl. End, Reverse End, Cancel Planned, Void, a correction). Acceptable for smoke, integrity and backup/restore rehearsal — **does not close A7** (§1a) | Technical Owner (script) | ☐ |
| P-9 | Release tag and artifact built once (runbook §3) | Technical Owner | ☐ |

## 1. Rehearsal steps

| # | Step | Expected | Evidence to record | Gate | Pass |
|---|---|---|---|---|---|
| 1 | **Production-like start**: deploy the artifact with staging config (`APP_ENV=production`, `NODE_ENV=production`) | Starts; a deliberately wrong value (e.g. remove `ENTRA_TENANT_ID`) makes it refuse to start; restored config starts | Config inventory (names only); refusal log line; start log | A2, A6 | ☐ |
| 2 | **Migration** from an empty database (runbook §5), function-owner path | All migrations applied; `migrate status` up to date; grant state matches handoff §4 | Release record; grant query output | A2, A6 | ☐ |
| 3 | **Entra sign-in / sign-out** with a non-prod test account | Signs in with MFA; signs out | Screenshot / log with timestamps | A3 | ☐ |
| 4 | **Rejection and security cases** | v1 token, wrong audience, missing scope, other tenant → 401; account without HRMS user → 403; `/api/v1/dev/test-users` → 404; headers present; proxy log has no query strings and no CORS headers; DB not reachable from outside | Request/response log; proxy log sample; network test | A2, A3 | ☐ |
| 5 | **Access administration** | Environment record; operator registered; bootstrap two HR admins; assign/remove role; disable → 403 on next request; enable; last-admin removal refused (exit 2); operator self-grant refused (exit 2); audit rows show operator, reason, before/after | Command outputs (`--json`); audit query | A4 | ☐ |
| 6 | **Application health** | `/health` ok; 503 when DB stopped, ok again after | Responses | A6 | ☐ |
| 7 | **Synthetic data + integrity scan** (P-8, P-7) — manual entry through the app | Dataset entered; scan 0 errors | Scan output | A6 (not A7) | ☐ |
| 8 | **Backup** | Backup taken; failure alert test received | `restore-rehearsal-record.md` §2–3 | A5 | ☐ |
| 9 | **Restore** into a new instance | Within RTO | Record §4 | A5 | ☐ |
| 10 | **Post-restore verification** | Counts, migrations, integrity 0, access audit, app smoke identical | Record §5 | A5 | ☐ |
| 11 | **Rollback drill** | Previous artifact redeployed and starts against the migrated schema; then current artifact again | Release record | A6 | ☐ |
| 12 | *(Only when the approved import utility exists)* **Synthetic onboarding rehearsal** per §1a | All six stages pass | Validation report, preview, import log, reconciliation sheet, scan output, HR sign-off | A7 | ☐ |

## 1a. Manual synthetic entry vs Gate A7

Manual entry of synthetic data through the app is acceptable for general staging smoke, integrity and backup/restore rehearsal. **It does not close Gate A7.** A7 closes only when the approved one-time import utility (M-12) is rehearsed with a synthetic source file through **validation → preview → import → reconciliation → integrity scan → HR sign-off**, with each stage's evidence recorded. Step 12 may run in this session or in a later one.

## 2. Sign-off

| Field | Value |
|---|---|
| Date / duration | |
| Participants (Technical Owner, IT, HR admin for step 5/7) | |
| Failed steps and re-runs | |
| Gates whose rehearsal evidence is now complete | A2 ☐ A3 ☐ A4 ☐ A5 ☐ A6 ☐ A7 ☐ (step 12 only) |
| Signed — Technical Owner | |
| Signed — IT | |

A failed step is re-run after the fix; the whole session is not repeated unless the platform changed.
