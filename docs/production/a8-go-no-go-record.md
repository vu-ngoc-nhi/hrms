# Mini HRS — Real-Data Go / No-Go Record (A8) — TEMPLATE

- **Template — unsigned. Real employee data remains PROHIBITED.**
- Real employee data may enter any Mini HRS environment only when this record is completed with the outcome **REAL DATA ALLOWED** and signed by all three signatories, and the decision is recorded in `docs/decision-register.md`.
- Each item references evidence that **proves** the outcome; an intention, a plan or a configured-but-untested setting does not count.

## 1. Conditions

| # | Gate | Condition | Evidence (document / record, date) | Met |
|---|---|---|---|---|
| 1 | A1 | Written counsel answers for Q-L1, Q-L2, Q-L4, Q-L5, Q-L6, Q-L7 recorded; employee notice delivered if counsel requires it; Q-L12 scoping decided and, if blocking, answered | | Yes / No |
| 2 | A2 | Production platform matches the staging-verified configuration: private DB, TLS, secrets in the store, least-privilege grants re-verified, startup check passes with real config, headers + final CSP verified, proxy log hygiene, advisories re-checked | | Yes / No |
| 3 | A3 | Production Entra registration configured; staging real-token rehearsal passed (accept + reject cases); test identity impossible (404); MFA applies | | Yes / No |
| 4 | A4 | Owners named; operators provisioned; staging access rehearsal passed; leaver procedure and no-ad-hoc-SQL rule agreed | | Yes / No |
| 5 | A5 | Production backups running, encrypted, alerting; **restore rehearsal PASS within RTO** | | Yes / No |
| 6 | A6 | Deployment/migration runbook approved; staging deploy/migrate/rollback rehearsal passed | | Yes / No |
| 7 | A7 | Mapping and catalogs approved; synthetic import rehearsal passed (integrity 0 errors); reconciliation template signed by HR | | Yes / No |

## 2. Outcome (exactly one)

☐ **REAL DATA ALLOWED** — all seven conditions are "Yes".

☐ **REAL DATA PROHIBITED** — failing conditions: ______________________

No conditional, partial or "mostly ready" outcome exists. A PROHIBITED outcome is re-decided with a new record when the failing items close.

## 3. Signatures (all three required)

| Role | Name | Signature | Date |
|---|---|---|---|
| Management | | | |
| HR System Owner | | | |
| Technical Owner | | | |

## 4. After ALLOWED

- Record the decision in the register (A8 → COMPLETE) with this record's reference.
- Real data is then loaded only by the approved procedure (import utility, M-12) and reconciled (Gate B1). Go-live still requires Gate B (B1–B5); this record is **not** a Production Ready decision.
