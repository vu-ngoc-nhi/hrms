# CLAUDE.md

## Production & Migration Safety
- Normal local development may run in Auto mode.
- Never execute database migrations against staging/production, deploy to production, modify production data, perform destructive database operations, or perform irreversible Git operations without explicit user approval.
- When such an action becomes necessary: stop, state the exact command/action, its impact and rollback approach, and ask the user to switch to Manual mode.
- Approval of a design, plan or code change is not approval to execute migration or production actions.
- `npm test` may reset ONLY the local `hrms_test` schema, through the guard in `src/lib/db-safety.ts` (APP_ENV=test, db exactly `hrms_test`, loopback host, no production-like variables; fails closed). Do not bypass or weaken this guard.
- Never reset, drop or truncate `hrms_dev` without explicit approval. Seeds must stay insert-only.

## Data and legal
- Use synthetic data only. Never use real employee data in development, tests, fixtures, logs or AI tools; real data is a pre-production gate.
- Do not invent legal conclusions or retention periods. Mark unresolved items `Pending Legal Review`.

## Decisions
- Track decisions in `docs/decision-register.md` as Confirmed Decision / MVP Decision / Pending Validation / Pending Legal Review.
- Do not turn a Pending item into a permanent rule. Raise material conflicts before implementing instead of assuming.

## Language and naming
- English-first: UI text, messages, docs, acceptance criteria, tests and code use English. UI strings go through `src/i18n` (no hardcoded user-facing strings in components).
- Vietnamese only for Vietnam-specific legal or official business data (e.g. `job_title.name_vi`).
- Personal names are never translated; demo data may use realistic Vietnamese names, but controlled values (departments, job titles, statuses, types) are English.
- Business terminology is English in UI and code (Job Title, Employee Type). Logic and the database depend on ids, codes and stable enum values, never on display text.

## Domain model
- Employee Type belongs to the employment period, not the assignment; a relationship change is a new period. Working Arrangement and Employment Stage are separate concepts.
- Work email and personal/contact email are separate fields; email is never an identity key.

## Identity
- Never hardcode Entra tenant/client IDs, audiences or secrets; they come from environment configuration (Web/SPA and API registrations are separate).
