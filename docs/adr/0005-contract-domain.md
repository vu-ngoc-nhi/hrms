# ADR-0005 — Contract domain (Phase 2A Contract Management)

- Status: **Accepted (2026-10-15)** — freezes C-104 … C-112 and M-15 … M-19 for implementation. Staged delivery (C-109): **2A-0** done; **2A-1 Contract foundation implemented** (migration `20261015000000_contract_foundation`, §16); **2A-2 core lifecycle implemented** (§17); **2A-3 contract screens implemented** (§18); each later slice needs an owner checkpoint. Amendment workflow and Phase 2B are **not** authorized.
- Sources: `docs/design/phase2-contract-decision-pack.md` (revision 4), `docs/decision-register.md`, API draft `docs/api/contracts-api-draft.md`.
- Governing principles: C-84 (*Lightweight HR operations, strong Core HR integrity*), C-85 (permission-based access), ADR-0003 (identity), ADR-0004 (history vs audit).
- Synthetic data only. Real contract data needs PL-11, PL-12, PL-13 and the Real Data Gate.

A change to anything in this ADR is a new decision (register entry + ADR revision), never a silent implementation choice.

## 1. Domain boundary

| Concept | Source of truth for | Must never |
|---|---|---|
| Person | Identity and personal data | — |
| **Employment Period** | The working relationship and its lifecycle: start/end, Employee Type, Employment Status (computed), End Reason | be changed by any contract action |
| Assignment | Organisational placement | be changed by any contract action |
| **Contract** | A written agreement documenting terms of **one** Employment Period: type, number, effective dates, signature date, document lifecycle, renewal link | change Employment Status, Employee Type, period dates, Assignment or Probation |

- Contract expiry produces a review/action item, never an automatic End Employment. HR chooses: renew, new contract, Relationship Change, End Employment, or nothing.
- Phase 1 workflows (End Employment, period corrections, Cancel Planned Period, Void Employment Period, Relationship Change, Rehire) are **not blocked** by contracts and never cascade into contracts.
- A probation-type agreement never creates, ends or evaluates Probation (C-17). Contract Type never implies Employee Type (C-13).

## 2. Employment Period relationship

- `contract.employment_id` is mandatory and never changes after Finalize.
- **Structural date rule (only one):** at Finalize, **Effective From** lies inside the linked period (`start_date ≤ effective_from` and, if the period has an end date, `effective_from ≤ end_date`). It does not concern created/finalized/signed timestamps — a contract may be created, finalized or signed before the period starts.
- **Period validity** = the Phase 1 disposition predicate: the period is **not Cancelled and not Voided**. **Employment Status (Pre-start / Active / Ended) never gates a contract action.**
- A contract whose period becomes Cancelled/Voided, or whose Effective From falls outside the period after a period correction, is kept unchanged, leaves operations through the shared query, and is flagged *Needs Review*.
- **Operational end** of an agreement = `least(effective_to, period.end_date, renewal_successor.effective_from − 1)`; open-ended → period end or successor. The contract's own `effective_to` is never rewritten.

## 3. Phase 2A aggregate and model

Three tables; no Contract Version subsystem; no speculative fields (C-104 (6)).

| Table | Content |
|---|---|
| `contract_type` | id, code (immutable), name, name_vi, is_active. No behaviour flags. Managed with `catalogs.read` / `catalogs.manage`; deactivate, never delete. |
| `contract` | id, employment_id, parent_contract_id, relationship_type, contract_type_id, contract_number, effective_from, effective_to, is_open_ended, summary, finalized_at, finalized_by, signed_at (DATE), cancelled_at, voided_at, revision, created_at, created_by |
| `contract_history_event` | id, contract_id, event_type, effective_date (nullable), recorded_at, recorded_by, reason (nullable), related_contract_id (nullable) |

Database invariants (fail closed):
- `parent_contract_id` and `relationship_type` both null or both set; **2A admits `relationship_type = 'renewal'` only** (amendment is added by forward migration after its checkpoint).
- Parent in the same period: composite FK `(parent_contract_id, employment_id) → contract(id, employment_id)`; parent is an agreement; no cycles.
- At most one renewal child per parent that is not Cancelled/Voided (partial unique index).
- `cancelled_at` and `voided_at` mutually exclusive; a Cancelled/Voided row is immutable (terminal trigger, as C-86).
- `signed_at` requires `finalized_at`.
- Finalized rows: Contract Type, Contract Number and Effective From set; exactly one of `effective_to ≥ effective_from` or `is_open_ended = true`.
- Contract Number unique on `lower(btrim(contract_number))` across **all** rows (§8).
- No DELETE grant for the application role on contract tables.

Actors (`created_by`, `finalized_by`, `recorded_by`, audit actor) are `app_user.id` — the internal principal of ADR-0003 — never e-mail, display name or Entra OID.

## 4. Stored lifecycle markers

| Marker | Meaning |
|---|---|
| `finalized_at` null | **Draft** — working record, normal editing |
| `finalized_at` set | **Finalized** — **contract record content locked from normal editing**. Not Signed, not Active, not Employment started |
| `signed_at` set | **Signed** — the **business date on which HR confirms the contract has been fully executed by all required parties**. No individual signers. Not a future date in Asia/Ho_Chi_Minh; may precede Finalize, Effective From and the period start |
| `cancelled_at` / `voided_at` | Dispositions (§6) |

There is no status column. Document state is derived: `signed` if `signed_at`, else `finalized` if `finalized_at`, else `draft`.

## 5. Computed time state

Computed on every read for **today in Asia/Ho_Chi_Minh** (date-based, C-69), only for Finalized/Signed contracts that are operational (not Cancelled/Voided, period valid):

| Time state | Rule |
|---|---|
| `upcoming` | `effective_from > today` |
| `active` | `effective_from ≤ today ≤ operational_end` (or no operational end) |
| `expired` | `operational_end < today`; detail `closed_by_employment_end` or `replaced_by_renewal` when that bound applies |

Drafts and non-operational contracts have no time state. Time state does not depend on `signed_at`. Never stored.

## 6. Cancelled / Voided disposition

- **Cancelled** — (a) a discarded Draft, or (b) a Finalized/Signed contract that has not started (time state `upcoming`) and will not take effect (*Cancel planned contract*, reason, `contracts.finalize`, slice 2A-5).
- **Voided** — a Finalized/Signed contract that should never have existed (reason, `contracts.correct`, slice 2A-5). **Final; no Unvoid.**
- Both terminal; rows and events kept; excluded from operations by the **shared contract query predicate** (`cancelled_at IS NULL AND voided_at IS NULL AND period not Cancelled/Voided`), defined once beside `operationalEmploymentWhere` and contract-tested. No hard delete.

## 7. Transitions

| Action | From | Permission | Reason | Slice |
|---|---|---|---|---|
| Create Draft | — | manage | — | 2A-2 |
| Edit Draft | Draft | manage | — | 2A-2 |
| Discard Draft | Draft | manage | optional | 2A-2 |
| **Finalize** | Draft | **finalize** | — | 2A-2 |
| **Return to Draft** | Finalized, unsigned | **finalize** | mandatory | 2A-2 |
| **Confirm signed** | Finalized, unsigned; period not Voided (C-111) | **finalize** | — | 2A-2 |
| Create renewal Draft | Finalized/Signed | manage | — | 2A-5 |
| Cancel planned contract | Finalized/Signed, upcoming | finalize | mandatory | 2A-5 |
| Correct | Signed | **correct** | mandatory | 2A-5 |
| Void | Finalized/Signed | **correct** | mandatory | 2A-5 |
| Amend | — | — | — | **gated** |

**Finalize** — blockers: Contract Type set and active; number present and unique; Effective From inside a valid period; term consistent; renewal parent valid. Warnings (M-17, never blocking): unlinked overlap with another operational agreement of the person, gap after the renewal predecessor, `effective_to` after the period's end date, another open Draft for the period. Warnings follow **M-19**: blockers can never be overridden; with warnings and no blockers the server returns `409 FINALIZE_CONFIRMATION_REQUIRED` with the current warnings instead of finalizing silently; HR confirms once (*Finalize Anyway*), sending the server-issued `warning_fingerprint`; the server recomputes blockers and warnings in the writing transaction and finalizes only if the fingerprint still matches. Confirming does not resolve a warning (the contract stays under Needs Review) and leaves no acknowledgement record — only the `finalized` history event.

**Past dates (C-109):** Effective From and `signed_at` in the past are accepted with `contracts.finalize`; `recorded_at` preserves when the record was entered.

**Return to Draft (C-104 (5), C-109)** — a controlled reversal, allowed only when: not Signed; not Cancelled/Voided; the period is not Cancelled/Voided (an Ended period never blocks); no renewal child that is not Cancelled/Voided (`DEPENDENT_CONTRACTS_EXIST`; nothing cascades); actor holds `contracts.finalize`; reason supplied; `expected_revision` and `Idempotency-Key` checks pass. Effect: clears `finalized_at`/`finalized_by`, keeps number and content, `revision + 1`, history `returned_to_draft` + audit. Signed contracts never return to Draft (Correction, Void, or Amendment when approved). Phase 2B may add artifact-based restrictions.

## 8. Contract Number (M-15, M-18)

Optional while Draft, required before Finalize, HR-entered. Stored trimmed of surrounding whitespace; empty after trimming = no number. **Once assigned, unique case-insensitively across the whole register** — including discarded (Cancelled) and Voided records; **voiding never frees a number**. No generation, no format validation (HR policy). Changeable after Finalize only through Return to Draft (unsigned) or Correction (signed).

## 9. Permission semantics (C-106, C-109)

| Permission | Semantics |
|---|---|
| `contracts.read` | View contract data, history, lists, reminders |
| `contracts.manage` | Prepare working records: Draft create/edit/discard, renewal Drafts |
| `contracts.finalize` | Make, reverse or certify the official record: Finalize, Return to Draft, Confirm signed, Cancel planned contract |
| `contracts.correct` | Change protected history: Correct Signed data, Void |

Bundles: HR_ADMIN all four; HR_EDITOR read + manage + finalize; API_DOCS_READER none. Declared once per operation in the contract registry and enforced server-side by the shared handler (C-85); no role-name checks. `employees.read` never implies contract access. `ADMINISTRATIVE_PERMISSIONS` unchanged. Permissions are introduced in slice 2A-1 (code map + `access_role_permission` mirror by migration, contract-tested).

## 10. Optimistic concurrency

- Own aggregate revision **`contract.revision`**, starting at 1 and incremented by every write to the contract (content, markers, dispositions). Every mutation except Create takes `expected_revision`; stale → `409 REVISION_CONFLICT`.
- Contract writes do **not** touch `person.revision` (M-11 unchanged for Core HR).
- Cross-record checks run in the writing transaction: Finalize / Return to Draft / renewal creation lock the parent contract and read-lock the period row; the DB unique indexes (number, renewal) are the final backstop. Overlap is warning-only, so no exclusion constraint.

## 11. Idempotency

- `Idempotency-Key` **required** on every POST that creates a record or changes lifecycle (create Draft, Discard, Finalize, Return to Draft, Confirm signed, renewal, Cancel planned, Correct, Void), using the existing module: claimed in the business transaction, scoped per actor + operation, keyed HMAC of the payload, 24-hour TTL (M-07). Replay → original status with `Idempotent-Replayed: true` and the current representation; same key + different payload → `409 IDEMPOTENCY_KEY_REUSED`.
- `PATCH` (Edit Draft) follows the Phase 1 PATCH convention: `expected_revision`, no key; resubmitting identical values is a no-op (no revision bump, no history).

## 12. Contract History vs technical audit

| | Contract History (`contract_history_event`) | Technical audit (`audit_event`, `audit_field_change`) |
|---|---|---|
| Purpose | Business story shown to HR | Evidence |
| Reader | `contracts.read`, on the contract / Employee Contracts tab | Not shown raw to HR |
| Content | Business action, effective date where applicable, Recorded By, Recorded At, reason where relevant, related contract | Actor, action, outcome (incl. denied), entity, request id, changed field names, reason, old/new values for approved fields |

- 2A event types: `created`, `discarded`, `finalized`, `returned_to_draft`, `signed_confirmed`, `renewal_created` (on the parent), `cancelled`, `corrected`, `voided`. Draft edits are audited, not history events.
- Reasons are shown on contract history for `returned_to_draft`, `discarded`, `cancelled`, `corrected`, `voided` (C-108).
- C-24 old/new allow-list (DB CHECK) extended in 2A-1 with: `contract.contract_type_id`, `contract.contract_number`, `contract.effective_from`, `contract.effective_to`, `contract.is_open_ended`, `contract.signed_at`, `contract.finalized_at`. `summary` and reasons never get old/new values.
- The Core HR History tab is unchanged and is not an audit viewer; contract events are not merged into Employment History.

## 13. Server authority for state

The API returns, for every contract, the server-computed document state, disposition, time state, operational end, review items (warnings / Needs Review) and **per-caller allowed actions with reason codes**. The UI renders them and never re-derives lifecycle rules; every action re-validates server-side. Labels are client-side (i18n) from machine codes (C-02). Details: API draft §4.

## 14. Phase 2B extension boundary

Phase 2B (templates, preview, reproducible document snapshot, Word, PDF) **must be additive and must not require redesigning or invalidating the Phase 2A aggregate**. Expected additions: `contract_template_version`, `contract_document` (referencing `contract.id` + `contract.revision`), history event `document_generated`, generation operations, and possibly artifact-based restrictions on Return to Draft. Additive schema changes are allowed when an approved business requirement supports them. 2A must not add fields, flags or tables for 2B in advance. Real signed-document storage is separately gated (PL-13).

## 15. Consequences

- HR gets a contract register that cannot rewrite employment history and is forgiving of data-entry mistakes (Draft, Return to Draft, Correction, Void).
- Overlaps and gaps can exist in data; they are visible through Needs Review, not prevented.
- Numbers typed by mistake stay reserved (M-18); HR edits the Draft rather than discarding it.
- No Employee Type / Contract Type compatibility check until PV-31.
- Amendments cannot be recorded until the amendment checkpoint (PL-12, PV-38).

## 16. Implementation record — slice 2A-1 (2026-10-15)

Forward, additive migration `prisma/migrations/20261015000000_contract_foundation/migration.sql` (applied to local `hrms_dev` and rebuilt from zero on `hrms_test`; never run elsewhere).

| Object | Implemented as |
|---|---|
| `contract_type` | id, code (`^[A-Za-z0-9._-]{1,30}$`, unique `lower(code)`), name, name_vi, is_active, created_at, updated_at — catalog conventions, no behaviour flags |
| `contract` | id, **employment_id** (existing FK naming for the Employment Period), parent_contract_id, relationship_type, contract_type_id, contract_number, effective_from, effective_to (inclusive), **is_open_ended** (existing boolean naming), summary, finalized_at, finalized_by, signed_at (DATE), cancelled_at, voided_at, revision, created_at, created_by, updated_at (as on the Person aggregate) |
| `contract_history_event` | id, contract_id, event_type, effective_date, recorded_at, recorded_by, reason, related_contract_id |
| Constraints | `contract_relationship_type_check` (`renewal` only); `contract_relationship_pair_ck`; `contract_not_own_parent_ck`; `contract_parent_same_period_fk` (composite FK on `contract_id_employment_uq`); `contract_term_exclusive_ck`; `contract_dates_ck`; `contract_finalized_complete_ck`; `contract_finalized_by_ck`; `contract_signed_requires_finalized_ck`; `contract_single_disposition_ck`; `contract_void_requires_finalized_ck`; number CHECK (1–100 chars, no surrounding whitespace); `contract_history_event_reason_required_ck`; `contract_history_event_related_ck` |
| Indexes | `contract_number_ci_uq` UNIQUE on `lower(contract_number COLLATE "und-x-icu")` — no disposition excluded (M-18; ICU folding is independent of the database default collation, so the server must provide ICU); `contract_one_live_renewal_uq` partial on live renewals |
| Triggers | `contract_structural_rules_trg`: Effective From inside the period (on insert, on change of the date or period, and on finalization; never on period writes), new records/finalization only on a period that is not Cancelled/Voided (row read-locked), parent must be an agreement, link immutable, period fixed after Finalize. `contract_disposition_is_terminal_trg`: no insert already disposed, no change after Cancel/Void, disposing never changes content |
| Grants | `hrms_app`: SELECT, INSERT, UPDATE on `contract_type`, `contract`; SELECT, INSERT on `contract_history_event`; no DELETE anywhere |
| Audit | `audit_field_change_field_check` extended with the seven contract fields of §12 |
| Permissions | `contracts.read/manage/finalize/correct` in `ROLE_PERMISSIONS` and the `access_role_permission` mirror (HR_ADMIN 4, HR_EDITOR 3) |
| Code | `src/modules/contracts/model.ts` (number normalization, document state, value sets, `signed_at` business-date rule for later services), `src/modules/contracts/queries.ts` (shared operational predicate) |

Clarification applied in 2A-1: the Effective-From-inside-period rule is enforced on every write that sets the date (Draft included), not only at Finalize — an out-of-period date is objectively invalid for that period; later Phase 1 period corrections remain unblocked (C-107).

## 17. Implementation record — slice 2A-2 (2026-10-16)

- Operations (all `/api/v1/core-hr`): `createContract`, `getContract`, `updateContractDraft`, `createContractDiscard`, `createContractFinalize`, `createContractReturnToDraft`, `createContractSignatureConfirmation`, `listContractHistory` — design `docs/design/phase2a-slice-2a-2-lifecycle.md`.
- Code: `src/modules/contracts/evaluation.ts` (the single place that decides blockers, warnings, Needs Review, time state and allowed actions; services enforce through `stateReasons`), `src/modules/contracts/service.ts` (commands, projection, idempotent runner, database error mapping).
- Finalize (M-19): blockers → 422 `CONTRACT_NOT_READY`; warnings `OVERLAPPING_CONTRACT`, `GAP_AFTER_PREDECESSOR`, `ANOTHER_OPEN_DRAFT_FOR_PERIOD`, `CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD` → 409 `FINALIZE_CONFIRMATION_REQUIRED` with `warning_fingerprint` (`w1:` + SHA-256 of the sorted code/related-contract pairs) unless the request confirms exactly the current set; recomputed in the writing transaction; no acknowledgement record.
- Parent dispositions (C-111): under a Cancelled or Voided period a Draft is readable, keeps its history, cannot be edited or finalized and may be discarded; Confirm Signed is allowed under a Cancelled period and refused under a Voided one. Forward migration `20261016000000_contract_voided_parent_guard` makes a contract under a Voided period read-only in the database except for its own dispositions (Discard / Void).
- Concurrency: row lock + `contract.revision`; Idempotency-Key claimed inside the transaction (a rejected request leaves the key unused); `person.revision` untouched.
- **Scope of the Voided-parent guard (owner note, 2026-10-16, C-112):** `contract_voided_parent_read_only` protects **normal** lifecycle operations. It is not a permanent prohibition against a future, explicitly approved controlled correction / recovery / relink path; if 2A-5 (or later) approves such semantics, they arrive as an explicit forward-only change, never by weakening or bypassing the guard. MVP behaviour: under a **Cancelled** period Confirm Signed is allowed (historical truth) and Return to Draft is not; under a **Voided** period normal lifecycle mutation stays blocked.
- The error envelope gained an optional `warning_fingerprint` (FINALIZE_CONFIRMATION_REQUIRED only) and `details[].related_contract_id`.

## 18. Implementation record — slice 2A-3 (2026-10-16)

Contract screens over the 2A-2 API: sidebar **Contracts**, `/contracts` (portfolio list, canonical URL filters), `/contracts/{id}` (routeable Contract Detail with lifecycle dialogs and Contract History), Employee Detail **Contracts** tab, Create/Edit Draft dialog. New read operations `listContracts` and `listEmployeeContracts` (`src/modules/contracts/read.ts`), evaluated through the same facts (`facts.ts`) and `evaluation.ts` as the detail. Document status and Time status are always labelled separately; disposed records show only their disposition. Record: `docs/design/phase2a-slice-2a-3-ux.md`.
