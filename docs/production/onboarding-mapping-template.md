# Mini HRS — HR Data-Mapping Template and Import-Design Skeleton (DRAFT)

- Date: 2026-10-12. Track 5 (owner: **HR**). Gate A7 input. Draft prepared by engineering; **closes nothing.**
- Decisions applied: M-12 (small one-time validated import utility — no generic engine, no mapping platform, no end-user import), M-13 (current operational truth + relationship-relevant prior Employment Periods; historical assignment changes not assumed), C-15 (legacy CLASSIFY never mapped automatically), C-26 / C-27 / C-63 (Rehire vs Relationship Change), C-25 (Initial Data Capture).
- **Real data rule:** HR fills these sheets **outside every Mini HRS environment, outside Git and outside AI tools.** Filled copies are never committed, attached to tickets or loaded anywhere before the A8 decision records REAL DATA ALLOWED. Engineering rehearses only with synthetic files of the same shape.
- The import utility is **not** built until HR approves this mapping (PV-05, PV-06, PV-08).

## 1. What HR provides

| # | Item | Sheet / decision | Register |
|---|---|---|---|
| 1 | Department catalog | `departments.csv` | PV-06 |
| 2 | Job Title catalog (English name; official Vietnamese name where applicable) | `job_titles.csv` | PV-06 |
| 3 | Level catalog | `job_levels.csv` | PV-06 |
| 4 | Employee Types and their Work-Email expectation (MVP set: Employee, Service Contractor, Intern — C-13) | `employee_types.csv` | PV-06, C-13, C-18 |
| 5 | Company e-mail domain(s) | one line in §5 | PV-06 |
| 6 | Employee Code format, case-only duplicates, prefix for new codes | §5 | PV-08 |
| 7 | Meaning of the ambiguous legacy columns (L, S, T, M, R, G–I, AA–AC, AS–AV, BC) and a decision per distinct value: Map / Transform / Discard / Needs Investigation | §4 | PV-05, C-15 |
| 8 | Which people need prior Employment Periods (rehire / relationship history) | `employment_periods.csv` | M-13 |
| 9 | First-load scope: current employees only, or also people who already left (and back to which date) | §5 | M-13 — **HR decision** |
| 10 | Whether optional personal fields (date of birth, gender, mobile phone, personal e-mail) are loaded at all | §5 | **HR + Legal (Q-L1)** |

## 2. Target sheets (header-only CSV templates in `onboarding-templates/`)

"Required" below means **required by the frozen Phase 1 model** (database / API), not a new HR rule.

### `people.csv` — one row per person

| Column | Model target | Required by model | Format / rule |
|---|---|---|---|
| `employee_code` | employee code registry | Yes | Legacy code preserved as text (leading zeros kept); unique case-insensitively; never reused (PV-08) |
| `full_name` | `person.full_name` | Yes | 2–150 characters; never used for matching |
| `date_of_birth` | `person.date_of_birth` | No | `YYYY-MM-DD`, not in the future — load only if HR + Legal agree (§1 #10) |
| `gender` | `person.gender` | No | `male` / `female` / `other` — same condition |
| `mobile_phone` | `person.mobile_phone` | No | `0xxxxxxxxx` or `+84xxxxxxxxx` — same condition |
| `personal_email` | `person.personal_email` | No | e-mail; never used for matching — same condition |

### `employment_periods.csv` — one row per Employment Period to load

| Column | Model target | Required by model | Format / rule |
|---|---|---|---|
| `employee_code` | person | Yes | Must exist in `people.csv` |
| `period_seq` | (ordering only) | Yes | 1 = earliest period loaded for this person |
| `start_date` | `employment.start_date` | Yes | `YYYY-MM-DD`; periods of one person never overlap |
| `end_date` | `employment.end_date` | For ended periods | Inclusive; ≥ `start_date`; empty = open |
| `employee_type_code` | `employment.employee_type_id` | Yes | Code from `employee_types.csv`; classified by HR from the **actual relationship**, never from the legacy CLASSIFY label (C-13, C-15) |
| `work_email` | `employment.work_email` | Expected when the Employee Type expects one | Company domain (§5); unique across overlapping periods |
| `how_started` | event sequence | Yes | `initial` (first period loaded) · `rehire` (returned after a gap or after an ended period, C-26) · `relationship_change` (continuous change to a **different** Employee Type, starts exactly the day after the previous period's end, C-27 / C-63) |
| `end_reason_code` | End event | For ended periods (except the system-set end before a `relationship_change`) | `VOLUNTARY_RESIGNATION`, `EMPLOYER_INITIATED_END`, `PLANNED_TERM_COMPLETED`, `MUTUAL_AGREEMENT`, `PROBATION_NOT_PASSED`, `OTHER` (C-21; labels are not legal grounds, PL-09) |
| `end_note` | End event note | Only for `OTHER` | Short text; no sensitive content |

Not loaded: cancelled or erroneous source rows (fix them in the sheet instead), probation, working arrangement, contracts, salary.

### `assignments.csv` — the current assignment of each loaded period (M-13)

| Column | Model target | Required by model | Format / rule |
|---|---|---|---|
| `employee_code`, `period_seq` | the period | Yes | Must match a row in `employment_periods.csv` |
| `effective_from` | `job_assignment.effective_from` | Yes | Within the period; for an ended period, the assignment in effect at its end |
| `department_code` | department | Yes | Code from `departments.csv` (exact match, never auto-created) |
| `job_title_code` | job title | Yes | Code from `job_titles.csv` |
| `job_level_code` | level | No | Code from `job_levels.csv` |
| `manager_employee_code` | manager | No | Employee code (never a name); the manager must be employed on `effective_from` (loaded in a second pass) |
| `change_reason` | `job_assignment.change_reason` | Yes | e.g. "Initial onboarding" (HR wording) |

Historical assignment changes from earlier years are **not** loaded unless HR raises a specific need (M-13).

### Catalog sheets

`departments.csv` (`code,name`), `job_titles.csv` (`code,name_en,name_vi`), `job_levels.csv` (`code,name,sort_order`), `employee_types.csv` (`code,name,requires_work_email` = `true`/`false`). Codes are stable identifiers; English names in the UI; Vietnamese only for official job-title names.

## 3. Synthetic example (illustration only — not real people)

| employee_code | period_seq | start_date | end_date | employee_type_code | how_started | end_reason_code |
|---|---|---|---|---|---|---|
| SYN0001 | 1 | 2022-03-01 | | EMPLOYEE | initial | |
| SYN0002 | 1 | 2023-06-01 | 2023-11-30 | INTERN | initial | — (system end) |
| SYN0002 | 2 | 2023-12-01 | | EMPLOYEE | relationship_change | |
| SYN0003 | 1 | 2019-01-02 | 2021-05-31 | EMPLOYEE | initial | VOLUNTARY_RESIGNATION |
| SYN0003 | 2 | 2024-02-01 | | SERVICE_CONTRACTOR | rehire | |

## 4. Legacy Excel → template (starting point: `docs/core-hr-spec.md` §1, `legacy-v0`)

| Legacy column | Template column | Current status | HR decision needed |
|---|---|---|---|
| B EC | `employee_code` | Mapped | Format, case duplicates, new-code prefix (PV-08) |
| C FULL NAME | `full_name` | Mapped | — |
| J START DAY / K RESIGN DAY | `start_date` / `end_date` of the **latest** period | Mapped / Pending (D-06) | Confirm meaning; supply earlier periods separately (one legacy row = one period only) |
| N DEPARTMENT / O POSITION / P POSITION VIETNAMESE / Q Level | `department_code` / `job_title_code` / `job_level_code` | Mapped by exact catalog match | Build catalogs first; confirm P cross-check |
| R LINE MANAGER | `manager_employee_code` | Pending (D-07) | Confirm the column holds employee codes |
| S CLASSIFY | — (never `employee_type_code`) | C-15 | Classify each person's Employee Type by actual relationship |
| L / T STATUS, M NOTE | — | Pending (D-04, D-13) | Meaning; used only to help HR review, not imported |
| Z GENDER, AD DOB, AF PHONE, AG PRIVATE EMAIL | `people.csv` optional columns | Mapped (optional) | Load or not (§1 #10, Q-L1) |
| AH COMPANY EMAIL | `work_email` | Mapped | Domain list (§5) |
| G–I, AA–AC, AS–AV, AW, AE, AL–AN, BC–BE | — | Pending Validation | Confirm they are not needed for the first load |
| D–F, U–X, AI–AK, AO–AR, AX–BB, BF, BG–CD | — | Out of scope / rejected (documents, contracts, IDs, tax, insurance, bank, dependants, salary) | None — never loaded |

## 5. HR answers (fill in)

| Question | Answer |
|---|---|
| Company e-mail domain(s) | |
| Employee Code format; how case-only duplicates are resolved; prefix for new codes | |
| First-load scope (current employees only / also leavers since ____) | |
| Optional personal fields to load (none / list) — after Q-L1 | |
| People who need prior periods (count; listed in the sheet) | |
| Second-person checker for the mapping | |
| Mapping approved by (HR Lead, date) | |

## 6. Import-design skeleton (for the utility after the mapping is approved — not built)

- **Flow:** source sheets → validation → dry-run preview (nothing written) → error report → HR corrects the sheet → approved import → reconciliation → integrity scan → HR sign-off. Re-runnable dry run; the final import runs once and stops on the first failure (fixed forward, never patched with SQL).
- **How it writes:** through the application's own services and validations in one transaction per person (catalog check, period non-overlap, Work-Email uniqueness, manager employed on date), never raw SQL; marks rows `record_source = snapshot_import` (the schema already allows it); a reason such as "Initial onboarding import" on every write that needs one.
- **Order:** catalogs (HR enters them through the Organization screens) → people + periods → assignments without manager → manager pass.
- **Validation report:** row-level errors and warnings — duplicate codes (incl. case-only), same name + date of birth, duplicate Work Email, unknown catalog code, overlapping or out-of-order periods, `relationship_change` not starting the day after the previous end or keeping the same type, manager not employed on the date, missing required column.
- **Reconciliation output:** counts per Employment Status, Department and Employee Type; people without Work Email or manager; a ≥ 10 % sample list for HR; integrity scan result.
- **Run by** the Technical Owner on the approved operator machine against staging (synthetic) and, after A8, production.
- **Open design points (decided with the utility design, not now):** which application user is recorded as the actor of the import; how Initial Data Capture (C-25) applies to prior periods and their End events; file format details (CSV UTF-8 vs the original workbook).
