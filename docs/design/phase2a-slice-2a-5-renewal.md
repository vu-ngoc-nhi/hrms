# Slice 2A-5 — Renewal chains, Cancel planned, Correction and Void (implementation record)

- Status: **Implemented (2026-10-16), awaiting owner checkpoint.** Decisions: C-115 (PV-39, gate revision 3 — `docs/design/phase2a-slice-2a-5-renewal-gate.md`), C-116; refines C-104, C-107, M-17, M-20 / C-113 as recorded in C-115. Phase 2A is **not** complete (2A-6 remains; Amendment stays gated). Not started: Amendment, early termination, Add Employee Contract integration, Phase 2B documents, Entra, real Contract data.

## Migration — `20261017000000_contract_renewal_chains`

Forward-only, no data change; applied to the guarded local `hrms_dev` and rebuilt from zero on `hrms_test` by every test run.

| Part | What it does |
|---|---|
| Validation | `contract_renewal_model_violations()` lists rows violating the approved model (`parent_is_amendment`, `cross_period_parent`, `branching`, `parent_not_renewable`, `starts_before_parent`); a `DO` block fails the migration **only** if it returns rows. Compatible renewal rows (e.g. a chain A → B → C) are accepted. Owner-only (revoked from PUBLIC). |
| Invariant name | `contract_one_live_renewal_uq` → `contract_one_nondisposed_renewal_uq` (definition unchanged): **one non-disposed direct renewal per parent agreement**; disposed = Discarded, Cancelled or Voided. |
| Structural rules | `contract_structural_rules()` replaced: the parent may be an original **or a renewal** agreement, never an amendment (`contract_parent_is_agreement`); on insert the parent must be renewable — Finalized/Signed, not disposed, not open-ended, with an Effective To (`contract_parent_renewable`); a renewal starts after its parent starts (`contract_renewal_starts_after_parent`, checked on insert, on an Effective From change and at Finalize). The parent row is read `FOR SHARE`. |
| Parent guard | New BEFORE UPDATE trigger `contract_parent_with_renewal_guard_trg`: while a non-disposed renewal exists the parent cannot be cancelled, voided or returned to Draft (`contract_parent_has_renewal`), cannot become open-ended or lose its Effective To (`contract_parent_renewable`), and cannot move its Effective From onto/after the renewal's start. Nothing cascades. |

## Behaviour (server; `src/modules/contracts/evaluation.ts`, `service.ts`)

| Topic | Implemented rule |
|---|---|
| Renew | `POST /contracts/{id}/renewals` (`contracts.manage`). Parent locked `FOR UPDATE`. New Draft in the parent's period (no `employment_id` accepted), `relationship.type = renewal`. Prefill: parent's Contract Type when active (changeable; no same-type rule), Effective From = parent Effective To + 1 (editable), number never prefilled. Parent gets one `renewal_created` history event linking the renewal; the renewal gets `created`; audit `contract.renew`. Expired parents may be renewed. |
| Refusals | Draft / disposed / open-ended parent → 422 `PARENT_NOT_RENEWABLE`; renewal exists → 409 `RENEWAL_EXISTS` (+ `related_contract_id`); period Cancelled/Voided → 422 `PERIOD_NOT_VALID`; start not after the parent's → 422 `RENEWAL_STARTS_BEFORE_PARENT`; outside the period → 422 `EFFECTIVE_FROM_OUTSIDE_PERIOD` (cross-period continuation = new period, new contract). |
| Gap / overlap | `GAP_AFTER_PREDECESSOR` (start > parent Effective To + 1) and `RENEWAL_OVERLAPS_PREDECESSOR` (start ≤ parent Effective To) are M-19 warnings and stay under Needs review while true. |
| Parent projection | Only a **Signed**, non-disposed renewal is the confirmed successor: parent operational end = renewal Effective From − 1 (`time_state_detail = replaced_by_renewal`) and the parent leaves Expiring soon. Draft and Finalized-unsigned renewals change nothing. The parent's stored Effective To is never changed; voiding the Signed renewal restores the parent's own projection. |
| Cancel planned | Contract-wide (`contracts.finalize`): Finalized, not Signed, Effective From after the Vietnam business date, no non-disposed renewal. Draft → Discard instead (`NOT_FINALIZED`); Signed → 409 `CONTRACT_STATE_CONFLICT` (`ALREADY_SIGNED`, PL-10); started → 422 `NOT_UPCOMING`. Mandatory reason; history `cancelled` with business date = Effective From; audit `contract.cancel_planned`. Number stays reserved. A cancelled renewal frees its parent. |
| Correction | `contracts.correct`, **Signed only** (Finalized-unsigned → Return to Draft; `NOT_SIGNED`). Fields: Contract Type, Contract Number (required), Effective From, Effective To / open-ended (exactly one), signed date (≤ today, never cleared). Mandatory reason; unchanged values → 400; history `corrected`; audit `contract.correct` with old/new values; database keeps lineage valid. Same contract identity. |
| Void | `contracts.correct`; Finalized/Signed **erroneous records only** (Draft → Discard). Mandatory reason, final (no Unvoid), stored values kept, no operational effect; history `voided`; audit `contract.void`. Blocked while a non-disposed renewal exists. Never used for early termination (not built). |
| Return to Draft | Additionally blocked (`DEPENDENT_CONTRACTS_EXIST`) while the contract has a non-disposed renewal. |
| Concurrency | All four take an Idempotency-Key (key used only when the command succeeds); Cancel planned / Correction / Void use `expected_revision`; concurrent renewals of one parent produce exactly one (parent lock + unique index). |

## API and projection

Operations `createContractRenewal`, `createContractCancelPlanned`, `createContractCorrection`, `createContractVoid` (generated OpenAPI; all `201` + `ContractDetail`). `ContractDetail.relationship` = `{ type, parent_id, parent_number, renewal_id, renewal_number, renewal_state }`; `renewal_defaults` = server prefill (`null` when Renew is unavailable); `actions` has nine keys. `ContractSummary.relationship` adds `parent_number`, `renewal_state`. New error codes: `RENEWAL_EXISTS`, `PARENT_NOT_RENEWABLE`, `RENEWAL_STARTS_BEFORE_PARENT`, `NOT_UPCOMING`.

## UI

Actions come only from server `actions`: **Renew** beside Edit; **Cancel planned contract**, **Correct contract**, **Void contract** (danger) in *More actions*. Renew opens the draft form in renew mode, prefilled only from `renewal_defaults`, and navigates to the new Draft. Cancel planned and Void dialogs require a reason; Void states that it is not for ending a valid contract early. Correction dialog sends only changed fields. Detail header shows lineage (*Renews X* / *Renewed by Y (state)*); history entries with a related contract link to it; the Employee Contracts tab shows *Renews X*. One server disposition (`cancelled`) is presented as **Discarded** for a Draft and **Cancelled** for a cancelled planned contract; the list filter reads "Include discarded, cancelled and voided". A plain note explains when the renewal is the only reason Return to draft / Cancel planned / Void are unavailable. No renewal rule is computed in the browser (unit-tested).

## Tests

- `tests/integration/contract-foundation-db.test.ts`: chains, renewable parent, start-after-parent, no branching, disposed renewal frees the slot, parent guard, link immutability; **migration validation** — the migration's own `DO` block is executed against planted rows (owner connection on `hrms_test`, triggers/constraint/index suspended inside a transaction that is always rolled back): a compatible chain passes, incompatible rows (amendment parent, branching, non-renewable parent, start before parent) fail.
- `tests/integration/contract-renewal.test.ts` (24, incl. the three owner close-out checks): Renew defaults/lineage/history/audit; type change; A → B → C; branching refused; discarded / cancelled / voided renewal frees the parent and keeps the number; open-ended / Draft / disposed parents refused, Expired allowed; same period only; gap and overlap warnings; Draft and Finalized renewals leave parent reminders unchanged, Signed renewal changes the projection and keeps stored Effective To; voided Signed renewal restores it; Cancel planned generic / Signed / started / Draft; dependency rules for cancel, void, return to Draft; Correction (Signed only, permissions, no-op, future date, stale revision, reason, lineage); Void (permissions, reason, kept values, not early termination); permissions; idempotent replay; concurrent renewals; stale revisions.
- Updated: `db-schema-guarantees` (newest migration, index name, new trigger), `permission-matrix` (four operations), `contract-ui` unit tests (placement, server prefill, correction body, explanation, labels, no browser renewal rules).
- Regression: typecheck, lint, `npm test` 63 files / 816 tests, integrity baseline, UAT round 1 (22) and round 2 (5), integrity scan (0 errors / 0 warnings), production build — all green.

## Browser review (synthetic data, local test identities)

HR Editor: Renew on SYN-HD-2026-005 (prefill Test Type B, 06 Nov 2026), renewal Draft SYN-HD-2026-006 created and opened with *Renews*; parent shows *Renewed by … (Draft)*, Renew and Return to draft hidden with the plain explanation; history *Renewal created* links to the renewal. HR Admin: Correct contract on SYN-HD-2026-001 (signed date, reason shown in history); Finalize of the renewal (no warnings); Void dialog copy checked (not submitted); Cancel planned of the renewal → *Record: Cancelled*, history with reason and business date; parent renewable again. No horizontal overflow at 1024, 390 and 375 px.

## Owner close-out checks (verified and tested)

**1. Correction cannot rewrite lineage.** `ContractCorrection` is a strict body with only `expected_revision`, `reason`, `contract_type_id`, `contract_number`, `effective_from`, `effective_to`, `is_open_ended`, `signed_at`; sending `employment_id`, `parent_contract_id` or `relationship_type` (any value, including `null` or `amendment`) is refused with 400 `VALIDATION_ERROR` / `FIELD_NOT_ALLOWED`. The service writes only those six columns. The database independently refuses any change of the link (`contract_link_immutable`) and of the period of a Finalized contract (`contract_employment_fixed_after_finalize`), keeps a renewal starting after its parent (`contract_renewal_starts_after_parent`) and keeps a renewed parent finite and starting first (parent guard). A permitted date correction may create or remove a gap/overlap **warning** but never changes who renews whom. Any lineage change needs a separately approved recovery path; none exists in 2A-5. Tests: `contract-renewal.test.ts` › *Correction cannot change employment_id, parent_contract_id or relationship_type*; `contract-foundation-db.test.ts` (link immutability, period fixed after Finalize, parent guard).

**2. Inactive Contract Type during correction (C-44 applied).** Exact behaviour:

| Situation | Behaviour |
|---|---|
| Correction of other fields on a contract whose type is now inactive | The type is **retained** unchanged (no re-validation of an unchanged reference). |
| Correction to another **existing** inactive type (API) | **Accepted** — C-44: a historical correction may reference an inactive catalog value that still exists, to record what was historically true; reason mandatory, audit `contract.correct` stores old/new type id. |
| Correction to a non-existent type | 404. |
| Correction dialog (UI) | Offers **active types plus the record's current type only**; inactive types are not presented as ordinary choices. Correcting to a *different* inactive type is therefore API-only in 2A-5 (offering labelled inactive options in the dialog, as Core HR correction forms do, would be a separate owner decision). The current type is shown by name without an "inactive" marker. |
| New business data — Create, Draft edit, Renew | Inactive type refused (`CONTRACT_TYPE_INACTIVE`); Renew does not prefill an inactive parent type (`renewal_defaults.contract_type_id = null`); Finalize blocks a Draft with an inactive type. |

Test: `contract-renewal.test.ts` › *inactive Contract Type (C-44)*.

**3. Renewing a Finalized, unsigned renewal is intentional.** Under C-115 a renewable parent is Finalized **or** Signed, so A → B (B Finalized, not signed) → C is allowed when every other invariant holds; B unsigned is not A's confirmed successor, so A's projection is unchanged. Not to be changed without a new owner decision. Tests: `contract-renewal.test.ts` › *A → B (Finalized, NOT signed) → C is intentionally allowed*; `contract-foundation-db.test.ts` › chains (database level, B Finalized unsigned).

## Interpretations recorded (no new business rule)

1. The default Effective From is only a prefill; if parent Effective To + 1 falls outside the period the server refuses the date (HR edits it; a continuation beyond the period is a new period and contract, per C-115 §9).
2. Inactive Contract Type in a correction follows C-44 exactly as tabulated above.
3. "Cancelled" vs "Discarded" is presentation of the single Cancelled disposition, using the document state.
