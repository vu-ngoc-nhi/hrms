# Mini HRS — Core HR Product Checkpoint

- Date: 2026-10-11 · Mode: **audit / review only** (no Home, no API, no new capability built).
- Milestone unchanged: **Core HR Phase 1 — UAT Passed With Pre-Production Actions**. Not Production Ready (Gate A 0/8, Gate B 0/5, `docs/production/pre-production-readiness-plan.md`).
- Inputs: UI refresh UI-0 … UI-10 plus D-UI-17 (`docs/design/ui-refresh-implementation-map.md`), decision register revision 48, a code reading of the list, detail and completeness services, and a browser walk-through on synthetic `hrms_dev` data (HR Admin test identity, 1366 px).
- Evidence (screenshots, 1366 × 860): 01 Employees · 02 Add Employee Review · 03 Active Overview (DEMO802) · 04 Employment · 05 Assignment · 06 End Employment Drawer · 07 Organization (plus 00 D-UI-17 edit modal). Nothing was saved while capturing them.

---

## A. Executive assessment

**Core HR Phase 1 is coherent and usable for EmeSoft's HR team.** Each primary task has one obvious place. Business actions, data corrections and Advanced (Void) actions are visibly separated. Every write workflow runs in one Drawer or Modal with a preview, and history is preserved. Of tasks A–L, **ten are Clear and two are Acceptable but can improve**. None is Confusing in the normal case.

There is **one material product gap**, and it is a recovery gap rather than a UI defect: **a planned (future-dated) Assignment Change cannot be withdrawn.** Combined with C-28, a resignation dated before an already-planned assignment change blocks End Employment and Relationship Change. HR's only exit is to correct the planned row's date, which is the "date manipulation" anti-pattern in C-84. This is a business decision, recorded as **PV-29 (Pending Validation)**. It is not decided here.

Home is the right next slice. It needs **one lightweight read-only aggregation endpoint**. Headcount and Needs Attention can come from today's API, but Upcoming changes and a Data Quality breakdown cannot be aggregated across employees without new API support.

Remaining visual inconsistencies are minor (§C). None blocks UAT, real-data onboarding or go-live.

## B. Core journey review

### B.1 Journey: Employees → Add Employee → Detail → workflows → Organization

| Step | What HR sees | Verdict |
|---|---|---|
| Employees list (01) | Search by name or code; filters for Employment Status, Employee Type, Department (inactive values marked) and Record Completeness; the count with "status as of"; a Needs Attention icon after the name; the list state is remembered for Back | Clear |
| Add Employee (02) | Four steps (Personal, Employment, Assignment, Review), each with Edit. "Nothing is saved until you review and save." One atomic save. The Employee Code is "Issued when saved"; the override sits under Advanced | Clear |
| Overview (03) | Header: name, code, "Job Title · Department · Employee Type", status badge, one primary action, More actions. Cards: Current Employment, Current Assignment, Upcoming Changes, Basic Information, Record Health | Clear — state is readable in about 5 s |
| Personal | Label-above-value pairs; absent optional values show "—" without warning styling; Edit Personal Information; correction from More actions | Clear |
| Employment (04) | A card per period showing Current / Upcoming / Ended / Cancelled / Voided, the period history, and business actions, then Correct record, then Advanced | Clear |
| Assignment (05) | Current, Upcoming (with "changed from"), Previous, and a muted Cancelled-or-voided section; only Correct on rows | Clear |
| History | A business-readable timeline (rehire labelled neutrally) | Acceptable: corrections, Work Email and personal changes are not shown (no audit-read API, D-UI-7) |
| Workflow Drawer (06) | Title, the record it acts on, an explanation, fields, Timeline Impact, and a blocking message when invalid | Clear; see PV-29 for the blocked case shown |
| Organization (07) | Four tabs; Active / Inactive; no delete; code immutable; Employee Type Work Email policy read-only after creation (D-UI-17) | Clear |

### B.2 Primary HR tasks A–L

| # | Task | Where | Classification | Notes |
|---|---|---|---|---|
| A | Find an employee | Employees: search + 4 filters, URL state | **Clear** | No column sort (ordered by Employee Code); acceptable at ~100 people |
| B | Understand state in ~5 s | Detail header + Overview | **Clear** | Status badge, subtitle, Upcoming card and Record Health are all above the fold at 1366 px |
| C | Create an employee | Add Employee wizard | **Clear** | Can improve: Manager is a plain select (~40 options today); the first assignment's date is fixed to the Start Date (API); no duplicate-person warning (D-UI-8, future) |
| D | Add / change assignment | Header primary (Change Assignment / Add Initial Assignment) | **Clear** | A planned change is visible on Overview and Assignment, but cannot be withdrawn (PV-29) |
| E | End employment | Period card → End Employment (Drawer) | **Acceptable but can improve** | Clear in the normal case. When an assignment is planned after the requested end date the action is blocked with "Correct it first", and no legitimate correction exists (PV-29) |
| F | Rehire | More actions → Rehire / Plan Rehire (Drawer) | **Clear** | History says "New Employment Period started" |
| G | Relationship change | Period card → Change Employment Relationship (Drawer) | **Clear** | Help text states that a new period is created. Same future-assignment block as E |
| H | Correct bad data | Correct record (period), Correct (assignment row), More actions → Correct Name or Date of Birth | **Acceptable but can improve** | Reason, preview and audit are in place. Corrections are invisible in History (D-UI-7). HR_EDITOR cannot correct (by design, C-85). Withdrawing a planned assignment is Missing (PV-29) |
| I | Cancel a planned period | Period card → Cancel Planned Period (Modal) | **Clear** | Latest future period only (C-70) |
| J | Reverse End | Period card → Reverse End Employment, when an Active End Event exists (Modal) | **Clear** | Exact reversal (C-54) |
| K | Void | Period card → Advanced → Void (Drawer with dependency preview) | **Clear** | HR-accepted (C-87); `employment.correct` only |
| L | Maintain reference data | Organization | **Clear** | Can improve: no usage count before Deactivate (needs API, Later) |

No task is **Confusing** in the normal path. The single **Missing** capability is the withdrawal of a planned Assignment Change (§D, PV-29).

### B.3 Information architecture

- **Top level: Home (placeholder "Soon") · Employees · Organization.** This is correct for a ~70–100 person company with a small HR team. Reports, Admin and Documents are **not** reintroduced:
  - Access administration is a guarded CLI (C-89 / C-94), not a UI module.
  - API documentation is `/internal/docs` for `docs.read` only and is not in the navigation.
  - Documents and Contracts are a future module (Later).
- **Detail tabs: Overview · Personal · Employment · Assignment · History.** This is correct. Each tab owns one concept, and Overview summarises without duplicating actions.
- `/` redirects to `/employees` until Home exists. That is the correct interim behaviour.

### B.4 Action hierarchy (confirmed as implemented in UI-9, D-UI-13 / D-UI-16)

| Level | Owner | Actions |
|---|---|---|
| Primary (header) | Representative period | Change Assignment, or Add Initial Assignment when the period has none |
| More actions (header) | Person | Rehire / Plan Rehire / Add Initial Employment Period; Correct Name or Date of Birth |
| Period card — business | That period | Edit Work Email, End Employment, Change Employment Relationship, Cancel Planned Period, Reverse End Employment; assignment actions only for non-representative periods |
| Period card — Correct record | That period | Correct Employment Period, Correct / Clear Work Email (`employment.correct`) |
| Period card — Advanced | That period | Void Employment Period (`employment.correct`) |
| Assignment row | That row | Correct (`employment.correct`) |
| Personal tab | Person | Edit Personal Information |

Every action has one home. Visibility comes from capabilities (`session.can`), never from role names, and the server enforces the same permission. Cancelled and Voided periods expose no mutation (D-UI-14).

### B.5 Record Health — one authoritative source

- **Source:** server-side `completenessView` (`src/modules/core-hr/people/completeness.ts`, rule `operational-mvp-2026-10-08.2`, MVP Decision; PV-03 email rule, C-78 pre-start readiness).
  - The **list** (`operational_completeness`) and the **detail** (`completeness.operational.items`) use the same function and the same `completenessAssignment` rule.
  - The UI never recomputes it.
- **Items (approved):** Full Name; Work Email (or Contact Email, per Employee Type and Start Date); Start Date; an Employment record; Department; Job Title; Employee Type.
- **Not available without new API support:**
  1. Which item is missing, per person, in the list (the list returns status only).
  2. Counts per missing item across employees.
  3. When a record became incomplete (no history of a computed value).
- HR completeness is **not defined** (PV-04). Legal completeness is **Pending Legal Review**. Neither may be shown as a defect.

### B.6 Upcoming changes

- **Employee Detail derives locally** from the detail payload (pure view models):
  - a future start (Pre-start period);
  - a planned end date (with or without an Active End Event);
  - future-dated assignment rows (`effective_from > status_as_of`);
  - a successor created by a Relationship Change;
  - a planned rehire.
- **Cannot be aggregated across employees today:**
  - The list item has no end date and no future-assignment information.
  - `employment_status=not_started` gives Pre-start people with their start date, which covers starts only.
  - There is no cross-employee events endpoint.
  - A future Home "Upcoming" therefore needs the read-only Upcoming Events endpoint already approved in principle (D-UI-3).

## C. Remaining UX inconsistencies

| # | Item | Where | Severity | Recommendation |
|---|---|---|---|---|
| C1 | "Record Completeness" filter label vs "Record Health" on Overview (the option "Needs Attention" is consistent) | Employees filter | Low | Rename the filter label to "Record Health" (copy-only, i18n) |
| C2 | Native date inputs render in the browser/OS locale (e.g. `11/10/2026`) while the app displays `11 Oct 2026`, so dd/mm vs mm/dd is ambiguous | All date fields | Medium-low | Keep native inputs for now. Echo the chosen date in project format beside the field, or adopt one date field primitive later |
| C3 | The `en-GB` month abbreviation "Sept" (`02 Sept 2024`) vs three letters elsewhere | Dates | Low | Fix in `formatDate` (copy-level) |
| C4 | The ten pre-UI-0 workflow forms keep legacy markup (`card` / `row`, inline `style={{…}}`, an unused inline launcher branch). Inside the Drawer they render acceptably, but spacing is uneven (large gap above actions; Timeline Impact as plain bullets) | `src/app/employees/[id]/*Form.tsx` | Low (technical) | One cleanup pass onto the UI primitives; no behaviour change |
| C5 | The Record Health footnote "Completeness rule: MVP decision, pending HR validation." uses governance wording in an HR screen | Overview | Low | Plainer copy, e.g. "Checked against the current minimum record rule." |
| C6 | Login (development test identity) and `/internal/docs` keep the older look | Dev-only screens | None for HR | Login is replaced by Entra sign-in (Gate A3); docs page is technical |
| C7 | History does not show corrections, Work Email or personal-data changes | History | Medium (understanding) | Already documented (D-UI-7); an audit-read view is Later (Gate C "Audit viewer for HR") |

No screen keeps the pre-refresh look in an HR-facing path. The legacy token aliases (`--accent`, `--muted`) are no longer used by `globals.css`.

## D. Product gaps

| Item | Current state | User impact | Recommendation | Priority |
|---|---|---|---|---|
| **Withdraw a planned Assignment Change (PV-29)** | A future-dated assignment row can only be corrected in place (HR_ADMIN). It cannot be withdrawn. End Employment and Relationship Change are blocked while it starts after the requested date (C-28) | **Deadlock:** an employee with a planned 1 Nov change resigns effective 31 Oct, and HR cannot record the End without falsifying the planned row's date | HR decision needed. Options: (1) a "Withdraw planned assignment change" action (future rows only, reason, audit, previous row's end restored — mirrors Cancel Planned Period); (2) let End Employment offer to withdraw the blocking future rows inside its preview; (3) keep as a documented limitation (technical owner fixes). **Recommended: (1)** — the smallest control that preserves integrity. Not a UI blocker | **P0 before go-live** (decision first) |
| Duplicate-person detection | None; only exact Employee Code / Work Email conflicts (D-UI-8) | A person could be created twice by mistake; recoverable only by Void (if periods exist) or not at all for the person | Lightweight warning (same name + DOB, or same personal email) at Review; needs an HR decision on matching rules. Onboarding duplicates are handled by reconciliation (A7 / B1) | P1 |
| Audit-read History | Not available (D-UI-7) | HR cannot see who corrected what. The technical owner can query on request | Read-only audit view behind an existing permission | Later (Gate C) |
| Export | Deferred pending Legal / Privacy (D-UI-5) | HR copies from the screen | After legal review | Later (Pending Legal Review) |
| Searchable Manager picker | Plain select | Slower at 100+ people | Type-to-filter select (UI only, same data) | P1 |
| Usage count before Deactivate | Not shown | HR may deactivate a value still used by current assignments (allowed, C-44) | Show "used by N current assignments" (needs a count in the catalog API) | Later |
| Reverse Relationship Change (PV-24) | Not available | Recovery is via Cancel Planned / Void | Prioritise by UAT frequency | Later |

**Not UI blockers:** Legal / privacy (A1), platform (A2), Entra sign-in (A3), access-administration owners (A4, PV-26 / PV-28), backup / restore (A5), deployment rehearsal (A6), onboarding method and real catalogs (A7, PV-05 / PV-06 / PV-08), the Go / No-Go (A8), and all Gate B items. These gate real use, but no UI work resolves them.

## E. Home requirements

### E.1 Data Quality — definition (approved rules only)

- **Data Quality = the operational Record Health rule applied to all people.**
  - The count of people whose operational record is incomplete.
  - Broken down by missing item: Work Email / Contact Email, Department, Job Title, Employee Type, Start Date / Employment record, Full Name.
- **Not defects:** Manager, Level, Date of Birth, Gender, Mobile and Personal Email. (Personal Email counts only as the Contact Email alternative under PV-03, never on its own.)
- **No score, percentage grade or ranking.**
- **Not included without a decision:**
  - inactive catalog values on current assignments (allowed, C-44);
  - suspected duplicates (D-UI-8);
  - HR completeness (PV-04);
  - legal completeness (Pending Legal Review).
- The technical integrity scan (`npm run integrity:scan`) is an operations control (Gate B2), **not** an HR Home widget.

### E.2 Four Home questions and their inputs

| Question | Inputs | Classification |
|---|---|---|
| 1. How many people do we have (Active, Pre-start), optionally by department? | `GET /employees?employment_status=active&page_size=1` → `total` (likewise for `not_started`); a department snapshot needs one call per department | **Existing endpoint** for headcount. The department snapshot is possible but chatty (N calls), and fits better in the aggregation endpoint |
| 2. Who needs attention? | `GET /employees?operational_completeness=incomplete` → count + rows | **Existing endpoint** (count + names). *Why* each person needs attention is unavailable without per-person detail calls |
| 3. What is coming up (next 30 days: starts, planned ends, assignment changes)? | Starts are partly available via `not_started`; planned ends and future assignment changes are not available | **One lightweight aggregation endpoint** (D-UI-3) |
| 4. How good is our data (Data Quality by item)? | Counts per missing item | **One lightweight aggregation endpoint** (same computation as Record Health). N+1 detail calls are **not worth it** |

### E.3 Minimum Home layout

1. **Headcount:** Active · Pre-start (each links to the filtered Employees list). Optional compact department snapshot (counts per active Department, text / table, no chart).
2. **Needs Attention:** the count plus the first ~5 people (name, code, missing items), each linking to the employee's Overview → Record Health. "View all" goes to Employees filtered to Needs Attention.
3. **Upcoming (next 30 days):** a date-ordered list of starts, planned ends and assignment changes, each linking to the employee's relevant tab. Empty state: "Nothing planned in the next 30 days."
4. **Data Quality:** counts per missing operational item, each linking to the filtered list (the list filter exists for the status; per-item filtering is optional).

No decorative charts, AI, analytics, notifications or trend lines. "Status as of" is shown once. Capability gating is `employees.read`, and no personal fields are needed.

## F. Home API options (recommendation only — nothing implemented)

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A. Compose from existing endpoints** | Several `GET /employees` calls with `page_size=1` and filters; one per department for the snapshot | No backend change | No Upcoming; no Data Quality breakdown; 4–10 calls with possibly different "as of" moments; Home would be half-empty |
| **B. One read-only `GET /api/v1/core-hr/hr-dashboard`** | `{ status_as_of, rule_version, headcount: {active, pre_start}, departments: [{id, name, active}], needs_attention: {total, by_item: {code: n}, sample: [{id, code, name, missing: [codes]}]}, upcoming: {days: 30, items: [{date, kind: start\|planned_end\|assignment_change, person: {id, code, name}, period_id}]} }`; permission `employees.read`; computed with the shared operational query module and `completenessView` | One authoritative computation and one "as of"; Record Health and Upcoming identical to the detail; one permission check; small at EmeSoft scale (in-memory like the list); fulfils D-UI-3 | A new API (needs approval and OpenAPI); must stay a fixed summary, not a reporting engine |
| **C. Split** | Keep the list for headcount and Needs Attention; add only `GET /upcoming-events?days=30` (D-UI-3); add `missing_items` to list rows | Each piece reusable | Three changes instead of one; Data Quality still needs a full list scan in the browser; more contract surface |

**Recommendation: Option B.** It is one small, read-only endpoint that reuses the shared query module and the completeness function, so Home can never disagree with Employee Detail. It also absorbs the already-approved Upcoming Events endpoint (D-UI-3).

Guardrails:
- No personal fields.
- No filters beyond `days` (fixed 30, max 90).
- No caching layer.
- No scoring.
- Operational periods only (`cancelled_at IS NULL AND voided_at IS NULL`).

Approval of the endpoint is required before UI-1 Home starts.

## G. Phase 1 scope recommendation (freeze)

| Priority | Items |
|---|---|
| **P0 before first real-data use** | Gate A1–A8 (legal / privacy, platform, Entra sign-in, access administration + named owners, backup + restore rehearsal, deployment rehearsal, onboarding method with real catalogs PV-05 / PV-06 / PV-08, signed Go / No-Go). None is UI work |
| **P0 before go-live** | Gate B1–B5. **PV-29 decision and, if approved, the withdrawal action** (a recovery gap in daily operations) |
| **P1 (Phase 1 polish, after the checkpoint)** | **UI-1 Home** (minimum layout §E.3 with Option B endpoint, after approval); copy fixes C1 / C3 / C5; workflow-form cleanup C4; searchable Manager picker; duplicate-person warning (after an HR matching decision, D-UI-8) |
| **Later** | Audit-read History (Gate C); Export (Pending Legal Review, D-UI-5); Documents / Contracts module; configurable Access Roles / in-app access screen (Gate C, C-85); reports beyond Home counts; notifications; org chart; usage counts before Deactivate; Reverse Relationship Change (PV-24); Working Arrangement (PV-15); probation module (PV-16) |

**Freeze rule:** nothing outside P0 / P1 enters Phase 1 without a new decision in the register.

## H. Recommended next step

1. **HR decides PV-29** (withdraw a planned Assignment Change; recommended option 1). If approved, it becomes a small S4-style slice before go-live.
2. **Approve or reject the Option B endpoint** (`GET /hr-dashboard`, read-only, `employees.read`).
3. Then **UI-1 Home** with the minimum layout in §E.3, plus copy fixes C1 / C3 / C5 in the same pass.
4. In parallel, Gate A work continues (IT / Legal / HR owners). Real employee data stays prohibited until A8.
