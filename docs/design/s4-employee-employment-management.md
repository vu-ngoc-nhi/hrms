# S4 — Employee & Employment Period Management (design)

- Status: **Design approved for S4 scope (decisions S4-01 to S4-09, 2026-10-09). Not implemented.**
- Cancel Planned Period data-model change (§9): **awaiting approval** before implementation.
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
| **Cancel Planned Period** (S4-09) | Allowed only before the period's start date. Reason required. The period is kept and visible but has no operational effect (§9) | No | No (never started) |

Normal business events (assignment change, end, rehire, relationship change, cancel) by HR_EDITOR must be effective **today or in the future** ("today" = Asia/Ho_Chi_Minh); a past effective date requires HR_ADMIN. Historical corrections are HR_ADMIN only with no fixed time window; all constraints must still pass (S4-05).

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
| `date_of_birth` | `employees.write_personal` | Correction | No | **Required** | No |
| `gender` | `employees.write_personal` | Simple edit | No | — | No |
| `mobile_phone`, `personal_email` | `employees.write_personal` | Simple edit (clear allowed) | No | — | No |
| `employee_code` | Nobody in S4 | — | — | — | — |
| `profile_state` | Nobody (deprecated, C-12) | — | — | — | — |
| `employment.work_email` | `employment.manage` | Simple edit | No (period value) | — | No |
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

## 6. Permissions (existing roles only; S4-02)

| Permission | HR_ADMIN | HR_EDITOR |
|---|---|---|
| `employees.update` (new) | ✓ | ✓ |
| `employees.write_personal` (existing) | ✓ | ✓ |
| `employment.manage` (new): assignment change, End Employment, Rehire, Relationship Change, Cancel Planned Period, Work Email | ✓ | ✓ (effective today or later only) |
| `employment.correct` (new): Employee Type, period dates, historical assignment corrections, and any past-dated business event | ✓ | **✗** |

## 7. API (planned)
`PATCH /employees/{id}`; `GET/POST /employees/{id}/employments` (history, rehire); `PATCH /employments/{id}` (work email, corrections); `POST /employments/{id}/end`; `POST /employments/{id}/relationship-change`; `POST /employments/{id}/cancel`; `GET/POST /employments/{id}/assignments`; `PATCH /assignments/{id}` (correction). All writes: `expected_revision`, single transaction, server-side permission and date checks; create-type actions: `Idempotency-Key`.

## 8. Edge cases

| Case | Handling |
|---|---|
| Overlapping periods | Rejected by the DB exclusion constraint (409 with the conflicting period). Cancelled periods excluded (§9, pending approval) |
| Backdated correction | HR_ADMIN only, reason required, no time window; preview of the effect |
| Future-dated rehire | Allowed; person is Pre-start until the start date |
| Incorrect Employee Type | HR_ADMIN correction on the same period; completeness and email rule recomputed |
| Missing Work Email | Allowed; shown as operationally incomplete where the type requires a company account |
| Ending a period with future assignments | **Blocked** (S4-08); list the assignments to correct first |
| Start-date correction vs first assignment | First assignment start must remain within the period; block if the correction would leave an assignment outside the period (correct the assignment first) |
| Editing historical records | Only via HR_ADMIN corrections with reason and audit |
| Concurrent edits | `expected_revision` mismatch → 409 |
| Manager whose period ends | Not blocked; historical references kept |

## 9. Cancel Planned Period — data-model analysis (awaiting approval)

**Current behavior**
- `employment` has no cancelled marker. `employment_event.event_type` allows `cancel_planned_start`, but nothing reads it.
- `employment_no_overlap_ex` covers **all** periods of a person (no `WHERE`), and `employment_work_email_period_ex` covers all periods with a work email.
- Status, representative period, completeness, list filters and the manager lookup read **all** periods.

**Why the event alone is not sufficient**
1. A cancelled future period would still be included in the overlap exclusion constraint, so HR could not create a valid replacement period with overlapping dates.
2. It would keep reserving its Work Email for those dates.
3. Status/completeness/list queries would still treat it as Pre-start unless every query joined events; exclusion constraints cannot reference another table.

**Recommended data-model approach** (smallest forward-only change)
- Add nullable `employment.cancelled_at timestamptz` and `employment.cancelled_by uuid` (FK `app_user`). The reason lives on the `cancel_planned_start` employment event (one per period).
- Recreate `employment_no_overlap_ex` and `employment_work_email_period_ex` with `WHERE (cancelled_at IS NULL)` (work-email: `WHERE (work_email IS NOT NULL AND cancelled_at IS NULL)`).
- DB guard: once `cancelled_at` is set it cannot be cleared or changed, and a cancelled period's dates/type cannot be edited (trigger). "Before the start date" is checked in the application (date-dependent).

**Required forward migration:** one new migration: add the two columns, drop and recreate the two exclusion constraints with the new `WHERE`, add the guard trigger, grant column access. Non-destructive: no data changes; existing periods are all non-cancelled.

**Effect on Employment Status:** cancelled periods are filtered out before computing status, representative period, completeness and list filters; a person with only cancelled periods computes as `no_employment`. Cancelled is not a status; the UI shows the period in history with a "Cancelled" marker.

**Effect on overlap constraints:** cancelled periods no longer block new periods or reserve a Work Email; all non-cancelled periods keep the current guarantees.

**Effect on assignments/history:** planned assignments stay (traceability) and still satisfy the "within period" trigger; they are ignored operationally because their period is cancelled. Manager lookups exclude cancelled periods. Nothing is deleted; the cancel event records actor, time and reason.

**Alternatives considered:** (a) event-only, derived in queries: cannot be used by the exclusion constraints; (b) shrinking dates or deleting the period: loses history and violates the no-delete rule; (c) a generic stored state column: overlaps with the computed-status decision (C-16).

## 10. Model implications for implementation (summary)
1. `audit_event.reason` (nullable) and a small table for old/new values of the approved structural fields.
2. End Reason storage: stable codes with a selectable flag (`RELATIONSHIP_CHANGE` not selectable), plus `end_reason_code` and optional note on the `end` employment event (or the period).
3. Three new permissions (`employees.update`, `employment.manage`, `employment.correct`) in the application allow-list; HR_EDITOR without `employment.correct`.
4. Cancel Planned Period columns and constraint changes (§9), pending approval.
5. `person.revision` increments on every person/child change; all S4 writes use `expected_revision`.
