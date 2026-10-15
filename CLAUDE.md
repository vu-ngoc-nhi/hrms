# CLAUDE.md

## Production & Migration Safety
- Normal local development may run in Auto mode.
- Never execute database migrations against staging/production, deploy to production, modify production data, perform destructive database operations, or perform irreversible Git operations without explicit user approval.
- When such an action becomes necessary: stop, state the exact command/action, its impact and rollback approach, and ask the user to switch to Manual mode.
- Approval of a design, plan or code change is not approval to execute migration or production actions.
- `npm test` may reset ONLY the local `hrms_test` schema, through the guard in `src/lib/db-safety.ts` (APP_ENV=test, db exactly `hrms_test`, loopback host, no production-like variables; fails closed). Do not bypass or weaken this guard.
- Never reset, drop or truncate `hrms_dev` without explicit approval. Seeds must stay insert-only.

## Migration governance
- A migration committed to Git (shared project history) is immutable. Never edit it to represent a new schema change.
- Every schema evolution after the baseline — constraint changes, column changes, data transformations, removals — gets a NEW forward migration.
- An old migration may be edited only if it is clearly uncommitted/local-only and has never been part of shared history.
- Never rewrite committed migration history silently.

## Auto Development vs Business Decision Gate
Auto mode may be used for normal local engineering work, but never to make unresolved HR/Product business decisions.

### Work that may proceed automatically
- Bug fixes that preserve approved business behavior; refactoring that does not change business semantics.
- TypeScript/type fixes; linting, formatting and code cleanup.
- Unit, integration and contract tests; running tests against `hrms_test` under the fail-closed guard; typecheck, lint and builds.
- Regenerating OpenAPI from already-approved API changes.
- Documentation updates that reflect decisions already Confirmed or approved as MVP decisions.
- English-first UI/i18n implementation.
- Synthetic/demo seed updates that only represent approved rules.
- Technical logging and error handling that do not expose sensitive data.
- Performance/index improvements that do not change business behavior.
- Security hardening that does not change business permissions.
- Non-destructive forward migrations required to implement an already-approved rule, and applying them to the guarded local `hrms_dev` when no data is removed or semantically transformed.

### Mandatory Business Decision Gate
STOP and ask the user before implementing anything that introduces, changes, removes or interprets an unresolved business rule, including (not limited to):
- Employee Type values or meaning; mapping legacy CLASSIFY values;
- Employment Status values or lifecycle transitions; Employment Period creation/termination rules; rehire rules;
- Working Arrangement / Full-time / Part-time / FTE; Probation model, dates, status, outcome or extension;
- profile completeness requirements; required vs optional HR fields;
- Work Email / Personal Email business requirements; company account eligibility;
- role or permission changes; approval authority; Entra role/group/business access mapping;
- historical-data correction rules; backdating or overlapping effective dates; audit requirements; required correction reasons;
- retention rules; privacy/legal interpretation; handling of real employee data;
- Leave, Contract, Payroll, Benefits or other HR policy rules.

When such a question appears:
1. Stop before implementing the business behavior. Do not silently choose a "reasonable default".
2. Do not infer a permanent rule from demo data, legacy fields, UI wording or old code.
3. Explain the decision needed, why it matters, the main options, the recommended option, and the impact on data model/API/UI/history.
4. Mark the item `Pending Validation` in `docs/decision-register.md`.
5. Wait for explicit user approval before implementing it. Technical work that does not depend on the decision may continue.

If it is uncertain whether a change is technical implementation or a business decision, treat it as a business decision and ask first.

### Safety operations (always require explicit approval, regardless of Auto mode)
Destructive reset of `hrms_dev`; destructive database operations outside `hrms_test`; staging or production migrations; staging or production data changes; deployment; real employee data use; irreversible Git operations; force push.

## Product design philosophy (C-84, mandatory)
Context: Eme People — AI-First People Management Platform (formerly Mini HRS; C-103) — serves EmeSoft, a technical company of ~70–100 employees with a small HR team. Full guidance: `docs/design/emesoft-design-philosophy.md`.
- **Strict on history and integrity, flexible on operations** — "Lightweight HR operations, strong Core HR integrity". Scale down process complexity, not engineering quality.
- Choose the lightest sufficient control: (1) **hard constraint** (DB/API, fail closed) only for objectively invalid or unsafe data; (2) **controlled correction** (HR_ADMIN, explicit action, reason, audit, optimistic concurrency, idempotency, no hard delete, no approval chain) when data may legitimately need correcting; (3) **soft guidance** (wording, confirmation, warning, preview) for usability.
- Prefer the smallest workflow that preserves integrity, auditability and safe recovery; add no statuses, approval layers, intermediate states or hand-offs without a demonstrated business, legal, security or integrity risk.
- Recovery is first-class: for every write workflow answer "what if HR makes a genuine mistake?"; never rely on deletes, fake events, date manipulation or direct DB fixes; otherwise document the limitation.
- Historical record ≠ operational effect: keep evidence (dispositions, reversals, corrections); exclude it from operations through the shared query module.
- Internal dependencies (inside the aggregate being corrected) should not block; external dependencies (other people, later periods, other modules) need explicit handling; never silently repair unrelated records.
- DB for invariants, application services for workflows, UI for guidance; no business behaviour only in the frontend. No speculative frameworks for future modules — prefer a clear extension contract.
- Apply the design review questions and anti-pattern list in the philosophy document to every significant workflow. The Business Decision Gate above still applies; never disguise a business-rule change as a refactor.

## Access control principle (C-85, mandatory)
Direction: `docs/design/access-control-direction.md`. Phase 1 roles (HR_ADMIN, HR_EDITOR, API_DOCS_READER) and permissions are the current baseline and are not changed without approval.
- **Flexible role configuration, strict authorization enforcement.** Authorize by **permissions** (stable, code-controlled capabilities) — never by role names, individual users or organisational facts. Roles are bundles of permissions; effective permissions = union of enabled roles; no deny/precedence rules without a demonstrated need.
- Organisational position (Department, Job Title, Level, Employee Type) may only *suggest* access; it never silently grants or revokes privileges.
- Adding or replacing HR staff should need role assignment only — no code change, migration or deployment. Do not add new hard-coded role checks; declare the required permission on the operation and enforce it server-side; UI visibility is never a security boundary.
- Do not create a new permission unless it represents a materially different authorization boundary EmeSoft is likely to assign differently; otherwise reuse the existing capability (e.g. Void Employment Period uses `employment.correct`).
- Future access management must prevent privilege escalation, give disabled accounts no access, warn on sensitive grants and keep a separate security audit trail. No policy engines, ABAC builders, scope matrices or approval chains without a demonstrated EmeSoft risk; scope (self/team/department/all) stays an extension point only.

## Data and legal
- Use synthetic data only. Never use real employee data in development, tests, fixtures, logs or AI tools; real data is a pre-production gate.
- Do not invent legal conclusions or retention periods. Mark unresolved items `Pending Legal Review`.

## Decisions
- Track decisions in `docs/decision-register.md` with these statuses, used consistently:
  - `Confirmed Decision` — approved business/product rule.
  - `MVP Decision` — approved for the current version; may change later.
  - `Pending Validation` — user/stakeholder decision required before implementation.
  - `Pending IT Configuration` — requires IT/identity configuration.
  - `Pending Legal Review` — must not be resolved by engineering assumptions.
- Never silently promote a Pending item into a Confirmed or MVP decision. Raise material conflicts before implementing instead of assuming.

## Language and naming
- English-first: UI text, messages, docs, acceptance criteria, tests and code use English. UI strings go through `src/i18n` (no hardcoded user-facing strings in components).
- Vietnamese only for Vietnam-specific legal or official business data (e.g. `job_title.name_vi`).
- Personal names are never translated; demo data may use realistic Vietnamese names, but controlled values (departments, job titles, statuses, types) are English.
- Business terminology is English in UI and code (Job Title, Employee Type). Logic and the database depend on ids, codes and stable enum values, never on display text.

## Domain model
- Employee Type belongs to the employment period, not the assignment. A genuine relationship change is a new period; a data-entry correction updates the existing period (authorized user, reason). Working Arrangement, Employment Status and Probation are separate concepts: Employment Status is computed (`not_started`/`active`/`ended` → Pre-start/Active/Ended; end causes are future End Reasons); Cancelled and Voided (PV-25, C-86) are record dispositions, not statuses — only the shared query module decides what is operational (`cancelled_at IS NULL AND voided_at IS NULL`); Probation is a concurrent condition of an Active period whose Failed outcome never ends the period automatically. Working Arrangement and the probation module are not implemented (Pending Validation).
- Work email and personal/contact email are separate fields; email is never an identity key.

## Identity
- Never hardcode Entra tenant/client IDs, audiences or secrets; they come from environment configuration (Web/SPA and API registrations are separate).
