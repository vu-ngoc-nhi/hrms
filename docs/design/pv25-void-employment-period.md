# PV-25 — Void Employment Period (pre-production design)

- Status: **DESIGN PROPOSAL — awaiting approval.** Nothing here is implemented; no migration, API or UI exists.
- Baseline: `phase1-uat-passed` (Core HR Phase 1 — UAT Passed With Pre-Production Actions).
- Decision item: **PV-25** (HIGH PRIORITY — MUST BE RESOLVED BEFORE PRODUCTION READINESS). Related: PV-24 (Reverse Relationship Change), C-29/C-69–C-71 (Cancel Planned Period), C-38/C-54–C-57 (Reverse End Employment), C-61 (Rehire), C-73 (manager references).
- Every point marked **[HR]** is an open business question (§17) and must not be treated as decided.

## 1. Business definition

**Void Employment Period** (recommended name; UI action "Void Employment Period", history label "Employment period voided — entered in error").

> An HR_ADMIN records that an Employment Period which has already become effective was **entered in error and never represented a real employment relationship**. The period stays in the history with all its data and a *Voided* badge, but has no operational effect from its start.

How it differs from the existing actions:

| Action | Meaning | Applies to |
|---|---|---|
| Cancel Planned Period (C-29) | A real **plan** will not take effect | Period starting after today |
| End Employment (C-50) | A real relationship ends | Real period |
| Reverse End Employment (C-38) | An End action was wrong; the relationship continued | Active End Event |
| Historical Correction (C-40) | Real period, wrong data | Real period |
| **Void Employment Period** | **The period itself should never have been recorded** | Effective period entered in error |

Why not "Cancel" for effective periods: Cancel means "a plan was withdrawn before it took effect" (C-69 keeps it strictly pre-start). Void means "this record was a mistake". Mixing the two would make a cancelled period ambiguous (real plan vs data error) and would weaken C-69.

## 2. Eligibility matrix

Proposed default: **no fixed time limit; strict dependency validation instead.** A same-day limit would not reflect when mistakes are discovered (often days later) and is not the actual risk; the risk is that other records already depend on the period. **[HR Q3]**

| Period | Void allowed? | Notes |
|---|---|---|
| Initial Employment period (incl. one created with the profile) effective on or before today | **Yes**, if §3 passes | Person returns to *No Employment Record* when no other valid period exists |
| Rehire period, effective | **Yes**, if §3 passes | Previous period untouched (§11) |
| Relationship Change **successor** period | **No — blocked** (`RELATIONSHIP_CHANGE_SUCCESSOR`) | Composite reversal belongs to PV-24 (§16) |
| Relationship Change **predecessor** (old) period | **No** | It has a later period (blocked by §3) |
| Legacy / imported period (no `start` event) | **Yes**, if §3 passes | Import mistakes are a main use case **[HR Q7]** |
| Period starting **after today** | **No — use Cancel Planned Period** | Keeps one meaning per action **[HR Q2]** |
| Cancelled period | No (already non-operational, read-only) | |
| Already voided period | No (terminal) | |
| Not the person's **latest** non-cancelled, non-voided period | **No** (`LATER_PERIOD_EXISTS`) | A later period may have been created on the assumption that this one was real (e.g. Rehire's latest-period rule) **[HR Q4]** |

## 3. Permission model

- **HR_ADMIN only**, permission `employment.correct`, **mandatory reason** (stored on the void event and in audit; never shown in the generic history).
- Rationale (confirmed direction): voiding removes the operational effect of an effective record — it is a historical correction, not a business event. HR_EDITOR keeps Cancel Planned Period for future periods. **[HR Q8: is a same-day HR_EDITOR exception needed? Recommendation: no.]**

## 4. Dependency / blocking matrix

| Dependency | Class | Behaviour |
|---|---|---|
| The period's own `start` event | **A** — safe automatically | Kept; void event added after it |
| The period's own assignment rows (initial, and later rows of the same period) | **A** for data (kept, become non-operational with the period) — but see **[HR Q5]**: more than the initial row means the period was operated on over time; recommendation: **block (C)** in Phase 1 when an Assignment Change or correction exists on the period | Never deleted, moved or copied |
| Work Email recorded on the period (incl. later updates of it) | **A** | Value kept for history; reservation released (§9) |
| Planned end date without End event | **A** | Kept as data |
| End + End Reversed pairs (fully reversed) | **A** | Kept; they neutralise each other **[HR Q6]** |
| **Active End Event** on the period | **B** — explicit coordinated reversal | Blocked (`ACTIVE_END_EVENT_EXISTS`): HR runs Reverse End Employment first, then Void |
| Manager references: other employees' assignments whose `manager_employment_id` is this period | **B** — explicit correction first | Blocked (`MANAGER_REFERENCES_EXIST`) with the list of affected assignments; HR corrects them (Assignment Change / historical correction). Never rewritten automatically (C-73) **[HR Q9: block past references too? Recommendation: yes, all references]** |
| Later non-cancelled, non-voided period of the same person (Rehire, Relationship Change successor) | **C** — must block | `LATER_PERIOD_EXISTS` |
| The period is a Relationship Change successor (predecessor's Active End Event has `RELATIONSHIP_CHANGE` ending the day before) | **C** | `RELATIONSHIP_CHANGE_SUCCESSOR` → PV-24 |
| Other lifecycle events (suspend/resume — not implemented today) | **C** | Blocked |
| Future modules (Payroll, Leave, Contracts, Entra/account provisioning) referencing the period | **C** | Each future module must register a dependency check (see §10 extension point); Phase 1 has none |

Principle: **exact void or no void** — the system never repairs other records to make a void possible.

## 5. Data model options

| | Option 1 — `voided_at` marker + `employment_voided` event (recommended) | Option 2 — generic `disposition` column replacing `cancelled_at` | Option 3 — event only | Option 4 — separate `employment_void` table |
|---|---|---|---|---|
| Business clarity | High: two named dispositions (Cancelled = withdrawn plan, Voided = entered in error) | High, one concept | Low (state hidden in events) | Medium |
| Data integrity | Exclusion constraints and the terminal trigger read a column on `employment` | Same, after rewriting | **Not possible**: exclusion constraints cannot reference events (same reason as C-29 §9) | **Not possible** for the same reason without also adding a marker |
| Schema complexity | +1 nullable column, +1 event type, recreate 2 exclusion predicates, extend 2 triggers, +1 unique index | Data transformation of existing cancelled rows, rewrite S4.0 constraints/trigger/tests, drop or deprecate `cancelled_at` | Smallest schema, but unusable | +1 table + marker anyway |
| Reversal safety | Terminal (no Unvoid); simple | Same | — | Same |
| Query complexity | One line in the shared module (`OPERATIONAL` adds `voidedAt: null`) | One predicate (`disposition = 'valid'`), but every existing reference changes | Every query joins events | Join |
| Auditability | Event + audit, same pattern as Cancel/End | Same | Event only | Table + audit |
| Payroll/Leave/Contracts | Clear rule: only operational (non-cancelled, non-voided) periods are consumable | Same | Fragile | Same |
| Risk | Low, additive forward migration | Higher: semantic transformation of shipped data (CLAUDE.md migration governance) | — | — |

**Recommendation: Option 1.** It is additive, keeps C-29 untouched, does **not** overload `cancelled_at`, and reuses the S4.0 shared query abstraction so every operational query excludes voided periods by construction. Option 2 is attractive long-term but transforms shipped data and is not needed for PV-25.

## 6. Recommended schema (forward migration, not written yet)

- `employment.voided_at timestamptz NULL` — operational marker (recording time). Actor and reason live in the event and audit (as for `cancelled_at`).
- `CHECK (NOT (cancelled_at IS NOT NULL AND voided_at IS NOT NULL))` — one disposition at most.
- `employment_event.event_type` CHECK adds `employment_voided`; partial unique index: at most one `employment_voided` event per period; C-52 metadata columns stay null for it (existing CHECKs already enforce this for non-`end` events).
- Recreate `employment_no_overlap_ex` and `employment_work_email_period_ex` with `... AND voided_at IS NULL` (non-destructive; existing data has `voided_at` null).
- Terminal trigger: extend `employment_cancelled_is_terminal` (or add `employment_voided_is_terminal`) so a voided period's marker, dates, Employee Type, Work Email and person can never change.
- Lifecycle trigger: reject inserting `end` / `end_reversed` events on a voided period; the immutability trigger (C-53) already covers the new event's columns.
- Application: `queries.ts` `OPERATIONAL` becomes `{ cancelledAt: null, voidedAt: null }`; `loadWritableEmployment` rejects voided periods (`409 EMPLOYMENT_PERIOD_READ_ONLY`, message "voided"); the query-boundary contract test also covers `voidedAt`; `historyFlags` adds `voided_at`.
- Application role grants: unchanged (UPDATE on `employment` already exists; the marker is written only through the shared module, as `markEmploymentCancelled` is).

## 7. Lifecycle / history behaviour

- The `start` event is **kept**. A new `employment_voided` event is added with `effective_date = start_date` (the period is void from its start — same convention as `cancel_planned_start`, C-71) and `recorded_at` = when HR voided it; reason on the event, never exposed in the generic history.
- History shows the period with a **Voided** badge and, ordered by effective date then recorded time:
  - Start of employment — 10 Oct 2026
  - Employment period voided — 10 Oct 2026 (entered in error)
- Period note: "This period was recorded by mistake and voided. It is kept for traceability and has no operational effect."
- Any reversed End pairs on the period stay visible as they are (C-80 presentation).

## 8. Status semantics

- **Voided is a record disposition, not an Employment Status** (exactly like Cancelled, C-16 / C-70). Status codes stay `no_employment` / `not_started` / `active` / `ended`.
- A voided period has `period_lifecycle = null`, never counts as Active, Ended or Pre-start, never contributes to the person's computed status, representative period, list department/filter (C-76), completeness (C-78), current/future employment or manager resolution.
- A person whose only periods are voided and/or cancelled is *No Employment Record*.

## 9. Assignment and Work Email behaviour

- **Assignments** of a voided period are kept unchanged (no delete, no void flag, no move, no copy). They become non-operational through the period disposition. A later correct period gets assignments only through the approved workflows (Add Initial Assignment, Relationship Change initial assignment).
- **Work Email** value is kept for history; the reservation is released by adding `voided_at IS NULL` to `employment_work_email_period_ex` (a new forward migration is required — the current predicate only checks `cancelled_at`). The address can then be used by a valid period under the normal date-range rule.
- Account deprovisioning stays out of scope (C-36).

## 10. API concept

`POST /api/v1/core-hr/employments/{id}/void` — operation `createVoidEmployment`.

- Body: `expected_revision`, `reason` (1–1000, mandatory). Header: `Idempotency-Key`. Permission `employment.correct`.
- Errors (stable codes): `404`; `409 EMPLOYMENT_PERIOD_READ_ONLY` (already cancelled or voided); `422 PERIOD_NOT_EFFECTIVE` (start after today → use Cancel Planned Period); `409 LATER_PERIOD_EXISTS`; `422 RELATIONSHIP_CHANGE_SUCCESSOR` (→ PV-24); `422 ACTIVE_END_EVENT_EXISTS` (→ Reverse End first); `422 MANAGER_REFERENCES_EXIST` (details list the assignments); `422 ASSIGNMENT_HISTORY_EXISTS` (only if **[HR Q5]** confirms blocking); `422 REASON_REQUIRED`; `409 REVISION_CONFLICT`; `409 IDEMPOTENCY_KEY_REUSED`.
- Response: `201` with the employee detail (the period shows `voided_at`, `period_lifecycle: null`).
- **Dependency extension point:** a small list of dependency checks evaluated inside the transaction (Phase 1: later periods, Relationship Change successor, Active End Event, manager references, assignment history); future modules (Payroll, Leave, Contracts) add their own checks instead of changing this action.
- Optional read-only preview (`GET /employments/{id}/void-preview`) returning the blocking dependencies — **[HR Q11]**; the UI can also derive most of it from the detail response.

## 11. UI concept

- **Void Employment Period** shown only to HR_ADMIN on an effective, non-cancelled, non-voided, latest period (hidden for HR_EDITOR; server enforces regardless).
- Confirmation screen: period dates, Employee Type, Work Email, assignment summary, lifecycle events; the consequence in plain words ("The period will be kept in history and marked Voided. It will have no effect: no status, no assignment, no manager, no Work Email reservation."); blocking dependencies listed with the action to take (Reverse End Employment first; correct the assignments that use this person as manager; a Relationship Change is undone through PV-24); mandatory reason; explicit warning that **Void cannot be undone in Phase 1**.
- After voiding a Rehire whose previous End was also wrong, the page offers guidance (not automation): "If the previous End Employment was also recorded only to enable this Rehire, review whether Reverse End Employment is required."
- History: *Voided* badge and the event line in §7. Future-dated periods keep the existing Cancel Planned Period action.

## 12. Audit

- One audit record `employment.void` on the employment: actor, timestamp, request ID, mandatory reason, `changedFields: ["employment.voided", "employment_event.employment_voided"]`. No structural old/new values (`voided_at` is not added to the C-24 allow-list, same as `cancelled_at`, C-71).
- Audit is never used as rollback data; there is no rollback.

## 13. Concurrency / idempotency

- Same command runner as all S4 actions (C-34): key claimed first in the transaction; `expected_revision`; one `person.revision` bump (M-11); every dependency check runs **after** the revision lock, inside the same transaction.
- DB safety nets: one `employment_voided` event per period (unique index); terminal trigger; disposition CHECK; lifecycle trigger locks the employment row so a concurrent End/End Reversed insert cannot interleave.
- Concurrent Void + Rehire / Relationship Change / End on the same person are serialised by the person revision; the loser receives `REVISION_CONFLICT`.

## 14. Migration impact

- One **forward, non-destructive** migration (no data transformation; existing rows keep `voided_at = NULL`): new column, disposition CHECK, event type, unique index, two exclusion constraints recreated with the extra predicate, trigger extensions. Verified from zero on `hrms_test`, then applied to local `hrms_dev` under the existing guard; staging/production only with explicit approval.
- Integrity scan: new checks — voided period appearing operationally (e.g. referenced as a current/future manager), voided without event / event without marker, voided + cancelled, voided with Active End Event.
- No change to committed migrations.

## 15. Tests required

- Eligibility: effective Initial Employment, effective Rehire, legacy period → allowed; future period → `PERIOD_NOT_EFFECTIVE`; cancelled / voided → read-only; not latest → `LATER_PERIOD_EXISTS`; Relationship Change successor → `RELATIONSHIP_CHANGE_SUCCESSOR`.
- Permissions: HR_ADMIN allowed; HR_EDITOR / API_DOCS_READER / anonymous denied; reason mandatory.
- Blocking: Active End Event, manager references (listed), assignment history (if confirmed), future dependency hook.
- Effect: marker + event set atomically; start event kept; status/representative/list/filter/completeness/manager resolution exclude the period; person with only voided periods → *No Employment Record*; Add Initial Employment Period allowed again; Rehire after voiding uses the previous valid period; Work Email reusable; overlap constraint no longer counts the voided period.
- Rehire scenario: void Rehire → previous period and its End unchanged → Reverse End Employment on the previous period now succeeds (S4.7R ignores the voided period) when the End was also wrong.
- History: Voided badge, event label/order, no free-text reason; employee code unchanged.
- Concurrency/idempotency: same key replay, key reuse, stale revision, concurrent Void vs End/Rehire, rollback leaves nothing partial.
- DB: constraints/trigger/grants from zero; terminal immutability; integrity scan detects seeded violations; clean baseline stays 0/0.

## 16. Relationship to PV-24

**Keep PV-24 separate.** Voiding a Relationship Change successor alone would leave the predecessor ended with End Reason `RELATIONSHIP_CHANGE` and no successor — an incoherent history that Void must not create. Undoing a Relationship Change requires two coordinated, exact steps (void the successor **and** reverse the predecessor's End with all S4.7R validations); that composite is precisely *Reverse Relationship Change* (PV-24). PV-25 therefore **blocks** successors with `RELATIONSHIP_CHANGE_SUCCESSOR`. A future PV-24 design can reuse the Void primitive plus the existing Reverse End primitive in one atomic action.

Rehire is different: a Rehire period is independent of the previous period (the previous End is its own action). Voiding the Rehire leaves the previous period untouched; if that End was also wrong, HR runs Reverse End Employment as a separate explicit step (§11).

Initial Employment: after voiding, the same Person and Employee Code remain (the code registry is insert-only, M-02); the person returns to *No Employment Record* and can receive a correct Add Initial Employment Period. If the **whole profile** was created for the wrong or a duplicate person, that is a different problem (person merge / duplicate profile) and is out of scope **[HR Q10]**.

## 17. Unresolved business questions (HR approval required)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Business name: "Void Employment Period" / "Mark as entered in error"? | "Void Employment Period", history label "Employment period voided — entered in error" |
| Q2 | Void also for future periods, or keep Cancel Planned Period for them? | Effective periods only; future → Cancel Planned Period |
| Q3 | Time limit (same day, N days) or dependency validation only? | No fixed limit; strict dependency validation |
| Q4 | Only the latest non-cancelled, non-voided period? | Yes in Phase 1 |
| Q5 | Block when the period has Assignment Changes / corrections beyond the initial assignment? | Block (the period was operated on as real); revisit after real usage |
| Q6 | Allow when the period has fully reversed End history (End + End Reversed)? | Allow |
| Q7 | Allow for legacy/imported periods without a start event? | Allow |
| Q8 | HR_ADMIN only, or a same-day HR_EDITOR exception? | HR_ADMIN only |
| Q9 | Manager references: block on any reference (past and current/future), or only current/future? | Block on any reference; HR corrects them first |
| Q10 | Wrong / duplicate whole Person profile: separate backlog item? | Yes, new item (person merge / duplicate profile), not part of PV-25 |
| Q11 | Is a read-only "void preview" needed, or is the confirmation screen enough? | Confirmation screen with the server re-validating; preview optional |
| Q12 | Is an **Unvoid** ever needed? | No in Phase 1. Recovery from a wrong void: re-enter the period with Add Initial Employment Period or Rehire (reason required for past dates); both records stay visible |
| Q13 | Should voided periods appear in the default history view or be collapsed? | Shown with the *Voided* badge (traceability) |
| Q14 | Must Void notify other systems (Entra/IT, Leave tool) in Phase 1? | No; future integration item |

Approval of this design is required before any migration, API or UI work. Approval of the design is not approval to run migrations outside the guarded local databases.
