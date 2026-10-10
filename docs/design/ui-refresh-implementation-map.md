# Mini HRS — Core HR Phase 1 UI Refresh: Audit and Implementation Map

- Status: **APPROVED (2026-10-10).** Decisions D-UI-1 … D-UI-11 recorded in §8 (register C-95); D-UI-12 … D-UI-14 (register C-96) and D-UI-15 … D-UI-16 (register C-97) also in §8. **UI-0 implemented** (§9). **UI-2 Employee List implemented** (§10). **UI-3 Employee Detail shell + Overview implemented** (§11). **UI-4 Personal Information implemented** (§12). **UI-5 Employment implemented** (§13). **UI-6 Assignment implemented** (§14). **UI-7 History implemented** (§15). **Employee Detail consistency review — completed** (§16). **UI-8 Add Employee implemented** (§17). Next slice (UI-9) not started.
- Scope: restyle and reorganise the existing Core HR Phase 1 UI to the approved white + red direction (mockup supplied 2026-10-10). Business rules, API semantics, permissions and lifecycle behaviour stay unchanged; where the mockup conflicts with an approved rule the rule wins (§4).

## 1. Current frontend (facts)

| Area | Current state |
|---|---|
| Stack | Next.js 16 App Router, React 19, **plain CSS** (`src/app/globals.css`, 63 lines), no UI framework; all screens are client components inside `AppShell` |
| Tokens | 13 CSS variables in `:root` (`--bg #f7f7f8`, `--surface`, `--text`, `--muted`, `--border`, `--accent #c8102e`, `--ok`, warn/err pairs, `--radius 8px`). No spacing, shadow, control-height or row-height tokens; no hover/pressed red |
| Shell | `src/components/AppShell.tsx`: **top bar** (brand text "Mini HRS", nav Employees / Catalogs / API Docs by permission, user name, *Test identity* badge, Sign out); session context with `can(permission)` from `GET /core-hr/me/permissions` |
| Routes | `/` → redirect `/employees`; `/login` (development test identity); `/employees` (list); `/employees/new` (create); `/employees/[id]` (detail, 510 lines); `/catalogs` (4 catalogs as tabs); `/internal/docs` (API docs, `docs.read`) |
| Shared components | Only `AppShell` and `ErrorBox`. Buttons, badges, cards, tables, alerts are global CSS classes (`.card`, `.badge.ok/warn`, `.alert.*`, `button.primary`, `.tabs`, `.table-wrap`, `dl.kv`) |
| Duplicated styling | **64 inline `style={{…}}` in 16 files** (margins, textarea styling repeated in every form, opacity for cancelled/voided cards) |
| Detail page | One long page: header badges, profile edit, completeness card, personal card, then one card per Employment Period with **all action forms inline** (Work Email, Correct Period, End, Relationship Change, Cancel Planned, Reverse End, Void, Initial Assignment, Change Assignment), assignment table with per-row *Correct*, event list |
| Forms | 12 form components in `src/app/employees/[id]/` — each opens **inline** under the period card; each keeps its own Idempotency-Key per attempt; impact previews ("Timeline Impact") already exist in Change Assignment, End, Relationship Change, Void |
| Permission-aware UI | Every action gated with `session.can("employment.manage" / "employment.correct" / "employees.update" / "catalogs.manage" …)`; no role-name checks in UI |
| List | `/employees`: search, Employment Status, Department; URL state (`search`, `employment_status`, `department_id`, `page`); 7 columns; 20 per page |
| i18n | All UI text in `src/i18n/messages/en.ts` (415 lines) via `t()` / `tMaybe()` |
| UI tests | No component/browser tests; node-only unit tests for pure helpers (`list-query`, `labels`, `status`). API behaviour is covered by integration/UAT suites (419 + 27) |

## 2. Implementation map

Legend — **Reuse**: keep as is · **Refactor**: restyle/restructure, same behaviour · **New**: new UI · **Risk**: L/M/H.

| Screen / Component | Current State | Reuse | Refactor | New | Risk |
|---|---|---|---|---|---|
| Design tokens | 13 vars in `globals.css` | colour values as starting point | rename into a token set; remove inline constants | spacing, shadow, red hover/pressed, info, control/row heights; `tokens.css` | L |
| Global shell | Top bar | session context, permission gating, sign-out | — | **left sidebar** (white), wordmark "Mini HRS", nav Home / Employees / Organization, user block, active red indicator | M (every page renders inside it) |
| Shared UI kit | CSS classes only | `.badge`, `.alert`, `ErrorBox` logic | buttons → primary / secondary / destructive / ghost variants | `Button`, `Card`, `PageHeader`, `Tabs`, `StatusBadge`, `KeyValue`, `EmptyState`, `Modal`/`Drawer` shell, `ActionMenu` (dropdown), `Stepper`, `InfoBox` | M |
| Home / Action Center | none (redirect) | — | `/` stops redirecting | headcount tiles, needs-attention, upcoming events, data quality, by-department | **H — needs data not exposed today (§3)** |
| Employee List | functional | URL state, pagination, permission check | table/filter layout, red *Add Employee* | extra columns/filters (§3) | M |
| Add Employee | single form, 4 fieldsets | payload builder, validation, idempotency, legacy code (HR_ADMIN) | split into 4-step wizard (Personal → Employment → Assignment → Review) | Stepper, Review step, duplicate-person **UI state only** (disabled) | M |
| Employee Detail shell | one long page | data loading, `realPeriods`/`latest` derivations, permission gating | header (name · code · status), red *Change Assignment*, *More actions*, *Correct record* menus | tabs Overview / Personal / Employment / Assignment / Documents / History | M |
| Overview | n/a | detail API data | — | current employment, current assignment, contact, record health, **upcoming change** (derived client-side from detail data) | M (derivation must follow approved status rules) |
| Personal | card + ProfileEditForm | ProfileEditForm logic | restyle as tab + edit drawer | — | L |
| Employment | period cards | period data, badges (Reversed/Current end/Cancelled/Voided) | Current / Upcoming / History grouping | — | M |
| Assignment | table per period | assignment data, per-row *Correct* (HR_ADMIN) | Current / Upcoming / History grouping | — | M |
| History | event list per period | event labels, End/Reversed/Void presentation (C-80, C-86) | business-language timeline with Effective date (+ Recorded at for lifecycle events) | — | M (see §3 for assignment "recorded at" and actor) |
| Documents | none | — | — | placeholder tab "Coming in a later phase" | L |
| Workflow forms (12) | inline forms | all logic, payloads, idempotency, previews | wrap in `Modal`/`Drawer` with common layout (title, explanation, fields, impact, Cancel / primary) | — | M (many files; behaviour must be identical) |
| End Employment | inline form + Timeline Impact | logic | modal; scheduled vs effective explanation | — | L |
| Relationship Change | inline form | logic | modal with CURRENT → NEW and "A new Employment Period will be created. The previous period will remain in history." | — | L |
| Void | inline, preview-driven | logic and preview | moved under *Correct record → Advanced*; destructive red button | — | L |
| Organization | `/catalogs` 4 tabs | page logic | rename nav to *Organization*; tabs Departments / Job Titles / Levels (+ Employee Types, see §4) | — | L |
| Login | dev test identity page | logic | white/red restyle | — | L |
| API docs link | top-nav item (`docs.read`) | page | moved out of the main nav (small sidebar footer link for `docs.read` only) | — | L |

## 3. Data the mockup needs vs what the API provides

| Mockup element | Available today? | Proposal | Needs |
|---|---|---|---|
| Home headcount (Total/Active/Pre-start/Ended) | Yes — `GET /employees` `total` with `employment_status` filter (4 small calls) | UI-only | — |
| Home "Employees by Department" | Partly — one list call per department | UI-only (≤ ~10 departments) or small read endpoint | — |
| Home "Needs attention" / "Data quality" | **No** — completeness is per person; "missing manager" and "assignment date mismatch" are not in any API | new read-only summary endpoint (`employees.read`), or show only *Incomplete operational profile* count via a list filter | **Decision D-UI-2**, and "missing manager" is **not** an approved completeness rule (M-04) |
| Home "Upcoming events (next 30 days)" | **No** aggregate | new read-only endpoint (starts, planned ends, future assignments, future periods) | **Decision D-UI-3** |
| List columns Work Email | Yes (`work_email`) | UI-only | — |
| List column Start Date | **No** | additive field (start of the representative period, C-76) | D-UI-4 |
| List filters Employee Type / Manager / Record Completeness / Upcoming Changes | **No** (only search, status, department) | additive query parameters | D-UI-4 |
| **Export current view** | No | **personal data export** — readiness plan LP-09 / legal Q-L9: "ask when an export feature is proposed" | **Business + Legal decision D-UI-5** (Pending Legal Review); not built until approved |
| Overview "Upcoming change" | Yes — derivable from detail (future assignment rows, planned end, future periods) | UI-only derivation (pure, unit-tested) | — |
| Overview "Tenure" | Derivable, but meaning is not defined (current period only? across Rehire / Relationship Change?) | omit or show "In current period since …" | **D-UI-6** |
| History "Recorded at" for assignment changes | **No** (assignment rows expose no recording time) | additive field `recorded_at` on assignments, or show Effective date only for assignments | D-UI-7 |
| History "By" (actor) | **No** — actor lives only in audit, which has no read API | not shown (audit viewer is Gate C, C-85 security audit separation) | D-UI-7 |
| Duplicate-person warning | **No** backend matching | UI component only, disabled; proposed follow-up feature (also readiness Q4 duplicate profile) | D-UI-8 (follow-up, not this task) |
| Rehire with Department / Job Title in one modal | Rehire API has **no** `initial_assignment` (Relationship Change has) | keep two steps (Rehire → Add Initial Assignment) inside one guided modal, or additive API field | **D-UI-9** (two sequential calls would not be atomic) |

## 4. Mockup vs approved rules — the rule wins

| Mockup | Approved rule | UI decision |
|---|---|---|
| "Employment Type" column/filter | Business term is **Employee Type** (C-02, CLAUDE.md) | keep **Employee Type** (renaming is a terminology decision, D-UI-1) |
| "Full-time", "Part-time" next to the type | Working Arrangement is **not implemented** (PV-15) | not shown |
| "Contractor" | Catalog value is **Service Contractor** (C-13) | show catalog names |
| Gender / Date of Birth marked required (*) | Optional — not part of the operational-completeness rule (M-04) | not required |
| "Missing manager" as an attention item | Manager is not an operational-completeness item (M-04) | not shown unless approved (D-UI-2) |
| Organization with only Departments / Job Titles / Levels | Employee Types are an HR-managed catalog today (`catalogs.manage`) | keep a 4th tab *Employee Types* (no feature removed) |
| Void inside an action modal row of the period | Void is advanced HR_ADMIN recovery (C-86/C-94) | only under *Correct record → Advanced*, destructive styling |
| Top-level items Reports / Admin | Not in Phase 1 | not added; API Docs moved to a footer link (permission `docs.read`) |
| Mockup logo/brand | No approved EmeSoft logo asset in the repository | neutral wordmark **"Mini HRS"** |

## 5. Red token (needs HR approval)

- The repository uses `--accent: #c8102e` since the MVP baseline commit; **no document records it as an approved EmeSoft brand colour**.
- An EmeSoft brand skill available in this workspace describes the brand red as **`#E8002D`** — this is not a repository asset and has not been confirmed for Mini HRS.
- Proposal: introduce `--color-primary` as a **temporary UI token** with the current value `#c8102e` (WCAG AA contrast with white text), documented as temporary in `tokens.css`, until HR/brand approves the exact value (**D-UI-10**). Changing it later is one line.

## 6. Proposed files per stage (after approval)

| Stage | Files |
|---|---|
| UI-0 | `src/app/tokens.css` (new), `src/app/globals.css` (refactor to tokens), `src/components/AppShell.tsx` (sidebar), `src/components/ui/{Button,Card,PageHeader,Tabs,StatusBadge,KeyValue,EmptyState,Modal,ActionMenu,InfoBox,Stepper}.tsx` (new), `src/i18n/messages/en.ts` (nav labels) |
| UI-1 | `src/app/page.tsx` (Home instead of redirect), `src/app/home/*` (sections); data from existing list API only unless D-UI-2/3 approve an endpoint |
| UI-2 | `src/app/employees/page.tsx`, `src/app/employees/listQuery.ts` (+ unit tests); new columns/filters only if D-UI-4 approved |
| UI-3 | `src/app/employees/[id]/page.tsx` split into `EmployeeHeader.tsx`, `tabs/OverviewTab.tsx`, `derive.ts` (pure helpers: current assignment, upcoming changes — unit-tested) |
| UI-4 | `tabs/PersonalTab.tsx`, `ProfileEditForm.tsx` (drawer) |
| UI-5 | `tabs/EmploymentTab.tsx` |
| UI-6 | `tabs/AssignmentTab.tsx` |
| UI-7 | `tabs/HistoryTab.tsx` |
| UI-8 | `src/app/employees/new/page.tsx` → wizard (`steps/*.tsx`), duplicate-person component (disabled) |
| UI-9 | the 12 form components wrapped in `Modal`/`Drawer`; action menus in `EmployeeHeader` |
| UI-10 | `src/app/catalogs/page.tsx` → `/organization` (keep `/catalogs` redirect), `src/app/login/page.tsx` restyle |

Verification after each stage: typecheck, lint, build, unit tests for new pure helpers, the integration/UAT suites when shared code is touched (no API change is planned), and browser screenshots of the stage compared with the mockup on the synthetic DEMO data.

## 7. Decisions needed before or during the refresh

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| D-UI-1 | "Employment Type" vs approved "Employee Type" | Keep **Employee Type** | Labels (UI-2…) |
| D-UI-2 | Home "Needs attention" / "Data quality" contents and source | Phase 1: incomplete operational profiles + missing Work Email (both from the approved rule); no "missing manager"; integrity-scan findings stay technical | UI-1 sections B/D |
| D-UI-3 | Upcoming-events summary endpoint (read-only, `employees.read`) | Approve a small additive read endpoint | UI-1 section C |
| D-UI-4 | Additive list fields/filters (Start Date; Employee Type, Manager, Completeness, Upcoming filters) | Approve Start Date + Employee Type + Completeness; Manager/Upcoming later | UI-2 extras |
| D-UI-5 | **Export current view** (personal data export) | Not in this refresh; legal review first (Q-L9) | UI-2 export |
| D-UI-6 | Tenure definition | Omit, or "In current period since …" | UI-3 |
| D-UI-7 | Assignment "Recorded at" and actor in History | Effective date only for assignments now; no actor | UI-7 |
| D-UI-8 | Duplicate-person detection | UI shell disabled now; separate follow-up feature | UI-8 |
| D-UI-9 | Rehire + assignment in one step | Guided two-step modal (no API change) | UI-9 |
| D-UI-10 | Exact red token | Temporary `#c8102e` until HR/brand approval (`#E8002D` candidate) | UI-0 |

Stages that need none of these decisions: UI-0, UI-3 (without tenure), UI-4, UI-5, UI-6, UI-7 (effective dates), UI-8 (without duplicate detection), UI-9, UI-10.

## 8. Approved decisions (2026-10-10, register C-95)

| ID | Decision |
|---|---|
| D-UI-1 | Use **Employee Type** (not "Employment Type"). |
| D-UI-2 | *Needs Attention* shows only issues backed by actual product rules. **Missing Manager is not an issue** while Manager is optional; **no double counting** of Missing Work Email when the same condition is already shown as record incompleteness. |
| D-UI-3 | A small **read-only Upcoming Events endpoint** is approved for later (not in UI-0); no notification/workflow engine. |
| D-UI-4 | Employee List: **Start Date** column, **Employee Type** filter, **Record Completeness** filter approved. **Deferred:** Manager filter, Upcoming Changes filter. |
| D-UI-5 | **Export deferred** pending Legal/Privacy review; not implemented in this refresh until separately approved. |
| D-UI-6 | **No Tenure** in Phase 1. Use Start Date or neutral wording such as "Current period since <date>"; never imply company seniority across Rehire / Relationship Change. |
| D-UI-7 | History shows the business **Effective Date** only; no Recorded At / actor until an approved audit-read design exists. |
| D-UI-8 | Duplicate-person detection is a **future capability**; no fake or disabled duplicate warning in the real Add Employee flow (may stay documented as a future design state). |
| D-UI-9 | **Rehire stays a two-step flow**; after a successful Rehire the UI guides HR to **Add Initial Assignment**; no simulated atomic Rehire + Assignment. |
| D-UI-10 | Use the existing **#c8102e** as the **temporary** primary red, defined once as a central token (`--color-primary` in `src/app/tokens.css`). **Brand red pending final EmeSoft brand confirmation.** |
| D-UI-11 | The product UI stays **English-first**; Vietnamese only in review documents/mockups, never a mixed-language production UI. |
| D-UI-12 (2026-10-10, register C-96) | **Upcoming / future-effective state uses the semantic INFO treatment** everywhere (light-blue accent + explicit text such as *Upcoming*). The primary red is never used for ordinary future lifecycle state. Applied to the Overview upcoming cards and Upcoming Changes in UI-6. |
| D-UI-13 (2026-10-10, register C-96) | **Action ownership direction:** the header holds the primary assignment action and person-level / lifecycle-level actions only; Employment-Period-specific actions belong to the relevant period card (and assignment-row corrections to their row). The consolidation is done in **UI-9**; current behaviour stays stable until then. |
| D-UI-14 (2026-10-10, register C-96) | **Cancelled / Voided Employment Periods never expose operational mutation actions** on their own card (Employment and Assignment tabs); proved by unit tests. |
| D-UI-15 (2026-10-10, register C-97) | **Assignments of Cancelled / Voided Employment Periods remain visible as historical evidence** in a separate muted section ("Cancelled or voided periods"); they are not operational, never Current, never Upcoming and never mutation targets. Historical facts are not hidden because the parent period is Cancelled or Voided. |
| D-UI-16 (2026-10-10, register C-97) | **Duplicate Add Initial Assignment placement is consolidated in UI-9** (not before): for the representative period the header owns the primary Add Initial Assignment CTA and the empty Assignment card only explains the missing assignment; a non-representative / future period's card may keep its own secondary Add Initial Assignment. |

**Revised implementation order:** UI-0 → UI-2 Employee List → UI-3 Detail shell + Overview → UI-4 Personal → UI-5 Employment → UI-6 Assignment → UI-7 History → UI-8 Add Employee → UI-9 Action workflows → UI-10 Organization → **UI-1 Home last** (largest data gaps; avoids mixing the UI refactor with new API work).

## 9. UI-0 — Design system / global shell (implemented 2026-10-10)

| Deliverable | Evidence |
|---|---|
| Central tokens | `src/app/tokens.css`: primary red + hover/pressed/subtle/border/ink, page/surface/surface-2/border/border-strong, text primary/secondary, success/warning/danger/info (+ subtle/border), neutral, focus ring, spacing scale (4–48 px), radii, shadows, control height (36/28), table row height (44), sidebar/content widths, font sizes/weights. Legacy aliases (`--accent`, `--muted`, …) map to the new tokens for screens not yet refactored |
| Single red | Contract test: `#c8102e` appears only in `tokens.css`; `globals.css` contains no raw colours |
| Global styles | `src/app/globals.css` rebuilt on tokens: typography, focus-visible, sidebar shell, page header, buttons, forms, cards, key/value, tables (sticky header, row height), semantic badges, alerts, tabs, empty state, modal, action menu |
| Button hierarchy | primary (red/white), secondary (white + border, default), danger and danger-outline (destructive, separate `--color-danger`), ghost, small; hover / active / focus-visible / disabled |
| Shell | `AppShell.tsx`: light sidebar, "Mini HRS" wordmark (no logo), nav Home (disabled placeholder "Soon" until UI-1; `/` still opens the Employee List), Employees, Organization (route `/catalogs` until UI-10); API Docs in the sidebar footer; user block (initials, name, role codes), Test identity badge, Sign out; becomes a top bar under 900 px |
| Permission behaviour | Unchanged capability checks: Home + Employees need `employees.read`, Organization `catalogs.read`, API Docs `docs.read`. Verified: HR_ADMIN and HR_EDITOR see Home/Employees/Organization (no API Docs); API_DOCS_READER sees only API Docs. No role-name check added |
| Shared primitives | `src/components/ui/`: Button, Card, PageHeader, Tabs (WAI-ARIA tabs, roving arrows), StatusBadge (semantic variants by stable code), Field (label/hint/error association), Modal (focus moves in, Tab trapped, Escape closes unless busy, focus returns), ActionMenu (menu button: arrows/Home/End/Escape/Tab/click-outside), InfoBox, EmptyState, icons, `keyboard.ts` |
| Inline styles | 64 → 52: the 12 duplicated textarea styles replaced by the global `textarea` rule; the shell has none. Screen-specific margins stay until each slice |
| Tests | `tests/unit/ui-foundation.test.ts` (token discipline, status variants, keyboard helper) + all unit tests: 62/62; typecheck, lint, production build pass |
| Visual QA (synthetic DEMO data, 1100 px viewport) | Login (white card, red buttons); shell + Employee List (white sidebar, red active item, red *Create Employee*); DEMO002 detail; existing Change Assignment form inside the new base styles; smoke login → Employees → Employee Detail after restart |

Still expected before the final mockup (later slices): list columns/filters and semantic status badges in the list (UI-2); detail tabs, header actions and Overview (UI-3…UI-7); wizard (UI-8); modals/action menus for workflows (UI-9); Organization page title and tabs (UI-10, page title still "Catalogs"); Home (UI-1).

## 10. UI-2 — Employee List (implemented 2026-10-10)

Scope: the Employee List only (`/employees`), per D-UI-4. No business rule, status rule, completeness rule or permission changed.

### Backend additions (additive, read-only)

| Addition | Contract | Semantics |
|---|---|---|
| `start_date` on each list item | `EmployeeListItem.start_date: date \| null` | Start date of the **representative operational Employment Period** (same `representativeEmployment` used for status, Department and completeness): the Active period, else the nearest upcoming period, else the most recently ended period. Cancelled and Voided periods are never considered (shared `OPERATIONAL` filter). `null` when the person has no operational period. It is **not** a hire date, company seniority or tenure (D-UI-6): after a Rehire or Relationship Change it is the start of the period shown, not the first-ever start |
| `employee_type_id` filter | `GET /employees?employee_type_id=<uuid>` | Matches the **Employee Type of the representative period** (the value shown in the row) — e.g. an Active Employee with a planned Relationship Change to Service Contractor still matches *Employee*. Malformed value → 400 `VALIDATION_FAILED`; unknown id → empty result |
| `operational_completeness` filter | `GET /employees?operational_completeness=complete\|incomplete` | The authoritative operational completeness (C-78, rule `operational-mvp-2026-10-08.2`) computed by the same `completenessView` as Employee Detail; Manager is not a completeness item (M-04, D-UI-2). Invalid value → 400 |

Filters combine with AND with search, Employment Status and Department; pagination and `total` are applied after all filters. OpenAPI regenerated (`contracts/core-hr/openapi.json`).

### UI

| Element | Implementation |
|---|---|
| Header | `PageHeader` "Employees" · "View and manage employee records."; red **+ Add Employee** only with `employees.create` (also in the zero-employee empty state) |
| Filter area | One card (`role="search"`): Search (code or name, unchanged), Employment Status, Employee Type and Department (catalog-driven, include inactive values marked "(inactive)", shown only with `catalogs.read`), Record Completeness (All / Complete / Needs Attention); labels explicitly associated (`htmlFor`); **Clear filters** shown when any filter is active |
| URL state | Canonical API parameter names only (`search`, `employment_status`, `employee_type_id`, `department_id`, `operational_completeness`, `page`); no aliases; unknown or malformed values are ignored; reload restores the view; `replaceState` (no history spam) |
| Columns | Employee Code · Full Name · Employment Status (`StatusBadge`, semantic colours, red is never a status colour) · Employee Type · Department · Job Title · Work Email · Start Date |
| Needs attention | Compact warning icon after the name (tooltip + screen-reader text "Needs attention") instead of a separate column |
| Row navigation | Exactly one target per row: the Full Name link to Employee Detail |
| Actions column | **Not rendered**: the only list-context action is opening the record (already the name link); no correction or lifecycle actions in the list |
| States | Initial loading, inline "Loading…" while refreshing (previous rows stay, `aria-busy`), no-results empty state with Clear filters, zero-employee empty state, API error box, no-permission message |
| Pagination | "Showing x–y of z" + Previous / Page n of m / Next |
| Responsive | Code, name, status and date never wrap; descriptive columns may wrap. Work Email hidden below 1366 px viewport (still on Employee Detail). Below that the table scrolls inside its card; the page itself never scrolls horizontally |

### Deferred (not built)

Manager filter, Upcoming Changes filter (D-UI-4); Export (D-UI-5, Pending Legal Review); bulk edit; configurable columns; reports; Home data; duplicate detection.

### Evidence

| Check | Result |
|---|---|
| Integration `tests/integration/list-ui2.test.ts` | Start Date: Active, Pre-start, Ended, no employment, Rehire active and planned, planned Relationship Change keeps the current period, Cancelled and Voided periods excluded (correct period after a Void). Employee Type: each type, representative type, combinations with status/department/completeness/search, malformed → 400, unknown → empty. Completeness: complete / incomplete, equals Employee Detail, Manager absence still complete, invalid → 400, pagination totals |
| Unit `tests/unit/list-query.test.ts` | URL initialisation, aliases and malformed values ignored, round-trip, Clear filters, capabilities by permission (never role names) |
| Full suite | `npm test`: 39 files, 434 tests pass; typecheck, lint, production build pass |
| Integrity scan (`hrms_dev`, read-only) | 0 errors, 0 warnings |
| Visual QA (synthetic DEMO data, HR Admin test identity) | A default list; B search `DEMO` (18); C Pre-start → DEMO101, DEMO901, DEMO904 (planned rehire); D Employee Type = Service Contractor → DEMO105, DEMO905; E Needs Attention → DEMO105, DEMO905, DEMO906 (voided only, Start Date "—"); F narrower laptop: table fits without horizontal scroll at 1440 / 1366 / 1280 px (email hidden at 1280), narrow pane 443 px scrolls inside the card only |
| Smoke | Test login → Employees → Needs Attention + Service Contractor filters (URL updated, state restored after reload) → Clear filters (bare `/employees`, 49 rows, 3 pages) → page 2 → name link → Employee Detail, no console errors |

Known pre-existing item (not UI-2): a `pg` DeprecationWarning ("client.query() when the client is already executing a query") appears in test output from existing assignment/relationship-change paths.

## 11. UI-3 — Employee Detail shell + Overview (implemented 2026-10-10)

Scope: the Employee Detail shell, header, tabs, Overview and action placement only. The content of the Personal, Employment, Assignment and History tabs and of every workflow form is unchanged (moved, not redesigned); no API, business rule or permission changed.

### Shell and header

| Element | Implementation |
|---|---|
| Back navigation | "← Back to Employees" returns to the last Employee List view of the browser tab (the list remembers its canonical query in `sessionStorage`; the detail page re-validates it with the list URL parser; falls back to `/employees`) |
| Header | Full Name (h1) · Employee Code · one line *Job Title · Department · Employee Type* · Employment Status badge (text, not colour only). Values are the representative period/assignment, exactly as the Employee List row (C-76); the status badge qualifies them (e.g. *Pre-start*, *Ended*). No Full-time, tenure or contract status |
| Tabs | Overview · Personal · Employment · Assignment · History (WAI-ARIA tabs, arrow/Home/End keys). Selected tab in the URL (`?tab=…`, Overview = bare URL). **Documents is not shown** (no function yet; stays on the roadmap) |
| Tab content | Personal = former Personal Information card. Employment = former period cards (dates, type, work email, period workflows). Assignment = former assignment tables per period (row *Correct* stays inline). History = former event lists per period. Inside wording/layout unchanged until UI-4 … UI-7 |

### Overview information hierarchy

1. **Employment** card — title by state: *Current Employment* (Active), *Upcoming Employment* (Pre-start, light accent), *Last Employment* (Ended), *Employment* (none). Employment Status, Employee Type, **Start Date** (start of this employment period — never Join/Hire/Company Start Date), **Planned End** (end date today or later) or **End Date** (past), End Reason when recorded. Pre-start: "Employment has not started yet. It begins on …"; after a Rehire: "The previous employment period ended on …" (periods never merged). No Tenure (D-UI-6).
2. **Assignment** card — *Current Assignment* (in effect today), *Upcoming Assignment* (first assignment of a pre-start period; "Takes effect on … Not in effect yet."), *Last Assignment* (ended period; "Not a current assignment."). Department, Job Title, Level, Manager (absent → "—", never an error), Effective Date. No assignment → neutral text; no assignment is invented.
3. **Upcoming Changes** (full width, light red accent + "Upcoming" label) — see derivation below; "No upcoming changes." otherwise.
4. **Basic Information** — Full Name, Employee Code, Work Email (of the representative period).
5. **Record Health** — *Complete* / *Needs Attention* badge from the API completeness (`completeness.operational`); missing items listed from the API items (no frontend reasons); rule version and "Status as of".

No operational period (only Cancelled/Voided, or none): Employment shows **No Employment Record** with a note that cancelled/voided periods are kept in the Employment tab; Assignment "No assignment — there is no employment period"; header shows no job/department/type.

### Upcoming-change derivation (`src/app/employees/[id]/detailModel.ts`, pure, unit-tested)

Input: the existing Employee Detail response only (no new endpoint, no notification system). Operational periods only (Cancelled and Voided excluded).

| Item | Rule |
|---|---|
| Assignment change | An assignment with `effective_from` after today, compared with the preceding assignment of the same period; only changed fields are shown (Department / Job Title line, Level, Manager); wording "New assignment takes effect on <date>." (no interval notation) |
| Planned end | A period whose end date is today or later: "Employment scheduled to end — Last day of the employment period" (+ End Reason) |
| Employment begins / New Employment Period begins | A period starting after today (first period vs a later one, e.g. Rehire), with its Employee Type and first assignment |
| Relationship change | A future period starting the day after a period whose active End has reason `RELATIONSHIP_CHANGE`: one item "New Employment Period — <old type> → <new type>" explaining that the current period ends and a new period starts; the predecessor's planned end is not listed separately |

Representative period and assignment use the shared `representativeEmployment` / `representativeAssignment` (C-76), so Overview, header and the Employee List agree.

### Action hierarchy

| Place | Actions (only when the existing capability **and** eligibility allow; same conditions as before UI-3, now in `periodEligibility` / `headerActions`) |
|---|---|
| Primary (red) | **Change Assignment**; when the representative period has no assignment yet, the same slot offers **Add Initial Assignment** (existing workflow, D-UI-9 guidance) |
| More actions — daily | Edit Work Email, End Employment, Change Employment Relationship, Rehire / Plan Rehire, Add Initial Employment Period |
| More actions — Correct record | Edit Profile, Correct Employment Period, Correct Work Email (ended period), Clear Work Email, Cancel Planned Period, Reverse End Employment |
| More actions — Advanced | Void Employment Period (red text item; `employment.correct` + existing eligibility) |

Header actions act on the **representative period**; that period's card shows no duplicate inline buttons ("Actions for this period are under the buttons at the top of the page."). **Other periods** (e.g. the planned successor of a Relationship Change, older ended periods) keep their existing inline buttons in the Employment / Assignment tabs, and assignment-row *Correct* stays inline — both to be migrated in UI-9. A selected action opens the unchanged workflow form in a "Selected action" region under the header (focus moves to its first field; Cancel or Save closes it); forms gained only an optional `launched` prop (`launch.ts`). Modal presentation is UI-9. Capabilities come from the server session (`can`), never role names.

Also fixed (UI-0 primitive): a destructive menu item no longer inherits the filled danger-button background (its text was invisible), and long menu items no longer wrap/centre.

### Remaining for later slices

UI-4 Personal, UI-5 Employment, UI-6 Assignment, UI-7 History tab redesigns; UI-9 modal workflows, migration of non-representative period actions and assignment-row corrections into the action hierarchy, and the Change Assignment timeline wording (exclusive end boundary).

### Evidence

| Check | Result |
|---|---|
| Unit `tests/unit/detail-overview.test.ts` (23) | Active, Pre-start, Ended, no assignment in effect, future Assignment (changed fields only; effective today is current), planned End (incl. today), Rehire (not merged), planned Rehire, Relationship Change (single item) vs end+start, Cancelled/Voided excluded, only-voided → No Employment Record, no employment, Manager absent neutral, Record Health = API items; header actions for HR_ADMIN / HR_EDITOR / read-only, Pre-start, Ended, no period, planned Relationship Change |
| Unit `tests/unit/list-query.test.ts` | Back to Employees href re-validated, fallback |
| Unit suite / typecheck / lint / build | 88/88 unit tests; typecheck, lint, production build pass. Frontend-only change: DB/UAT suites not re-run |
| Visual QA (synthetic data, HR Admin test identity, 1440 px) | A Active DEMO001; B Pre-start DEMO901; C Ended DEMO003; D upcoming Assignment DEMO802 (planned 01 Nov 2026 change QA → Engineering, created through the header *Change Assignment* during QA — demo batch 8 used for UI-3 QA); E Rehire DEMO904; F Relationship Change DEMO905; G Voided / No Employment Record DEMO906; planned End DEMO903 at 1280 px |
| Responsive | Header and actions fit at 1280 px; Overview cards in two columns ≥ 1024 px, stacked below; no horizontal page scroll at 900 px or phone width |
| Accessibility | Tabs and More actions operable by keyboard (ArrowDown opens, End/arrows move, Escape closes and returns focus); every card has a heading; status always has text; focus moves into an opened workflow |
| Smoke | Employees → DEMO001 (Active) → DEMO901 (Pre-start, back link keeps the list search) → DEMO003 (Ended) → DEMO802 (upcoming change); Void opened from More actions loads its preview and Cancel closes it (nothing submitted); no app console or server errors |

## 12. UI-4 — Personal Information (implemented 2026-10-10)

Scope: the Personal tab only. No API, field, privacy rule, permission or correction semantics changed.

### Supported fields (intentionally minimal)

Full Name · Date of Birth · Gender · Mobile · Personal Email — exactly the existing fields. Employee Code, Work Email, Employee Type, Department and Job Title are **not** repeated (header / Overview / Employment own them; Work Email is an employment field).

**Intentionally NOT added:** National ID / legal ID, address, marital status, emergency contact, bank, tax or social-insurance data, family/dependants, generic HR notes, age or birthday analytics. Any future sensitive personal field needs a separate product and legal decision (`employees.read_sensitive` remains unassigned); the former in-page note listing such future fields was removed.

### Layout

One card *Personal Information*: label-above-value pairs in two columns on desktop (Full Name, Date of Birth / Gender, Mobile / Personal Email), one column below 720 px; no horizontal scroll. Absent optional values read "—" with normal styling (no warning) — completeness stays in Overview → Record Health. Dates use the project format (`14 May 1988`). Without `employees.read_personal` the card shows Full Name and "You do not have permission to view personal information."

### Normal update vs correction (C-23 preserved)

The backend has one action (`PATCH /employees/{id}`) whose reason rule is enforced server-side. UI-4 presents its two meanings separately; `personalModel.ts` mirrors the rule only for guidance.

| Path | Where | Fields | Reason |
|---|---|---|---|
| **Edit Personal Information** (normal update) | Secondary button in the Personal card (the page keeps a single red primary action); edits in place | Gender, Mobile, Personal Email; Date of Birth **only when none is recorded** (completion). Full Name and a recorded Date of Birth are shown read-only with a pointer to the correction | Never (payload never carries Full Name or a reason) |
| **Correct Name or Date of Birth** (correction) | More actions → **Correct record** (replaces UI-3's "Edit Profile"); opens in the Selected action region | Full Name; recorded Date of Birth (change or clear to remove) when the personal write capability allows | Always required, kept in the audit trail (values are not audited, C-24) |

Gender keeps the contract values (Female / Male / Other) and stays optional; Date of Birth stays optional (no required marker; future dates and the under-15 review warning remain server rules). Validation errors from the API are shown next to the field (`aria-invalid`, `aria-describedby`), the rest in the error box.

### Permissions (capabilities, never role names)

| Capability | Effect |
|---|---|
| `employees.read_personal` | personal values visible |
| `employees.update` + `employees.write_personal` | Edit Personal Information; Date of Birth correction |
| `employees.update` | Correct Name or Date of Birth (Full Name) |

HR_ADMIN and HR_EDITOR both hold these today (C-23 corrections of Full Name / Date of Birth are not `employment.correct` actions); API_DOCS_READER sees no employee data.

### Shared primitives

Uses `Card`-style section, `Field` (visible label, `htmlFor`/`id`, hints, errors), `Button`, `InfoBox`; no inline styles. Two UI-0 `Field` fixes: the label no longer inherits the global grid label style (the required `*` sat on its own line) and controls are no longer stretched to a neighbour's height (`align-content: start`). The old combined `ProfileEditForm` was removed.

### Evidence

| Check | Result |
|---|---|
| Unit `tests/unit/personal-tab.test.ts` (13) | optional DOB / Gender / Mobile / Personal Email; Gender values; normal update payload (no Full Name, no reason; DOB completion; recorded DOB untouched; clearing → null); correction payload (Full Name, DOB change/removal, reason); capabilities for HR_ADMIN / HR_EDITOR / read-only / no personal access; no role-name checks in the Personal code; field-level errors |
| Unit `tests/unit/detail-overview.test.ts` | header Correct record now offers `correct_personal` |
| Unit suite / typecheck / lint / build | 101/101 unit tests; typecheck, lint, production build pass. Frontend-only: DB/UAT suites not re-run |
| Visual QA (synthetic data, HR Admin test identity, 1440 px) | A all fields DEMO001; B no optional values DEMO906 (all "—", no warning); C edit form open DEMO001 (recorded DOB read-only); D correction from More actions DEMO001 with review (cancelled, nothing saved) |
| End-to-end on synthetic DEMO801 (batch 8, QA) | normal update filled in the missing Date of Birth and Mobile without a reason; correction of the recorded Date of Birth with a reason; invalid Mobile on DEMO001 rejected with a field-level message (nothing saved) |
| Responsive / smoke | one column and no horizontal scroll at phone width; Employees → DEMO001 → Personal → edit → cancel → Correct record → cancel after restart; no app console or server errors |

## 13. UI-5 — Employment (implemented 2026-10-10)

Scope: the Employment tab only. No Employment Period rule, status computation, Rehire / Relationship Change / End / Reverse End / Cancel Planned / Void semantics, permission or API changed. Employment Period ≠ Contract; Contracts/Documents not implemented.

### Information architecture

Three sections, each shown only when it has periods: **Current Employment** → **Upcoming Employment** → **Employment History**. One card per Employment Period ("Employment Period N · <Employee Type>", N = chronological number among all recorded periods), never merged.

| Section | Rule (server facts only, `employmentModel.ts`) |
|---|---|
| Current | `period_lifecycle = active` |
| Upcoming | `period_lifecycle = not_started` (nearest first) |
| Employment History | `period_lifecycle = ended`, plus Cancelled / Voided records — most recent first |
| No operational period | "No Employment Record" empty state; cancelled/voided records still listed under History. With no records at all: "No employment period has been recorded" (Add Initial Employment Period stays in More actions) |

Card labels are text badges: **Current** (soft green), **Upcoming** (soft blue), **Historical** (neutral), **Cancelled** (neutral, muted card), **Voided** (dashed outline, muted dashed card). Red is not used for lifecycle; Current/Upcoming cards carry a soft left border.

### Card content

Employee Type · Employment Status (operational periods only) · Start Date · End Date / **Planned End** (end date today or later) / "No end date" · End Reason · **Work Email** (of that period; Work Email lives here, not in Personal). Status notes: "Starts <date>. Not in effect yet." (Upcoming), "Scheduled to end <date>. Employment stays active until then." (planned End). No Tenure, Join/Hire/Company Start Date or Working Arrangement. "No assignment recorded for this period yet." is neutral text (never a period error) with a neutral **Add Initial Assignment** button when permitted.

**Period history** (per card, from recorded events only — nothing synthesized, C-24): "Started / Starts <date>", "Scheduled to end <date>", "Ended <date> · <End Reason>", "Ended <date> for Relationship Change", "End of <date> reversed" (a reversed End and its reversal shown once), "Cancelled before it started", "Voided — entered in error"; for disposed records the start reads "Was planned to start" (Cancelled) / "Recorded start" (Voided). No interval notation, no raw codes, no audit payload; the full history stays in the History tab.

### Rehire and Relationship Change

- **Rehire**: the new period is its own card (Upcoming or Current) and the ended period stays in History; same person/code implicit.
- **Relationship Change** (predecessor's active End has reason `RELATIONSHIP_CHANGE` and the next period starts the next day): the predecessor shows End Reason "Relationship Change" and "Scheduled to end / Ended for a Relationship Change. A new Employment Period starts/started <date>."; the successor says "This Employment Period was created by a Relationship Change (previously <type>)." and its history reads "Started/Starts <date> — new Employment Period after a Relationship Change". The C-72 guidance (successor cancelled) is kept as a warning box for `employment.correct` holders.

### Cancelled / Voided (dispositions, not Employment Status)

No Employment Status row; recorded dates are kept and labelled "Recorded Start Date / Recorded End Date". Cancelled: "This period was planned but cancelled before it started. It never took effect and is kept for history only." Voided: "This period was entered in error and is not operational. It is kept for traceability only." No actions on disposed records.

### Actions

Each period carries its own actions (eligibility = existing `periodEligibility`, grouped by the shared `periodActions`, which the header now also uses):

| Group | Presentation | Actions |
|---|---|---|
| Daily | Secondary small buttons | Add Initial Assignment (no assignment yet), Edit Work Email, End Employment, Change Employment Relationship |
| Correct record | Menu button "Correct record" (accessible name includes the period) | Correct Employment Period, Correct Work Email (ended period), Clear Work Email, Cancel Planned Period, Reverse End Employment |
| Advanced | Inside the same menu, separated | Void Employment Period (red text item; never a filled button) |

The selected workflow opens inside its period card (unchanged form, focus moves to it; Cancel/Save closes). The page header keeps Change Assignment and More actions for the representative period (UI-3), so those actions are reachable from both places; both open the same form (`PeriodWorkflow.tsx`). Assignment-row corrections remain in the Assignment tab (UI-6).

### Evidence

| Check | Result |
|---|---|
| Unit `tests/unit/employment-tab.test.ts` (17) | Active, Pre-start (never Current), Ended, planned End, reversed End, Rehire (separate numbered periods), Relationship Change (predecessor/successor links), Cancelled and Voided as dispositions with no status (even if a lifecycle value were present), no operational period, History ordering, Work Email per period; actions for HR_ADMIN / HR_EDITOR / read-only, Pre-start Add Initial Assignment + Cancel Planned, ended-period corrections, no actions on disposed records; no role names |
| Header regression | `tests/unit/detail-overview.test.ts` unchanged and passing after the header switched to `periodActions` |
| Unit suite / typecheck / lint / build | 118/118 unit tests; typecheck, lint, production build pass. Frontend-only: DB/UAT suites not re-run |
| Visual QA (synthetic data, HR Admin test identity, 1440 px) | A Active DEMO001; B Pre-start DEMO901; C Ended DEMO003; D Rehire DEMO904 (Period 1 History, Period 2 Upcoming); E Relationship Change DEMO005 (completed) and DEMO905 (planned); F planned End DEMO903; G Cancelled ES0015 (with reversed End, C-72 guidance and Add Initial Assignment); H Voided + I no operational record DEMO906; ES0010 no records at all |
| Responsive / accessibility | actions on one line at 1280 px; one column, menus inside the viewport and no horizontal scroll at phone width; labels are text; menus keyboard operable with per-period accessible names; headings h2 (section) / h3 (period) / h4 (period history) |
| Smoke | Employees → DEMO005 → Employment → Edit Work Email from the period card (focus inside, Cancel closes) → header More actions unchanged; no app console or server errors |

## 14. UI-6 — Assignment (implemented 2026-10-10)

Scope: the Assignment tab, plus D-UI-12 applied to the Overview upcoming cards. No assignment rule, effective-date semantics, manager rule, Change / Initial Assignment behaviour, correction semantics, permission or API changed; no backend change.

### Decisions recorded first (§8, register C-96)

D-UI-12 upcoming = INFO treatment (Overview Upcoming Changes / upcoming cards switched from the light-red accent to info; Employment and Assignment already use it). D-UI-13 action ownership direction (consolidation in UI-9; behaviour unchanged now). D-UI-14 no operational mutation on Cancelled/Voided period cards (unit-tested in `assignment-tab.test.ts`, covering every eligibility flag and the grouped actions for both dispositions, with and without assignment rows).

### Information architecture (`assignmentModel.ts`, server facts only)

| Section | Rule |
|---|---|
| **Current Assignment** | Row in effect today (`effective_from ≤ today < effective_to`, open end allowed) of the period the server reports `active`; at most one. An active period without an assignment shows the empty state here |
| **Upcoming Assignment(s)** | Every operational row with `effective_from` after today — planned changes in the current period, the initial row of a Pre-start period, rows of a future period after Rehire / Relationship Change — nearest first; several are shown (the model never assumes one) |
| **Assignment History** | Remaining operational rows (replaced rows, rows of ended periods), most recent first; the final row of an ended period is labelled **Last Assignment** |
| **Cancelled or voided periods** | Rows recorded on cancelled / voided periods: muted, "Not operational", explanation, no actions — never Current or Upcoming |

Labels are text badges (Current / Upcoming / Historical / Last Assignment / Not operational); Current soft green, Upcoming info (D-UI-12). When more than one Employment Period is recorded each card names its period ("Employment Period 2 · Employee · from 02 Nov 2026"); assignments are never compared or merged across periods.

### Card content and date wording

Department · Job Title · Level · Manager · dates. Level absent → "—" (optional); Manager absent → "—" with the accessible name "No manager", never warning styling; Manager shows name (Employee Code) linking to that person — no email, org tree or report counts.

| State | Wording |
|---|---|
| Current | **Effective since** <date>; if a planned row follows: "A planned change takes effect on <date> (see Upcoming Assignment)." |
| Upcoming | **Effective Date** <date> + "Takes effect on <date>. Not in effect yet." |
| Historical, followed by the next row | **Effective from** <date> · **Replaced on** <next row's start> |
| Historical, closed without successor (e.g. End Employment) | **Effective from** <date> · **Effective through** <exclusive end − 1 day> |
| Last row of an ended period, open end | **Effective from** <date> · **Effective through** <period end date> |

The exclusive `effective_to` is never shown as an "End Date" next to the next row's start (unit-tested). A small change summary shows only changed fields against the previous row of the same period ("Changed from the previous assignment: Job Title: … → …"), using the existing pure comparison; no backend support added.

### Actions

| Action | Where | Treatment |
|---|---|---|
| Change Assignment — representative period | Employee header (UI-3) | Primary red (unchanged); no competing red in the tab |
| Change Assignment — another operational period (e.g. future period after Relationship Change) | That period's latest row | Secondary small button |
| Correct (assignment correction, `employment.correct`) | Its own row | Ghost small button, accessible name "Correct assignment effective from <date>"; existing form and reason rules |
| Add Initial Assignment (`employment.manage`) | Empty state "No assignment has been added for Employment Period N." | Secondary; a normal operational action (the record may stay Needs Attention per the authoritative completeness) |

Forms open inside their card (unchanged content; focus moves in; Cancel/Save closes). Row corrections are not in the header (D-UI-13).

### Evidence

| Check | Result |
|---|---|
| Unit `tests/unit/assignment-tab.test.ts` (16) | current; multiple historical rows with "Replaced on" (no overlapping end date); change summary of changed fields only; future change; several upcoming rows ordered; Pre-start Upcoming; Ended → Last Assignment "Effective through"; open row of ended period; missing Manager / Level; Rehire and Relationship Change keep rows in their period (no cross-period comparison); empty period state; Cancelled/Voided rows never Current/Upcoming; D-UI-14 eligibility; Correct needs `employment.correct`, Change / Initial need `employment.manage`; no role names |
| Unit suite / typecheck / lint / build | 134/134 unit tests; typecheck, lint, production build pass. Frontend-only: DB/UAT suites not re-run |
| Visual QA (synthetic data, HR Admin test identity) | A current DEMO001 (1280 px); B Pre-start upcoming DEMO901; C historical changes DEMO002 (QA Junior → QA Middle → Engineering); D future change DEMO802; E missing Manager DEMO901/DEMO003; F Rehire DEMO904 (Period 2 upcoming, Period 1 Last Assignment); G period without assignment ES0015 (empty state + Add Initial Assignment); H Ended DEMO003 (Last Assignment, effective through 31 Dec 2025); I Relationship Change DEMO905 (future-period row Upcoming with period context and secondary Change Assignment); voided row DEMO906 (Not operational, no actions); Overview DEMO802 with the D-UI-12 info treatment |
| Responsive / smoke | 1280 px readable; one column and no horizontal scroll at phone width; Employees → DEMO905 → Assignment → Change Assignment (period row) → Cancel after restart; Correct opens the existing correction form in place; no app console or server errors |

## 15. UI-7 — Employee History (implemented 2026-10-10)

Scope: the History tab only — a business-readable timeline, not an audit viewer. No event model, audit model, lifecycle / correction rule, permission or API changed. Decisions D-UI-15 and D-UI-16 recorded in §8 (register C-97).

### Sources (nothing invented)

Only facts already in the Employee Detail response: each period's recorded employment events (`start`, `end` with its structured End Reason, `end_reversed`, `cancel_planned_start`, `employment_voided`) and the effective-dated assignment rows. **Not shown, because no approved audit-read API exists (D-UI-7):** corrections (period / assignment / personal), Work Email added / changed / cleared, personal-information updates, recorded-at times and actors. The tab says so in one line: "Corrections, Work Email and personal-information changes are kept in the audit trail and are not shown here." Free-text reasons are never part of the response (C-24); only the structured End Reason is shown.

### Event taxonomy (`historyModel.ts`)

| Entry | Built from | Notes |
|---|---|---|
| Employment started / starts | `start` of the first operational period (or of a voided period, decorated Voided) | |
| Employee rehired | `start` of a later operational period that is not a Relationship Change (only Rehire creates such a period, S4.8) | "New Employment Period N · <type>. The previous Employment Period ended <date>." |
| Employment relationship changed | predecessor's active End with reason `RELATIONSHIP_CHANGE` + operational successor starting the next day | One entry at the new period's start: "<old type> → <new type>" + last day / new start; the End and start are not listed separately. If the successor was cancelled, nothing is merged (End + cancelled period stay separate) |
| Employment ended / scheduled to end | `end` | "Last day of employment · <End Reason>"; a reversed End stays visible, struck through, badge **Reversed**, "This end was later reversed." |
| End reversed | `end_reversed` | "The employment end recorded for <date> was reversed." (dated with the reversed End) |
| Planned Employment Period cancelled | cancelled period (its start and cancel events) | One entry at the planned start: "This planned period did not take effect." + planned dates; never "ended" |
| Employment Period voided | `employment_voided` (dated at the period start: void ab initio) | "Entered in error and not operational…"; the period's own events and assignments stay visible, badge **Voided** |
| Assignment added / changed | assignment rows | Added = first row of a period (values); Changed = later rows, only changed fields vs the previous row of the **same** period (UI-6 helper); rows of cancelled / voided periods decorated (D-UI-15) |

Titles come from the i18n catalogue; unknown future event types fall back to the existing event-type labels or "Employment event" — never a raw code. Tense follows the effective date ("starts", "scheduled to end") independently of the Reversed / Voided badges.

### Ordering

Ascending sort key: **effective date** → **Employment Period order** (chronological) → **lifecycle step** (period begins / relationship change / rehire → assignment added → assignment changed → other events → End → End reversed → cancelled → voided, matching the API's per-period order with the void listed last) → the API's own event order. Displayed as date groups **most recent first**; inside a date, the lifecycle order (first step on top). Future-dated entries carry a **Planned** badge (INFO, D-UI-12).

### Presentation

Compact vertical timeline: date column (120 px) + one small item per entry (title, badge, one or two lines, and "Employment Period N · <type>" context when the person has several periods — omitted where the description already names the period). Reversed / Cancelled / Voided items are muted (Voided dashed). No filters (event volume per person is small — Phase 1 recommendation). Empty state: "No history recorded yet."

### Privacy / minimisation

No personal values, Work Email, full-name history, recorded-at, actor or reason text are used — unit-tested by feeding personal data and Work Email into the model and asserting none appears. Read access is unchanged (`employees.read` for the detail; personal data only via its own permission, not used here).

### Evidence

| Check | Result |
|---|---|
| Unit `tests/unit/history-tab.test.ts` (14) | deterministic order and same-date lifecycle order; most-recent-first groups; assignment change summary (changed fields only, same period); Planned marking; End + Reverse End (old End kept, Reversed, tense by date); Rehire; Relationship Change merged only when reliable (not when the successor was cancelled); Cancelled single entry; Voided evidence kept; D-UI-15 (rows of cancelled / voided periods visible, never Current/Upcoming, no eligible mutation, decorated in history); minimisation; every title free of technical codes; no role names |
| Unit suite / typecheck / lint / build | 148/148 unit tests; typecheck, lint, production build pass. Frontend-only: DB/UAT suites not re-run |
| Visual QA (synthetic data, HR Admin test identity, 1440 px) | A/C simple start + planned End DEMO903; B assignment changes DEMO002; D End + Reverse End DEMO006; E Rehire DEMO004; F Relationship Change DEMO005; G Cancelled period with reversed End, unmerged Relationship-Change End and Rehire ES0015; H Voided DEMO906; I/J DEMO801 (personal update and Date of Birth correction from UI-4 QA) — no personal value, correction or Work Email entry appears; empty state ES0010 |
| Responsive / smoke | one column, no horizontal scroll at phone width; Employees → DEMO005 → History (tab in URL) after restart; no app console or server errors |

## 16. Employee Detail consistency review — completed (2026-10-10)

Review + small consistency fixes across Header, Overview, Personal, Employment, Assignment and History. No business rule, API semantics or permission changed; no backend change; no new capability.

### History semantic correction

The Employee Detail API has no explicit Rehire marker, so History no longer infers "Employee rehired". A later operational period that is not a proven Relationship Change is shown neutrally as **"New Employment Period started / starts"** ("Employment Period N · <type>. The previous Employment Period ended <date>."). Relationship Change keeps its higher-level entry only with explicit `RELATIONSHIP_CHANGE` evidence plus a next-day successor. Unit-tested (`history-tab.test.ts`: no title contains "rehire"). The **Rehire** workflow name stays on its action (More actions), which is a real workflow, not an inference.

### Terminology checklist (one label per concept)

| Concept | Label used everywhere |
|---|---|
| Employee Type | Employee Type |
| Employment Period | Employment Period (N) |
| Employment card titles | Current Employment · Upcoming Employment · Last Employment · Employment (none) |
| Assignment card titles | Current Assignment · Upcoming Assignment(s) · Last Assignment · Assignment History |
| End of a period | Planned End (today or later) / End Date (past); History: "Employment scheduled to end" / "Employment ended" |
| Completeness | Complete / Needs Attention (list icon text aligned to "Needs Attention") |
| Relationship Change | End Reason "Relationship Change"; action "Change Employment Relationship"; event "Employment relationship changed / changes" (Overview and History aligned) |
| Dispositions | Cancelled · Voided (Assignment rows of disposed periods now use the same badges instead of "Not operational") |
| Starts | "starts" (future) / "started" (past) — "begins" removed from Overview |
| Assignment dates | Effective since (current) · Takes effect on (upcoming) · Effective from / Replaced on / Effective through (history) — Overview now uses the same labels |
| Empty states | "No Employment Period has been recorded." · "Only cancelled or voided Employment Periods exist. They are kept for history and have no effect." · "No assignment has been added for this Employment Period." (shared keys for Overview, Employment, Assignment) |

### Visual semantics (all tabs)

Current = normal surface (green left borders removed from Employment / Assignment current cards; the text badge "Current" stays) · Upcoming = INFO accent (D-UI-12) · Historical = neutral surface + neutral badge · Cancelled = muted · Voided = muted + dashed + "Voided". Primary red is used only for the primary action and navigation. Field styling: Overview cards now use the same label-above-value grid as Personal / Employment / Assignment; card titles share one size (Personal card title aligned); badges, radius and borders come from the same tokens.

### Issues found

| Issue | Screen(s) | Severity | Decision |
|---|---|---|---|
| "Employee rehired" inferred without an explicit marker | History | High (misleading) | **Fixed now** — neutral "New Employment Period started" |
| Current assignment dated "Effective Date" vs "Effective since" | Overview vs Assignment | Medium | **Fixed now** |
| Overview label/value layout differed from the other tabs | Overview | Medium | **Fixed now** (shared grid) |
| Disposed assignment rows badged "Not operational"; cancelled rows dashed like voided | Assignment | Medium | **Fixed now** (Cancelled / Voided badges; dashed only for Voided) |
| Current cards with green border in two tabs, plain in Overview | Employment, Assignment | Low | **Fixed now** |
| Three different sentences for "no assignment" / "no employment"; Assignment tab used plain text instead of the empty state | Overview, Employment, Assignment | Low | **Fixed now** |
| "begins" vs "starts"; Overview Relationship Change titled "New Employment Period" | Overview, History | Low | **Fixed now** |
| Completeness rule version code shown to HR | Overview | Low (developer language) | **Fixed now** — plain sentence, version in tooltip |
| Redundant "Start Date is the start of this employment period." on every Overview | Overview | Low | **Fixed now** (removed) |
| "Needs attention" casing; "No lifecycle events recorded"; "Last day of the employment period. ·" | List, Employment, Overview | Low | **Fixed now** |
| Personal card title larger than other card titles | Personal | Low | **Fixed now** |
| History badge "Planned" vs card badge "Upcoming" | History vs tabs | Low | **Kept**: events are *Planned*, states are *Upcoming*; both use the INFO treatment |
| Header shows the representative (e.g. upcoming) job title for Pre-start | Header | Info | **Kept**: same rule as the Employee List (C-76), qualified by the status badge; never labelled "current" |
| Duplicate actions (inventory below) | Header, Employment, Assignment | Medium | **UI-9** (D-UI-13, D-UI-16) |
| Workflow forms still say "Line Manager", "Effective To (exclusive)", "End Date (inclusive)"; inline form styling | Workflow forms | Medium | **UI-9** (forms → modals, wording aligned) |
| Add Employee uses "Mobile Phone" / "Personal/Contact Email" | Add Employee | Low | **UI-8** |
| Phone width: tabs wrap to two lines, header actions under the name | All | Low | Accepted (desktop/laptop primary; nothing unreachable) |

### Action duplication inventory (current state, unchanged in this pass)

| Action | Header primary | Header More actions | Employment period card | Assignment tab | Personal tab |
|---|---|---|---|---|---|
| Change Assignment (representative period) | ✓ | — | — | — (other periods: their latest row) | — |
| Add Initial Assignment (representative period without assignment) | ✓ | — | ✓ secondary | ✓ empty card, secondary | — |
| Edit Work Email / End Employment / Change Employment Relationship (representative) | — | ✓ | ✓ | — | — |
| Correct Employment Period / Correct or Clear Work Email / Cancel Planned Period / Reverse End (representative) | — | ✓ Correct record | ✓ Correct record | — | — |
| Void Employment Period (representative, eligible) | — | ✓ Advanced | ✓ Advanced | — | — |
| Period actions of other periods | — | — | ✓ only | — | — |
| Rehire / Plan Rehire / Add Initial Employment Period | — | ✓ only | — | — | — |
| Correct Name or Date of Birth | — | ✓ only | — | — | hint only |
| Edit Personal Information | — | — | — | — | ✓ only |
| Correct assignment (row) | — | — | — | ✓ only, on its row | — |

No new duplicate was introduced in this pass.

### Confirmed UI-9 ownership direction (D-UI-13, D-UI-16)

- Header: primary **Change Assignment** (or **Add Initial Assignment** when the representative period has none) + person-level actions only: Rehire / Plan Rehire, Add Initial Employment Period, Correct Name or Date of Birth.
- Employment-Period actions only on their period card (remove the representative period's period actions from header More actions).
- The representative period's empty Assignment card explains the missing assignment without its own button; non-representative / future periods keep a secondary Add Initial Assignment.
- Assignment-row corrections stay on their row; Edit Personal Information stays in the Personal tab.
- Workflow forms move to the modal pattern with aligned wording (Manager, business date wording).

### Evidence

| Check | Result |
|---|---|
| Unit suite / typecheck / lint / build | 148/148 unit tests (history test updated for the neutral label); typecheck, lint, production build pass. Frontend-only: DB/UAT suites not re-run |
| Responsive | 1440 / 1280: header on one line, Overview two columns; ~900: Overview stacks, More actions menu inside the viewport; phone: no horizontal scroll, menus reachable |
| Visual QA (synthetic data, 1440 px) | A Active DEMO001; B Pre-start DEMO901; C Ended DEMO003; D Rehire DEMO004 (Overview + History "New Employment Period started"); E Relationship Change DEMO905 (Overview + Employment); F Planned End DEMO903; G Voided / No Employment Record DEMO906 (Overview + Assignment) |
| Smoke | Employees → DEMO905 → Overview (aligned upcoming wording) → Personal → Employment → Assignment → History after restart; no server errors |

## 17. UI-8 — Add Employee wizard (implemented 2026-10-10)

Scope: the Add Employee page only. No backend, API, business rule or permission change.

### Create semantics verified before implementation

| Question | Finding (`POST /api/v1/core-hr/employees`, `createEmployee`) |
|---|---|
| What creates the record | One request with optional `personal`, optional `employment` (`start_date`, `employee_type_id`, `work_email`) and optional `employment.assignment` (`department_id` + `job_title_id`, optional `job_level_id`, `manager_person_id`) |
| Transaction | **One database transaction**: Person, Employee Code (issued, or legacy code registered), first Employment Period, its start event, Initial Assignment and audit record. Atomic — a failure saves nothing |
| Employee Code | Issued inside the transaction on save (`nextGeneratedCode`); a legacy code only with `employees.set_code` |
| Initial Assignment date | Always the Start Date (no separate input exists) |
| Work Email | Optional at save. The Employee Type's server flag `requires_work_email` drives the completeness rule after the start date (PV-03); no hard requirement |
| Idempotency | `Idempotency-Key` per content; a retried identical request replays the same result (no duplicate person) |
| Validation | Full Name required; inactive catalog values rejected; manager must be employed on the Start Date; future DOB rejected; unusual start date only a warning; optional "require completeness" refuses incomplete records |

Consequence: the wizard needs no new API and no recovery path for partial creation — there is no partial state. Real blocker: none.

### Wizard

Personal → Employment → Assignment → Review (shared `Stepper` primitive: current step `aria-current="step"`, completed steps marked "✓" and "completed" in text, only reached steps can be revisited). One page, values kept across Back / Next / Edit (reducer, unit-tested). Next = red primary, Back = secondary, Cancel = ghost. Focus moves to the step heading on each step and to the first invalid field on a failed check. Nothing is saved before **Save Employee** on Review.

| Step | Fields (labels shared with the Employee Detail tabs) | Required |
|---|---|---|
| Personal | Full Name; Date of Birth, Gender, Mobile, Personal Email (only with `employees.write_personal`); "Keep an existing (legacy) Employee Code" disclosure only with `employees.set_code` | Full Name only |
| Employment | Start Date, Employee Type (active catalog values), Work Email | None; Employee Type / Work Email need a Start Date. Work Email hint follows the server flag: "Expected for this Employee Type…" or "Optional for this Employee Type." — never a `*` |
| Assignment | Department, Job Title, Level, Manager (active employees, "Name (Code)"); "Takes effect on <Start Date>" shown read-only | Optional as a whole; once started, Department and Job Title are required (`*` appears); Level and Manager never required. Disabled with an explanation when there is no Start Date |
| Review | Personal / Employment / Assignment summaries with Edit buttons; "Only save if the record is complete" (existing option); "Saving creates the employee record, its Employment Period and assignment together. If saving fails, nothing is saved." | — |

No duplicate-person warning or matching (D-UI-8): only the server's exact conflicts are shown (duplicate legacy Employee Code, Work Email already in use). No National ID, address, family, bank or notes fields. Copy aligned: Mobile, Personal Email, Manager (not "Line Manager"), Start Date (never Join / Hire Date).

### Saving and failure behaviour

- One request; the Save button is guarded synchronously and disabled while saving ("Saving the employee record…") — three rapid clicks sent one request in QA. Back and step navigation are locked during the save.
- Success → the new record's Overview with "Employee record created." (`?created=1`, removed from the URL afterwards). A Pre-start record shows Upcoming Employment / Upcoming Assignment (UI-3 semantics).
- Validation / business error → nothing was saved: "Nothing was saved. Correct the highlighted fields and save again." shown on whichever step HR is returned to; server field errors (e.g. invalid Mobile, Work Email in use, manager not employed on the Start Date, duplicate code) are mapped to their field and step.
- Lost connection → "The connection was interrupted, so the result is unknown. Saving again is safe: the same details will not create a second employee." (same Idempotency-Key).
- Saving without an assignment is a valid, intentional result (the record shows Needs Attention and the header offers Add Initial Assignment) — not a partial failure.
- Catalog loading: "Loading…" in the select, "No active values — add them under Organization" when empty, error box with **Try again** on API failure.
- Leaving with unsaved input: confirmation on Back to Employees / Cancel, browser prompt on reload or close; no drafts.

### Evidence

| Check | Result |
|---|---|
| Unit `tests/unit/add-employee-wizard.test.ts` (18) | name-only payload (optional DOB / Gender omitted), full payload in one request, Level / Manager optional, Department + Job Title pairing, no assignment effective date sent, capability-filtered payload (personal, legacy code), completeness option; step checks (Full Name, Start Date needed for employment fields, assignment needs employment); Work Email never required, hint from the server flag; Back / Next / Edit keep values; no jump to unreached steps; no change while saving; dirty tracking; server field errors → field and step; creation result URL; capabilities; no role names |
| Unit suite / typecheck / lint / build | 166/166 unit tests; typecheck, lint, production build pass. Frontend-only: DB/UAT suites not re-run |
| Browser QA (synthetic data, HR Admin test identity) | A Personal; B Employment — Employee; C Employment — Service Contractor (Work Email hint differs, never required); D Assignment; E Review; F validation (Full Name, Department / Job Title pairing; server invalid Mobile → back to Personal, "Nothing was saved"); G success → Overview of **ES0032 "UI8 QA Pre-start (Synthetic)"** (Pre-start, Upcoming Assignment, Complete); H intentional no-assignment result **ES0033 "UI8 QA No Assignment (Synthetic)"** (Needs Attention, Add Initial Assignment). Exactly one person per save confirmed in `hrms_dev` (read-only check) |
| Responsive / accessibility | 1440 / 1280 / ~900: four-step stepper, two-column fields; phone: two-column stepper, one-column fields, no horizontal scroll; labels associated, `aria-invalid` / `aria-describedby` on errors, focus management, state in text |

