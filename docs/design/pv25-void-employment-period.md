# PV-25 — Void Employment Period (pre-production design, revision 2)

- Status: **PV-25 — Accepted / Closed (2026-10-10).** Implemented as Confirmed Decision C-86; HR human acceptance V-1 to V-5 PASS recorded as C-87 (`docs/uat/pv25-hr-acceptance.md`). No Unvoid required for Phase 1. Forward migration `20261012000000_void_employment_period`; operations `getVoidEligibility` / `createVoidEmployment` (`employment.correct`); dependency checks `src/modules/core-hr/employments/void-dependencies.ts`; service `void-period.ts`; UI `VoidPeriodForm`. See *Implementation notes* at the end. Production Readiness is **not** declared by this item.
- Revision 2 (2026-10-10) applies the HR decisions on the first proposal: internal period activity (including End / End Reversed) no longer blocks; manager blocking is limited to references that rely on this period; an eligibility preview is added; dependencies are reclassified internal vs cross-period; PV-24 stays separate; no Unvoid.
- Baseline: `phase1-uat-passed`. Decision item: **PV-25** (HIGH PRIORITY — MUST BE RESOLVED BEFORE PRODUCTION READINESS). Related: PV-24, C-29/C-69–C-71, C-38/C-54–C-57, C-59, C-61, C-73, C-76–C-78.

## 1. Business definition

**Void Employment Period**: HR confirms that an **already-effective** Employment Period was created in error and the employment relationship it represents **never existed in reality**. The period and everything recorded inside it stay in the history; its final disposition becomes **Voided** and it has no operational effect.

Void must **not** be used for — these keep using the real lifecycle workflows:

| Situation | Correct workflow |
|---|---|
| Real employment that later ended (including probation not passed) | End Employment |
| A contract / relationship that actually started | It stays; correct data with Historical Correction; end it with End Employment |
| Ordinary termination | End Employment |
| Change of working relationship (e.g. Contractor → Employee) | Relationship Change; undoing it is PV-24 |
| A wrong End action while the person kept working | Reverse End Employment |
| A future plan that will not happen | Cancel Planned Period |
| Cleaning history for convenience | Not allowed |

The UI must state this definition on the confirmation screen and the reason is mandatory, so the record carries HR's explicit confirmation.

## 2. Eligibility matrix

No fixed time limit (same-day / N-day) — eligibility comes from the period's nature and from **cross-period dependencies** (§3), which are the actual risk.

| Candidate period | Eligible? | Rule |
|---|---|---|
| Effective (`start_date <= today`), non-cancelled, non-voided, the Person's **latest valid** period | **Yes**, unless a §3 blocker exists | Any origin: profile creation, Add Initial Employment, Rehire, legacy/import |
| Same, with internal activity (assignment changes, corrections, Work Email changes, planned end date, Active End Event, End + End Reversed) | **Yes** | Internal records do not block (§3.A) |
| Not the latest valid period (a later **non-cancelled, non-voided** period exists) | No — `LATER_PERIOD_EXISTS` | Later cancelled or voided periods do **not** count |
| Successor created by a Relationship Change (§3.B) | No — `RELATIONSHIP_CHANGE_SUCCESSOR` | PV-24 |
| Start date after today | No — `PERIOD_NOT_EFFECTIVE` | Use Cancel Planned Period |
| Cancelled or already voided | No — `EMPLOYMENT_PERIOD_READ_ONLY` | Dispositions are terminal |

## 3. Dependency matrix (revised)

### A. Internal to the erroneous period — never block; kept as history; non-operational after Void

| Record | After Void |
|---|---|
| `start` event (if any) | Kept |
| Initial assignment and later Assignment Change rows | Kept unchanged; non-operational through the period disposition |
| Historical corrections made on the period (dates, Employee Type, assignment rows) | Kept (their results stay on the rows; audit stays) |
| Work Email (current value, earlier changes in audit) | Value kept; reservation released (§7) |
| Planned end date / end date | Kept |
| **Active End Event** (incl. its End Reason and C-52 metadata) | Kept as history; **no Reverse End prerequisite**; it simply stops mattering because the whole period is voided |
| End + End Reversed pairs | Kept |
| Audit records of any earlier action | Kept (evidence only) |

### B. Cross-period — block Void

| Dependency | Blocker | Detection |
|---|---|---|
| A **later valid period** of the same Person (non-cancelled, non-voided, `start_date` after this period) — e.g. a Rehire or Relationship Change successor | `LATER_PERIOD_EXISTS` | Shared operational query |
| This period **is a Relationship Change successor** | `RELATIONSHIP_CHANGE_SUCCESSOR` → PV-24 | The immediately preceding valid period of the Person ends exactly on `start_date − 1` **and** its Active End Event has End Reason `RELATIONSHIP_CHANGE` (deterministic, from lifecycle data; audit is never used) |
| This period is a Relationship Change **predecessor** with a valid successor | Covered by `LATER_PERIOD_EXISTS` | — |
| **Manager dependency** from other employees (§4) | `MANAGER_DEPENDENCY` (lists the assignments) | §4 |
| Future modules: Payroll, Leave, Contracts | Module-specific codes, e.g. `PAYROLL_DEPENDENCY`, `LEAVE_DEPENDENCY`, `CONTRACT_DEPENDENCY` | Extension point (§3.D) |
| Future external-system references (e.g. Entra / account provisioning, external leave tool) | `EXTERNAL_REFERENCE` | Extension point |

### C. Explicitly not blocking

- Later **cancelled or voided** periods of the same Person.
- A Relationship Change **predecessor whose successor was cancelled** (the Relationship Change never took effect) — see open question Q2.
- Manager references to **other** periods of the same Person, references from other employees' **cancelled or voided** periods, and references whose dates do not overlap this period (§4).
- The person merely having appeared as a manager at some time.

### D. Extension mechanism for future modules

- A single ordered list of **void dependency checks** in the employments module; each check has a stable `key`, runs **read-only inside the caller's transaction**, receives the period and today's business date, and returns zero or more blockers `{ code, message, references[] }`.
- The eligibility preview (§8) and the POST action (§9) evaluate the **same list**.
- **Fail closed:** a check that errors blocks Void (it never silently passes).
- Phase 1 checks: `later_period`, `relationship_change_successor`, `manager_dependency`. Payroll, Leave and Contracts add their own check when they exist; this action does not change.

## 4. Manager dependency semantics (exact)

Let **V** be the period to void, with validity range `[V.start_date, V.end_date]` (open-ended when `end_date` is null; inclusive end), i.e. assignment-style `[V.start_date, V.end_date + 1)`.

An assignment **A** of **another** person creates a **blocking manager dependency** when all hold:

1. `A.manager_employment_id = V.id` — the manager reference was resolved to **this** period (manager references always point to the exact period valid on the assignment's effective date, `currentEmploymentWhere`);
2. A belongs to a **valid** period of its own person (non-cancelled, non-voided);
3. A's range `[A.effective_from, A.effective_to)` **overlaps** V's range — i.e. during that overlap the manager relationship is valid only because V exists.

Consequences:

- Such assignments are listed (person, Employee Code, assignment dates) and Void is blocked until HR corrects them explicitly (Assignment Change for current/future rows, Historical Assignment Correction for past rows). Nothing is rewritten or cleared automatically (C-73).
- References to **other** periods of the same person (earlier real employment) do **not** block — they do not rely on V.
- A reference to V with **no** overlap is already inconsistent; it does **not** block, but the preview returns it as a **warning** and the integrity scan reports it (`manager_not_employed_on_date`).
- Past references within V's dates **do** block (history would otherwise show a manager who never existed). Because V is effective and often recent, these are expected to be rare.

## 5. Event and history semantics

- All existing events stay (`start`, `end`, `end_reversed`, …). A new event **`employment_voided`** is added; free-text reason stored on the event, never in the generic history.
- **`recorded_at`** = when HR performed Void.
- **`effective_date`** (the column is mandatory) = **the period's `start_date`**. Justification: Void has no business-effective date of its own — it declares the period void *from its beginning* (ab initio). Using today would invent a date implying the period was valid until today; using the start date matches the existing conventions where an event that negates a timeline point carries that point's date (`cancel_planned_start` = planned start, C-71; `end_reversed` = reversed End's date, C-59).
- **Presentation:** because `employment_voided` is the **disposition of the whole period**, the history lists it **after all other events of that period**, regardless of its effective date; all other events keep the existing order (effective date, then recorded time). Example:
  - Start of employment — 10 Oct 2026
  - End of employment — 31 Oct 2026 · Voluntary Resignation *(Current end at the time)*
  - Employment period voided — entered in error
- Period card: **Voided** badge (not a lifecycle badge) and the note "This period was recorded in error and voided. It is kept for traceability and has no operational effect." Internal End badges (C-80) are not shown as "Current end" once the period is voided.

## 6. Recommended schema (forward migration, not written yet)

- `employment.voided_at timestamptz NULL` — operational marker (recording time). Actor and reason live in the event and audit (as for `cancelled_at`).
- `CHECK (cancelled_at IS NULL OR voided_at IS NULL)` — a period cannot be both cancelled and voided.
- `employment_event.event_type` CHECK adds `employment_voided`; partial unique index: one `employment_voided` event per period. Existing CHECKs already keep C-52 metadata null on non-`end` events.
- Terminal rule: extend the terminal trigger so that once `voided_at` is set it can never change and the period's dates, Employee Type, Work Email and person can never change (same rule as cancelled).
- Event insert rule (extend `employment_event_lifecycle_rules`): on a voided period no further events may be inserted except its single `employment_voided` event, which requires `voided_at` to be set in the same transaction (marker first, then event).
- Application: the cancellation marker and the void marker are written only through the shared query module (`markEmploymentCancelled`, new `markEmploymentVoided`); the query-boundary contract test covers both fields.

## 7. Operational query and constraint impact

| Area | Change |
|---|---|
| Shared abstraction | `OPERATIONAL` becomes `{ cancelledAt: null, voidedAt: null }` (= `cancelled_at IS NULL AND voided_at IS NULL`); `operationalEmploymentWhere`, `currentEmploymentWhere`, `futurePlannedEmploymentWhere`, `operationalPeriods` follow automatically. No ad-hoc predicates elsewhere (contract test). |
| Write guard | `loadWritableEmployment` rejects voided periods (`409 EMPLOYMENT_PERIOD_READ_ONLY`, message mentions *voided*); every S4 write path already uses it |
| Employment overlap exclusion | Recreate `employment_no_overlap_ex` with `WHERE (cancelled_at IS NULL AND voided_at IS NULL)` — a voided period no longer blocks a correct replacement |
| Work Email availability | Recreate `employment_work_email_period_ex` with `WHERE (work_email IS NOT NULL AND cancelled_at IS NULL AND voided_at IS NULL)` |
| Status / representative period / completeness / list display and filter / manager resolution / current & future employment | Via the shared abstraction: voided periods never count |
| Rehire latest-period rule, Add Initial Employment eligibility, Relationship Change latest rule, Cancel Planned latest rule, Reverse End `LATER_PERIOD_EXISTS` | Via the shared abstraction: voided periods are ignored — e.g. after voiding an erroneous Rehire, Reverse End on the previous period is no longer blocked by it |
| History | Includes voided periods, flagged (`voided_at`), like cancelled ones |
| Integrity scan | New checks: void marker without event / event without marker; cancelled and voided; voided period referenced by an overlapping valid assignment as manager; events inserted after void |

## 8. Eligibility preview contract

`GET /api/v1/core-hr/employments/{id}/void-eligibility` — operation `getVoidEligibility`, permission `employment.correct` (HR_ADMIN; it lists other employees' assignments). Read-only; evaluated as of today's business date.

```json
{
  "employment_id": "uuid",
  "evaluated_revision": 7,
  "as_of": "2026-10-10",
  "eligible": false,
  "period": { "start_date": "2026-10-10", "end_date": null, "employee_type": { "code": "EMPLOYEE", "name": "Employee" }, "period_lifecycle": "active" },
  "blockers": [
    {
      "code": "MANAGER_DEPENDENCY",
      "message": "Other employees' assignments use this period as their manager. Correct them first.",
      "references": [{ "person_id": "uuid", "employee_code": "ES0042", "full_name": "…", "assignment_id": "uuid", "effective_from": "2026-10-12", "effective_to": null }]
    }
  ],
  "warnings": [{ "code": "MANAGER_REFERENCE_WITHOUT_OVERLAP", "message": "…", "references": [] }],
  "affected_internal_records": {
    "assignments": 2,
    "lifecycle_events": [{ "event_type": "start", "effective_date": "2026-10-10" }],
    "has_active_end_event": false,
    "work_email": "x@example.test",
    "planned_end_date": null
  },
  "consequences": ["NO_OPERATIONAL_EFFECT", "WORK_EMAIL_RELEASED", "PERSON_HAS_NO_VALID_EMPLOYMENT", "VOID_IS_PERMANENT"]
}
```

- `consequences` are stable codes the UI translates (e.g. `PERSON_HAS_NO_VALID_EMPLOYMENT` when no other valid period remains; `PREVIOUS_PERIOD_UNCHANGED` for a Rehire, with the hint that a wrong previous End needs a separate Reverse End).
- The preview is informational only. **The POST never trusts it**; it re-evaluates everything in its transaction. `evaluated_revision` lets the UI send `expected_revision` so a change in between yields `REVISION_CONFLICT`.

## 9. POST Void concept

`POST /api/v1/core-hr/employments/{id}/void` — operation `createVoidEmployment`, permission `employment.correct`, body `{ expected_revision, reason }`, header `Idempotency-Key`. Response `201` with the employee detail.

One transaction, in this order:

1. claim the Idempotency-Key (C-34);
2. load the period through the write guard (404 / 409 read-only);
3. bump `person.revision` with `expected_revision` (locks the person; serialises with any other action on the person);
4. check effective (`start_date <= today`, else `PERIOD_NOT_EFFECTIVE`);
5. evaluate every dependency check (§3.D); any blocker → 422 (or 409 for `LATER_PERIOD_EXISTS`, consistent with existing usage) with the same codes and references as the preview;
6. set `voided_at` (shared module, conditional on still being non-cancelled/non-voided);
7. insert `employment_voided` (effective_date = start_date, reason, actor);
8. write audit;
9. commit.

Error codes: `404`, `409 EMPLOYMENT_PERIOD_READ_ONLY`, `422 PERIOD_NOT_EFFECTIVE`, `409 LATER_PERIOD_EXISTS`, `422 RELATIONSHIP_CHANGE_SUCCESSOR`, `422 MANAGER_DEPENDENCY`, future module codes, `422 REASON_REQUIRED`, `409 REVISION_CONFLICT`, `409 IDEMPOTENCY_KEY_REUSED`.

UI concept: HR_ADMIN-only "Void Employment Period" on an eligible period → confirmation screen fed by the preview (definition from §1, internal records, consequences, blockers with the action to take, "Void cannot be undone"), mandatory reason → POST. If the POST returns a blocker that appeared after the preview, the screen shows it.

**Authorization (C-85):** both operations declare `employment.correct` in the contract registry — no role-name checks, no new permission. A future split into `employment.void` is non-breaking (one registry change plus granting it to roles holding `employment.correct`).

## 10. Audit and concurrency rules

- HR_ADMIN, `employment.correct`, mandatory reason (1–1000 chars, trimmed), actor, request ID, recorded timestamp — on the event and in one audit record `employment.void` (`changedFields: ["employment.voided", "employment_event.employment_voided"]`). No structural old/new values (`voided_at` stays outside the C-24 allow-list, like `cancelled_at`). No personal values.
- Audit is evidence only; there is no rollback and no Unvoid.
- Idempotency: same key + same payload → one execution, replayed result; different payload → `IDEMPOTENCY_KEY_REUSED`; different key + stale revision → `REVISION_CONFLICT`.
- DB safety nets: disposition CHECK, one void event per period, terminal trigger, event-insert rule (row lock on the period, as for End events).

## 11. Migration impact

One **forward, non-destructive** migration — no data transformation (existing rows keep `voided_at = NULL`):

- add `employment.voided_at`, disposition CHECK;
- extend the event-type CHECK, add the one-void-per-period index;
- recreate the two exclusion constraints with the extra predicate;
- extend the terminal trigger and the event insert rule.

Verified from zero on `hrms_test` (guarded), applied to local `hrms_dev` only under the existing guard. Staging/production require explicit approval (CLAUDE.md). No committed migration is edited. OpenAPI gains two operations and the history `voided_at` flag / `employment_voided` event type (additive).

## 12. Required tests

- **Eligibility:** effective Initial Employment, effective Rehire, legacy period, profile-created period → eligible; with Assignment Changes, corrections, Work Email changes, planned end, Active End Event, End + End Reversed → still eligible; future period → `PERIOD_NOT_EFFECTIVE`; cancelled/voided → read-only; later valid period → `LATER_PERIOD_EXISTS`; later **cancelled or voided** period → still eligible; Relationship Change successor → `RELATIONSHIP_CHANGE_SUCCESSOR`; Relationship Change predecessor with valid successor → `LATER_PERIOD_EXISTS`.
- **Manager semantics:** overlapping reference from another valid period → blocked and listed; reference to another period of the same person → not blocked; reference from a cancelled/voided period → not blocked; non-overlapping reference → warning only; after HR corrects the reference → eligible.
- **Preview vs POST:** preview and POST return the same blockers; a blocker created after the preview is caught by the POST; preview is read-only (no revision bump, no audit).
- **Effect:** marker + event atomic; all internal records unchanged; status/representative/list/filter/completeness/manager resolution exclude the period; person with no valid period → `no_employment`, same Employee Code; Add Initial Employment Period allowed again; Work Email reusable; overlap no longer counted; voided period read-only for every write action.
- **Rehire:** void erroneous Rehire → previous period and its End unchanged → Reverse End Employment on the previous period then succeeds when HR confirms it was also wrong.
- **History:** event kept order + `employment_voided` listed last; Voided badge; no free-text reason exposed; End badges not shown as current on a voided period.
- **Permissions:** HR_ADMIN only for preview and POST; HR_EDITOR / API_DOCS_READER / anonymous denied; reason mandatory.
- **Concurrency/idempotency:** same-key replay, key reuse, stale revision, concurrent Void vs End/Rehire/Relationship Change, rollback leaves nothing partial.
- **DB:** constraints, CHECK, index and triggers from zero; immutability after void; integrity scan detects seeded violations; clean baseline stays 0/0; extension point fails closed.

## 13. PV-24 boundary

- PV-25 voids **one** erroneous period whose dependencies are internal. A Relationship Change touches **two** periods (End with `RELATIONSHIP_CHANGE` on the predecessor + Start of the successor). Voiding the successor alone would leave the predecessor ended for a transition that never happened — so the successor is **blocked** (`RELATIONSHIP_CHANGE_SUCCESSOR`), and the predecessor is blocked while the successor is valid.
- Undoing an effective Relationship Change remains **PV-24** (coordinated workflow). PV-24 may later combine this Void primitive with the existing Reverse End primitive atomically; it may also introduce an explicit successor link if detection from lifecycle data is not enough.
- Rehire is not a coordinated change: a Rehire period can be voided on its own; a wrong previous End is reversed separately, afterwards (§12).

## 14. Initial Employment and Unvoid

- Voiding an effective Initial Employment with no other valid period: the Person and Employee Code remain (the code registry is insert-only, M-02); the Person is operationally profile-only (`no_employment`, shown as "No Employment Record" — an existing value, not a new status). A later correct period is added with Add Initial Employment Period; no new Person or Employee Code is created.
- **No Unvoid in Phase 1.** If a Void itself was wrong, the recovery is to create a new legitimate period through the approved workflow (Add Initial Employment Period, or Rehire when a previous ended period exists; a past start date requires a reason), keeping the erroneous Void in the history. Data of the voided period (assignments, Work Email) is not copied and must be re-entered. This limitation is shown on the confirmation screen.

## 15. Remaining open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | History placement: list `employment_voided` **after all other events** of the period (as in the HR example) rather than by its effective date (= start date)? | Yes — it is the disposition of the whole period |
| Q2 | A Relationship Change **predecessor whose successor was cancelled** (Relationship Change never took effect): may it be voided, with its `RELATIONSHIP_CHANGE` End kept as internal history? | Yes — no valid cross-period dependency remains |
| Q3 | Manager reference to V **without** date overlap (already inconsistent): warning only? | Yes — warning in the preview and the integrity scan, not a blocker |
| Q4 | A wrong or duplicate **whole Person profile**: separate backlog item (merge/duplicate profile)? | Yes — new item, not part of PV-25 |

Implementation (migration, API, UI, tests) starts only after explicit approval of this revision. Approval of the design is not approval to run migrations outside the guarded local databases.

## 16. Implementation notes (2026-10-10, C-86)

Implemented as designed. Open questions closed: Q1 yes (void event listed last); Q2 — a Relationship Change predecessor is **not forbidden** from Void (warning, never an automatic blocker): for a genuine relationship the normal recovery stays *Cancel successor → Reverse End*; if HR independently confirms that the predecessor period itself was entered in error, it is evaluated under the normal Void rules once no blocking cross-period dependency remains; the preview returns the warning `RELATIONSHIP_CHANGE_PREDECESSOR`; Q3 yes (warning only); Q4 out of scope (separate backlog, not started).

Engineering details added during implementation (no business rule changed):

| Detail | Why |
|---|---|
| Preview returns `200` with a single blocker `EMPLOYMENT_PERIOD_READ_ONLY` or `PERIOD_NOT_EFFECTIVE` for cancelled/voided or future periods (dependency checks are skipped there); `404` for an unknown period. The preview runs in a `READ ONLY` transaction. | Structured data for the UI; read-only by construction |
| POST error mapping: first blocker decides the status (`LATER_PERIOD_EXISTS` 409, `DEPENDENCY_CHECK_FAILED` 503 `SERVICE_UNAVAILABLE`, others 422 `BUSINESS_RULE_VIOLATION`); `details` list every blocker and its references (employee code and dates, no names). | Same blockers as the preview |
| Void row-locks the period (`FOR UPDATE`) before the dependency checks; trigger `job_assignment_manager_not_voided` share-locks the manager period on every assignment write that sets a manager and rejects a reference to a voided period for overlapping dates (mapped to `422 MANAGER_PERIOD_VOIDED`). | No race can leave another employee's assignment depending on a voided period |
| The new trigger messages carry `(constraint "…")` | The Prisma driver adapter does not expose the constraint name of a trigger-raised `check_violation` |
| Event-insert trigger now reads (and locks) the period for every event type | Rejects any event after Void and a void event without the marker |
| UI shows *Void Employment Period* (HR with `employment.correct`) only on the latest valid period once it is effective; earlier periods would always be blocked by `LATER_PERIOD_EXISTS`. The confirmation is built from the preview; if the POST fails, the error and a refreshed preview are shown. | Less noise; preview-driven |

### Closure verification (2026-10-10)

- Manager reference model: `job_assignment.manager_employment_id` (FK → `employment.id`) stores the manager's **Employment Period**, never a person id; the API takes `manager_person_id` and resolves it to the manager's operational period covering the assignment's effective date (`currentEmploymentWhere`). Valid periods of one person cannot overlap (exclusion constraint), so at most one period can support a manager relationship on a given date. The checker, the trigger and the integrity check therefore all match on the exact period id, a valid dependent period, and overlapping dates; references stored against another period of the same manager are never attributed to the voided period.
- Copy fixes only: the `RELATIONSHIP_CHANGE_PREDECESSOR` warning (true whether the successor is still valid or was cancelled; distinguishes genuine vs erroneous; Reverse End is not presented as the only option), the UI corrective direction for `MANAGER_DEPENDENCY`, and "Planned end of employment" for a future End in the preview.
- HR acceptance set: `docs/uat/pv25-hr-acceptance.md`.

