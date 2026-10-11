# PV-29 — Cancel Planned Assignment (design proposal, revision 1)

- Status: **Pending Validation — design only, awaiting approval. Nothing is implemented.**
- Date: 2026-10-11. Raised by the Core HR product checkpoint (`docs/design/core-hr-product-checkpoint.md` §D).
- Priority: **P0 before go-live** (recovery capability).
- Governing principles:
  - C-84 — strict on history and integrity, flexible on operations; recovery is first-class.
  - C-85 — authorize by permissions.
  - C-28 — future assignments are never changed automatically.
  - C-29 / C-70 — Cancel Planned Period, the closest precedent.
  - C-37 — `employment_event` scope.
  - C-24 — free-text reasons are never exposed.
  - C-54 — exact reversal or no reversal.
- Decisions marked **BD-n** need HR/Product approval. Items marked **T-n** are technical and follow from approved rules.

---

## 1. Problem

A future-dated Assignment Change can block later lifecycle actions. End Employment (C-28) and Relationship Change both refuse when an assignment starts after the requested date, and they tell HR to "correct it first". HR then has no legitimate way to withdraw the plan:

- **Correct Assignment** (S4.6, `employment.correct`) is the wrong tool. The plan may have been correct when entered; the business decision changed later. Correcting would also misstate history (moving its date is the C-84 "date manipulation" anti-pattern). It cannot remove the row anyway (C-42: a row may not become empty or leave the period).
- **Void** applies to whole periods entered in error, not to plans that changed.
- **Example deadlock:** a promotion is planned for 01 Nov; the employee resigns effective 31 Oct; End Employment on 31 Oct is refused.

**Cancel Planned Assignment** is a normal lifecycle action: *"this planned assignment will not take effect"*. It is not a correction and not a delete.

## 2. Current assignment persistence semantics (verified in code)

| Aspect | Current behaviour | Source |
|---|---|---|
| Row model | `job_assignment(employment_id, effective_from, effective_to, department_id, job_title_id, job_level_id, manager_employment_id, change_reason, record_source, created_at, created_by)`. There is **no disposition column**: every row is operational | `prisma/schema.prisma`, init migration |
| Range | **Half-open `[effective_from, effective_to)`**; `effective_to` NULL = open | init migration comment; `assignment-change.ts` |
| DB invariants | `job_assignment_dates_ck` (to > from); **`job_assignment_no_overlap_ex`** (gist exclusion per employment over `daterange(from, to, '[)')`); deferred **`job_assignment_within_employment`** trigger (from ≥ period start; to ≤ period end + 1 when the period has an end); `job_assignment_manager_not_voided` (PV-25) | migrations `20261007…`, `20261012…` |
| Scheduling a change on date *d* (`createAssignmentChange`) | Refused if any row starts on/after *d* (`FUTURE_ASSIGNMENT_EXISTS`). Finds the row covering *d* (`previous`); refused if none (`NO_ASSIGNMENT_IN_EFFECT`). Then **`previous.effective_to := d`** and inserts the new row **`[d, previous.old_effective_to)`** — the new row *inherits* the predecessor's closing boundary (NULL, or period end + 1). Free-text reason goes to audit only; `change_reason = 'assignment_change'` | `assignment-change.ts` |
| Consequence for chains | **A → B (future) → C (later future) is allowed**: scheduling C after B finds B as `previous`. Inserting a row *between* existing rows is not allowed | same |
| Boundary carried by the last row | End Employment closes the row in effect on the end date at end + 1 and stores `closed_assignment_id` / `closed_assignment_previous_effective_to` on the `end` event; Period Correction moves the last row's `effective_to` when it was aligned with the old end | `end-employment.ts`, `period-correction.ts` |
| Reverse End | Restores `closed_assignment_id`'s `effective_to` exactly; refuses when the effect changed or **any later row exists** | `reverse-end.ts` |
| Representative / current queries | Pure `representativeAssignment` / `completenessAssignment` over the rows the caller passes (detail, list, completeness C-78). Every caller loads **all** rows of the operational periods | `status.ts`, `people/service.ts` |
| History | Derived from assignment rows (first row = "assignment added", later = "assignment changed"; future = status Planned). No `employment_event` for assignments (C-37) | `historyModel.ts` |
| Reasons | Assignment Change reason: audit only. Cancel Planned Period reason: on the event + audit. API never exposes free text (C-24) | `schemas.ts` |

## 3. Business semantics

- A *planned* assignment is one whose `effective_from` is after today (Asia/Ho_Chi_Minh). It has never taken effect.
- Cancelling it means **"it will not take effect"**. The row is kept unchanged as evidence, gets a **terminal disposition** *Cancelled*, and is excluded from every operational query.
- Whatever was in effect before it **continues as if the plan had never been scheduled**: the predecessor gets back the boundary the plan had inherited.
- There is no "un-cancel" (**BD-10**). If the plan becomes valid again, HR schedules a new Assignment Change.

## 4. Eligibility

All of the following must hold:

1. The row's `effective_from` **> today** (Vietnam business date). A row effective **today** has taken effect and is not cancellable (same rule as Cancel Planned Period, C-70) — **BD-2**.
2. The row is not already cancelled (otherwise `409 ASSIGNMENT_CANCELLED`, read-only).
3. Its Employment Period is writable: loaded via `loadWritableEmployment` (not Cancelled / Voided → `409 EMPLOYMENT_PERIOD_READ_ONLY`).
4. It is the **latest operational row of its period**: no non-cancelled row starts after it (`409 LATER_ASSIGNMENT_EXISTS`) — **BD-3**.
5. If it has an operational predecessor, the predecessor is **contiguous**: `predecessor.effective_to = row.effective_from`. Otherwise `422 ASSIGNMENT_TIMELINE_NOT_CONTIGUOUS`; an unrelated legacy gap is never repaired silently (C-42 practice).
6. It is **not the `closed_assignment_id` of the period's Active End Event**. Otherwise `422 ACTIVE_END_EVENT_EXISTS` with "Use Reverse End Employment first, then cancel the planned assignment" — **BD-5**.
   - Reason: Reverse End restores that exact row (C-54). If the row were cancelled, an exact reversal would no longer exist. This mirrors the Cancel Planned Period precedent.
7. A non-empty reason (`422 REASON_REQUIRED`) — **BD-6**.
8. `expected_revision` matches (`409 REVISION_CONFLICT`); `Idempotency-Key` is present.

**Not blockers** (deliberately — "do not invent blockers"):

- The row references a manager (references from a cancelled row stop mattering operationally).
- Other people's assignments reference this person's period as manager (the period is unaffected).
- A later Employment Period exists (the row is inside its own period).
- A planned end date without an End event (the boundary is restored exactly, §5).
- Being a Pre-start period (the whole period could also be cancelled; both are legitimate).
- Leaving the period without any assignment (**BD-4**).

## 5. State / data changes

### 5.1 Model — an assignment disposition (recommended), not an event

| Option | Fit | Verdict |
|---|---|---|
| **Disposition column `job_assignment.cancelled_at timestamptz NULL`** | Mirrors `employment.cancelled_at` / `voided_at`. The row itself states it is not operational. One predicate `cancelled_at IS NULL` serves queries, constraints and the scanner | **Recommended** |
| New `employment_event` type (e.g. `assignment_cancelled` + `assignment_id`) | C-37 limits events to Employment lifecycle; assignments have no events today. Every operational query would need a NOT EXISTS join; constraints cannot use it | Rejected |
| Hard delete / move dates / zero-length row | Destroys evidence or falsifies history | Rejected |

- The actor, time, reason and structural change go to **audit** (same request id), exactly like Assignment Change.
- No `cancelled_by` column: audit carries the actor, as for Assignment Change. (`employment.cancelled_at` has its actor on the event.)

### 5.2 The atomic command (one transaction)

1. Load and lock the period (`loadWritableEmployment`); bump the person revision (`bumpPersonRevision(expected_revision)`).
2. Load the period's **operational** rows (`cancelled_at IS NULL`), ordered by `effective_from`. Verify the eligibility rules of §4.
3. **Predecessor restoration (derived, not hard-coded):**
   - Scheduling did `pred.effective_to := B.from` and gave B the old `pred.effective_to`.
   - Any later move of the period boundary (End Employment, Period Correction) was applied to B, because B is the last row.
   - So the exact inverse is **`pred.effective_to := B.effective_to`**: NULL for an open period; period end + 1 for a period with a planned or recorded end; whatever boundary B carries now.
   - No gap and no truncation results, and the period's last row stays aligned with its end.
   - Without a predecessor (planned Initial Assignment) nothing else changes; the period has no operational assignment afterwards.
4. Set `B.cancelled_at = now()`. B's dates and values are **never** changed.
5. Audit:
   - `assignment.cancel_planned` (entity `job_assignment` B; changed field `assignment.cancelled`; reason);
   - when a predecessor exists, `assignment.effective_to` on the predecessor with the structural old/new value (like End Employment's `assignment.close`).
   - Same request id and reason; manager ids are never logged (C-24).

Worked check (derived, not special-cased):

| Before | After cancelling B |
|---|---|
| A `[01 Jan, 01 Nov)`, B `[01 Nov, NULL)`, open period | A `[01 Jan, NULL)`; B Cancelled `[01 Nov, NULL)` |
| Period ends 31 Dec (planned): A `[01 Jan, 01 Nov)`, B `[01 Nov, 01 Jan next)` | A `[01 Jan, 01 Jan next)` |
| A → B `[01 Nov, 01 Dec)` → C `[01 Dec, NULL)`: cancel C, then B | After C: B `[01 Nov, NULL)`; after B: A `[01 Jan, NULL)` |
| Pre-start period starting 02 Nov with Initial Assignment `[02 Nov, NULL)` | No operational assignment; Add Initial Assignment is available again |

### 5.3 Database changes (one new forward migration; committed migrations untouched) — T-1

All four changes are non-destructive: there are no existing cancelled rows and nothing is backfilled.

1. `ALTER TABLE job_assignment ADD COLUMN cancelled_at timestamptz NULL`.
2. Replace `job_assignment_no_overlap_ex` with the same exclusion **`WHERE (cancelled_at IS NULL)`**. A cancelled row keeps its range as evidence while the predecessor is extended over it.
3. `job_assignment_within_employment()`: ignore rows with `cancelled_at IS NOT NULL`. After cancellation, End Employment may legitimately move the period end before the cancelled row's dates. Evidence rows are not containment subjects, just as voided-period rows are never re-validated.
4. New guard trigger **`job_assignment_cancelled_is_terminal`**: once `cancelled_at` is set, the row is immutable and `cancelled_at` cannot be cleared. This is the hard-constraint layer for objectively invalid writes; "effective after today" is time-dependent and stays an application rule verified by the scanner.

`job_assignment_manager_not_voided` needs no change: it fires on manager/date updates. Cancelling writes neither, and restoring the predecessor re-checks the predecessor as today.

### 5.4 Shared operational predicate — T-2

- Add `operationalAssignmentWhere()` (`{ cancelledAt: null }`) and a pure `operationalAssignments(rows)` to the shared query module (`queries.ts`). This is the only place that decides whether an assignment is operational, as `operationalEmploymentWhere` does for periods.
- Every operational reader and writer must use it:
  - list `include` and candidate filter;
  - detail representative / completeness;
  - Assignment Change (`NO_ASSIGNMENT_YET`, `FUTURE_ASSIGNMENT_EXISTS`, `previous`);
  - Add Initial Assignment (`count > 0`);
  - Assignment Correction (and refuse a cancelled target: `409 ASSIGNMENT_CANCELLED`);
  - Period Correction (first / last row moves);
  - End Employment and Relationship Change (blocking rows, closed row);
  - Reverse End (closed row lookup and "later row exists");
  - Void `manager_dependency`;
  - the void-preview assignment count.
- The detail API keeps returning **all** rows, with an additive `cancelled_at` per assignment (like `historyFlags` for periods), so history stays visible.

## 6. API — T-3

```
POST /api/v1/core-hr/assignments/{id}/cancel-planned
Headers: Idempotency-Key (required); the usual bearer authentication
Body:    { "expected_revision": <int ≥ 1>, "reason": "<1–1000 chars>" }   (strict object)
201      EmployeeDetail (Idempotent-Replayed: true on replay)
```

- Follows the existing conventions:
  - an action route per row, like `POST /assignments/{id}/corrections`;
  - the `cancel-planned` verb, like `POST /employments/{id}/cancel-planned`;
  - the same `CancelPlannedCreate`-style body;
  - 201 + `EmployeeDetail`;
  - `runIdempotentCommand` with operation `createAssignmentCancelPlanned` and `resourceId` = assignment id (`personIdForAssignment` already exists).
- The employment id is implied by the assignment and is not repeated in the path. No generic assignment-state API.
- Errors (all existing envelope):

| Status | Code |
|---|---|
| 404 | not found |
| 403 | forbidden |
| 409 | `REVISION_CONFLICT`, `EMPLOYMENT_PERIOD_READ_ONLY`, `ASSIGNMENT_CANCELLED`, `LATER_ASSIGNMENT_EXISTS`, `IDEMPOTENCY_KEY_REUSED` (same key, different body) |
| 422 | `REASON_REQUIRED`, `ASSIGNMENT_ALREADY_EFFECTIVE`, `ASSIGNMENT_TIMELINE_NOT_CONTIGUOUS`, `ACTIVE_END_EVENT_EXISTS` |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` |

- Contract: an additive nullable `cancelled_at` on assignment objects, then OpenAPI regeneration.

## 7. Permissions — BD-1

- **`employment.manage`** (HR_EDITOR and HR_ADMIN), not `employment.correct`.
- Validated against the architecture:
  - `employment.manage` is the "normal business events effective today or later" capability (`permissions.ts`, C-25). It already covers scheduling the same Assignment Change and Cancel Planned Period.
  - A cancellation is always about a future date, so there is no backdating dimension that would need `employment.correct`.
  - Whoever may schedule a plan may withdraw it. No new permission is needed (C-85: no materially different boundary).
- The server enforces it on the operation; the UI shows the action only when `session.can("employment.manage")`.

## 8. UI

- **Location:** Assignment tab → **Upcoming Assignment** card → **Cancel Planned Assignment**, next to the existing Correct (which stays `employment.correct`). It belongs to that row only.
  - It is not in the Employee header and not on the period card (no duplicate home).
  - The Overview Upcoming Changes card stays action-free.
- **Visibility:** only on the latest upcoming row of an operational period, for `employment.manage`.
  - An earlier upcoming row (chain case) shows the hint "To cancel this planned assignment, first cancel the later one." instead of the action.
- **Surface:** Modal (short form), like Cancel Planned Period. Success closes it, lands on the Assignment tab and shows the notice "Planned Assignment cancelled."
- **Wording:**
  - Title: `Cancel Planned Assignment`
  - Helper: `Use this when a future Assignment is no longer going to take effect.`
  - Context line: `<Job Title> · <Department>, planned for <date>`
  - Confirmation (built from the derived result, no range language):
    - "This planned Assignment will not take effect."
    - With a predecessor: "<Job Title> · <Department> stays in effect after <date>." Without: "This Employment Period will have no Assignment; the record will show Needs Attention until one is added."
    - "The planned Assignment stays in the history as Cancelled."
  - Reason (required): "Why is this plan no longer going ahead?"
  - Warning (soft, **BD-8**): when the predecessor's manager is not employed through the extended range — "The manager of the assignment that stays in effect is not employed after <date>. Review the manager after cancelling." Not a blocker (C-73).
- **Cancelled row display:** a muted "Cancelled planned assignments" section in the Assignment tab (reusing the D-UI-15 pattern), status badge **Cancelled**, no actions. It is never Current or Upcoming.
- **Blocking messages elsewhere (soft guidance, BD-9):** End Employment and Relationship Change keep blocking (C-28 unchanged). Their message becomes: "A planned assignment starts after this date (<list>). If it is no longer going ahead, cancel it from the Assignment tab first; if it was entered wrongly, correct it." No inline cancellation in Phase 1.
- **Not used:** "Delete", "Remove", "Correct", "Undo".

## 9. History — BD-7

- One entry replaces the row's former "Assignment change — Planned" entry: **"Planned Assignment cancelled"**.
  - Context: "<Job Title> · <Department> was planned for <date> and did not take effect."
  - Status badge: Cancelled.
  - For a cancelled Initial Assignment: "Planned initial Assignment cancelled".
- **Effective date semantics:** the entry is dated with the **planned effective date** (the date that will not happen). This is the same convention as "Planned Employment Period cancelled", which is dated with the planned start.
- **Recorded time:** the API will expose `cancelled_at`, but Phase 1 History, like every other entry, is ordered and dated by effective date and **does not show when the cancellation was recorded**. Who cancelled it and why live in audit only; there is no audit-read API (D-UI-7). This limitation is stated, not hidden.
- Never labelled "deleted" or "corrected". The predecessor's extension is not a separate history entry, because it is the consequence of the cancellation.

## 10. Integrity implications and scanner — T-7

| Scanner check | Change |
|---|---|
| `assignment_overlap` (error) | Consider only `cancelled_at IS NULL` rows (parity with the partial exclusion constraint) |
| `assignment_outside_period` (error) | Ignore cancelled rows (parity with the trigger) |
| `assignment_gap_after_first` (warning) | Compute `lead()` over operational rows only (a cancelled row must not create a false gap or hide one) |
| `last_assignment_not_aligned_with_period_end` (warning) | Last **operational** row |
| `manager_not_employed_on_date` (warning) | Operational rows only |
| `voided_period_referenced_as_manager` (error) | Operational rows only (parity with Void `manager_dependency`) |
| `end_effect_assignment_of_other_period` (error) | Unchanged |
| **New** `cancelled_assignment_was_effective` (error) | `cancelled_at` (Vietnam date) ≥ `effective_from`: cancelled after it took effect |
| **New** `active_end_event_closes_cancelled_assignment` (error) | An Active End Event's `closed_assignment_id` is cancelled (impossible under rule 4.6) |
| **New** `cancelled_assignment_in_disposed_period` | None needed: a cancelled period's rows are already non-operational. Cancelling inside one is refused by the write guard |

- **Parity rule:** the scanner's `a.cancelled_at IS NULL` is the SQL form of `operationalAssignmentWhere()`, as `VALID()` is for periods. Query semantics, the DB constraints and the scanner agree.
- Dependency review (actual effects only):

| Area | Effect |
|---|---|
| End Employment / Relationship Change | Unblocked once the blocking plan is cancelled; no rule change |
| Rehire | Unaffected (separate period) |
| Manager dependencies | Cancelled rows stop counting for Void `manager_dependency`; cancellation itself is never blocked by them |
| Completeness | Recomputed from operational rows; Initial-cancel → Department / Job Title items fail → Needs Attention (existing semantics, C-41 / C-78) |
| Representative / upcoming | Operational rows only |
| History | §9 |
| Reverse End | Closed-row lookup and the "later row exists" count use operational rows (a cancelled later row must not block) |

## 11. Test matrix

**Service / integration** (against `hrms_test` under the guard):

| # | Scenario | Expectation |
|---|---|---|
| A | Cancel one future Assignment Change | 201; B `cancelled_at` set; B's dates and values unchanged |
| B | Predecessor restoration | A.effective_to = B's former effective_to (open → NULL; planned end → end + 1); no gap, no overlap; detail Current = A after B's date |
| C | Cancel a future Initial Assignment (Pre-start; and Active period whose first row starts later) | Period has no operational assignment; Add Initial Assignment allowed again |
| D | Needs Attention | Completeness `department` / `job_title` unsatisfied; list `operational_completeness=incomplete` |
| E | Row effective today | 422 `ASSIGNMENT_ALREADY_EFFECTIVE` (date boundary via Vietnam "today") |
| F | Historical / current row | 422 `ASSIGNMENT_ALREADY_EFFECTIVE` |
| G | Row in a Cancelled or Voided period | 409 `EMPLOYMENT_PERIOD_READ_ONLY` |
| H | A → B → C: cancel C | Allowed; B regains C's boundary |
| I | A → B → C: cancel B | 409 `LATER_ASSIGNMENT_EXISTS`; nothing changed |
| J | End Employment before the plan | Blocked before cancellation (C-28 unchanged); succeeds after; closes A correctly at end + 1 |
| J2 | Relationship Change before the plan | Same as J |
| K | Current / Upcoming / list / representative | Cancelled row never returned as Current, Upcoming or list department / title |
| L | History | Detail still returns the row with `cancelled_at`; History model shows one "Planned Assignment cancelled" entry dated with the planned date |
| M | Permissions | HR_EDITOR (`employment.manage`) allowed; read-only user 403; HR_ADMIN allowed; UI shows the action by capability, no role names |
| N | Concurrency | Stale `expected_revision` → 409; two concurrent cancels / cancel vs Assignment Change on the same period → one wins, the other gets 409, no partial state |
| O | Idempotency | Same key + body → replay with `Idempotent-Replayed`; same key, different body → 409 `IDEMPOTENCY_KEY_REUSED` |
| P | Integrity parity | After every scenario `runIntegrityChecks` → 0 errors; partial exclusion lets A extend over cancelled B; new checks fire on hand-crafted bad fixtures in `hrms_test` only |
| Q | Active End Event closed the plan | 422 `ACTIVE_END_EVENT_EXISTS`; after Reverse End, cancel allowed |
| R | Reverse End after an earlier cancellation | A cancelled later row does not block reversal |
| S | Terminal disposition | Updating or un-cancelling a cancelled row fails in the DB (guard trigger); Assignment Correction on it → 409 `ASSIGNMENT_CANCELLED` |
| T | Void manager dependency | A cancelled row referencing M does not block Void of M |
| U | Audit | `assignment.cancel_planned` + predecessor `assignment.effective_to` share request id and reason; no manager ids |
| V | Non-contiguous predecessor (legacy gap fixture) | 422 `ASSIGNMENT_TIMELINE_NOT_CONTIGUOUS` |

**Unit / UI:**

- view models: action only on the latest upcoming row; hint on earlier rows; Cancelled section; header Add Initial Assignment re-appears after an Initial cancel;
- Modal wording without range language;
- surface = modal; success tab = assignment;
- no role-name checks;
- History entry kind and label.

**Contract:** OpenAPI includes the operation, the strict body and the additive `cancelled_at`.

## 12. Open decisions

| ID | Item | Recommendation | Type |
|---|---|---|---|
| BD-1 | Capability `employment.manage` (HR_EDITOR may cancel) | Yes — same capability that schedules the plan | **BUSINESS DECISION** |
| BD-2 | Strictly after today; a row effective today is not cancellable | Yes — consistent with C-70 | **BUSINESS DECISION** |
| BD-3 | Latest-only: a middle planned row cannot be cancelled while a later plan exists (cancel the later one first) | Yes — simpler and safer than relinking; chains are rare | **BUSINESS DECISION** |
| BD-4 | Cancelling a planned Initial Assignment is allowed and may leave the period without an assignment (Needs Attention) | Yes — C-41 already allows a period without assignment | **BUSINESS DECISION** |
| BD-5 | A plan closed by an Active End Event: block; Reverse End first | Yes — preserves exact reversal (C-54), mirrors Cancel Planned Period | **BUSINESS DECISION** |
| BD-6 | Reason mandatory; stored in audit only; never displayed | Yes — same as Assignment Change (C-23, C-24) | **BUSINESS DECISION** |
| BD-7 | History label "Planned Assignment cancelled", dated with the planned date, recording time not shown | Yes | **BUSINESS DECISION** |
| BD-8 | Predecessor's manager not employed through the restored range → warning only | Yes — C-73 precedent | **BUSINESS DECISION** |
| BD-9 | End Employment / Relationship Change: guidance to the new action only; no inline cancellation in Phase 1 | Yes | **BUSINESS DECISION** |
| BD-10 | Cancellation is terminal (no un-cancel); re-plan with a new Assignment Change | Yes | **BUSINESS DECISION** |
| T-1 | Migration: `cancelled_at`, partial exclusion constraint, trigger ignores cancelled rows, terminal guard trigger | As §5.3 | TECHNICAL |
| T-2 | Shared `operationalAssignmentWhere` / `operationalAssignments`; all readers and writers listed in §5.4 | As §5.4 | TECHNICAL |
| T-3 | Endpoint, schema, error codes, additive `cancelled_at`, OpenAPI | As §6 | TECHNICAL |
| T-4 | Audit actions and structural changes | As §5.2 | TECHNICAL |
| T-5 | Scanner changes and new checks | As §10 | TECHNICAL |
| T-6 | UI placement, Modal, Cancelled section, hint, copy through `src/i18n` | As §8 | TECHNICAL (after BD approval) |
| T-7 | DB CHECK "cancelled before effective" | Not added: time-zone-dependent expression; application rule + scanner check instead | TECHNICAL |

## 13. Implementation outline (after approval only)

1. Migration (T-1), applied to the guarded local `hrms_dev` only after approval; never staging / production without explicit approval.
2. Shared predicate and caller updates (T-2), with regression tests on the existing workflows.
3. Command + route + contract (T-3, T-4).
4. Scanner (T-5).
5. UI (T-6).
6. Docs: register PV-29 → Confirmed / MVP Decision with the approved BDs; UAT checklist addition.
