# Eme People — Core HR Phase 1 Specification (profiles, create, update, Excel import/export)

- **Version 0.3.1, 2026-10-08.** 0.3.1 applies decisions C-09 to C-12: Employee Type on the employment period; separate work and contact email; v2-only Entra tokens.
  - v0.3 is an English rewrite of v0.2 (`docs/archive/core-hr-spec-v0.2-vi.md`). It applies the product and engineering decisions of 2026-10-08.
  - IDs (D-xx, R-xx, V-xx, S-x, GWT numbers) are kept for traceability.
  - Decision statuses are recorded in `docs/decision-register.md`. This spec does not turn any Pending item into a rule.
- **Related documents:**
  - `docs/adr/0001`–`0004`;
  - `docs/legal/legal-review-s0-s3.md`;
  - `docs/api/core-hr-api.md`;
  - `contracts/core-hr/openapi.json`.

Column-status legend: **Mapped** = implemented or ready to implement · **Pending Validation** · **Pending Legal Review** · **Out of scope** (phase 1).

## Implementation status (2026-10-08)

**Implemented (local, synthetic data):**
- migrations from an empty database;
- REST `/api/v1/core-hr/*`: catalogs (departments, job titles, levels, employee types), employee list, create (name only, or operational profile), detail;
- an English UI built on a message catalog;
- internal OpenAPI 3.1 at `/internal/docs`;
- the development test issuer;
- executable database safety guards.

**Not implemented:**
- profile updates (S4);
- suspension, return and termination events;
- Excel (S5–S8);
- real Entra sign-in (MSAL);
- leave tool integration;
- sensitive data groups.

## 0. Source survey (template.xlsx)
- `template.xlsx` has one sheet with a **header row only** (A1:CK1) and no data rows, so value formats are proposals.
- Data validations exist only on header cells (L1, S1, BH1). They are recorded as observations, **not** used to interpret STATUS or CLASSIFY.
- Several headers repeat (Date/Month/Year, STATUS, DOB, NO.CONTRACT). Legacy mapping must therefore check both column address and header text.
- Columns Y and CE–CG have no header.
- The leave tool exposes an OpenAPI document only. It is not queried, to avoid reading real employee data.

## 1. Legacy column mapping (`legacy-v0`)
`text-id` = read as a string and keep leading zeros; a numeric cell is an error. `ref` = exact catalog match; never auto-created.

| Col | Source header | Target | Type | Rule | Status |
|---|---|---|---|---|---|
| A | # | — (renumbered on export) | — | ignored | Mapped |
| B | EC (employee code) | `employee_code_registry` (source=legacy) | text-id | required; trimmed; unique, case-insensitive | Mapped; format PV-08 |
| C | FULL NAME | `person.full_name` | text | NFC, collapsed spaces, 2–150 chars; never used for matching | Mapped |
| D, E, F | LINK PROFILE, CV original, Eme Format | documents | url/file | — | Out of scope (D-12) |
| G–I | Date / Month / Year | not mapped | — | warn if populated | Pending Validation (PV-05) |
| J | START DAY | `employment.start_date` | date | required for new hires | Mapped; meaning PV-05 (D-06) |
| K | RESIGN DAY | `employment.end_date` (inclusive) | date | ≥ J | Pending Validation (D-06) |
| L | STATUS | not mapped | — | shown in preview only | Pending Validation (D-04) |
| M | NOTE | not mapped | text | — | Pending Validation (D-13) |
| N | DEPARTMENT | `job_assignment.department_id` | ref | exact match | Mapped |
| O | POSITION | `job_assignment.job_title_id` (`job_title.name_en`) | ref | exact match | Mapped |
| P | POSITION VIETNAMESE | cross-check with `job_title.name_vi` | ref | must belong to the same job title as O | Pending Validation |
| Q | Level | `job_assignment.job_level_id` | ref | exact match | Mapped (not part of operational completeness) |
| R | LINE MANAGER | `job_assignment.manager_employment_id` | text-id → ref | employee code only, never a name; manager employed on the effective date | Pending Validation (D-07) |
| S | CLASSIFY ("Fulltime, Probation" list on the header) | **never** Employee Type (C-15). "Fulltime" is a Working Arrangement candidate, "Probation" a probation-condition candidate; neither is migrated automatically and no dates are inferred | — | not mapped; HR classifies each real value as Map / Transform / Discard / Needs Investigation from a value/count report without personal data | Confirmed process (C-15); actual values Pending Validation (PV-05) |
| T | STATUS | not mapped | — | — | Pending Validation (D-04) |
| U–X | current contract | — | — | dropped at read, never stored | Out of scope |
| Y | (blank) | — | — | warn if populated | Mapped |
| Z | GENDER | `person.gender` (`male`/`female`/`other`) | enum | value set to confirm | Mapped |
| AA–AC | Date / Month / Year | not mapped; DOB is never derived from these | — | warn | Pending Validation (PV-05) |
| AD | DOB | `person.date_of_birth` | date | not in the future | Mapped (optional) |
| AE | POB | place of birth | text | — | Pending Validation |
| AF | PHONE | `person.mobile_phone` | text-id | `0xxxxxxxxx` or `+84xxxxxxxxx`; separators removed only | Mapped (optional) |
| AG | PRIVATE EMAIL | `person.personal_email` | email | never used for matching | Mapped (optional) |
| AH | COMPANY EMAIL | `employment.work_email` | email | company domain; unique during the assigned period | Mapped |
| AI–AK | ID number, issue date, issue place | identity document | text-id/date/text | — | Pending Legal Review (PL-03); not enabled |
| AL–AN | education level, school, major | education | text | — | Pending Validation |
| AO | PIT number | tax code | text-id | — | Pending Legal Review; not enabled |
| AP | SI number | social insurance number | text-id | — | Pending Legal Review; not enabled |
| AQ, AR | bank account, bank | bank account | text-id/ref | — | Pending Legal Review; not enabled (D-09) |
| AS–AV | permanent/contact address (new/old) | addresses | text | old/new never interpreted | Pending Validation (D-14) |
| AW | FAMILY STATUS | marital status | enum | — | Pending Validation |
| AX–BB | dependants, children + DOB | family members | — | — | Pending Legal Review (PL-03) |
| BC–BE | emergency contact (label?, name, phone) | emergency contact | text | BC meaning unclear | Pending Validation (D-13) |
| BF | SALARY BASIC | — | — | dropped at read; never stored, logged or kept as a file | Out of scope |
| BG–CD | contracts and appendices | — | — | dropped at read | Out of scope |
| CE–CG | (blank) | — | — | warn if populated | Mapped |
| CH–CK | ID card, Degree, Health certificate, SYLL | document checklist | — | health data is sensitive | Pending Legal Review (PL-03) |

## 2. Data model (implemented; source of truth: `prisma/migrations`)
- **Person** (`person`):
  - stable UUID; employee code (via the insert-only `employee_code_registry`);
  - basic personal fields (gender, date of birth, personal email, mobile phone);
  - `revision`.
  - `profile_state` is deprecated (M-04).
- **Employment period** (`employment`):
  - start date; end date (**inclusive**); work email (company-issued; separate from the personal/contact email on `person`);
  - **employee type** (nature of the relationship: Employee, Service Contractor, Intern…, C-09). A genuine relationship change is a new period; a data-entry correction updates the existing period in place (authorized HR user with a reason, S4). There is no database-level immutability (migration `20261009000000`).
  - Periods of one person cannot overlap. A work email is unique within its assigned period (exclusion constraint).
  - Rehire and relationship changes (e.g. Service Contractor → Employee) create a new period.
  - Not modelled in MVP: Working Arrangement (PV-15) and Probation (C-17, implementation PV-16). See "Employment lifecycle model" below.
- **Employment lifecycle model** (C-13 to C-18, 2026-10-09):

  | Concept | Meaning | Where | Changes create a new Employment Period? | MVP status |
  |---|---|---|---|---|
  | Employment Period | One continuous relationship span with EmeSoft | person → employment | — | Implemented |
  | Employee Type | Nature of the relationship: Employee, Service Contractor, Intern (C-13; Intern defined in C-19 — a time-limited learning relationship, not probation). Not Contract Type | employment period | Genuine change: yes (e.g. Intern → Employee, Contractor → Employee). Data correction: no | Implemented (catalog) |
  | Employment Status | Computed lifecycle: `not_started` / `active` / `ended`, displayed Pre-start / Active / Ended (C-16) | computed | No | Implemented (label fix pending) |
  | End Reason | Why a period ended (resignation, dismissal, contract expiry, probation failure…) | future attribute of the period end | — | Pending Validation (PV-17) |
  | Probation | Effective-dated condition of a period, concurrent with Active; outcome pending/passed/failed/cancelled; pass continues the same period; Failed does not end the period by itself (C-17) | future child of employment period | No | Concept approved; not implemented (PV-16, PL-08) |
  | Working Arrangement | Full-time / Part-time, effective-dated within a period | future | No | Deferred (PV-15) |
  | Company account expectation | Default per Employee Type (`requires_work_email`; concept closer to `company_account_expected`, rename deferred); per-period override deferred (C-18, PV-14). Approved defaults: Employee and Intern `true` (C-20), Service Contractor `false` | employee type (+ future period override) | No | Default implemented; override PV-14 |
  | Organizational Assignment | Department, job title, level, manager, effective-dated | employment period → assignment | No | Implemented |

  Internship duration is the Intern Employment Period's start and end dates; there is no separate Internship Status, and completing or ending an internship is neither passing nor failing probation (C-19). Rehire is a new Employment Period (Pre-start before its start date). Probation, Rehire in Progress, On Leave, Maternity Leave, Resigned, Dismissed and Contract Expired are not lifecycle statuses.
- **Employment events** (`employment_event`): start, suspend, resume, end, cancel_planned_start. Only `start` is written in S3.
- **Job assignment** (`job_assignment`):
  - `[effective_from, effective_to)` (start inclusive, end **exclusive**);
  - department, job title, level, manager employment (a department or job-title change never changes the employee type);
  - `record_source`, `change_reason`.
  - Assignments cannot overlap within a period and must fall inside the period (deferred constraint trigger). Self-management is blocked.
  - A real change (transfer, promotion) creates a new row. A correction edits the row with a reason (S4).
- **Catalogs**: department, job_title (`name_en`, optional `name_vi` for official documents), job_level, employee_type (with the HR-managed flag `requires_work_email`). They are identified by id/code, deactivated rather than deleted, and logic never depends on display names (C-02).
- **Accounts and links**: `app_user` (Entra tenant + object id), `app_user_role` (role code format only; the allow-list lives in the application), `external_identity` (per external system).
- **Cross-cutting**: `audit_event` (field names only), `idempotency_record` (keyed HMAC).
- **Completeness** (M-04): computed per request.
  - `operational` has status, rule version and items.
  - `hr` is `not_defined`.
  - `legal` is `pending_legal_review`.

  A future HR or legal rule can be added as another versioned rule without changing the schema.

## 3. Shared validation rules
There is one server-side validation path (Zod schemas plus service rules), used by the API, form and future importer. The client only mirrors it for early feedback.

| ID | Rule | Level |
|---|---|---|
| V-TXT-ID | Identifier columns must hold string values. Numeric, formula or exponent cells are rejected, and leading zeros are never padded. The cell's actual value type is checked, not only its `@` format. | Error |
| V-DATE | Native Excel dates (1900/1904 systems, no timezone shift) or `dd/mm/yyyy` strings; impossible dates are rejected. Start date before 2000 or more than 90 days ahead → **warning** (implemented). | Error / Warning |
| V-REQ | API: `full_name` only. `require_operational_completeness=true` adds the operational items (M-04). Update mode (planned): employee code. | Error |
| V-REF | Exact catalog match (trimmed, case-insensitive); inactive items are rejected for new assignments. | Error |
| V-UNIQ-FILE / V-UNIQ-SYS | Duplicates of employee code or identifiers within the file or against the system are blocked. Blanks are never considered duplicates. | Error / Block |
| V-SOFT-DUP | A name + DOB or email match only produces a warning; profiles are never merged automatically. | Warning |
| V-NAME | NFC normalization; a digit in the name → warning `NAME_CONTAINS_DIGIT` (implemented). | Warning |
| V-PHONE | Separators are removed only; `0xxxxxxxxx` or `+84xxxxxxxxx` (implemented). | Error |
| V-EMAIL | Work email must use a configured company domain (implemented). | Error |
| V-DOB | Not in the future; under about 15 years → `AGE_REVIEW` warning, which is not a legal conclusion (implemented). | Error / Warning |
| V-PROTECTED | Legal ID, tax, social insurance, bank, dependants, health, salary, contract and document fields → 422 `PROTECTED_FIELD_NOT_ENABLED` (implemented). | Error |
| V-OUT / V-UNMAPPED | Out-of-scope or pending columns with data → one file-level warning that never shows the values. | Warning |
| V-FILE | `.xlsx` only, 5 MB, 2,000 rows, decompressed-size and cell-count limits; fingerprint check for `legacy-v0`. | Reject file |

Person matching never uses name or email:
- **Create** is blocked when any strong identifier already exists.
- **Update** matches on employee code only. A conflicting identifier → `conflict`. A blank cell means *no change*. A previously blank identifier may be filled in, if the caller has permission.

## 4. Screens
**Implemented:**
- Sign in (test identity, clearly labelled);
- Employees list: search, filter by employment status and department, operational completeness badge;
- Create Employee: name only, or with employment and first assignment; optional "Require a complete operational profile";
- Employee detail: employment status, operational completeness items, personal group by permission, employment periods and assignments;
- Catalogs: Departments, Job Titles, Levels, Employee Types; create and deactivate;
- API Docs (`docs.read`).

**Planned (S4+):**
- edit with before/after review and an `expected_revision` conflict check;
- change versus correct an assignment;
- end employment and rehire;
- history view;
- Excel import and export (§8).

## 5. Original open questions D-01–D-16 → register
| D | Topic | Now tracked as |
|---|---|---|
| D-01 | Stack, hosting | M-01; hosting PL-02 |
| D-02 | Clearing values via Excel | MVP: not supported; clear through the form (S4) |
| D-03 | Employee codes | M-02, PV-08, PV-09 |
| D-04 | L/S/T status columns | PV-05, PV-01 |
| D-05 | Date/Month/Year columns | PV-05 |
| D-06 | Meaning of J/K | PV-05 |
| D-07 | Column R; effective date for assignment changes in Excel | PV-05; MVP: assignment changes via form only |
| D-08 | Identity documents | PL-03 |
| D-09 | Bank | PL-03 |
| D-10 | Roles | M-03, PV-07, PV-10 |
| D-11 | Catalogs | PV-06 |
| D-12 | Links, CV, document checklist | Out of scope |
| D-13 | Note, dependants, emergency contact | PV-05, PL-03 |
| D-14 | Addresses | PV-05 |
| D-15 | Leave tool link | Deferred; `external_identity` exists |
| D-16 | Staging, audit retention, encryption | M-07, PL-01, PL-02 |

## 6. Delivery slices
| # | Slice | Status |
|---|---|---|
| S0 | Foundation, authentication, authorization, OpenAPI, safety guards | Done (local) |
| S1 | Schema and constraints | Done for person, codes, employment, assignment, catalogs, audit, idempotency; identity documents and staging not started |
| S2 | Shared normalization and validation | Partial (form/API fields); Excel reader not started |
| S3 | Create profile | Done |
| S4 | Edit, assignment change/correction, events, history | Not started |
| S5–S8 | Excel read/preview/commit/export | Designed (§8) |
| S9 | Leave tool sync | Backlog |

## 7. Acceptance tests (Given–When–Then)
Synthetic data only: names like `Test Employee A`, `@example.test` emails, generated identifiers.

**Implemented and automated (`tests/`):**

32. **Given** HR_EDITOR **When** creating with only a full name **Then** 201, an auto code `ES####`, no employment, operational completeness `incomplete`, and exactly one audit event holding field names only.
33. **Given** `require_operational_completeness=true` and missing items **When** creating **Then** 422 `OPERATIONAL_PROFILE_INCOMPLETE` lists the missing items, and nothing is written.
34. **Given** an Employee with Full Name, Work Email, Start Date, Department, Job Title and Employee Type, without DOB, gender, level or personal details **When** creating **Then** operational completeness is `complete`, HR is `not_defined` and legal is `pending_legal_review`.
35. **Given** no Employee Type **Then** operational completeness is `incomplete`, with only `employee_type` missing.
35a. **Given** an active Employee with a contact email but no work email **Then** `work_email` is missing. **Given** a Service Contractor (type without a company account) with a contact email **Then** complete. **Given** a pre-start hire with only a contact email **Then** complete.
35b. **Given** `employee_type_id` inside `assignment` **Then** 400 (it belongs to the employment period). **Given** a period with a wrongly entered type **When** an authorized correction updates it in place **Then** it is accepted, no extra period is created, and an unknown type id is rejected (FK).
35c. **Given** a v2 token whose `aud` is the App ID URI, or a token with `ver` ≠ `2.0` **Then** 401.
35d. **Given** a freshly migrated test database **When** running the development demo seed **Then** each demo profile has its documented status and completeness, and the Service Contractor → Employee change shows as two periods.
36. **Given** a future start date **Then** the employment status is `not_started`.
37. **Given** a work email assigned to someone else for an overlapping period (including a future end date) **Then** 409 `WORK_EMAIL_IN_USE`, and no person, code or audit remains (rollback).
38. **Given** 10 concurrent creates **Then** 10 distinct codes. **Given** 5 concurrent creates with the same Idempotency-Key **Then** 1 profile and 1 audit event.
39. **Given** a replay with the same key and payload **Then** the same profile with `Idempotent-Replayed: true`. A different payload **Then** 409. A revoked role **Then** 403.
40. **Given** legal ID, tax, bank or dependant fields **Then** 422 `PROTECTED_FIELD_NOT_ENABLED`. Unknown fields, including the retired `profile_state`, **Then** 400.
41. **Given** a caller without `employees.read_personal` **Then** the detail JSON has no `personal` key.
42. **Given** a missing or invalid token (audience, tenant, issuer, expiry, scope) **Then** 401. Authenticated but not permitted **Then** 403. A retired role code such as `HR_VIEWER` grants nothing. The OpenAPI endpoint returns 401/403/200 by `docs.read`.
43. **Given** `NODE_ENV=production` or `APP_ENV=production` **Then** test tokens get 401 and `/api/v1/dev/*` returns 404 (also checked on `next build && next start`).
44. **Given** the app role `hrms_app` **Then** it cannot UPDATE/DELETE audit rows, delete people, change the code registry or run DDL. Overlapping periods or assignments, and assignments outside a period, are rejected by the database.
45. **Given** `APP_ENV` other than `test`, a database name other than `hrms_test`, a non-loopback host, a remote `*DATABASE_URL`, or a `PROD`/`PRODUCTION` variable **When** resetting the test DB **Then** the operation is refused before connecting. **Given** a production or remote target **When** running `db:migrate` **Then** it is refused.
46. **Given** the generated OpenAPI **Then** it is valid 3.1, operationIds are unique, routes match operations 1:1, there are no DELETE operations, and there is no Vietnamese text in system strings.

**Planned for Excel (S5–S8), from v0.2:**

1. Create mode: a duplicate employee code → `blocked_duplicate`.
2. Create mode: a duplicate identifier → blocked.
3. Same name and email but different identifiers → `new`, plus a soft-duplicate warning.
4. Re-importing a file → all rows blocked; person count unchanged.
5. Duplicate codes within one file → both rows error.
6. Update mode with an unknown code → error; nothing created.
7. Update mode with a conflicting identifier → `conflict`; nothing written.
8. Update mode matched by email only → error.
9. Text cell `00123` → kept as `00123`.
10. Numeric phone cell → V-TXT-ID error; no padding.
11. Exponent identifier cell → error.
12. Export then re-import → all rows `no_change`.
13. `31/02/2024` → V-DATE error.
14. Before confirming, no business table or profile audit changes; upload, access and denial logs are allowed.
15. Preview shows only the changed fields, with before and after values.
16. A DB failure on row 3 of 5 → row 3 leaves nothing; the other rows commit.
17. A revision changed after preview → that row becomes `conflict`.
18. An expired batch → confirmation refused.
19. A blank cell → no change and no audit.
20. An assignment change via the form → the old row closes on the effective date and history is kept.
21. An assignment change via Excel → `conflict`, "effective date required".
22. Rehire → two periods; the old one is unchanged.
23. Audit shows actor, time, source and field names; the app role cannot modify it.
24. Salary or contract values → one V-OUT warning; values absent from staging, logs and DB; the file is not stored.
25. Pending columns → V-UNMAPPED; never written.
26. A wrong header at a legacy coordinate → the whole file is rejected.
27–30. Server-side permission checks on detail, export and confirm.
31. Exporting `=HYPERLINK(...)` or `+84…` → a string cell with no formula that round-trips unchanged.

## 8. Excel design for S5–S8 (not implemented)
- **Formats (R01):**
  - `core-hr-v1` uses unique field codes as headers, allows any column order, and has a `_meta` sheet with the template version.
  - In update mode, `employee_code` plus the changed columns are enough; missing columns and blank cells mean no change.
  - Metadata columns (`_source_row`, `_error_code`, `_error_message`) are ignored on import.
  - `legacy-v0` is checked by coordinate and header (§1). A mismatch shows the differences and suggests the standard template; columns are never auto-matched.
- **Staging (R07):**
  - Each batch is bound to its creator and their permission scope.
  - Only in-scope fields are staged, encrypted. Payloads are removed on completion or after 72 hours.
  - The original file is never stored, including temp directories, request logs and error telemetry.
- **Preview → confirm (R05, R06, R10):**
  - Permissions and the previewed `person.revision` are re-checked at confirm.
  - Each row commits in one transaction: business change, audit and row result.
  - Re-sending a committed batch returns the stored results; an interrupted batch resumes uncommitted rows.
  - Managers are resolved from staging and the DB, in dependency order.
- **Snapshot import (R03):** a migration batch needs an HR-confirmed `snapshot_date`. Assignments start on that date with `record_source = snapshot_import`; no past history is invented.
- **Export (R09):**
  - Cells are written as strings with Text format and no formulas.
  - "Download for update" (`core-hr-v1`) is a separate action from "custom report".
  - Columns outside the caller's permissions are never exported, including in error files.

## 9. Planned endpoints (not in the trial OpenAPI)

S4 scope, rules, permissions and the Cancel Planned Period model analysis: `docs/design/s4-employee-employment-management.md` (decisions C-21 to C-29).
- S4:
  - `PATCH /api/v1/core-hr/employees/{id}`;
  - `GET`/`POST …/employees/{id}/employments`;
  - `POST …/employments/{id}/events`;
  - `GET`/`POST …/employments/{id}/assignments`;
  - `GET …/audit-logs`.
- Excel:
  - `GET …/import-templates/employees`;
  - `POST …/imports/employees`;
  - `GET …/imports/{id}` and `…/imports/{id}/rows`;
  - `POST …/imports/{id}/confirm`;
  - `GET …/imports/{id}/errors.xlsx`;
  - `POST …/exports/employees`.
