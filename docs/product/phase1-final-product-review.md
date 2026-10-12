# Mini HRS — Core HR Phase 1 Final Product Review

- Date: 2026-10-11 · Mode: **review / polish only**. Phase 1 feature scope is **frozen**; no new capability, API or P1 work.
- Baseline: `main` at `f10b547` (phone-width overflow fixed). Polish commit `33e59fb`.
- **Milestone (candidate): Core HR Phase 1 — Product/UI Freeze Candidate** (2026-10-12) — pending the product owner's local visual review and final acceptance. Release status remains **UAT Passed With Pre-Production Actions**. **Not Production Ready**: Gate A 0/8 and Gate B 0/5 per `docs/production/pre-production-readiness-plan.md`.
- Evidence:
  - browser walk-through on synthetic `hrms_dev` (HR Admin, HR Editor, API Docs test identities);
  - DOM measurements in same-origin iframes at six widths;
  - code audit;
  - unit tests run from `main` only (`--exclude ".claude/**"`; worktree copies are not counted).

---

## A. Executive assessment

**Phase 1 is complete as a product.**
- Every HR task A–Q has one clear place and finishes without technical knowledge.
- Business changes, data corrections and recovery actions are visibly separated.
- History is preserved, and Home gives a truthful at-a-glance state.

The review found **no product regression**. It fixed eight small presentation defects (§C). Four of them were inconsistencies or gaps from earlier slices:
- the list label still read "Record Completeness";
- English dates showed "Sept";
- error detail lines could show technical field names and internal ids;
- two PV-29 error codes had no UI text.

What remains before real use is **pre-production**, not product: legal, production identity, infrastructure, backup, migration and onboarding rehearsals, support, and the Go / No-Go (§G). No P0 product item is open.

## B. End-to-end journey scorecard

| # | Task | Where | Result |
|---|---|---|---|
| A | Understand workforce state | Home: Workforce Snapshot, Needs Attention, Upcoming — next 30 days | **Clear** |
| B | Find an employee | Employees: search + Employment Status / Employee Type / Department / Record Health filters; URL state; Back keeps the list | **Clear** |
| C | Create an employee | Add Employee: 4 steps + Review, one atomic save | **Clear** (Manager is a plain select — acceptable at EmeSoft size) |
| D | Understand an employee in ~5 s | Detail header (name, code, title · department · type, status) + Overview cards | **Clear** |
| E | Add Initial Assignment | Header primary when the representative period has none; period card for other periods | **Clear** |
| F | Change Assignment | Header primary (Drawer) | **Clear** |
| G | Cancel Planned Assignment | Assignment tab → latest Upcoming Assignment (Modal) | **Clear** |
| H | End Employment | Period card (Drawer); a blocking planned assignment points to Cancel Planned Assignment | **Clear** |
| I | Reverse End | Period card → Correct record (Modal, `employment.correct`) | **Clear** |
| J | Change Employment Relationship | Period card (Drawer); one History item | **Clear** |
| K | Rehire | More actions (Drawer); History reads "New Employment Period started" | **Clear** |
| L | Correct personal data | More actions → Correct Name or Date of Birth; Personal → Edit Personal Information | **Acceptable** (corrections are not shown in History — accepted, D-UI-7) |
| M | Correct Employment Period | Period card → Correct record (Drawer, HR Admin) | **Acceptable** (same History limitation) |
| N | Correct Assignment | Assignment row → Correct (Drawer, HR Admin) | **Acceptable** (same History limitation) |
| O | Cancel Planned Employment Period | Period card → Correct record (Modal) | **Clear** |
| P | Void erroneous Employment Period | Period card → Advanced → Void (Drawer with dependency preview) | **Clear** |
| Q | Maintain Organization reference data | Organization: four tabs, Add / Edit / Deactivate / Reactivate, code immutable, Employee Type policy read-only after creation | **Clear** |

No task is "Needs polish" or "Regression".

### B.1 Information architecture (confirmed)

- **Top level:** Home · Employees · Organization. API Docs appears only for `docs.read` holders, in the sidebar footer.
- **Employee Detail:** Overview · Personal · Employment · Assignment · History.
- **Not reintroduced:** Reports, Admin, Documents, Notifications. None is needed for Phase 1. Access administration is a guarded CLI (C-89 / C-94); documents and reports are Later.

### B.2 Action ownership (confirmed in the browser, HR Admin and HR Editor)

| Context | Actions |
|---|---|
| Header | Primary Change Assignment / Add Initial Assignment; More actions = person / lifecycle level only (Rehire / Add Initial Employment Period, Correct Name or Date of Birth) |
| Employment Period card | Edit Work Email, End Employment, Change Employment Relationship · Correct record (Correct Employment Period, Correct / Clear Work Email, Cancel Planned Period, Reverse End) · Advanced (Void) |
| Assignment row | Correct; **Cancel Planned Assignment** on the latest Upcoming Assignment only |
| Personal tab | Edit Personal Information |

No action appears in two competing contexts. Overview and Home are action-free.

### B.3 Record Health and Home / Overview consistency

- **Record Health** has one source: the server's `completenessView`. Employee List, Overview, Home and the Add Employee result all display it, and none recomputes it.
- `personProjection` is shared by the list and Home. The dashboard test asserts `needs_attention.total` = the list `operational_completeness=incomplete` total.
- **Optional fields stay optional:** Manager, Level, DOB, Gender, Mobile and Personal Email are not completeness items. Personal Email counts only as the PV-03 contact alternative.
- **Home and Overview Upcoming** use one pure module (`employments/upcoming.ts`). The consistency test compares them per person.
  - Relationship Change is one item.
  - Cancelled / voided periods and PV-29 cancelled assignments never appear.

### B.4 Terminology (final)

| Concept | Final user-facing term |
|---|---|
| Completeness | **Record Health** (Complete / Needs Attention) — now on the list filter too (was "Record Completeness"); the API parameter `operational_completeness` is unchanged |
| Relationship type | Employee Type |
| Employment record | Employment Period |
| Organisational placement | Assignment — Current / Upcoming / Historical / Last Assignment |
| Planned end | "Planned End" (field); "Employment scheduled to end" (event) — Home now uses the same event wording as Overview / History |
| Record dispositions | Cancelled, Voided (badges, never statuses) |
| Dates | Start Date, End Date, Planned End, Effective since, Takes effect on, Effective from, Replaced on, Effective through, Was planned for. No interval or "inclusive / exclusive" wording |
| Reporting line | Manager (never "Line Manager") |

## C. Final polish fixes (commit `33e59fb`, presentation only)

| # | Fix | Files |
|---|---|---|
| 1 | Workflow forms: all legacy inline styles removed (form margins, action rows, Relationship Change e-mail choices, Period Correction checkbox, Void preview headings, Work Email editor). Action rows use `.form-actions`, so Drawer / Modal spacing and button alignment match the newer forms | 11 `src/app/employees/[id]/*Form.tsx` / `WorkEmailEditor.tsx`; helpers `.choice-group`, `.list-lead`, `.flush`, `.stack-form` in `globals.css` |
| 2 | List filter label "Record Completeness" → **"Record Health"** | `src/i18n/messages/en.ts` |
| 3 | English dates use three-letter months ("02 Sep 2024"; Intl en-GB wrote "Sept"). Business dates are never time-zone shifted | `src/i18n/index.ts` |
| 4 | Home planned end: "Employment ends" → **"Employment scheduled to end"** (Overview / History wording) | `en.ts` |
| 5 | Error details: technical field names (e.g. `end_date`) are no longer shown | `src/components/ErrorBox.tsx` |
| 6 | Error details: detail codes whose server text names internal ids (`FUTURE_ASSIGNMENT_OUTSIDE_END`, `FUTURE_ASSIGNMENT_EXISTS`, `LATER_ASSIGNMENT_EXISTS`, `ASSIGNMENT_OUTSIDE_PERIOD`) show plain guidance ("… Check the Assignment tab."); repeated lines are shown once | `ErrorBox.tsx`, `en.ts` |
| 7 | UI text for the PV-29 codes `LATER_ASSIGNMENT_EXISTS` / `ASSIGNMENT_CANCELLED` | `en.ts` |
| 8 | Stale `OPERATIONAL_PROFILE_INCOMPLETE` wording ("Uncheck the requirement" — the option was removed in UI-9) | `en.ts` |

Regression tests: `tests/unit/phase1-polish.test.ts` (date format, terminology, no inline styles in workflow forms, ErrorBox output without ids or field names); `tests/unit/home.test.ts` updated.

## D. Regressions found

**No product regression** in behaviour, permissions or data.

The following are gaps, not regressions; all were fixed or are accepted:

| Item | Status |
|---|---|
| Phone-width page overflow (all pages, 375 / 390 px) | Fixed before this review (`f10b547`); re-verified (§D.1) |
| PV-29 error codes without UI text | Fixed (#7) |
| Error details exposing technical field names / ids (pre-existing since S4; mostly unreachable because forms pre-check) | Fixed (#5, #6) |

### D.1 Responsive result (after `f10b547`)

- **Pages:** `document.documentElement.scrollWidth ≤ clientWidth` for **54 / 54** combinations.
  - Surfaces: Home, Employees, Add Employee, Overview, Personal, Employment, Assignment, History, Organization.
  - Widths: 1440, 1366, 1280, 900, 390, 375.
- **Overlays:** End Employment Drawer, Edit Work Email Modal and More actions menu at 1366 / 390 / 375. The document is not widened and each overlay box stays inside the viewport (the Drawer is full width at phone sizes).
- The employee table scrolls inside its own container (intended). No global overflow clipping is used.

### D.2 Permissions

- **HR Editor** (browser): only Edit Work Email, End Employment, Change Employment Relationship, Cancel Planned Assignment, Edit Personal Information, Change Assignment and Correct Name or Date of Birth.
  - No Correct record, Void or assignment Correct.
  - Organization is read-only (no Add, no Actions column).
  - Zero disabled mutation buttons.
- **No `employees.read`** (API Docs identity): no Home / Employees navigation and the permission message on `/`. The API returns 403 (tests).
- **No role-name checks** in UI code (role names appear only in comments). Visibility comes from `session.can`; the server enforces every permission.

### D.3 Accessibility (focused pass)

| Check | Result |
|---|---|
| Tabs | Arrow-key navigation |
| Modal / Drawer | Focus moves in, Tab is trapped, Escape closes, focus returns to the opener |
| Focus ring | Global `:focus-visible` |
| Workflow fields | Labelled (implicit or `htmlFor`); new forms use `Field` with `aria-invalid` / `aria-describedby` |
| Statuses | Text badges, not colour only |

No clear defect found; nothing changed.

## E. Accepted limitations (preserved; not blockers)

| Limitation | Why accepted |
|---|---|
| History does not show corrections, Work Email / personal changes, actor or Recorded At | No audit-read API (D-UI-7); the technical owner can query audit on request; audit viewer is Gate C |
| Native date inputs follow the browser / OS locale (e.g. `31/12/2026`) | No date-picker dependency in Phase 1. Mitigated: the Add Employee Review ("Starts 16 Nov 2026") and workflow Timeline Impact ("31 Dec 2026 is the final date…") repeat the chosen date unambiguously |
| A future assignment in History reads "Assignment changed" + Planned badge | Approved UI-7 pattern (badge carries the tense) |
| Manager is a plain select | Adequate at ~70–100 people; searchable picker is P1 |
| No Documents / Contracts, Export (Pending Legal Review), configurable Access Roles, reports, notifications, org chart, duplicate-person engine, AI features, custom date picker, HR_VIEWER role (PV-07) | Deliberately out of Phase 1 scope |
| Legacy workflow forms still use their own label / input markup (now without inline styles) | Visually consistent inside the Drawer / Modal; migrating to the `Field` primitive is P1 refactor |

## F. Product scope freeze

| Class | Items |
|---|---|
| **P0 PRODUCT — COMPLETE** | Core HR lifecycle (create, assignment change / initial / correction / **cancel planned**, end, reverse end, relationship change, rehire, cancel planned period, void, period and personal corrections), Employee List, Employee Detail (5 tabs), Add Employee wizard, Organization reference data, **Home / Action Center**, capability-based UI, responsive layout. **No open P0 product item.** |
| **P0 PRE-PRODUCTION — REMAINING** | §G (Gate A1–A8, Gate B1–B5) |
| **P1** (only after go-live or by explicit decision) | Searchable Manager picker; duplicate-person warning (needs an HR matching decision, D-UI-8); legacy workflow forms onto the `Field` primitive; per-requirement list filter for Needs Attention |
| **LATER** | Audit-read History / audit viewer; Export (after Legal); Documents / Contracts; configurable Access Roles / in-app access screen (C-85, Gate C); reports and analytics; notifications; org chart; usage counts before Deactivate; Reverse Relationship Change (PV-24); Working Arrangement (PV-15); probation module (PV-16); custom date picker; HR_VIEWER (PV-07) |

## G. Pre-production handoff (separate from UI readiness)

These are owned outside product UI work and tracked in `docs/production/pre-production-readiness-plan.md`. Gate A blocks any real employee data; Gate B blocks go-live.

| Gate | Item | Notes / open decisions |
|---|---|---|
| A1 | Legal / privacy approval (processing basis + notice, retention incl. backups, hosting / vendor, impact assessment, HR access to personal fields) | Pending Legal Review; Export stays deferred |
| A2 | Production infrastructure (hosting, private DB, TLS, secrets, least-privilege roles, production config, log hygiene) | Pending IT |
| A3 | Production Entra sign-in (real v2 tokens; test identity provably off) | PV-11 (tenant / client ids, scope) |
| A4 | Access operator provisioning and named owners | Command built (C-94); PV-26 owners, PV-28 operators / logins |
| A5 | Backup + a successful restore rehearsal | PV-27 recovery targets |
| A6 | Deployment & migration rehearsal (runbook, staging) | Migrations through `20261014000000_cancel_planned_assignment` |
| A7 | Data onboarding method on synthetic data (mapping, real catalogs, reconciliation template) | PV-05, PV-06, PV-08 |
| A8 | Signed Real-Data Go / No-Go | Management + HR system owner + technical owner |
| B1 | Real-data load reconciled and signed by HR | Integrity scan 0 / 0 on the loaded data |
| B2 | Minimum monitoring / support visibility | Availability alert, actionable logs, scan on production |
| B3 | Support model in writing | |
| B4 | HR smoke acceptance on production with real sign-in (+ legal go-live duties) | |
| B5 | Explicit human Production Ready decision | Never self-declared by engineering |

## H. Final screenshot evidence (synthetic data, 1366 × 900 unless noted)

1. Home — snapshot, Needs Attention (24), Upcoming (10 of 13)
2. Employees — "Record Health" filter, "02 Sep 2024" date
3. Add Employee — Review (not saved)
4. Active Employee Overview (DEMO802)
5. Employment (Correct record menu present for HR Admin)
6. Assignment (Current + Upcoming with Cancel Planned Assignment)
7. History
8. Lifecycle Drawer — End Employment (filled, not saved; aligned action row)
9. Organization — Departments
10. 375 px Home — `scrollWidth 375 = clientWidth 375`

Screenshots were delivered with the review report; they are not committed to the repository.

### Tests / build for this review

- Unit suite from `main` only (`--exclude ".claude/**"`): **219 / 219** (19 files).
- Shared `formatDate` is used in two server messages, so these integration files were run: `relationship-change.test.ts` and `void-employment.test.ts` — **36 / 36**.
- Typecheck, lint, production build: pass.
- No DB / UAT suite rerun: no domain or business code changed.

## I. Product/UI freeze (2026-10-12)

The review was accepted with one final copy cleanup (commit after `cfe5269`):
- Overview → Record Health no longer shows "Completeness rule: MVP decision, pending HR validation." or the rule-version tooltip.
- It now shows the neutral helper "Record Health reflects required operational information only." (2026-10-12 defect fix: the earlier helper listed specific optional fields and would go stale if the completeness rule changed, PV-04).
- The unused duplicate string "Rule {version} — MVP decision, pending HR validation." was removed.
- No rule version, internal validation status or project terminology is shown to HR users. The API still returns `rule_version` for traceability.
- The completeness rule's governance status is unchanged in the decision register (MVP Decision; PV-04 open).
- Void blocker for a period created by a Relationship Change (2026-10-12 defect fix): the project reference "(PV-24)" is no longer shown. It now reads "This Employment Period was created by a Relationship Change. Reversing that Relationship Change is not available yet."

**Core HR Phase 1 — Product/UI Freeze Candidate** (pending the product owner's local visual review; final owner acceptance turns it into Product/UI Frozen). No further product development in Phase 1. The next phase is **Pre-production Readiness, starting from Gate A** (§G).

Checks for the cleanup:
- unit suite from `main` only: 220 / 220;
- typecheck, lint, production build: pass.

