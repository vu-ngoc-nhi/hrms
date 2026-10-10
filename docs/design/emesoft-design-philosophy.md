# Mini HRS — EmeSoft Design Philosophy

- Status: **Confirmed Decision C-84** (architecture / product governance principle, 2026-10-10). Permanent guidance for every design and implementation step. Summary in `CLAUDE.md` § *Product design philosophy*.
- It does not change any existing confirmed decision. If an existing rule materially conflicts with it, the conflict is reported and decided — never silently changed.

## 1. Operating context

Mini HRS is built for **EmeSoft**, a technical company of roughly **70–100 employees**. HR operations are run by a **small HR team**, not by many specialised HR functions. The company is comfortable with structured systems, automation and clear data models, but the product must not copy the process complexity of a large-enterprise HRIS.

The target is **enterprise-quality data integrity with lightweight operational workflows** — not "enterprise process complexity for a 100-person company".

The product balances: strong data integrity · strong auditability · simple operations · fast HR execution · understandable recovery from mistakes · minimum unnecessary bureaucracy.

## 2. Core philosophy

> **Strict on history and integrity, flexible on operations.**
> Shorthand: **Lightweight HR operations, strong Core HR integrity.**

| Strict about | Flexible about |
|---|---|
| Historical truth | Normal HR operational paths |
| Authorization | Correcting genuine input mistakes |
| Auditability | Recovering from user errors |
| Effective-date chronology | Reasonable business exceptions |
| Overlap and uniqueness constraints | Avoiding unnecessary multi-step procedures |
| Destructive operations | Avoiding unnecessary approval layers |
| Silent data rewriting | Reducing repetitive HR work |
| Cross-record dependencies | |
| Actions that can corrupt downstream HR data | |

A technically correct system that regularly traps HR in unrecoverable states is not a successful design.

## 3. Three levels of control

| Level | Use when | Mechanism | Examples in Mini HRS |
|---|---|---|---|
| **1 — Hard constraint** | Violating the rule creates objectively invalid or unsafe data | DB constraints/triggers + API checks; **fail closed** | No overlapping valid Employment Periods (exclusion constraint); assignment timeline without overlaps; unique operational Work Email; impossible chronology (end before start); authorization (permission matrix); invalid cross-period state; no hard delete of history (no DELETE grants) |
| **2 — Controlled correction** | Data may legitimately need correction or recovery | HR_ADMIN, explicit action, mandatory reason where appropriate, audit, optimistic concurrency, idempotency, no hard delete — **no approval process** | Historical Correction; Reverse End Employment; Cancel Planned Period; Void Employment Period (PV-25) and similar future recovery workflows |
| **3 — Soft guidance** | Mainly usability or recommended practice | Clear wording, confirmation, warning, preview, recommended next action — **no blocker** unless an integrity or business risk is demonstrated | Rehire vs Relationship Change guidance for a gap; *Plan Rehire* text; Reverse End warning before a Rehire; pre-start / same-day notices; operational completeness shown as incomplete instead of blocking |

## 4. Minimum safe workflow

For new features prefer **the smallest workflow that preserves data integrity, auditability and safe recovery.**

Do not add approval layers, statuses, intermediate states, extra actors, exception workflows or mandatory hand-offs unless they solve a **demonstrated** business, legal, security or data-integrity risk. A workflow should not require three actions when one explicit audited action can safely represent the business intent.

## 5. Recovery is a first-class requirement

For every important write workflow ask: **"What happens when HR makes a genuine mistake?"**

- A business action should be reversible where reasonably safe; a correction should be explicit.
- Recovering from common HR mistakes must not require deleting history.
- Avoid designs whose only recovery is direct database intervention, fake business events, arbitrary date manipulation, deleting records, or adding misleading history just to undo an input mistake.
- If safe automatic reversal is not possible, provide a clear controlled correction/recovery path, or document the limitation explicitly (as done for PV-24 / PV-25).

## 6. History vs operations

> **Historical record ≠ operational effect.**

A record may remain visible for audit/history while being excluded from current operational logic: cancelled planned periods, voided periods, reversed lifecycle events, corrected historical values. Never delete historical evidence because it should no longer affect operations — prefer **disposition, reversal or correction** semantics. In Mini HRS this is implemented by the shared operational query module (one place decides what is operational) and by keeping events and audit append-only.

## 7. Internal vs external dependencies

| | Internal dependency | External dependency |
|---|---|---|
| Definition | Data wholly contained in the record / aggregate being corrected | Another aggregate, person or module depends on the record |
| Examples | Assignments, Work Email, lifecycle events and corrections inside the same Employment Period | Another employee references this person as manager; a later valid Employment Period; a cross-period Relationship Change; Payroll results; Leave balances; Contracts; external-system synchronisation |
| Rule | Should **not** create blockers when the whole aggregate is explicitly corrected or voided | Requires stronger analysis; may block or require explicit correction first |

Never silently repair unrelated records.

## 8. Design for EmeSoft scale

Assume ~100 employees, not 10,000:

- prefer simple role models and lightweight workflows; HR_ADMIN can reasonably handle exceptional corrections;
- no workflow engines, premature configuration frameworks or unnecessary generic abstractions.

Small scale is **not** an excuse for weak security, weak data integrity, missing audit, destructive history, inconsistent effective-date logic or unsafe concurrency.

> **Scale down process complexity, not engineering quality.**

## 9. Technical-company principle

Behaviour should be deterministic, explainable, testable, API-consistent, auditable and automation-friendly. Business rules have explicit semantics, not informal manual conventions.

- **Database** → genuine invariants.
- **Application services** → business workflows.
- **UI** → guidance and usability.
- Never hide business behaviour only in frontend logic.

## 10. Do not over-engineer future requirements

Do not implement speculative complexity for future Payroll, Leave, Contract or external integrations before they exist. Keep extension points only where clearly valuable (e.g. the PV-25 dependency-check list), document integration boundaries, avoid hardcoding assumptions that would block future modules, and implement real blockers only when the dependency exists.

> **Prefer a clear extension contract over an unused framework.**

## 11. Business decision gate (unchanged, restated)

| Kind of ambiguity | Who decides |
|---|---|
| Technical implementation detail | Claude, using engineering best practice |
| UX / copy detail that does not alter business semantics | Claude may improve it |
| Business-rule or lifecycle-semantic decision | **STOP and request approval** (CLAUDE.md gate; mark `Pending Validation`) |

Never disguise a business-rule change as a technical refactor.

## 12. Design review questions

For every significant new workflow or correction mechanism:

1. What business fact does this action represent?
2. What invalid state are we preventing?
3. Does this need a hard blocker, controlled correction, or only guidance?
4. What happens if HR enters it incorrectly?
5. Can the mistake be safely recovered without deleting history?
6. What internal records are affected?
7. What external records depend on it?
8. Is the process complexity proportional to the actual risk?
9. Would this workflow still be understandable to a small HR team six months later?
10. Are we building it because EmeSoft needs it, or because a large-enterprise HRIS might have it?
11. Can the same integrity be achieved with fewer states/actions?
12. Is the DB protecting true invariants without encoding unnecessary business bureaucracy?

If a proposal adds significant complexity but cannot say which demonstrated risk it solves, challenge it before implementation.

## 13. Anti-patterns (avoid unless specifically approved)

- Hard delete as normal recovery.
- A new status for every exception.
- Approval chains for ordinary HR corrections.
- Several fake lifecycle events to undo one input error.
- Copying large-enterprise HR workflows without an EmeSoft need.
- Blocking HR because of harmless internal history.
- Silently rewriting related records; automatic cross-person corrections.
- Configuration frameworks before a real configuration need.
- Treating every rare exception as its own feature.
- Using audit logs as application rollback state.
- Weakening database integrity for convenience.

## 14. Desired product character

Lightweight · predictable · forgiving of genuine human input mistakes · difficult to corrupt · easy to explain · fast for HR · technically disciplined.

## 15. Access control (C-85)

Details and the Phase 1 review: `docs/design/access-control-direction.md`.

- **Flexible role configuration, strict authorization enforcement.**
- Access control is configured through **roles and permissions**, not hard-coded to individual users or organisational job titles.
- **Organisational position may suggest access, but must not silently determine security privileges.**
- Adding or replacing HR staff should normally require **role assignment, not product change**.
- Three layers: **Permission** (stable, code-controlled capability) → **Access Role** (configurable bundle of existing permissions) → **User Role Assignment** (one or more roles per account). Effective permissions = union of enabled roles; no deny/precedence rules without a demonstrated need.
- Configurable: role definitions, role membership, assignments, enable/disable, optional suggested Position → Role mappings. Code-controlled: permission identifiers and semantics, server-side enforcement, security invariants, protected guardrails.
- Guardrails: no privilege escalation; disabled accounts have no access; UI is never a security boundary; sensitive grants are warned and audited in a **separate security audit trail**, not in employee history.
- Not at EmeSoft scale: policy engines, ABAC builders, allow/deny precedence, scope matrices, approval chains for role changes, automatic Job Title → access, user-created permission identifiers, external IAM provisioning. Scope (self/team/department/all) is an extension point only.
- New permissions only for a materially different authorization boundary that EmeSoft is likely to assign differently; otherwise reuse the existing capability.

