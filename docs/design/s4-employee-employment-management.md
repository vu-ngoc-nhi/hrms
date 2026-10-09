# S4 — Employee & Employment Period Management (design)

- Status: **Design approved (decisions C-21 to C-29 and PV-19, 2026-10-09), including the Cancel Planned Period data model (§9). Not implemented.**
- Implementation slices (§11): **approved 2026-10-09 (C-33).** PV-20 resolved (C-30, C-31, C-32); Reverse End Employment representation pending (PV-21).
- Decision IDs refer to `docs/decision-register.md`. Nothing here changes Pending Validation / Pending Legal Review items.

## 1. Scope

**Included**
1. View the employee profile and the full employment history (periods, assignments, events).
2. Edit profile and personal/contact fields.
3. Update the Work Email of a period.
4. Assignment change (new effective-dated row) and assignment correction (same row).
5. Historical corrections of a period: Employee Type, start date, end date (HR_ADMIN only).
6. End Employment with a structured End Reason.
7. Rehire (new period).
8. Relationship Change (atomic end + new period).
9. Cancel Planned Period.
10. Required reasons, minimal audit metadata, optimistic concurrency (`expected_revision`), idempotency for create-type actions.

**Excluded:** probation workflow; Working Arrangement; Leave; Payroll; Benefits; Contract management; External Workforce; full audit UI/module; approval workflows; Entra provisioning/deprovisioning; per-period company-account override (PV-14); automated retention; employee-code changes (PV-08); Excel (S5–S8); deletion of any person, period or assignment.

## 2. Definitions and action rules

| Action | Definition / rule | Creates period? | Ends period? |
|---|---|---|---|
| **Profile edit** | Update person fields (§4) | No | No |
| **Work Email update** | Current value of a period; uniqueness over the period's dates | No | No |
| **Assignment change** | Real organizational change: closes the current assignment at the effective date and opens a new row. Effective date ≥ today for HR_EDITOR; past effective date requires HR_ADMIN (S4-05). Reason required | No | No |
| **Assignment correction** | Fix a wrongly entered assignment row in place (values and/or effective dates). HR_ADMIN only (S4-02). Reason required | No | No |
| **Employee Type correction** | Fix a wrongly entered type on the same period. HR_ADMIN only. Reason required. Never used for a genuine relationship change | No | No |
| **Period date correction** | Fix a wrongly entered start or end date. HR_ADMIN only. Reason required. All constraints must pass (no overlap; assignments must fit) | No | No |
| **End Employment** | Explicit HR action: end date (inclusive) + structured End Reason (S4-01) + note (mandatory for OTHER). End date ≥ today for HR_EDITOR; past end date requires HR_ADMIN. **Blocked** if any assignment of the period would fall outside the end date (S4-08); HR is told which assignments to correct. The open assignment is closed at end date + 1 | No | Yes |
| **Rehire** (S4-06) | All existing periods have ended; the person returns. Same Person and Employee Code; new period; same **or** different Employee Type; no minimum gap; never overlapping. Start date ≥ today for HR_EDITOR; past start requires HR_ADMIN. Reason required | Yes | No |
| **Relationship Change** (S4-07) | Continuous transition to a **different** Employee Type: atomically ends the current period with system reason `RELATIONSHIP_CHANGE` and creates the new period starting **exactly the next calendar day** (inclusive end date). If there is any gap, use End Employment + Rehire instead. Reason required | Yes | Yes |
| **Cancel Planned Period** (S4-09) | Explicit action (not a generic PATCH). Allowed only when the period is not already cancelled and its start date is **strictly after today** (Asia/Ho_Chi_Minh); `employment.manage`; reason required. Sets `cancelled_at` and writes the `cancel_planned_start` event atomically. **Terminal in S4**: no Uncancel/Restore; a mistakenly cancelled period stays as history and HR creates a new correct planned period. Never deletes (§9) | No | No (never started) |

Normal business events (assignment change, end, rehire, relationship change, cancel) by HR_EDITOR must be effective **today or in the future** ("today" = Asia/Ho_Chi_Minh); a past effective date requires HR_ADMIN (backdated Assignment Change, End Employment, Rehire and Relationship Change are HR_ADMIN). Historical corrections are HR_ADMIN only with no fixed time window; all constraints must still pass (C-25).

**Initial Data Capture exemption (PV-19 resolved):** creating the *first* Employment Period as part of initial profile creation (S3 `createEmployee`) is initial data capture, not a backdated business event, so HR_EDITOR may use a past start date there. The exemption applies only to that initial capture and never extends to later operational events. No day limit.

## 3. End Reasons (S4-01)

| Code | Label | Selectable in End Employment | Note |
|---|---|---|---|
| `VOLUNTARY_RESIGNATION` | Voluntary Resignation | Yes | Optional |
| `EMPLOYER_INITIATED_END` | Employer-initiated End | Yes | Optional |
| `PLANNED_TERM_COMPLETED` | Planned Term Completed | Yes | Optional |
| `MUTUAL_AGREEMENT` | Mutual Agreement | Yes | Optional |
| `PROBATION_NOT_PASSED` | Probation Not Passed | Yes | Optional |
| `OTHER` | Other | Yes | **Mandatory** |
| `RELATIONSHIP_CHANGE` | Relationship Change | **No** — set only by the Relationship Change action | Optional |

Cancel Planned Period is not an End Reason. `PROBATION_NOT_PASSED` is chosen explicitly by HR in End Employment; a probation outcome never ends a period by itself (C-17). Legal interpretation of end reasons: Pending Legal Review (PL-09).

## 4. Field-level edit matrix

| Field | Editable by | Action type | Effective-dated? | Reason | Audit old/new value? (S4-04) |
|---|---|---|---|---|---|
| `full_name` | `employees.update` (HR_ADMIN, HR_EDITOR) | Correction/change | No | **Required** | No (field name only) |
| `date_of_birth` | `employees.write_personal` | `null → date`: completion of missing data; `date → other date`: correction; `date → null`: removal | No | `null → date`: none. Correction or removal: **required** (clarified 2026-10-09). Same value: no change, no audit, no revision bump | No |
| `gender` | `employees.write_personal` | Simple edit | No | — | No |
| `mobile_phone`, `personal_email` | `employees.write_personal` | Simple edit (clear allowed) | No | — | No |
| `employee_code` | Nobody in S4 | — | — | — | — |
| `profile_state` | Nobody (deprecated, C-12) | — | — | — | — |
| `employment.work_email` | Non-ended period: `employment.manage`. Ended period: `employment.correct` (HR_ADMIN). Cancelled period: never (C-30) | Simple edit / historical correction when ended | No (period value) | Ended period: **required** | No |
| `employment.employee_type_id` | `employment.correct` (HR_ADMIN) | Correction | No (fixed per period) | **Required** | **Yes** |
| `employment.start_date` | `employment.correct` (HR_ADMIN) | Correction | It is the effective date | **Required** | **Yes** |
| `employment.end_date` | End Employment (`employment.manage`; past date → HR_ADMIN) or correction (`employment.correct`) | Event or correction | It is the effective date | **Required** | **Yes** |
| End Reason + note | End Employment / Relationship Change | Event | — | Structured code; note mandatory for OTHER | Code: yes; note: no (stored on the event) |
| Assignment department / job title / level | `employment.manage` (change) or `employment.correct` (correction) | Event or correction | Yes | **Required** | **Yes** (ids) |
| Assignment manager | Same as above | Event or correction | Yes | **Required** | **No** (field name only) |
| Assignment effective_from / effective_to | `employment.correct` (HR_ADMIN) | Correction | Yes | **Required** | **Yes** |

## 5. Minimal audit (S4-04)

Every write keeps the existing audit fields (actor, timestamp, action, outcome, entity, request ID, changed field names) and adds:
- **reason** where required (§4);
- **old/new values only** for `employee_type_id`, `department_id`, `job_title_id`, `job_level_id`, employment start/end dates and assignment effective_from/effective_to.

Never stored as raw values: full name, date of birth, gender, mobile phone, personal/contact email, Work Email, manager. No audit UI in S4.

**Employment History reason visibility (2026-10-09):** the generic history response exposes event type and event date only. It never exposes free-text event reasons, correction reasons, narrative notes or other free-text HR notes. A future structured End Reason code/label may be shown to HR_ADMIN and HR_EDITOR; free-text End Employment notes do not automatically become part of the generic history. No new permission or history-detail API in S4.

**Missing events:** the absence of an event row means the system has no recorded event. Events are never synthesized for demo or migrated periods (UI copy: "No recorded events").

## 6. Permissions (existing roles only; S4-02)

| Permission | HR_ADMIN | HR_EDITOR |
|---|---|---|
| `employees.update` (new) | ✓ | ✓ |
| `employees.write_personal` (existing) | ✓ | ✓ |
| `employment.manage` (new): assignment change, End Employment, Rehire, Relationship Change, Cancel Planned Period, Work Email | ✓ | ✓ (effective today or later only) |
| `employment.correct` (new): Employee Type, period dates, historical assignment corrections, and any past-dated business event | ✓ | **✗** |

## 7. API (planned)
`PATCH /employees/{id}`; `GET/POST /employees/{id}/employments` (history, rehire); `PATCH /employments/{id}` (work email, corrections); `POST /employments/{id}/end`; `POST /employments/{id}/relationship-change`; `POST /employments/{id}/cancel-planned`; `GET/POST /employments/{id}/assignments`; `PATCH /assignments/{id}` (correction). All writes: `expected_revision`, single transaction, server-side permission and date checks; create-type actions: `Idempotency-Key`.

## 8. Edge cases

| Case | Handling |
|---|---|
| Overlapping periods | Rejected by the DB exclusion constraint (409 with the conflicting period). Cancelled periods are excluded from the constraint (§9) |
| Backdated correction | HR_ADMIN only, reason required, no time window; preview of the effect |
| Future-dated rehire | Allowed; person is Pre-start until the start date |
| Incorrect Employee Type | HR_ADMIN correction on the same period; completeness and email rule recomputed |
| Missing Work Email | Allowed; shown as operationally incomplete where the type requires a company account |
| Ending a period with future assignments | **Blocked** (S4-08); list the assignments to correct first |
| Start-date correction vs first assignment | First assignment start must remain within the period; block if the correction would leave an assignment outside the period (correct the assignment first) |
| Editing historical records | Only via HR_ADMIN corrections with reason and audit |
| Concurrent edits | `expected_revision` mismatch → 409 |
| Manager whose period ends | Not blocked; historical references kept |

## 9. Cancel Planned Period — approved data model (C-29)

**Why the existing event alone is not sufficient:** `employment_no_overlap_ex` and `employment_work_email_period_ex` cover every period, and exclusion constraints cannot reference `employment_event`; a cancelled future period would keep blocking replacement periods, keep reserving its Work Email, and keep making the person Pre-start unless every query joined events.

**Model (approved):**
- One nullable operational marker: `employment.cancelled_at timestamptz`. Non-null = the planned period was cancelled before it began. No `cancelled_by` on `employment` in MVP: actor, reason and request metadata live in the `cancel_planned_start` employment event and in audit records (single source of the audit fact).
- Existing periods stay non-cancelled (`NULL`) by default.

**Constraints (new forward migration; committed migrations untouched):**
- Recreate `employment_no_overlap_ex` with `WHERE (cancelled_at IS NULL)`.
- Recreate `employment_work_email_period_ex` with `WHERE (work_email IS NOT NULL AND cancelled_at IS NULL)`.
- Verified on PostgreSQL 18.6 (rolled-back probe in `hrms_test`, 2026-10-09): a cancelled period does not block a replacement with the same dates and Work Email; two non-cancelled overlapping periods and duplicate active Work Emails are still rejected; clearing `cancelled_at` into an overlap is rejected by the constraint itself.
- Technical safeguards enforcing the approved terminal rule: a trigger rejecting any change of `cancelled_at` once set and any change of dates/Employee Type/Work Email on a cancelled period; a partial unique index allowing at most one `cancel_planned_start` event per period. "Start date strictly after today" is validated in the application (date-dependent).
- Migration is non-destructive (adds a nullable column; drops and recreates two constraints with a narrower predicate; adds a trigger and an index). Applying it to `hrms_dev` needs no reset.

**Action contract:** `POST /employments/{id}/cancel-planned` with `expected_revision`, mandatory `reason`, `Idempotency-Key`, one transaction: (1) validate start date > today; (2) validate not already cancelled; (3) set `cancelled_at`; (4) insert `cancel_planned_start` event (actor, reason); (5) insert audit record; (6) bump `person.revision`. Replaying the same key returns the stored result without a second event.

**Operational effect:** a cancelled period does not contribute to Employment Status, Pre-start, operational completeness, current/future relationships, manager resolution or current assignment resolution; does not block another valid period; does not reserve a Work Email. Its planned assignments remain stored (still inside the period, satisfying the existing trigger) with no operational effect. Nothing is deleted.

**Status:** Cancelled is not a lifecycle status. Codes stay `not_started`/`active`/`ended` (Pre-start/Active/Ended). A person without non-cancelled periods keeps the existing no-employment profile condition. The history UI may show a "Cancelled" badge on that record only.

**Query design:** a shared employment query module (e.g. `src/modules/core-hr/employments/queries.ts`) is the only place that defines:
- *operational periods* (non-cancelled) — default for status, completeness, list filters, manager resolution, current assignment;
- *current period*, *future planned periods* — built on operational periods;
- *employment history* — explicitly includes cancelled periods, flagged.

Services must use these helpers instead of writing `cancelled_at IS NULL` themselves; a test asserts that operational queries exclude cancelled periods.

**Cancelled periods are read-only (S4 rule, 2026-10-09):** once `cancelled_at` is set, no normal or correction write may target the period: editing period fields, Work Email, adding/editing/correcting/changing assignments, End Employment, Relationship Change. The record and its planned assignments stay visible for traceability only; nothing is deleted and there is no Uncancel/Restore. Enforcement: the employment trigger protects the period row itself; every S4 write path loads its target through the shared domain guard `loadWritableEmployment` / `assertEmploymentWritable` (in `employments/queries.ts`), which rejects cancelled periods with 409 `EMPLOYMENT_PERIOD_READ_ONLY`. Assignment writes rely on this guard (no extra assignment trigger), covered by tests.

**Legal scope:** cancelling a planned period cancels an HR record only. It does not determine whether EmeSoft may legally withdraw or cancel a signed employment, internship or service agreement; any legal/contract consequence is Pending Legal Review (PL-10) / future Contract domain. No legal conclusion is drawn from a future start date.

## 10. Model implications (summary)
1. `audit_event.reason` (nullable) and a small table for old/new values of the C-24 structural fields.
2. End Reason storage: the C-21 codes as system reference data with a `selectable` flag (`RELATIONSHIP_CHANGE` not selectable), and `end_reason_code` + optional note on the `end` employment event.
3. Permissions `employees.update`, `employment.manage`, `employment.correct` in the application allow-list (HR_EDITOR without `employment.correct`).
4. `employment.cancelled_at`, the two narrowed exclusion constraints, the terminal-cancel trigger and the one-cancel-event index (§9).
5. `person.revision` increments on every person/child change; all S4 writes use `expected_revision`.
6. UI alignment: display label of `not_started` becomes "Pre-start" (C-16); stable code unchanged.

## 11. Implementation slices (approved 2026-10-09, C-33)

Each slice is implemented, tested and committed on its own; every slice ends with the full test suite, typecheck, lint, build and OpenAPI regeneration. Ordering note: the cancel marker and shared employment queries land first (S4.0) so every later query is written against *operational periods* from day one instead of being retrofitted.

| Slice | Objective / user value | Schema | API | UI | Permissions | Audit | Depends on | New business approval? |
|---|---|---|---|---|---|---|---|---|
| **S4.0 Foundation** | Safe base for all S4 writes; fixes the Pre-start label | Forward migration: `employment.cancelled_at`, narrowed exclusion constraints, terminal-cancel trigger, one-cancel-event index | None new (existing reads move to the shared query module, no behaviour change) | Label `not_started` → "Pre-start" | Add `employees.update`, `employment.manage` (HR_ADMIN, HR_EDITOR), `employment.correct` (HR_ADMIN) to the allow-list; helper enforcing C-25 (today/future for HR_EDITOR, past → HR_ADMIN, PV-19 initial-capture exemption) | None | — | No |
| **S4.1 Audit foundation** | Reasons and structural old/new values can be recorded | Forward migration: `audit_event.reason`, `audit_field_change` (event id, field, old, new) | None | None | — | `recordAudit` accepts reason and structural values; an allow-list rejects non-C-24 fields | S4.0 | No |
| **S4.2 Employment history (read)** | HR sees all periods, assignments, events, cancelled records | None | `GET /employees/{id}/employments` | Timeline on the detail page; "Cancelled" badge | `employees.read` | None | S4.0 | No |
| **S4.3 Profile edit** | HR keeps personal/profile data current | None | `PATCH /employees/{id}` (`expected_revision`) | Edit form with before/after review; reason field for name/DOB | `employees.update`, `employees.write_personal` | Field names; reason for name/DOB; no raw values | S4.1 | No |
| **S4.4 Work Email update** | IT-provisioned addresses recorded | None | `PATCH /employments/{id}/work-email` | Inline edit on the period card | Non-ended: `employment.manage`; ended: `employment.correct` + reason (C-30); cancelled: rejected | Field name only (+ reason when ended) | S4.1 | No (C-30) |
| **S4.5 Assignment change** | Transfers/promotions with history | None | `POST /employments/{id}/assignments` | "New assignment" dialog with timeline preview | `employment.manage`; past date → HR_ADMIN | Reason; old/new dept/title/level ids and dates | S4.1, S4.2 | No |
| **S4.6 HR_ADMIN corrections** | Fix entry mistakes without fake history | None for corrections; Reverse End Employment may need a small forward migration (PV-21) | `PATCH /employments/{id}` (type, start date, end date *changes* — never clearing it); `PATCH /assignments/{id}`; `POST /employments/{id}/reverse-end` | "Correct" / "Reverse End Employment" actions visible only to HR_ADMIN | `employment.correct` | Reason; old/new structural values; reversal keeps the original end event | S4.1, S4.2, S4.7 for reversal | Reverse End representation: **PV-21 design approval** |
| **S4.7 End Employment** | Explicit end with structured reason | Forward migration: End Reason reference data (`selectable` flag), `end_reason_code` + note on the `end` event | `POST /employments/{id}/end` | End dialog (reason list, note mandatory for OTHER) | `employment.manage`; past date → HR_ADMIN | Reason code + note; old/new end date | S4.1, S4.5 | No |
| **S4.8 Add Initial Employment Period / Rehire** (two separate concepts, C-32 / C-26) | People without a real period get their first one; returning people get a new period | None | Separate actions, e.g. `POST /employees/{id}/initial-employment` and `POST /employees/{id}/rehire` (`Idempotency-Key`); shared internals allowed | "Add initial employment" for profiles with no non-cancelled period; "Rehire" for profiles whose real periods have all ended | Initial: `employment.manage`, past start allowed for HR_EDITOR (initial data capture), reason required when backdated on an existing Person. Rehire: `employment.manage`, past start → HR_ADMIN, reason required | Reason; structural values; initial capture audited as such | S4.7 | No (C-26, C-32) |
| **S4.9 Relationship Change** | Continuous type change (e.g. Intern → Employee) | None | `POST /employments/{id}/relationship-change` | Dialog: old end date, next-day start shown, new type, first assignment | `employment.manage`; past date → HR_ADMIN | Reason; system End Reason `RELATIONSHIP_CHANGE` | S4.7, S4.8 | No |
| **S4.10 Cancel Planned Period** | Undo a planned period without deleting history | None (S4.0) | `POST /employments/{id}/cancel-planned` | "Cancel planned period" on future periods | `employment.manage` | Reason via event + audit | S4.0, S4.1, S4.2 | No |

**Acceptance criteria and tests (all slices):** permission matrix per role (401/403, HR_EDITOR past-date 403, HR_ADMIN allowed); `expected_revision` mismatch → 409; idempotent replay for create-type actions (no duplicate rows/events/audit); atomicity on failure (nothing partial); audit rows match C-23/C-24 (reason present, old/new only for allowed fields, never personal values); operational queries exclude cancelled periods; OpenAPI contract and English-only messages. Slice-specific criteria:
- S4.0: existing 118 tests unchanged; probe-style constraint tests (cancelled period does not block, non-cancelled still blocked, terminal trigger); label "Pre-start".
- S4.5: previous row closed at the effective date; Employee Type untouched; effective date inside the period.
- S4.6: correction that would leave an assignment outside the period or overlap another period is rejected with an explanation.
- S4.7: blocked when assignments fall outside the end date (C-28), listing them; open assignment closed at end date + 1; `OTHER` without a note rejected; `RELATIONSHIP_CHANGE` not accepted.
- S4.8: rejected while any non-cancelled period is open or future; same person and code; different type allowed.
- S4.9: new start = old end + 1 enforced; same type rejected (use Rehire); both writes atomic.
- S4.10: start date ≤ today rejected; second cancel rejected; replacement period with the same dates/email accepted; person no longer Pre-start.

### Resolved slice questions (PV-20, 2026-10-09)
- **Q1 → C-30:** Work Email on an ended period is an HR_ADMIN historical correction with reason; cancelled periods are immutable.
- **Q2 → C-31:** a mistaken End Employment is undone by the admin-only **Reverse End Employment** action (not Rehire, not a PATCH clearing `end_date`), preserving the original end event. Its event-model representation (PV-21) must be designed and approved before S4.6 implements it.
- **Q3 → C-32:** **Add Initial Employment Period** is its own action, separate from Rehire.
