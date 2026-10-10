# Mini HRS — Core HR Phase 1 Local Product Demo (15–20 min)

- Status of the product: **`Core HR Phase 1 — UAT Passed With Pre-Production Actions`**. This is **not** Production Ready.
- This is a **local product/business demo** on a developer machine with **fictional synthetic data only**. It is not a staging rehearsal, not an Entra test and not an infrastructure check.

## Objective and audience

- **Audience:** HR team, HR system owner, management.
- **Objective:** show how HR uses Core HR Phase 1 day to day — the employee list, an employee's profile and employment history, the main lifecycle actions (assignment change, end, rehire, relationship change) and safe recovery from mistakes — and the business rules that keep history trustworthy.

## Prerequisites (presenter, ~5 minutes before)

```bash
npm run db:up
```
```bash
npm run dev
```
```bash
npm run demo:prepare -- --run 2
```

- **URL:** http://localhost:3100
- **Identity:** on the sign-in page choose **Test HR Admin** (role HR_ADMIN). **Local demo authentication only — production Entra authentication is not implemented yet.**
- `demo:prepare` is local-only (refuses anything but the local `hrms_dev`), idempotent and non-destructive. It creates:
  - **Showcase records** `DEMO001`–`DEMO006` (created once; only *viewed* during the demo).
  - **A live-action batch** `DEMO<run>01`–`DEMO<run>06` that the demo changes. Use a **new run number for every demo** (`--run 2`, `--run 3`, … up to 8). Batch 1 (`DEMO101`–`DEMO106`) is already prepared and unused; batch 9 was consumed by the smoke test; batch 8 was used for UI-3/UI-4 visual QA (`DEMO802` has a planned assignment change on 01 Nov 2026; `DEMO801` has QA personal data and a Date of Birth correction). UI-8 QA created two synthetic records through the wizard: `ES0032` (UI8 QA Pre-start) and `ES0033` (UI8 QA No Assignment; UI-9 QA then added its Initial Assignment through the header). In the steps below `DEMOx0n` means the batch of the day (e.g. `DEMO201`).
- Prepare the batch on the day of the demo (the pre-start record starts 14 days after preparation; the Void record starts on the preparation day).
- In the Employee List always search **`DEMO`**: the development database also contains earlier synthetic UAT test records (codes `ES00xx`) that are not part of the story.

## Demo records

| Code | Name (fictional) | Shows |
|---|---|---|
| DEMO001 | Phan Minh Khoa | Active team lead in Engineering (Lead), manager of other demo employees, personal data section |
| DEMO002 | Vũ Hồng Nhung | Active, three assignments over time (QA Junior → QA Middle → Engineering under DEMO001) |
| DEMO003 | Hà Mỹ Linh | Ended employee (Voluntary Resignation, 31 Dec 2025) |
| DEMO004 | Tô Gia Bảo | Rehired: period 2021–2024 ended, new period since Mar 2025 — same person, same code |
| DEMO005 | Lâm Khánh An | Relationship Change: Service Contractor → Employee (Jan 2026), two periods |
| DEMO006 | Mai Xuân Trường | History with a correction: an End entered by mistake and reversed |
| DEMOx01 | Đinh Quang Vinh | Pre-start (starts in 14 days) |
| DEMOx02 | Quách Thảo Vy | Live: Change Assignment |
| DEMOx03 | Kiều Đức Anh | Live: planned End Employment |
| DEMOx04 | Lưu Ngọc Hân | Live: Rehire (ended 30 Jun 2026) |
| DEMOx05 | Trương Bảo Châu | Live: Relationship Change (Service Contractor) |
| DEMOx06 | Đoàn Hữu Phước | Live (optional): Void — a period entered by mistake today |

All names, codes, dates and e-mails (`@example.test`) are fictional.

## Storyline

### Scene 1 — Employee List (2 min)

| Action | Expected | Talking point |
|---|---|---|
| Open **Employees**, type `DEMO` in *Search by code or name* | 12+ demo rows with code, status, department, job title, Employee Type, Operational Profile | One list for the whole workforce; status is computed from employment periods, not typed in |
| *Employment Status* = **Pre-start**, then **Ended**, then **All** | Pre-start: DEMOx01 (and DEMOx04 once rehired). Ended: DEMO003, DEMOx04 | Pre-start = hired but not started yet; Ended = no current or future period |
| *Department* = **Quality Assurance** | DEMOx02, DEMOx04 | Department shown is the one that matters today (or the upcoming/last one for pre-start/ended people) |
| Copy the address bar | Filters are in the URL | A filtered list can be shared or bookmarked |

### Scene 2 — Employee detail (2 min) — **DEMO001**

| Action | Expected | Talking point |
|---|---|---|
| Open DEMO001 | Header: name · DEMO001, **Active**, *Operational Profile: Complete* | Employee Code is permanent and never reused |
| Point to *Operational Profile* checklist | All items ✓ | Completeness is computed by a versioned rule (MVP, pending HR validation) |
| *Personal Information* | Gender, date of birth, mobile, personal e-mail | Personal data is separate from the work e-mail; sensitive data (ID, tax, bank…) is deliberately not collected |
| *Employment History* → Period 1 | Start date, Employee Type *Employee*, Work Email, assignment table (Engineering · Software Engineer · Lead) | Employee Type belongs to the employment period; department/job title/level/manager belong to the assignment |
| Open **DEMO002** | Assignment table with three rows; current row has no *Effective To* and manager *Phan Minh Khoa (DEMO001)* (clickable) | The current assignment is the row still in effect; earlier rows are history |

### Scene 3 — Pre-start (1.5 min) — **DEMOx01**

| Action | Expected | Talking point |
|---|---|---|
| Open DEMOx01 | **Pre-start**; Period 1 starts in 14 days; assignment HR & Administration · HR Executive | HR can prepare a new hire before day one |
| Operational Profile | *Complete* (department and job title come from the assignment of the start date) | Readiness is judged on what will apply on the first day |
| *(optional)* Open **DEMOx05** in the list | *Incomplete* | A Service Contractor without a company account needs a contact e-mail — the rule tells HR what is missing instead of blocking work |

### Scene 4 — Change Assignment (2.5 min) — **DEMOx02**

| Action | Expected | Talking point |
|---|---|---|
| Open DEMOx02 → **Change Assignment** | Form with *Effective Date* (today), Department/Job Title/Level/Line Manager prefilled from the current assignment | A real organisational change, not a data fix |
| Set Department **Engineering**, Job Title **Software Engineer**, Level **Middle**; keep Line Manager *Phan Minh Khoa (DEMO001)*; Reason "Transfer to Engineering after internal application" | *Timeline Impact* shows the old assignment ending and the new one starting today, with the before → after values | HR sees the effect before saving |
| **Save Assignment Change** | "Changes saved."; table: old QA row now has *Effective To* = today; new Engineering row is current | Nothing is overwritten — the old assignment stays in history |

### Scene 5 — End Employment (2 min) — **DEMOx03**

| Action | Expected | Talking point |
|---|---|---|
| Open DEMOx03 → **End Employment** | Form with End Date, End Reason, optional Note, *Timeline Impact* | |
| End Date **30 Nov 2026** (or ~6 weeks ahead), End Reason **Voluntary Resignation** → **Save End Employment** | Status stays **Active**; Events: "**Planned end of employment** — 30 Nov 2026 · Voluntary Resignation" with badge *Current end* | A resignation can be recorded as soon as it is known; the person stays Active until the last day |
| | | The note is kept with the event but not shown in the history; End Reasons are a product classification, not legal grounds |

### Scene 6 — Rehire (2.5 min) — **DEMOx04** (and DEMO004)

| Action | Expected | Talking point |
|---|---|---|
| Open DEMOx04 (Ended, left 30 Jun 2026) → **Rehire** | Form shows the previous period and its End; nothing is copied | A genuine return after leaving |
| Employee Type **Employee**, Start Date **2 Nov 2026** (or any date after the previous end), Work Email `han.luu.r<run>@example.test`, Reason "Returning after a career break" → **Save Rehire** | Same name, **same Employee Code**; Period 1 (2023 – 30 Jun 2026, *Ended*) unchanged; Period 2 (*Pre-start*) | Same person + same Employee Code + new Employment Period; the old period is untouched |
| Note the header *Operational Profile: Incomplete* → in Period 2 click **Add Initial Assignment** (e.g. QA · QA Engineer · Middle) | Profile becomes complete | The new period gets its own assignment — HR confirms it explicitly |
| Open **DEMO004** | Completed rehire: two periods, each with its own history | |

### Scene 7 — Relationship Change (2 min) — **DEMOx05** (and DEMO005)

| Action | Expected | Talking point |
|---|---|---|
| Open DEMOx05 (Service Contractor) → **Relationship Change** | Form: new Employee Type, new start date, Work Email choice, optional Initial Assignment, *Timeline Impact* | Changing the working relationship is a **new period**, not an edit of the old one |
| New Employee Type **Employee**, start **2 Nov 2026**, *Use a different Work Email* `chau.truong.r<run>@example.test`, tick *Add the Initial Assignment* (prefilled, confirm), Reason "Contractor joins as permanent employee" → **Save** | Period 1 (Service Contractor) ends 1 Nov 2026 with End Reason *Relationship Change*; Period 2 (Employee) starts 2 Nov 2026 | History shows exactly when the person was a contractor and when an employee |
| Open **DEMO005** | Completed example: contractor period ended 4 Jan 2026, employee period since 5 Jan 2026 | |

### Scene 8 — History and corrections (2 min) — **DEMO006**, DEMO002

| Action | Expected | Talking point |
|---|---|---|
| Open DEMO006 → *Events* | "Start of employment"; "Planned end of employment — 31 Dec 2026" struck through with badge **Reversed**; "End of employment reversed — … (reverses the end of employment dated 31 Dec 2026)" | An End recorded for the wrong person was reversed — the mistake and its correction both remain visible |
| Point to the *Correct* buttons in the assignment table and **Correct Period** | HR_ADMIN-only historical corrections with a mandatory reason | Corrections fix data-entry mistakes in place, with a reason and audit; real changes use the lifecycle actions |
| Back to DEMO002 assignment table | Three assignment rows over time | Effective-dated history answers "who reported to whom, when" |

### Scene 9 — Void Employment Period (optional, 2 min) — **DEMOx06**

| Action | Expected | Talking point |
|---|---|---|
| Open DEMOx06 (Active since today, "entered for the wrong person") → **Void Employment Period** | Confirmation: "Use Void only when this Employment Period was entered in error and the relationship never existed in reality.", what is kept, what happens | Advanced recovery for genuine data-entry mistakes; not for real leavers |
| Reason "Profile was created for the wrong person" → **Void Employment Period** | Status **No Employment Record**; Period 1 badge **Voided**; events end with "Employment period voided — entered in error"; the reason is not displayed | Person and Employee Code remain; the mistaken period stays as history but no longer counts anywhere; no Unvoid — a correct period is added instead |

### Wrap-up (1 min)

Summarise: one list, computed status, effective-dated history, lifecycle actions that never overwrite history, explicit corrections with reasons, safe recovery. State the limitations below.

## Known limitations to state during the demo

- Sign-in is a **local test identity**; production Microsoft Entra sign-in is not implemented yet.
- No automatic **Reverse Relationship Change** once the new period has started (PV-24, backlog).
- **Void** cannot be undone (no Unvoid in Phase 1).
- **End Reasons** are a product classification, not legal termination grounds (Pending Legal Review).
- The **operational completeness** rule is an MVP decision pending HR validation; no HR/legal completeness rule yet.
- No exports, reports, Leave, Contract or Payroll in Phase 1.
- The development database also contains earlier synthetic UAT records (`ES00xx`); they are test data, not part of the story.

## What this demo does NOT prove

- Entra (Microsoft sign-in) readiness.
- Production hosting, network and TLS.
- Backup and restore.
- Legal / privacy approval.
- Real-data readiness or data onboarding.
- Production security configuration (secrets, database roles, access administration in a real environment).

These are tracked in `docs/production/pre-production-readiness-plan.md` (Gate A / Gate B).

## Pre-demo smoke test (2026-10-10, batch 9)

| Check | Result |
|---|---|
| App starts; `/health` ok; Test HR Admin signs in | ✓ |
| Employee List loads; search `DEMO`; filters Active / Pre-start / Ended / Department (UI and URL) | ✓ |
| Employee Detail and history load (DEMO001–DEMO006, DEMO901) | ✓ |
| Change Assignment on DEMO902 (QA → Engineering, Middle) | ✓ old row closed, new row current |
| End Employment on DEMO903 (30 Nov 2026, Voluntary Resignation) | ✓ Active, "Planned end of employment" |
| Rehire on DEMO904 (2 Nov 2026) + Add Initial Assignment | ✓ same code, Period 1 intact, Period 2 Pre-start; profile Incomplete → Complete after the assignment |
| Relationship Change on DEMO905 (→ Employee, 2 Nov 2026, work e-mail, initial assignment) | ✓ two periods, End Reason Relationship Change |
| Void preview and Void on DEMO906 | ✓ No Employment Record, Voided, history kept |
| `demo:prepare` idempotent (re-run: all skipped); refuses a non-local database | ✓ |
| Integrity scan on `hrms_dev` after preparation | 0 errors, 0 warnings |

## UX notes from preparation (non-blocking, not changed)

| # | Observation | Impact on demo | Suggested follow-up |
|---|---|---|---|
| U1 | The development database mixes earlier UAT records (`ES00xx`, e.g. "UAT PV25 …") with the demo records, also in the Line Manager list | Cosmetic; search `DEMO` | None for the product (test data) |
| U2 | Change Assignment *Timeline Impact* says the old assignment "ends on <date>" and the new one "starts on <date>" (same date; the end is exclusive) | May read as an overlap | Copy: "applies until <date − 1>" (copy-only change, separate approval) |
| U3 | The detail page has no "current assignment" summary at the top; the current row is the one without *Effective To* | Presenter explains it | Optional summary line (separate request) |
| U4 | After Rehire / Relationship Change the header shows *Incomplete* until the new period gets an assignment (by design: nothing is copied) | Use it as a talking point | — |
| U5 | The Relationship Change work-e-mail input has no accessible label | None visually | Add a label (accessibility, copy/markup only) |

No business-rule issue was found.
