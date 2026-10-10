# Mini HRS — Core HR Phase 1 UI Refresh: Audit and Implementation Map

- Status: **AUDIT — awaiting approval. No UI code has been changed.**
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
