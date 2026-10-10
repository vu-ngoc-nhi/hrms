# Mini HRS — Core HR Phase 1 UAT Checklist

- Milestone: **Core HR Phase 1 — UAT Passed With Pre-Production Actions** (HR sign-off 2026-10-10; results in `phase1-uat-round1-results.md` and `phase1-uat-round2-results.md`). **Not production ready** — PV-25 is a mandatory pre-production action.
- Environment: local/UAT build with the development test identity (not Microsoft Entra ID). **Use synthetic data only** — never real employee data (C-03).
- Roles: **HR Admin** (HR_ADMIN), **HR Editor** (HR_EDITOR), **API Docs** (API_DOCS_READER). Sign in from the login page with the matching test account.
- "Today" means the business date in Asia/Ho_Chi_Minh. End dates are inclusive. Status is computed: **Pre-start / Active / Ended**; **Cancelled** is a history badge, not a status.

How to use: run each scenario in order with a new synthetic person; tick a step only when the expected result is seen. Record the Request ID shown with any unexpected error.

## 1. New person and first employment

| # | Step (role) | Expected result |
|---|---|---|
| 1.1 | Create Employee with a name only (Editor) | Profile created with a new Employee Code (ES…); status *No Employment Record*; Operational Profile *Incomplete* |
| 1.2 | Add Initial Employment Period, start today, Employee Type *Employee* (Editor) | Period 1 shown *Active*; event "Start of employment"; no assignment yet; profile still incomplete |
| 1.3 | Add Initial Assignment, Department and Job Title (Editor) | One assignment from the start date; "Change Assignment" now available |
| 1.4 | Edit Work Email (Editor) | Address saved; Operational Profile *Complete* |
| 1.5 | Edit Profile: change Full Name (Editor) | Reason required; saved |
| 1.6 | Repeat 1.2 on another person with a start date in the past (Editor) | Reason required (Initial Data Capture); saved |
| 1.7 | Repeat 1.2 with a start date of today | Notice that a period starting today is effective immediately and cannot be cancelled as planned |
| 1.8 | Future period whose first assignment starts later than the start date | Department shown from that assignment, but Operational Profile *Incomplete* (Department / Job Title not ready on the start date, C-78) |

## 2. Organisational changes

| # | Step (role) | Expected result |
|---|---|---|
| 2.1 | Change Assignment effective in 10 days, new Department (Editor) | Previous assignment ends on that date; new assignment starts the same day; reason required |
| 2.2 | Change Assignment with a past date (Editor) | Refused (past dates need HR Admin) |
| 2.3 | Correct an assignment row: earlier start, inactive Department (Admin) | Row edited in place; previous row's end moves with it; no new row; reason required |
| 2.4 | Try any "Correct …" action as Editor | Not shown; the server also refuses it |

## 3. End Employment and reversal

| # | Step (role) | Expected result |
|---|---|---|
| 3.1 | End Employment in 30 days, reason *Voluntary Resignation* (Editor) | End date set; still *Active* until then; event "Planned end of employment · Voluntary Resignation" with a *Current end* badge; current assignment ends the day after |
| 3.2 | Try End Employment again | Not offered (an End is already recorded) |
| 3.3 | End Reason *Other* without a note | Save disabled / refused |
| 3.4 | Correct Period: move the end date 5 days later (Admin) | End date and the End event date both change; reason required |
| 3.5 | Reverse End Employment (Admin) | Shows original end date, End Reason and the state to restore; after saving the period is open again exactly as before End Employment (the corrected date in 3.4 is not kept); the End is struck through with a *Reversed* badge and "End of employment reversed" names the End it reverses |
| 3.6 | End Employment on a period that has not started yet | Guidance shown: use Cancel Planned Period if it should never start |
| 3.7 | Change Assignment before a future End, then Reverse End (Admin) | Reversal refused: the assignment closed by End Employment changed since |

## 4. Rehire

| # | Step (role) | Expected result |
|---|---|---|
| 4.1 | On an ended period, Rehire starting today (Editor) | New Period 2, same person and Employee Code; nothing copied (no assignment, no Work Email unless entered); reason required |
| 4.2 | Rehire while the previous end date is still in the future | Action shown as *Plan Rehire* with "The current employment is scheduled to end on <date>…"; earliest start = previous end + 1 day |
| 4.3 | Rehire after a previous End Employment | Warning that the previous End cannot be reversed while the new period exists |
| 4.4 | Cancel Planned Period on the planned Rehire (Editor) | Period shown *Cancelled*; previous period unchanged; Rehire can be planned again |
| 4.5 | Rehire with a past date (Editor) | Refused (HR Admin only) |

## 5. Relationship Change

| # | Step (role) | Expected result |
|---|---|---|
| 5.1 | On a *Service Contractor* or *Intern*, Relationship Change to *Employee* in 20 days (Editor) | Screen shows type change, old end date (day before), new start, assignment impact, Work Email choice (default: none), optional suggested Initial Assignment, and the note that Phase 1 has no automatic reversal |
| 5.2 | Choose the same Employee Type | Not offered / refused |
| 5.2a | Try a Relationship Change after End Employment was recorded | Not offered; if the End was wrong because the relationship continued: Reverse End Employment first, then Relationship Change; a genuine return after a gap is a Rehire (C-79) |
| 5.3 | Save with "Keep current Work Email" | Old period ends with End Reason *Relationship Change*; new period starts the next day with the same address |
| 5.4 | Cancel Planned Period on the NEW period (Editor) | New period *Cancelled*; HR Admin sees: "The planned relationship change was cancelled, but the previous Employment Period is still ended. Review whether Reverse End Employment is required." |
| 5.5 | Reverse End Employment on the old period (Admin) | Old period restored exactly; guidance disappears |

## 6. Cancel Planned Period

| # | Step (role) | Expected result |
|---|---|---|
| 6.1 | Future initial period with a planned assignment → Cancel Planned Period (Editor) | Summary shows type, dates, Work Email, assignment count; afterwards *Cancelled*, person *No Employment Record*; Add Initial Employment Period offered again |
| 6.2 | Period starting today | Cancel Planned Period not offered |
| 6.3 | Period with an End Employment | Save disabled until End is reversed |
| 6.4 | Earlier period when a later one exists | Save disabled |

## 7. Corrections and Work Email

| # | Step (role) | Expected result |
|---|---|---|
| 7.1 | Correct Period: Employee Type to an inactive type (Admin) | Allowed (historical correction); reason required |
| 7.2 | Correct Period on a legacy ended period without End event: Clear the end date (Admin) | Allowed with reason; no event created |
| 7.3 | Clear Work Email (Admin) | Reason required; not account deprovisioning |
| 7.4 | Clear Work Email (Editor) | Not offered; refused by the server |

## 8. Concurrency and errors

| # | Step | Expected result |
|---|---|---|
| 8.1 | Open a form, change the same person in another tab, then save the first form | "This profile was changed by someone else. Reload …" — nothing saved |
| 8.2 | Double-click Save on any action | Recorded once |
| 8.3 | Any refused business rule | Clear English message with the reason and a Request ID |

## 9. Employee list and filters

| # | Step | Expected result |
|---|---|---|
| 9.1 | Look at the Department column for an Active, a Pre-start and an Ended employee | Active: department of today's assignment; Pre-start: first assignment of the upcoming period; Ended: last assignment of the latest ended period; no employment / only cancelled periods: empty |
| 9.2 | Filter Department = the department shown for an Ended employee | The Ended employee is included (the filter matches the displayed department; it is not "active only") |
| 9.3 | Same filter plus Employment Status = Active | The Ended employee is excluded (status restricts the lifecycle) |
| 9.4 | Person currently in ENG with a planned future period in QA | Shown and filtered as ENG until the future period starts |
| 9.5 | Person whose only periods are cancelled | Status *No Employment Record*; not matched by any Department |
| 9.6 | Open a filtered list link, e.g. `/employees?search=UAT&employment_status=ended&department_id=<id>&page=1` | Controls and results match the link; refresh keeps them; changing a filter updates the address bar. Canonical parameters: `search`, `employment_status`, `department_id`, `page` (C-83); other names are ignored |

## 10. Roles

| # | Step | Expected result |
|---|---|---|
| 10.1 | API Docs account | Cannot see or change HR data |
| 10.2 | HR Editor | No "Correct …", "Reverse End Employment", "Clear Work Email"; past-dated business events refused |
| 10.3 | HR Admin | All actions available, including past dates and corrections |

## Key UAT validation topic: PV-25 (accepted for UAT — required before production)

**Effective Employment Period entered by mistake / void effective period (PV-25)** is the highest operational-priority open item. HR accepted it as a known limitation for UAT (2026-10-10); it **must be resolved before Production Readiness**. Today an *effective* Initial Employment or Rehire entered for the wrong person or date has no simple safe recovery workflow (Cancel Planned Period only works before the start date). During UAT, please record:

- how often this happens and in which situations (wrong person, wrong date, duplicate entry);
- how HR expects to fix it and who should be allowed to;
- whether the period may have been used by other processes before the mistake is noticed.

PV-24 (Reverse Relationship Change after it became effective) stays important; record actual occurrences so it can be prioritised by real need.

## Known Phase 1 limitations (expected, not defects)

- No automatic **Reverse Relationship Change** once the new period has started (PV-24).
- No same-day **Cancel Planned Period**: a period starting today is already effective (C-69).
- No **Reverse Rehire** and no way to void an effective period entered by mistake (PV-25 — key UAT validation topic).
- No automatic repair of manager references to periods that were cancelled or ended (C-73; reported by the integrity scan).
- No **Assignment** hard delete (C-46) and no generic **Employment Period** delete.
- Relationship Change requires a known current Employee Type (C-68).
- Legal interpretation (End Reasons, probation, intern/contractor classification, retention) stays outside Core HR workflow logic: **Pending Legal Review** (PL-01 to PL-10).
- Sign-in uses a development test identity; Microsoft Entra configuration is **Pending IT Configuration** (PV-11).
- Other open items in `docs/decision-register.md` (Pending Validation / Legal / IT) remain pending.

## Support tools for UAT

- `npm run integrity:scan` — read-only consistency scan of the local database (ids only, no personal data).
- `npm run test:integrity-baseline` — rebuilds the local test database with valid synthetic data only and requires a clean scan (0 errors, 0 warnings).
