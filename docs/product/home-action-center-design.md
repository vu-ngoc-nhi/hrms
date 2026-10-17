# UI-1 Home / Action Center — product and API contract design (revision 2: approved and implemented)

- Status: **Implemented and validated (2026-10-11)** — BD-H1 … BD-H9 approved (register **C-100**). Revision 1 design below; the implemented contract and evidence are in §K (it supersedes §D where they differ).
- Date: 2026-10-11.
- Inputs:
  - Core HR product checkpoint (`docs/design/core-hr-product-checkpoint.md` §E–F; Option B recommended);
  - D-UI-3 (a small read-only Upcoming endpoint approved in principle);
  - PV-29 / C-99 (Cancel Planned Assignment, implemented);
  - C-76 / C-78 (representative period / assignment, completeness readiness);
  - PV-03 (email rule);
  - C-84 (lightest sufficient control);
  - C-85 (permissions, not roles).
- Scale assumption: ~70–100 people at first go-live (hundreds at most in Phase 1).
- Decisions are marked **BD-H*n*** (business, need approval) or **T-*n*** (technical, follow from approved rules).

---

## A. Home goals

Home answers four practical HR questions. It is neither a report nor a work queue.

| # | Question | Answered by |
|---|---|---|
| 1 | What is the current workforce state? | Workforce Snapshot |
| 2 | Which employee records need attention? | Needs Attention |
| 3 | What changes are coming soon? | Upcoming — next 30 days |
| 4 | Is Core HR operational data healthy? | Needs Attention (same authoritative state; see §B.2). The integrity scan stays an engineering control (§B.4) |

Out of scope: analytics, trends, workforce planning, notifications, AI insights, tasks/assignment of work, charts.

## B. Final sections

### B.1 Three sections, not four

1. **Workforce Snapshot** (top strip): Active · Pre-start · Ended.
2. **Needs Attention** (main left): the number of records, a breakdown by missing requirement, and up to 5 records.
3. **Upcoming — next 30 days** (main right): up to 10 dated business changes.

### B.2 Data Quality merges into Needs Attention — BD-H2

- A separate Data Quality card would show the same authoritative state (operational completeness) twice: once as a count of people and once as counts per missing item.
- Needs Attention already carries both: the total and `by_requirement`.
- There is no other approved data-quality rule to show. HR completeness is not defined (PV-04); legal completeness is Pending Legal Review; duplicates are D-UI-8.
- A second card would therefore be redundant, or an invented score.
- **Recommendation: merge.** "Is the data healthy?" is answered by the Needs Attention empty state "No records need attention."

### B.3 Department snapshot — deferred — BD-H3

- "Employees by Department" does not support a daily HR decision at EmeSoft's size.
- The Employee List already filters by department when HR needs it.
- As a chart it would be decorative. **Deferred** (no chart library in Phase 1).

### B.4 Integrity scanner — not on Home — BD-H4

- `npm run integrity:scan` is an engineering / data-integrity control. Its findings name technical invariants and ids, not HR actions; it runs on demand / in operations (Gate B2).
- A "Core HR data check passed" badge would claim more than Home can prove, because the scan is not run per request.
- **Recommendation: keep the scanner outside HR Home in Phase 1.** Any scan failure is handled by the technical owner (support model B3).

### B.5 "Employee Records" total — not shown — BD-H1

- A total of all person records mixes current, future and historical people; it is not a headcount.
- The API returns it for completeness and future use, but **Home does not display it** in Phase 1.
- People with no valid Employment Period (e.g. only a cancelled or voided period) are not a snapshot tile. They appear in Needs Attention because the authoritative rule reports them incomplete (§C.2).

## C. Exact business semantics

### C.1 Workforce Snapshot

- One person counts once, by `employment_status`. This is the same computation as Employee List / Employee Detail: `representativeEmployment` + `employmentStatus` over operational periods only (`cancelled_at IS NULL AND voided_at IS NULL`), evaluated at the Asia/Ho_Chi_Minh business date.

| Tile | Meaning | `employment_status` | Link (existing canonical list URL) |
|---|---|---|---|
| **Active** | People employed today (a valid period covers today) | `active` | `/employees?employment_status=active` |
| **Pre-start** | People whose next valid period starts after today and who are not active today | `not_started` | `/employees?employment_status=not_started` |
| **Ended** | People whose valid periods have all ended (no current or planned period) | `ended` | `/employees?employment_status=ended` |

- **Active** is the only tile that is a current headcount. The label is "Active", never "Headcount" or "Total Headcount".
- A person with a planned end date is still **Active** until that last day has passed. A cancelled planned assignment (PV-29) never changes status, because status depends on periods only.
- The UI labels re-use the existing status labels (Active, Pre-start, Ended).

### C.2 Needs Attention

- **Authoritative rule:**
  - `completenessView(...).operational` — rule `operational-mvp-2026-10-08.2` (MVP Decision; PV-03 email rule; C-78 pre-start readiness).
  - Computed per person exactly as the Employee List computes `operational_completeness`: same facts, `completenessAssignment` and operational assignments only (PV-29).
  - No new rule and no severity.
- **Total:** the number of **people** whose operational status is `incomplete`. One person counts once, however many items are missing.
  - The total equals the Employee List total for `?operational_completeness=incomplete`, which is the "View all" target.
- **`by_requirement`:** for each operational item code, the number of people for whom that item is unsatisfied. A person missing two items appears in two rows; the rows are therefore not summed into the total, and the UI never shows a sum.
- **Item codes** (the existing completeness codes; labels come from the UI catalogue already used by Record Health):

| Code | UI label (existing) | When unsatisfied (authoritative) |
|---|---|---|
| `work_email` | Work Email | From the Start Date, when the Employee Type expects a company account (`requires_work_email`) or the type is unknown |
| `contact_email` | Contact Email (work or personal) | Before the Start Date, or for types without a company account: neither work nor personal email |
| `department` | Department | No operational assignment ready for the period (C-78) |
| `job_title` | Job Title | Same as above |
| `employee_type` | Employee Type | The representative period has no Employee Type |
| `start_date` | Start Date | No valid Employment Period |
| `employment_status` | Employment Status | No valid Employment Period |
| `full_name` | Full Name | Shorter than 2 characters |

- **Never defects:** Manager, Level, Date of Birth, Gender, Mobile, Personal Email (except where Personal Email is the PV-03 *contact* alternative, already inside the rule). None of these are completeness items, and Home adds none.
- **Raw items, no collapsing — BD-H9:**
  - A person with no valid Employment Period fails `start_date`, `employment_status`, `department`, `job_title` and `employee_type` together. This is exactly what their Record Health on Employee Detail lists.
  - Home reports the same raw items, so Home and Detail never disagree.
  - Alternative (not recommended for Phase 1): present such people as one reason "No Employment Period". That would be a presentation grouping the rule does not define.
- **Preview list:** up to **5** people, each with `missing` codes. Deterministic order (BD-H5):
  1. Active;
  2. Pre-start, nearest start date first;
  3. No employment record;
  4. Ended;
  5. then `employee_code` ascending, then person id.
  - Rationale: current and imminent records affect operations first. This is an ordering by existing status facts, not a severity score.
- **Scope = the canonical list filter (BD-H5):** all statuses are included (an incomplete Ended legacy record also counts), so the Home total always equals "View all".
- **PV-29:** cancelling a planned Initial Assignment can make a record incomplete (`department`, `job_title`). It then appears here because the authoritative rule says so; cancelled assignments themselves are never read.

### C.3 Upcoming — next 30 days

- **Window — BD-H6:** business dates in Asia/Ho_Chi_Minh, with `T` = today:
  - Starts and assignment changes: `T + 1 … T + 30` inclusive. A change effective today is already in effect and is not "upcoming".
  - **Planned ends:** the last day falls in `T … T + 30`. A period whose last day is today is still shown, because today is the last working day. This is the same rule Employee Detail's Upcoming Changes already applies ("a planned end counts from today, its last day").
- **Sources — operational records only:**
  - periods with `cancelled_at IS NULL AND voided_at IS NULL`;
  - assignments with `cancelled_at IS NULL` (PV-29: cancelled planned assignments never appear).
  - Nothing is read from audit, so there are no historical corrections.
- **Derivation:** the existing pure Upcoming Changes semantics of Employee Detail (`upcomingChanges` in `detailModel.ts`), moved to a shared module so both use one implementation (T-2).

| `type` | Produced when | Date | Duplicate rule |
|---|---|---|---|
| `employment_start` | The person's **first** valid period starts in the window | Start date | Its first assignment is described with it (no separate assignment item) |
| `new_employment_period_start` | A **later** valid period starts in the window and is **not** a Relationship Change successor | Start date | Neutral wording "New Employment Period starts" — never "Rehire" (same decision as History, consistency review) |
| `relationship_change` | A later valid period starts in the window **and** the previous valid period's Active End Event has End Reason `RELATIONSHIP_CHANGE` **and** that period's end date is the day before the new start | New period's start date | **One item**: the predecessor's planned end is not listed separately, and no separate start item is produced |
| `employment_end` | A valid period's end date (last day) is in the window and it was not merged into a Relationship Change | End date (last day) | One per period; an End Event is not required (a planned end date without an End event is also a planned end) |
| `assignment_change` | A valid assignment of a valid period takes effect in the window, except the first assignment of a period starting in the window | `effective_from` | When the first assignment of an already-Active period is planned later, `previous` is `null` (an initial assignment that takes effect later) |

- **Relationship Change rule (§15 of the brief):** the merge uses only authoritative recorded facts — the structured End Reason `RELATIONSHIP_CHANGE` on the Active End Event plus exact date adjacency (C-63 to C-67), as Employee Detail already does.
  - No heuristic such as "type changed" or "dates are close".
  - If the successor was cancelled (C-72), the predecessor's end stays as an `employment_end` item. It is not presented as a relationship change, because no new period will start.
- **Ordering — T-4:** `effective_date` ascending. Same date: lifecycle order `employment_end`, `relationship_change`, `employment_start`, `new_employment_period_start`, `assignment_change` (the existing Upcoming Changes `KIND_ORDER`); then `employee_code`, then person id.
- **Cap:** at most **10** items; `total` = all items in the window (BD-H8).

### C.4 "View all" navigation — T-5

| Section | Target |
|---|---|
| Snapshot tiles | `/employees?employment_status=active` / `not_started` / `ended` (existing filters) |
| Needs Attention "View all" | `/employees?operational_completeness=incomplete` (existing filter; same population and total) |
| Needs Attention breakdown rows | **Not linked** in Phase 1: the list has no per-requirement filter, and adding one is not needed for Home (deferred) |
| Upcoming | Each item links to the person's Employee Detail on the relevant tab (Employment for starts / ends / relationship changes; Assignment for assignment changes). **No Upcoming list or module (BD-H8)**: when `total > 10`, the UI says "Showing the next 10 of N changes." with no link |

### C.5 Empty states (positive)

| Section | Empty text |
|---|---|
| Snapshot | Tiles show 0 (no special state) |
| Needs Attention | "No records need attention." (+ "Every employee record meets the current minimum record rule.") |
| Upcoming | "No upcoming changes in the next 30 days." |
| Whole Home, no employees at all | "No employee records yet." with the Add Employee action when the user has `employees.create` |

## D. API contract

### D.1 Operation

| Item | Value |
|---|---|
| Route | **`GET /api/v1/core-hr/dashboard`** (one read-only aggregation; Option B of the checkpoint; absorbs D-UI-3) |
| operationId / tag | `getCoreHrDashboard` / `Dashboard` |
| Permission | **`employees.read`** (no new permission, C-85) |
| Query | **None.** Declared as a strict empty object, so any query parameter → `400 VALIDATION_ERROR`. The window (30) and the limits (5, 10) are fixed in Phase 1 (T-6) |
| Side effects | None: no audit, no revision change, no write |
| Caching | `Cache-Control: no-store` (personal identity fields; same as other Core HR reads) |

### D.2 Response `200` — schema `CoreHrDashboard`

Naming follows the existing contract: snake_case, `status_as_of` (as in Employee List / Detail), `total` for counts, a person reference with `person_id`. There are no labels, colours, icons or prose; the UI composes text through `src/i18n`.

```jsonc
{
  "status_as_of": "2026-10-11",              // Asia/Ho_Chi_Minh business date used for every section
  "snapshot": {
    "active": 61,
    "not_started": 3,                          // UI label "Pre-start" (existing status code)
    "ended": 14,
    "employee_records": 79                     // all person records incl. no-employment; returned, not shown (BD-H1)
  },
  "needs_attention": {
    "total": 4,                                // people, each counted once
    "rule_version": "operational-mvp-2026-10-08.2",
    "by_requirement": [                        // only codes with count > 0, in the fixed item order of the rule
      { "code": "work_email", "count": 2 },
      { "code": "department", "count": 1 },
      { "code": "job_title", "count": 1 }
    ],
    "records": [                               // ≤ 5, ordered as §C.2
      {
        "person_id": "uuid",
        "employee_code": "ES0035",
        "full_name": "…",
        "employment_status": "not_started",
        "missing": ["department", "job_title"] // item codes, rule order
      }
    ]
  },
  "upcoming": {
    "window_days": 30,
    "from": "2026-10-11",                      // first business date considered (planned ends count from today)
    "to": "2026-11-10",                        // last business date included (T + 30)
    "total": 2,
    "items": [                                 // ≤ 10, ordered as §C.3
      {
        "type": "relationship_change",         // employment_start | new_employment_period_start | relationship_change | employment_end | assignment_change
        "effective_date": "2026-11-01",
        "person": { "person_id": "uuid", "employee_code": "ES0040", "full_name": "…" },
        "employee_type": { "id": "uuid", "name": "Service Contractor" },        // starts and relationship_change: the (new) period's type; else null
        "previous_employee_type": { "id": "uuid", "name": "Employee" },        // relationship_change only; else null
        "assignment": { "department": { "id": "uuid", "name": "Engineering" }, "job_title": { "id": "uuid", "name_en": "Software Engineer" } }, // the assignment that takes effect (starts, assignment_change); else null
        "previous_assignment": null             // assignment_change: the assignment it replaces; null for a later initial one
      }
    ]
  }
}
```

- **Deliberately absent:** Employee Detail payloads; period / assignment / event ids; End Reason (BD-H7); reasons and notes; audit actor or time; Manager; Level; work or personal email; DOB; Gender; Mobile.
- `employment_end` items carry only `type`, `effective_date` and `person`. The other fields are `null`.
- All `*_id` values are catalog / person ids already exposed by the list; only `person_id` is needed for navigation.

### D.3 Errors (one unit, no partial sections)

| Status | When |
|---|---|
| 200 | Always, including empty results (zeros, empty arrays) |
| 400 `VALIDATION_ERROR` | Any query parameter is supplied |
| 401 `UNAUTHENTICATED` | Missing / invalid token |
| 403 `FORBIDDEN` | No `employees.read` (also disabled accounts) |
| 500 `INTERNAL_ERROR` / 503 `SERVICE_UNAVAILABLE` | Any failure. The whole response fails, with no silently missing section. The UI shows one error box with the request id and a retry |

## E. Query reuse (no dashboard-specific rules) — T-1 … T-3

| Concern | Reused source | Note |
|---|---|---|
| Operational periods | `operationalEmploymentWhere` / `operationalPeriods` (`employments/queries.ts`) | Cancelled / voided never counted |
| Operational assignments | `operationalAssignmentWhere` (PV-29) | Cancelled planned assignments never read |
| Status per person | `representativeEmployment` + `employmentStatus` (`employments/status.ts`) | The same as list / detail |
| Completeness per person | `completenessView` with the list's facts builder (`completenessAssignment`, C-78) | **T-1:** extract the list's row projection (`toListItem` facts) into one shared function used by both the Employee List and the dashboard, so the two cannot drift |
| Upcoming | Employee Detail's `upcomingChanges` semantics | **T-2:** move the pure derivation (currently in `src/app/employees/[id]/detailModel.ts`) to a shared pure module (e.g. `src/modules/core-hr/employments/upcoming.ts`) consumed by Overview and the dashboard; one implementation, one test suite |
| Active End Event | `activeEndEventOf` (`lifecycle-events.ts`) | For the Relationship Change merge |
| Business date | `todayInVietnam(now)` once per request, passed to every section | **T-3:** the service takes `now` (default `new Date()`) so tests can pin the instant |

- **Execution:** one service, two or three reads in one read transaction (`REPEATABLE READ`, read-only) so every section sees the same snapshot:
  - persons with operational periods, their operational assignments, Employee Types and events;
  - computation in memory with the shared pure functions — the same strategy the Employee List already uses for derived filters at MVP scale.
- No SQL re-implementation of status or completeness. No materialized views, caches or background jobs: about 100 people, a few hundred rows.
- **Revisit trigger:** if Phase 2 grows beyond ~2,000 person records, measure first.

## F. Privacy and permissions

- **`employees.read`** only. Holders already see every field returned here on Employee List / Detail (name, code, status, completeness, department, job title, employee type).
- **No `employees.read_personal` data:** no DOB, Gender, Mobile or Personal Email values.
  - `contact_email` in `missing` states only that neither email exists, as Record Health already does for `employees.read` users.
- No Work Email values. No free-text reasons, notes, End Reasons, audit actors or timestamps.
- UI visibility: the Home navigation item and page require `session.can("employees.read")`. A user without it gets the existing "no permission" state. No role-name checks.
- No new permission (C-85). Scope (self / team / department) stays an extension point; the endpoint is whole-company like the list.

## G. UI layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Home                                            Status as of 11 Oct 2026   │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                        │
│ │ Active   61  │ │ Pre-start 3  │ │ Ended    14  │   (compact link tiles) │
│ └──────────────┘ └──────────────┘ └──────────────┘                        │
├──────────────────────────────────────┬────────────────────────────────────┤
│ Needs Attention               4      │ Upcoming — next 30 days      2     │
│ Work Email 2 · Department 1 · …      │ 01 Nov  Relationship change        │
│ ─────────────────────────────────    │         Name (ES0040) Employee →   │
│ Name (ES0035) · Pre-start            │         Service Contractor         │
│   Missing: Department, Job Title  →  │ 16 Nov  Assignment change          │
│ …(≤5)                                │         Name (ES0034) QA → Eng.    │
│ View all records needing attention → │ (Showing the next 10 of N …)       │
└──────────────────────────────────────┴────────────────────────────────────┘
```

- **Desktop / laptop first:** at 1280 px the snapshot strip plus the two columns (about 60 / 40 or 50 / 50) fit above the fold with 5 + 10 rows. The page uses existing UI primitives (Card, PageHeader, StatusBadge, EmptyState, InfoBox) and tokens. There is no chart library and no fourth box.
- **Below ~1024 px:** the two columns stack (Needs Attention first, then Upcoming); tiles wrap. No horizontal scroll at 375 px.
- The sidebar "Home — Soon" placeholder becomes the live Home. `/` keeps redirecting to `/employees` until UI-1 ships, then redirects to Home.
- Upcoming item text (i18n) reuses the Overview Upcoming Changes wording:
  - "Employment starts" / "New Employment Period starts" / "Employment relationship changes: X → Y" / "Employment ends (last day)" / "Assignment change: Dept / Title → Dept / Title" (or "Assignment takes effect" when `previous_assignment` is null).
- Tile labels and item labels come from the existing status and completeness catalogues.

## H. Test plan

**Service / contract tests** (`hrms_test`, synthetic data, pinned `now`):

| Area | Cases |
|---|---|
| Snapshot | Active; Pre-start; Ended; a person with no valid period (only cancelled / voided) counted in none of the three but in `employee_records`; a planned end still Active; status equal to the list's status for the same person |
| Needs Attention | Complete person absent; incomplete counted once with two missing items (total 1, two `by_requirement` rows); Work Email policy (type expects it after start → `work_email`; Service Contractor with only a personal email → complete; pre-start → `contact_email`); missing assignment (`department` + `job_title`); C-78 pre-start assignment starting after the period start → incomplete; optional fields (no Manager / Level / DOB / Gender / Mobile) → complete; PV-29 cancelled initial assignment → incomplete; total equals list `operational_completeness=incomplete` total; preview ≤ 5 and ordering (Active → Pre-start by start → no employment → Ended → code) |
| Upcoming | Future first start; future Rehire / new period → `new_employment_period_start` (never "rehire"); planned End with and without an End event; future assignment change; later initial assignment (`previous_assignment` null); Relationship Change → exactly one `relationship_change` item (no `employment_end`, no start); RC successor cancelled → `employment_end` only; cancelled period excluded; voided period excluded (incl. its assignments); cancelled planned assignment excluded; effective today excluded for starts / changes but last-day-today included for ends; T+30 included, T+31 excluded; cap 10 with correct `total`; same-date ordering |
| Time zone | `now` = 16:59:59Z (still the previous VN date) vs 17:00:00Z (next VN date): `status_as_of`, window bounds and today / tomorrow classification move together |
| Permissions | HR_ADMIN / HR_EDITOR 200; API_DOCS_READER, no-role and disabled accounts 403; unauthenticated 401 |
| Contract | Response parses with `CoreHrDashboardSchema`; OpenAPI generated and validated; no forbidden keys (`date_of_birth`, `gender`, `mobile_phone`, `personal_email`, `work_email`, `reason`, `end_reason`); any query parameter → 400 |
| Consistency | Shared projection and shared upcoming module: Employee List, Detail Overview and dashboard return identical status / completeness / upcoming for the same fixtures (T-1, T-2 regression) |

**UI unit tests:**
- section models;
- labels from i18n (no hard-coded strings);
- empty states;
- "View all" URLs equal the canonical list URLs;
- capability gating;
- no role names;
- no chart dependency.

**Visual QA:**
- 1280 and 1440 px with data;
- all-healthy empty states;
- more than 10 upcoming;
- a narrow (stacked) layout.

## I. Deferred dashboard ideas

| Idea | Why deferred |
|---|---|
| Employees by Department (chart or table) | Not a daily HR decision at this size; the list filter covers it (BD-H3) |
| Separate Data Quality card / score / percentage / traffic light | Redundant with Needs Attention; no approved rule beyond operational completeness (BD-H2) |
| Integrity scan status on Home | Engineering control (BD-H4) |
| Upcoming list / module, calendar view, configurable window | Home summary only; detail tabs cover drill-down (BD-H8) |
| Per-requirement list filter ("View all missing Work Email") | Needs a new list filter; not needed for Phase 1 Home |
| End Reason on Home | Minimization (BD-H7) |
| Probation, contract expiry, birthdays, work anniversaries, leave | Not Core HR Phase 1 (PV-16, later modules; DOB is personal data) |
| Notifications / email digests / tasks | Out of Phase 1 |
| Trends, turnover, analytics, AI insights | Out of Phase 1 |

## J. Business decisions (approved 2026-10-11)

| ID | Decision | Recommendation | Type |
|---|---|---|---|
| BD-H1 | Snapshot shows **Active · Pre-start · Ended** only. No "Employee Records" total on Home (the API returns it). No-employment people appear via Needs Attention, not as a tile. Never "Headcount" | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| BD-H2 | **Merge** Data Quality into Needs Attention (total + breakdown); no separate card, no score | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| BD-H3 | **Defer** the department snapshot | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** — superseded 2026-10-16 by the owner-approved Home dashboard refresh (§L, register C-119) |
| BD-H4 | Integrity scanner **not** on HR Home in Phase 1 | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| BD-H5 | Needs Attention population = the canonical list filter (all statuses, incl. Ended and no-employment); preview order Active → Pre-start (nearest start) → no employment → Ended → code; preview 5 | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| BD-H6 | Upcoming window 30 days: starts / changes T+1 … T+30; planned ends with last day T … T+30 (same as Overview) | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| BD-H7 | Planned End items on Home show **no End Reason** (minimization; visible on Employee Detail) | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| BD-H8 | Upcoming capped at 10 with "Showing the next 10 of N"; **no** Upcoming list / module in Phase 1 | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| BD-H9 | Needs Attention breakdown uses the **raw** authoritative item codes (no "No Employment Period" grouping), so Home equals Record Health | Approved 2026-10-11 | **BUSINESS DECISION — APPROVED** |
| T-1 | Shared person projection (status + completeness) used by list and dashboard | — | TECHNICAL |
| T-2 | Move the Upcoming derivation to a shared pure module used by Overview and the dashboard | — | TECHNICAL |
| T-3 | Service takes `now`; one business date per request; read-only repeatable-read transaction | — | TECHNICAL |
| T-4 | Ordering keys as §C.2 / §C.3 | — | TECHNICAL |
| T-5 | Navigation targets as §C.4 (existing list URLs) | — | TECHNICAL |
| T-6 | Route, schema, fixed limits, strict empty query, error semantics as §D | — | TECHNICAL |

Approving the endpoint (Option B) is part of approving this design: it is a new read API (`employees.read`), additive, with no write and no new permission.

## K. Implementation and validation (2026-10-11)

### K.1 Implemented contract — `GET /api/v1/core-hr/dashboard` → `CoreHrDashboard`

Approval clarifications are applied: there is no `employee_records`, and existing naming is used throughout.

```jsonc
{
  "status_as_of": "2026-10-11",
  "snapshot": { "active": 38, "not_started": 10, "ended": 7 },
  "needs_attention": {
    "total": 24,
    "rule_version": "operational-mvp-2026-10-08.2",
    "by_requirement": [{ "code": "work_email", "count": 11 }],          // rule order; only count > 0
    "records": [{ "person_id": "uuid", "employee_code": "DEMO105", "full_name": "…", "employment_status": "active", "missing": ["contact_email"] }]
  },
  "upcoming": {
    "window_days": 30, "from": "2026-10-11", "to": "2026-11-10", "total": 13,
    "items": [{
      "type": "assignment_change",                                       // employment_start | new_employment_period_start | relationship_change | employment_end | assignment_change
      "effective_date": "2026-11-01",
      "person_id": "uuid", "employee_code": "DEMO802", "full_name": "…",
      "employee_type": null,                                             // { code, name } for starts and relationship_change
      "previous_employee_type": null,                                    // { code, name } for relationship_change
      "assignment": { "department": { "code": "ENG", "name": "Engineering" }, "job_title": { "code": "SE", "name_en": "Software Engineer" } },
      "previous_assignment": { "department": { "code": "QA", "name": "Quality Assurance" }, "job_title": { "code": "QAE", "name_en": "QA Engineer" } }
    }]
  }
}
```

**Differences from §D (technical):**
- Person fields are flat on each upcoming item (`person_id`, `employee_code`, `full_name`), as in `needs_attention.records`.
- Catalog references carry `code` + `name` only, without database ids (navigation needs only `person_id`).
- `employee_records` is not returned.
- `DashboardQuerySchema` is a strict empty object, so any query parameter gives `400 VALIDATION_ERROR`.

### K.2 Architecture (reuse, no dashboard rules)

- **`src/modules/core-hr/dashboard/service.ts`:**
  - `loadDashboardPeople` is one query tree: operational periods (`operationalEmploymentWhere`), their operational assignments (`operationalAssignmentWhere`, PV-29), Employee Types and the end / end-reversal events. There is no N+1. Sections share one `REPEATABLE READ` transaction.
  - `assembleDashboard(people, today)` is pure.
  - `getDashboard(principal, now)` derives `today` with `todayInVietnam(now)` once per request.
- **T-1:** `personProjection` in `people/service.ts` is the single status + completeness projection. `toListItem` (Employee List) and the dashboard both use it.
- **T-2:** `src/modules/core-hr/employments/upcoming.ts` is the pure Upcoming derivation moved out of the frontend. `detailModel.upcomingChanges` (Overview) is now a thin mapper over it, and the dashboard uses the same function. The backend never imports frontend code.
- Requirement codes live in `src/contracts/core-hr/completeness-codes.ts` (contract layer); the completeness rule imports them.
- **UI:**
  - `src/app/page.tsx` (Home at `/`) and `src/app/homeModel.ts` (pure).
  - Labels come only from `src/i18n` (`home.*`, `completeness.items.*`, `employmentStatus.*`).
  - The sidebar Home item is live (`employees.read`). The "Soon" placeholder and its strings and CSS are removed.
  - The wordmark and the post-login landing go to Home.

### K.3 Validation result

| Gate | Result |
|---|---|
| Dashboard integration tests (`tests/integration/dashboard.test.ts`): snapshot incl. cancelled / voided; Needs Attention incl. Work Email policy, missing assignment, optional fields, once-per-person, breakdown, PV-29; Upcoming T / T+1 / T+30 / T+31, Relationship Change merge, cancelled successor, new period, cancelled / voided / cancelled-assignment exclusion, cap 10 + total, same-date order; time zone 16:59:59Z vs 17:00:00Z; consistency with the list (status totals, incomplete total) and with Overview (per person); security (200 / 403 / 401), privacy (no personal / email / reason / audit keys or values), strict query 400 | 13 / 13 |
| Home UI unit tests (`tests/unit/home.test.ts`) | 11 / 11 |
| Full suite (unit, integration, contract incl. OpenAPI validation and the permission registry) | 621 / 621 (51 files) |
| UAT round 1 / round 2 / integrity baseline | 22 / 22, 5 / 5, 1 / 1 |
| Typecheck, lint, production build | Pass |
| Integrity scan `hrms_dev` | 0 errors, 0 warnings |
| Browser smoke and visual QA (synthetic `hrms_dev`) | Populated Home at 1366 and 1280 px (fits, no horizontal scroll; columns 2 : 3); stacked at ≤ 1023 px (900 px: no overflow); "View all" → `/employees?operational_completeness=incomplete`; metric links → list status filters; no-permission account sees the permission message and no Home / Employees navigation |

- **Healthy, no-upcoming and unavailable states:** `hrms_dev` holds incomplete records. These states were therefore rendered by overriding the dashboard **response in the browser only** (no data changed), and they are also covered by the unit tests.
- **Limitation — pre-existing, not Home-specific:** at 375 px every signed-in page (Home, Employees, Detail, Organization) is wider than the viewport, because of the app-shell layout. This is tracked as a separate follow-up; Phase 1 is desktop / laptop first.



## Addendum — Phase 2A Contract Attention (2026-10-16, C-113, M-20)

Owner-approved Phase 2 extension of Home (C-108): one **Contract Attention** section below the panels above (which are unchanged), shown only with `contracts.read` and loaded from its own endpoint `GET /api/v1/core-hr/contract-reminders`. Three signals — Expiring soon (next 30 days, M-20), Awaiting signature, Needs review — each with an authoritative count, a one-line HR action, up to three contracts and *View all →* to the canonical Contracts filter. No charts, trends, KPI cards or renewal content. Record: `docs/design/phase2a-slice-2a-4-attention.md`.

## L. Home dashboard refresh (owner-approved 2026-10-16, register C-119)

Owner-approved change to the frozen Phase 1 Home (C-101 / C-102), built to the owner's reference screenshot. Layout: greeting + business date; four summary cards; two charts side by side; Needs Attention and Upcoming side by side; the existing Contract Attention section (C-113) unchanged below. Light gray page, white rounded cards, restrained shadows, red accents; one column on phones.

| Element | Definition (server-side, `GET /api/v1/core-hr/dashboard`) |
|---|---|
| **Total Employees** | People whose current Employment Status is **Active** on the Asia/Ho_Chi_Minh business date, each counted once (the Employee List's `employment_status=active`). Excludes Pre-start, Ended and people without an operational Employment Period; Ended applies from the day after the last working day (inclusive last day, unchanged). Employment status — not login-account status. Equals Active; hint "Active employees only"; opens the Active Employee List. |
| **Active** | Same number and link (no invented distinction). |
| **On Leave** | No leave data: `workforce.on_leave = null`, rendered "—" ("Not available yet"), not a link, never 0. |
| **Needs Attention** | Unchanged (Record Health, `operational_completeness=incomplete`). |
| Trend slots / percentages | Reserved positions show "—" with the note "— means the data is not available yet." No arrows, growth figures or filled progress rings. |
| **Employees by Department** (donut) | Active people only, by the Department of the assignment **in effect on the business date** (the list's Department rule; future assignments not counted); "Not assigned" kept (last). Sums to Active. Real values link to the Active list filtered by Department (same count). |
| **Employee Type** (columns) | Active people only, by the Employee Type of the active Employment Period; actual catalog values; "Not assigned" kept. Sums to Active. Real values link to the Active list filtered by Employee Type. |
| Pre-start / Ended | Removed from the summary cards; subdued links "Pre-start N · Ended N" to the canonical list filters. The Workforce Snapshot bar was removed. |
| Upcoming | Unchanged item timeline (30-day rules, Employee Detail tab links); no totals derived from the 10-item preview, no "View all" (no destination). |

API: additive read-only `workforce { total, by_department[], by_employee_type[], on_leave: null }`, computed over **all** people in the same pass and snapshot as `snapshot` (never from a preview). Charts are plain SVG / CSS (no chart dependency); the browser only draws server counts. Tests: `tests/integration/dashboard.test.ts` (population, last-day boundary, future assignment, Not assigned, sums, per-group equality with the Employee List filters over all people), `tests/unit/home.test.ts` (cards, unavailable values, links, chart views, guards).

### L.1 Long labels and many categories (freeze-review validation, 2026-10-16)

Checked at 1366 / 390 px on an isolated synthetic fixture in the disposable `hrms_test` database (guarded reset + seed; 13 departments and 9 Employee Types including long names, Not assigned in both charts, 73 Active people; then a zero-Active case with one Pre-start person) — `hrms_dev` untouched. Found and fixed: long names were truncated with an ellipsis and readable only by mouse hover; the legend / column scroll areas were not keyboard-reachable. Now labels always wrap in full; an overflowing legend or column area becomes a focusable, labelled scroll region (`Departments (scrollable list)`, `Employee Types (scrollable chart)`) with a visible hint ("Scroll the list / sideways to see all N groups."). Verified: Tab reaches each region and Page Down / End scroll to Not assigned; no page-level horizontal overflow; every linked group equals its Active Employee List filter (22 groups) and both charts sum to Active; zero Active shows "No active employees on this date." in both charts. Layout, definitions, placeholders and Contract Attention unchanged.

### L.2 Desktop sizing (owner request, 2026-10-16)

Diagnosis at 100 % zoom (device pixel ratio 1, no CSS zoom or viewport scaling): not browser zoom — Home was capped by the app-wide `--content-max-width: 1240px` (at 1920 CSS px, 444 px of the 1684 px beside the sidebar stayed empty) and used compact sizes (KPI 30 px, headings 16 px, legend 13 px, 176 px charts). Change, Home only (`.page:has(> .home)`; every other screen keeps 1240 px): `--home-max-width: 1600px`, 32 px side gutters from 1200 px; from 1200 px KPI 36 px, Home title 28 px, section headings 18 px, card / legend / list text 14 px, donut `clamp(184px, 14vw, 240px)`, column plot `clamp(200px, 15vw, 260px)`; from 1600 px KPI 40 px, title 30 px, headings 20 px and roomier cards. Phones unchanged. Verified at 1920 / 1440 / 1366 / 390: four cards in one row with single-line labels and hints, equal chart and action columns, no horizontal overflow, long labels wrap. No metric, API or permission change.

### L.3 Fit to the workspace and balanced operational row (owner layout review, 2026-10-17)

Measured in the local preview at 100 % zoom (emulated 1366×900, 1440×900, 1920×1080, 2560×1080, 390×844; device pixel ratio 2). The owner's own Chrome tab and zoom control were not accessible, so the owner's zoom is not verified — only that a separate 100 % tab on the owner's 1440×900 display reported a 1440 CSS px viewport. Root causes: (1) the Home page box was centred (`margin: 0 auto`) under its 1600 px cap, so any viewport wider than ~1900 CSS px opened an empty corridor between the sidebar and the content (362 px at 2560), and at 1920 an 84 px unused strip remained on the right; (2) the operational row used `align-items: start`, so Needs Attention (≈520–570 px) and Upcoming (≈980 px) ended at different heights and left a 450–510 px blank gap above Contract Attention.

Change (Home only, CSS + one shared component; no metric, API, permission or business-rule change): the Home page box is left-aligned beside the sidebar (32 px gutter from 1200 px) and its cap is raised to 1760 px so standard screens up to 1920 px fill the main area and only genuinely wide screens leave space, on the far right; on two-column desktops (≥ 1101 px) Needs Attention and Upcoming stretch to one shared height capped at `--home-ops-height: clamp(380px, 46vh, 440px)`, with headings, chips and "Showing X of Y" fixed and the record lists scrolling inside. The shared `ScrollRegion` (`src/app/ScrollRegion.tsx`, also used by the workforce charts) makes a list a labelled, keyboard-focusable region with a visible focus ring only when it actually scrolls; on phones the lists keep natural flow with no extra focus stop. Same preview records, same truthful "Showing 10 of 20 upcoming changes", no filler, no new "View all" for Upcoming.

Measured after: content 32 px from the sidebar and no corridor at every width; content width 1130 / 1204 / 1684 / 1760 px at 1366 / 1440 / 1920 / 2560 (the 1760 px cap was later removed — see L.4); both panels 414 px (1366, 1440) or 440 px (1920, 2560) with identical top and bottom edges; Contract Attention 40 px below (the normal section gap); no horizontal overflow; PageDown / arrows / End scroll the focused list without moving the page. Owner visual acceptance: superseded by L.4 (accepted 2026-10-17).

### L.4 Full-width Home (owner decision, 2026-10-17)

Owner decision: Home fills the available workspace beside the sidebar at every width, ultrawide included ("full width" = the browser content area, not fullscreen and not fitting everything into one screen). Constraint removed: the Home-only cap `.page:has(> .home) { max-width: var(--home-max-width) }` (1760 px; token deleted), which itself overrode the app-wide `.page { max-width: var(--content-max-width) /* 1240px */; margin: 0 auto }`. Home now sets `max-width: none; margin: 0`; the page padding is the gutter (24 px below 1200 px, 32 px from 1200 px; 16 px on phones), applied symmetrically and inside the width. Every other screen keeps `--content-max-width`. No `100vw`, CSS zoom or transform; fonts and component sizes unchanged.

Wide-card readability: from 1200 px the department legend keeps a line length of at most 560 px and the donut + legend group is centred in its card, so a count never sits far from its name; the donut stays at its existing `clamp(184px, 14vw, 240px)`.

Discoverable list scrolling: when Needs Attention or Upcoming overflows its shared-height panel, the list shows soft edge shadows where more records are (pure CSS, colour token `--color-scroll-shadow`) and a visible hint below it ("Scroll the list to see all N records shown." / "… changes shown."), in addition to the labelled keyboard-focusable region; headings, chips and the truthful "Showing X of Y" stay outside the list. Phones keep natural flow (no region, no hint).

Measured (emulated viewport, 100 % zoom, sidebar 236 px): main / Home content width with left = right gutter — 1366: 1130 / 1066, 32 / 32; 1440: 1204 / 1140, 32 / 32; 1920: 1684 / 1620, 32 / 32; 2560: 2324 / 2260, 32 / 32; 2880: 2644 / 2580, 32 / 32; 390: 358 px content, 16 / 16. Four equal summary cards (249 / 267 / 387 / 547 / 627 px), two equal chart and operational columns, operational panels with identical top and bottom edges, Contract Attention spanning the full content width 40 px below, no page-level horizontal overflow at any width. **Owner visual acceptance confirmed 2026-10-17** (C-121, C-122).
