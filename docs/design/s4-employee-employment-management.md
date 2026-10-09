# S4 — Employee & Employment Period Management (design)

- Status: **Design approved (decisions C-21 to C-29 and PV-19, 2026-10-09), including the Cancel Planned Period data model (§9). Not implemented.**
- Implementation slices (§11): **approved 2026-10-09 (C-33), order revised by C-39.** S4.0–S4.5 implemented. PV-20 resolved (C-30, C-31, C-32); Reverse End Employment behaviour approved (C-38), schema pending (PV-21, §13).
- Pre-S4.6 decisions (2026-10-09): C-34 Idempotency-Key semantics, C-35 Add Initial Assignment, C-36 Work Email clearing, C-37 lifecycle event scope, M-11 aggregate revision, C-40 S4.6 scope. **S4.6 contract (§12) approved 2026-10-09 (C-48) with C-41 to C-47; S4.5A and S4.6 authorized.**
- Decision IDs refer to `docs/decision-register.md`. Nothing here changes Pending Validation / Pending Legal Review items.

## 1. Scope

**Included**
1. View the employee profile and the full employment history (periods, assignments, events).
2. Edit profile and personal/contact fields.
3. Update the Work Email of a period.
4. Add Initial Assignment (C-35), assignment change (new effective-dated row) and assignment correction (same row).
5. Historical corrections of a period: Employee Type, start date, end date from one date to another (HR_ADMIN only); Work Email clearing (C-36).
5a. Reverse End Employment (C-38, S4.7R).
6. End Employment with a structured End Reason.
7. Rehire (new period).
8. Relationship Change (atomic end + new period).
9. Cancel Planned Period.
10. Required reasons, minimal audit metadata, aggregate optimistic concurrency (`expected_revision`, M-11), Idempotency-Key semantics for command endpoints (C-34).

**Excluded:** probation workflow; Working Arrangement; Leave; Payroll; Benefits; Contract management; External Workforce; full audit UI/module; approval workflows; Entra provisioning/deprovisioning; per-period company-account override (PV-14); automated retention; employee-code changes (PV-08); Excel (S5–S8); deletion of any person, period or assignment.

## 2. Definitions and action rules

| Action | Definition / rule | Creates period? | Ends period? |
|---|---|---|---|
| **Profile edit** | Update person fields (§4) | No | No |
| **Work Email update** | Add/replace the value of a period; uniqueness over the period's dates. Account deprovisioning is never represented by clearing it (C-36) | No | No |
| **Work Email clear** (C-36) | Data correction for an address that was wrong or should never have been recorded. HR_ADMIN only (`employment.correct`), reason required. Any non-cancelled period | No | No |
| **Add Initial Assignment** (C-35) | First Assignment of a non-cancelled period that has **no** Assignment records; within the period dates. HR_EDITOR and HR_ADMIN. Normal onboarding: no reason. Backdated on an existing period because historical data was missing: Initial Data Capture (PV-19 exemption), reason required. Never done through Assignment Change | No | No |
| **Assignment change** | Real organizational change: closes the current assignment at the effective date and opens a new row. Requires an assignment in effect; never used on a period without assignments (C-35). Effective date ≥ today for HR_EDITOR; past effective date requires HR_ADMIN (S4-05). Reason required | No | No |
| **Assignment correction** | Fix a wrongly entered assignment row in place (values and/or effective dates); no fake history. HR_ADMIN only (S4-02), including future-dated rows (C-40). Reason required | No | No |
| **Employee Type correction** | Fix a wrongly entered type on the same period. HR_ADMIN only. Reason required. Never used for a genuine relationship change | No | No |
| **Period date correction** | Fix a wrongly entered start date, or an end date **from one date to another** (C-40). HR_ADMIN only. Reason required. All constraints must pass (no overlap; assignments must fit). Clearing an end date is never a date correction | No | No |
| **Reverse End Employment** (C-38) | Undo an End Employment entered by mistake while the person never stopped working. HR_ADMIN only, reason required. Keeps the original `end` event and adds `end_reversed` referencing it (at most once); restores the period and the closed assignment from the effect data End Employment stored (never from audit). Not Rehire | No | Reopens it |
| **End Employment** | Explicit HR action (C-50): sets the end date of an open period, or shortens/confirms an existing future end date (never later); rejected once the period has ended or an Active End Event exists (C-51). End date (inclusive) + structured End Reason (S4-01) + note (mandatory for OTHER). End date ≥ today for HR_EDITOR; past end date requires HR_ADMIN. **Blocked** if any assignment of the period would fall outside the end date (S4-08); HR is told which assignments to correct. The open assignment is closed at end date + 1 | No | Yes |
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
| `employment.work_email` | Add/replace on a non-ended period: `employment.manage`. Clear (any period) and any change on an ended period: `employment.correct` (HR_ADMIN). Cancelled period: never (C-30, C-36) | Simple edit / correction (clear, or ended period) | No (period value) | Clear or ended period: **required** | No |
| `employment.employee_type_id` | `employment.correct` (HR_ADMIN) | Correction | No (fixed per period) | **Required** | **Yes** |
| `employment.start_date` | `employment.correct` (HR_ADMIN) | Correction | It is the effective date | **Required** | **Yes** |
| `employment.end_date` | End Employment (`employment.manage`; past date → HR_ADMIN), correction date → date (`employment.correct`), or Reverse End Employment back to open (`employment.correct`, S4.7R) | Event, correction or reversal | It is the effective date | **Required** | **Yes** |
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

**Lifecycle events vs audit (C-37):** `employment_event` holds Employment lifecycle/business events only (start, end, cancel planned start, later `end_reversed`). Profile edits, Work Email updates, Assignment Change and Assignment Correction write no event rows; they are represented by their domain records/effective dating and by audit. Audit is never used as rollback data (C-38).

**Missing events:** the absence of an event row means the system has no recorded event. Events are never synthesized for demo or migrated periods (UI copy: "No recorded events").

## 6. Permissions (existing roles only; S4-02)

| Permission | HR_ADMIN | HR_EDITOR |
|---|---|---|
| `employees.update` (new) | ✓ | ✓ |
| `employees.write_personal` (existing) | ✓ | ✓ |
| `employment.manage` (new): assignment change, End Employment, Rehire, Relationship Change, Cancel Planned Period, Work Email | ✓ | ✓ (effective today or later only) |
| `employment.correct` (new): Employee Type, period dates, historical assignment corrections, and any past-dated business event | ✓ | **✗** |

## 7. API (planned)
Implemented: `PATCH /employees/{id}` (S4.3); `PATCH /employments/{id}/work-email` (S4.4); `POST /employments/{id}/assignment-changes` (S4.5). Proposed for S4.6 (§12): `POST /employments/{id}/period-corrections`, `POST /assignments/{id}/corrections`, Work Email clearing on the existing PATCH. Later: `POST /employments/{id}/initial-assignment` (PV-22), `POST /employments/{id}/end` (S4.7), `POST /employments/{id}/reverse-end` (S4.7R), initial employment / rehire (S4.8), `POST /employments/{id}/relationship-change` (S4.9), `POST /employments/{id}/cancel-planned` (S4.10). There is **no generic `PATCH /employments/{id}`**: every correction or reversal is an explicit action. All writes: `expected_revision`, single transaction, server-side permission and date checks; command endpoints: `Idempotency-Key` (C-34).

## 8. Edge cases

| Case | Handling |
|---|---|
| Overlapping periods | Rejected by the DB exclusion constraint (409 with the conflicting period). Cancelled periods are excluded from the constraint (§9) |
| Backdated correction | HR_ADMIN only, reason required, no time window; preview of the effect |
| Future-dated rehire | Allowed; person is Pre-start until the start date |
| Incorrect Employee Type | HR_ADMIN correction on the same period; completeness and email rule recomputed |
| Missing Work Email | Allowed; shown as operationally incomplete where the type requires a company account |
| Ending a period with future assignments | **Blocked** (S4-08); list the assignments to correct first |
| Start-date correction vs first assignment | First assignment start must remain within the period; block if the correction would leave an assignment outside the period (correct the assignment first). Boundary alignment proposal: §12.2 |
| Period without assignments | Add Initial Assignment (C-35), never Assignment Change |
| Wrong End Employment | Reverse End Employment (C-38), never Rehire and never a PATCH clearing `end_date` |
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
5. `person.revision` increments on every person/child change; all S4 writes use `expected_revision` (single aggregate revision, M-11).
7. End Employment effect data and the `end_reversed` link for Reverse End Employment (PV-21, §13), added with S4.7.
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
| **S4.5 Assignment change** | Transfers/promotions with history | None | `POST /employments/{id}/assignment-changes` (implemented) | "New assignment" dialog with timeline preview | `employment.manage`; past date → HR_ADMIN | Reason; old/new dept/title/level ids and dates | S4.1, S4.2 | No |
| **S4.5A Add Initial Assignment** (C-41) | First assignment of a period that has none, without misusing Assignment Change | None | `POST /employments/{id}/initial-assignment` (`expected_revision`, `Idempotency-Key`); Assignment Change returns `422 NO_ASSIGNMENT_YET` on a period without assignments | "Add initial assignment" on non-cancelled periods without assignments | `employment.manage`; past date allowed (Initial Data Capture), reason required when backdated | Reason when backdated; structural values | S4.5 | No (C-41) |
| **S4.6 Historical corrections** (C-40; excludes Reverse End Employment) | Fix entry mistakes without fake history | None (one column-level grant only if §12.10 O2 option (a) is chosen) | `POST /employments/{id}/period-corrections` (type, start date, end date date → date); `POST /assignments/{id}/corrections`; Work Email clearing on the existing PATCH (§12) | "Correct" actions and "Clear Work Email" visible only to HR_ADMIN | `employment.correct` | Reason; old/new structural values; one audit event per modified record | S4.1, S4.2 | **Contract approval (PV-23)** |
| **S4.7 End Employment** | Explicit end with structured reason | Forward migration: End Reason reference data (`selectable` flag), `end_reason_code` + note on the `end` event, **and the effect data needed for a later reversal** (C-38; schema PV-21, §13) | `POST /employments/{id}/end` | End dialog (reason list, note mandatory for OTHER) | `employment.manage`; past date → HR_ADMIN | Reason code + note; old/new end date | S4.1, S4.5, S4.6 | PV-21 schema choice |
| **S4.7R Reverse End Employment** (C-38) | Undo a mistaken End Employment without Rehire | `end_reversed` event type + link (with S4.7 migration) | `POST /employments/{id}/reverse-end` (`expected_revision`, reason, `Idempotency-Key`) | "Reverse End Employment" on ended periods, HR_ADMIN only | `employment.correct` | Reason; old/new end date and assignment effective_to | S4.7 passing | No (C-38) |
| **S4.8 Add Initial Employment Period / Rehire** (two separate concepts, C-32 / C-26) | People without a real period get their first one; returning people get a new period | None | Separate actions, e.g. `POST /employees/{id}/initial-employment` and `POST /employees/{id}/rehire` (`Idempotency-Key`); shared internals allowed | "Add initial employment" for profiles with no non-cancelled period; "Rehire" for profiles whose real periods have all ended | Initial: `employment.manage`, past start allowed for HR_EDITOR (initial data capture), reason required when backdated on an existing Person. Rehire: `employment.manage`, past start → HR_ADMIN, reason required | Reason; structural values; initial capture audited as such | S4.7 | No (C-26, C-32) |
| **S4.9 Relationship Change** | Continuous type change (e.g. Intern → Employee) | None | `POST /employments/{id}/relationship-change` | Dialog: old end date, next-day start shown, new type, first assignment | `employment.manage`; past date → HR_ADMIN | Reason; system End Reason `RELATIONSHIP_CHANGE` | S4.7, S4.8 | No |
| **S4.10 Cancel Planned Period** | Undo a planned period without deleting history | None (S4.0) | `POST /employments/{id}/cancel-planned` | "Cancel planned period" on future periods | `employment.manage` | Reason via event + audit | S4.0, S4.1, S4.2 | No |

**Acceptance criteria and tests (all slices):** permission matrix per role (401/403, HR_EDITOR past-date 403, HR_ADMIN allowed); `expected_revision` mismatch → 409; idempotent replay for create-type actions (no duplicate rows/events/audit); atomicity on failure (nothing partial); audit rows match C-23/C-24 (reason present, old/new only for allowed fields, never personal values); operational queries exclude cancelled periods; OpenAPI contract and English-only messages. Slice-specific criteria:
- S4.0: existing 118 tests unchanged; probe-style constraint tests (cancelled period does not block, non-cancelled still blocked, terminal trigger); label "Pre-start".
- S4.5: previous row closed at the effective date; Employee Type untouched; effective date inside the period.
- S4.6: see §12.9.
- S4.7R: blocked when already reversed, when a later period or lifecycle event depends on the End event, or when the closed assignment changed since; restores the exact previous state atomically; original `end` event kept.
- S4.7: blocked when assignments fall outside the end date (C-28), listing them; open assignment closed at end date + 1; `OTHER` without a note rejected; `RELATIONSHIP_CHANGE` not accepted.
- S4.8: rejected while any non-cancelled period is open or future; same person and code; different type allowed.
- S4.9: new start = old end + 1 enforced; same type rejected (use Rehire); both writes atomic.
- S4.10: start date ≤ today rejected; second cancel rejected; replacement period with the same dates/email accepted; person no longer Pre-start.

### Resolved slice questions (PV-20, 2026-10-09)
- **Q1 → C-30:** Work Email on an ended period is an HR_ADMIN historical correction with reason; cancelled periods are immutable.
- **Q2 → C-31, C-38:** a mistaken End Employment is undone by the admin-only **Reverse End Employment** action (not Rehire, not a PATCH clearing `end_date`), preserving the original end event. Implemented as S4.7R after End Employment (C-39); schema PV-21 (§13).
- **Q3 → C-32:** **Add Initial Employment Period** is its own action, separate from Rehire.

## 12. S4.6 implementation contract — APPROVED 2026-10-09 (C-48)

Scope per C-40. The open points of §12.10 were decided as C-42 to C-46; where the decisions refine the original proposal, the decision wins (notably: the last Assignment moves with a corrected end date only when it was aligned with the old end date; an existing lifecycle event date is synced; inactive catalog values are allowed only in corrections).

### 12.1 Common rules (every S4.6 write)

| Aspect | Rule |
|---|---|
| Permission | `employment.correct` (HR_ADMIN). HR_EDITOR and API_DOCS_READER → 403; no token → 401. Exception: Work Email add/replace on a non-ended period keeps the S4.4 rule (`employment.manage`). Effective-date kind `historical_correction` (no time window, C-25) |
| Target | Loaded through `loadWritableEmployment`: unknown → 404; cancelled → 409 `EMPLOYMENT_PERIOD_READ_ONLY` |
| Concurrency | `expected_revision` required; exactly one `person.revision` bump per successful request (M-11); mismatch → 409 `REVISION_CONFLICT` |
| Reason | Required; trimmed, 1–1000 characters, else 422 `REASON_REQUIRED`. Stored only in `audit_event.reason`; never on domain rows and never shown in history (C-24) |
| Idempotency | The new POST command endpoints require `Idempotency-Key` with the C-34 semantics (key claimed first in the transaction). The existing Work Email PATCH keeps its S4.4 contract (no key; same value = 200 no-op) |
| No change | All requested values equal to the current values → 422 `NO_CHANGE` (POST commands) |
| Atomicity | One DB transaction; any failure leaves no row change, audit record or revision bump |
| DB errors | Period overlap → 409 `PERIOD_OVERLAP`; Work Email range → 409 `WORK_EMAIL_IN_USE`; assignment overlap or outside the period → 422 `ASSIGNMENT_TIMELINE_CONFLICT` |
| Lifecycle events | No new `employment_event` rows (C-37). Dates of existing `start`/`end` events: §12.10 O2 |
| Audit | One `audit_event` per modified record (entity = that record), all sharing the request's `request_id` and reason; `changed_fields` = field names; `audit_field_change` old/new only for C-24 fields; never Work Email, names or manager ids |
| Response | 200 with the full `EmployeeDetail` (new revision; status and completeness recomputed) |

### 12.2 Assignment coverage invariant (O1 — recommended)

Inside a non-cancelled period, from the first Assignment's `effective_from` to the period end, exactly one Assignment covers each day: no overlap (already enforced by the DB), no internal gap, and the last row ends with the period (`effective_to` = end date + 1, or NULL while the period is open). The first row may start after the period start (C-35 allows a later Initial Assignment). All `hrms_dev` data satisfies this today (read-only check, 2026-10-09). Consequence: `effective_to` is never edited directly; a correction moves a **boundary**, shown in the preview and audited on every row it touches:
- correcting the start of a non-first row moves the previous row's `effective_to` to the same date;
- correcting the period start moves the first row's `effective_from` only when it currently equals the old start date;
- correcting the period end moves the last row's `effective_to` to the new end date + 1.

Implementation note: `job_assignment_no_overlap_ex` is not deferrable, so a row is shrunk before its neighbour is extended within the transaction.

### 12.3 Period correction — `POST /api/v1/core-hr/employments/{id}/period-corrections`

Operation `createPeriodCorrection`, tag Employments, `Idempotency-Key` required. Request (strict; unknown fields → 400): `expected_revision` (integer ≥ 1), `reason` (string), and at least one of `employee_type_id` (uuid), `start_date` (date), `end_date` (date; `null` is accepted by the schema only to return the explicit error below).

| Field | Rules | Errors |
|---|---|---|
| `employee_type_id` | Must exist (inactive values: O3). Same period; never creates a period (a genuine relationship change is S4.9). Email expectation and completeness recomputed | 422 `UNKNOWN_REFERENCE` |
| `start_date` | ≤ end date when there is one; may move earlier or later (including into the future → Pre-start); no overlap with the person's other non-cancelled periods; Work Email range re-checked; first-row alignment per §12.2 | 422 `ASSIGNMENT_OUTSIDE_PERIOD` listing the rows (new start after a non-aligned row start, or the aligned first row would become empty); 409 `PERIOD_OVERLAP` |
| `end_date` | Only when the period already has an end date. New end ≥ start. Rows starting after the new end are **not** changed automatically (C-28). The last row's `effective_to` moves to the new end + 1. Past → future end: O4 | `null` → 422 `USE_REVERSE_END_EMPLOYMENT`; date on an open period → 422 `USE_END_EMPLOYMENT`; rows after the new end → 422 `ASSIGNMENT_OUTSIDE_PERIOD` listing them; 409 `PERIOD_OVERLAP` / `WORK_EMAIL_IN_USE` |

Start and end in one request are validated together (e.g. shifting a whole period). Audit: `employment.correct` on the employment with old/new `employee_type_id`, `employment.start_date`, `employment.end_date` as applicable; `assignment.correct` on each first/last row whose boundary moved (old/new `assignment.effective_from` / `assignment.effective_to`).

### 12.4 Assignment row correction — `POST /api/v1/core-hr/assignments/{id}/corrections`

Operation `createAssignmentCorrection`, tag Employments, `Idempotency-Key` required. Request (strict): `expected_revision`, `reason`, and at least one of `effective_from` (date), `department_id` (uuid), `job_title_id` (uuid), `job_level_id` (uuid | null), `manager_person_id` (uuid | null). No `effective_to` (derived, §12.2).

- Any row of a non-cancelled period: past, current or future-dated (future rows HR_ADMIN-only, C-40). Edited in place: same id, no new row; `record_source`, `change_reason`, `created_by` unchanged.
- Department and Job Title cannot be cleared; Job Level and Manager can. Catalog references must exist (inactive: O3). Manager: not the person themselves (`SELF_MANAGER`); must have a non-cancelled period covering the row's (corrected) `effective_from` (`MANAGER_NOT_EMPLOYED_ON_DATE`).
- `effective_from`: first row within [period start, row `effective_to`); any other row strictly after the previous row's `effective_from` and before its own `effective_to`; the previous row's `effective_to` moves with it (§12.2). Otherwise 422 `ASSIGNMENT_OUTSIDE_PERIOD` / `ASSIGNMENT_TIMELINE_CONFLICT`.
- Removing a mistaken row is not available (no deletion in S4; O5).

Audit: `assignment.correct` on the corrected row (field names; old/new `department_id`, `job_title_id`, `job_level_id`, `assignment.effective_from`; manager as field name only) and, when a boundary moved, `assignment.correct` on the previous row (old/new `assignment.effective_to`).

### 12.5 Work Email clear/correction — existing `PATCH /api/v1/core-hr/employments/{id}/work-email`

`work_email` becomes `string | null`; `reason` stays optional in the schema and is required by these rules:

| Period | value → other value | value → null (clear) | null → value |
|---|---|---|---|
| Pre-start / Active | `employment.manage`, no reason (S4.4) | `employment.correct` + reason | `employment.manage`, no reason |
| Ended | `employment.correct` + reason (S4.4) | `employment.correct` + reason | `employment.correct` + reason |
| Cancelled | 409 | 409 | 409 |

Same value (including null → null): 200 no-op, no audit, no bump (a stale revision is still 409). Audit actions: existing `employment.work_email.update` / `.correct`, new `employment.work_email.clear`; field name `employment.work_email` and reason only. Clearing is never account deprovisioning (C-36); completeness is recomputed and may become incomplete.

### 12.6 Not in S4.6

(Add Initial Assignment approved as C-41 and implemented as S4.5A.)

- End Employment (S4.7) and Reverse End Employment (S4.7R).
- **Add Initial Assignment (PV-22, proposed as a small slice before S4.6):** `POST /employments/{id}/initial-assignment`, `Idempotency-Key`, `employment.manage`; eligible only when the non-cancelled period has no assignment rows; `effective_date` within the period (default: period start); `effective_date` before today = Initial Data Capture (reason mandatory, HR_EDITOR allowed), otherwise no reason; `change_reason = 'initial_assignment'`; audit `assignment.initial` with structural values; no lifecycle event. Assignment Change would then reject a period with no assignments (422 `NO_ASSIGNMENT_YET`, pointing to Add Initial Assignment) and, defensively, a date with no assignment in effect (422 `NO_ASSIGNMENT_IN_EFFECT`). Today `hrms_dev` has no non-cancelled period without assignments.

### 12.7 UI (HR_ADMIN only; strings through `src/i18n`)

"Correct period" form (Employee Type, start date, end date — end only when the period has one) with a before/after preview including moved assignment boundaries; a "Correct" action on each assignment row (including future rows); "Clear Work Email" with a reason and a note that clearing is not account deprovisioning. Hidden for HR_EDITOR; the server enforces permissions regardless.

### 12.8 Schema

None for §12.3–§12.5: `audit_field_change` already allows every needed field. Only if O2 option (a) is chosen: one forward migration with a column-level `GRANT UPDATE (effective_date) ON employment_event TO hrms_app`.

### 12.9 Tests

- Every endpoint: HR_ADMIN 200; HR_EDITOR 403; API_DOCS_READER 403; no token 401; unknown 404; cancelled 409 `EMPLOYMENT_PERIOD_READ_ONLY`; missing/blank reason 422; stale revision 409 with nothing changed; unknown field 400; `NO_CHANGE` 422; C-34 idempotency cases (including the deterministic concurrent same-key case).
- Period: type correction recomputes completeness/email expectation; start earlier/later moves the aligned first row; overlap with another period 409; start beyond the first row's end 422 listing rows; start into the future → Pre-start; end date → date moves the last row; end before a row start 422 listing rows (rows untouched); `end_date: null` 422 `USE_REVERSE_END_EMPLOYMENT`; end on an open period 422 `USE_END_EMPLOYMENT`; extension overlapping the next period 409; extension conflicting with another Work Email range 409; cancelled periods do not block.
- Assignment: values corrected in place (same id, same row count, no events); future row corrected by HR_ADMIN, 403 for HR_EDITOR; boundary move updates the previous row; dates outside the allowed window 422; manager rules; Department/Job Title cannot be cleared.
- Work Email: the §12.5 matrix per role; clear without reason 422; clear with reason 200 and audit `employment.work_email.clear` without the address.
- Audit: action names, entity ids, shared `request_id`, reason, old/new only for C-24 fields, no raw personal values.
- Atomicity: a forced failure inside the transaction leaves rows, revision and audit unchanged.
- No `employment_event` row is written by any S4.6 action (C-37); the coverage invariant holds after every successful correction.
- OpenAPI regenerated and contract test green; English-only messages.

### 12.10 Open points — decided 2026-10-09 (O1 → C-42, O2 → C-43 option (a), O3 → C-44, O4 → C-45, O5 → C-46)

| # | Question | Recommendation |
|---|---|---|
| O1 | Adopt the assignment coverage invariant and boundary moves (§12.2)? | Yes: one row per day, no fake rows, and a transfer-date correction is one request instead of two through an intermediate gap |
| O2 | When a start or end date is corrected, what happens to the existing `start`/`end` event date? (a) Correct `effective_date` in place (same fact, wrong date; old/new in audit; needs the column-level grant) or (b) leave the event untouched (history then shows a date that differs from the period) | (a) |
| O3 | May a correction reference an existing but **inactive** Department / Job Title / Job Level / Employee Type? | Yes for corrections (they restore historical truth); unknown ids are still rejected. Normal business events keep requiring active values |
| O4 | May an end date move from the past to a future date (Ended → Active with a known end)? | Yes: it is still date → date; reopening to no end date stays Reverse End Employment |
| O5 | Removing an assignment row that should never have existed? | Out of S4 (no deletion); revisit with a separate decision if HR needs it |

## 13. PV-21 — schema for End Employment effect data and Reverse End Employment (for S4.7 / S4.7R)

**Decided 2026-10-09 (C-47), revised by C-52: Option A including `previous_end_date`** — `previous_end_date`, `closed_assignment_id`, `closed_assignment_previous_effective_to` (only on `end`), `reverses_event_id` (only on `end_reversed`, unique), plus the structured End Reason on `end`. End Employment may shorten or confirm an existing future end date (C-50), so the previous end date is not always null. Active End Event: C-51. Migration ships with S4.7. The analysis below is kept for context.

Behaviour is approved (C-38). With C-28 (End Employment is blocked when any assignment would fall outside the end date) and §12.2, End Employment changes exactly two things: the period's end date and at most one assignment (the row covering the end date). Reversal therefore needs one assignment id and two previous values.

**Option A — explicit nullable columns on `employment_event` (recommended, smallest).** One forward migration in S4.7:
- `end_reason_code` (FK to the End Reason reference data) and `end_note` — already planned for S4.7 (§10);
- `previous_end_date date` — the period end date before End Employment (NULL = open-ended);
- `closed_assignment_id uuid REFERENCES job_assignment(id)` — NULL when no assignment was closed;
- `closed_assignment_previous_effective_to date` — that row's `effective_to` before End Employment (NULL = open-ended);
- `reverses_event_id uuid REFERENCES employment_event(id)` with a partial unique index (one reversal per End event);
- `event_type` CHECK extended with `end_reversed`; CHECKs: effect columns only on `end` rows, `reverses_event_id` present if and only if `end_reversed`, previous `effective_to` only with `closed_assignment_id`; a small trigger ensures the referenced event is an `end` event of the same employment.

**Option B — separate 1:1 table** `employment_end_effect(end_event_id PK/FK, previous_end_date, closed_assignment_id, closed_assignment_previous_effective_to)` plus the same `reverses_event_id`. Keeps `employment_event` narrow, but adds a table and a join for one row per End Employment.

**Not chosen:** generic JSON effect payloads or event sourcing (excluded by C-38); audit records as rollback data (excluded by C-38).

**Reversal checks (S4.7R):** the event is an `end` event of this period and not already reversed; the period is not cancelled; the period end date still equals the End event date and the closed row's `effective_to` still equals end date + 1 (otherwise 409 `END_EFFECT_CHANGED`); no later lifecycle event on the period; no other non-cancelled period of the person starting after this period's start (409 `LATER_PERIOD_EXISTS` — covers Rehire and Relationship Change); overlap and Work Email ranges re-validated by the DB constraints. Then, atomically: restore `end_date` to `previous_end_date`, restore the closed row's `effective_to`, insert `end_reversed` (actor, reason, `reverses_event_id`), record audit, bump `person.revision`.

