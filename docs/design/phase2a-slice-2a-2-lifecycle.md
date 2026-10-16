# Slice 2A-2 — Core Contract lifecycle (design)

- Status: **Approved with one modification and implemented (2026-10-16, C-111).** Point 1 was split by the owner: a **Cancelled** period allows Confirm Signed, a **Voided** period refuses it (also enforced by the database, migration `20261016000000_contract_voided_parent_guard`). Builds on ADR-0005, the API draft (`docs/api/contracts-api-draft.md`) and decisions C-104 … C-110, M-15 … M-19.
- Scope: the server-side lifecycle of a single contract — Draft create / read / edit / discard, Finalize (with the M-19 warning confirmation), Return to Draft, Confirm Signed, contract history. **API and services only.**
- Not in 2A-2: list/filter and the Employee Contracts tab (2A-3; the *Review before finalizing* dialog ships with those screens), reminders / Home and the `attention` block (2A-4, needs PV-36), Renewal / Cancel Planned / Correction / Void (2A-5), Add Employee step (2A-6), Amendment (gated), Phase 2B, real data, Entra.

## 1. Operations

All under `/api/v1/core-hr`, declared once in the contract registry (tag **Contracts**), enforced by the shared handler; strict bodies; Asia/Ho_Chi_Minh business dates.

| operationId | Method + path | Permission | Idempotency / concurrency | Success |
|---|---|---|---|---|
| createContract | POST `/contracts` | contracts.manage | `Idempotency-Key` | 201 `ContractDetail` |
| getContract | GET `/contracts/{id}` | contracts.read | — | 200 `ContractDetail` |
| updateContractDraft | PATCH `/contracts/{id}` | contracts.manage | `expected_revision` | 200 `ContractDetail` (no-op → unchanged, no revision bump) |
| createContractDiscard | POST `/contracts/{id}/discard` | contracts.manage | key + revision | 201 `ContractDetail` |
| createContractFinalize | POST `/contracts/{id}/finalize` | contracts.finalize | key + revision | 201 `ContractDetail` |
| createContractReturnToDraft | POST `/contracts/{id}/return-to-draft` | contracts.finalize | key + revision | 201 `ContractDetail` |
| createContractSignatureConfirmation | POST `/contracts/{id}/confirm-signed` | contracts.finalize | key + revision | 201 `ContractDetail` |
| listContractHistory | GET `/contracts/{id}/history` | contracts.read | — | 200 `{ data: ContractHistoryItem[] }` |

Idempotency uses the existing module (claimed in the business transaction, so a rejected request leaves the key free). Every mutation locks the contract row (`FOR UPDATE`), checks `expected_revision`, increments `revision`, writes `updated_at`, one audit event and — for lifecycle actions — one history event, in one transaction. The database trigger read-locks the Employment Period when dates or finalization are written.

## 2. Rules per action

| Action | Allowed when | Effect | History | Audit (old/new fields) |
|---|---|---|---|---|
| **Create Draft** | Period exists and is not Cancelled/Voided; type (if given) active; number (if given) normalized and free; Effective From (if given) inside the period; term consistent | New Draft, revision 1 | `created` | `contract.create` (field names; structural values) |
| **Edit Draft** | Draft; not Cancelled; period not Cancelled/Voided (else 422 `PERIOD_NOT_VALID`); same field checks as create; `employment_id` not editable | Changed fields only | — (audit only) | `contract.update_draft` |
| **Discard Draft** | Draft; not Cancelled | `cancelled_at`; number stays occupied (C-110) | `discarded` (reason optional) | `contract.discard` |
| **Finalize** | Draft, not Cancelled; no blockers; M-19 confirmation when warnings exist (§3) | `finalized_at`, `finalized_by` | `finalized` | `contract.finalize` (`contract.finalized_at`) |
| **Return to Draft** | C-109: Finalized, not Signed, not Cancelled/Voided; period not Cancelled/Voided (Ended is fine); no renewal child that is not Cancelled/Voided (`DEPENDENT_CONTRACTS_EXIST`; unreachable until 2A-5); reason 1–500 | Clears `finalized_at` / `finalized_by`; number and content kept | `returned_to_draft` (reason) | `contract.return_to_draft` (`contract.finalized_at`) |
| **Confirm Signed** | Finalized, not Signed, not Cancelled/Voided; period not **Voided** (a Cancelled period is allowed, C-111); `signed_at ≤ today` (Asia/Ho_Chi_Minh; 422 `SIGNED_AT_IN_FUTURE`); past dates and dates before Effective From / the period start are fine (C-109) | `signed_at` | `signed_confirmed` (effective_date = `signed_at`) | `contract.confirm_signed` (`contract.signed_at`) |

`recorded_at` on every history event preserves when HR actually entered the record (past-dated registration, C-109).

## 3. Finalize and warnings (M-19)

```
POST /finalize { expected_revision, confirmed_warning_fingerprint? }
   │  lock contract, check revision and state
   │  recompute BLOCKERS ──► any? ──► 422 CONTRACT_NOT_READY (details = blockers)   ← never overridable
   │  recompute WARNINGS ──► none? ──► finalize
   │                     └─► some: fingerprint(current) == confirmed_warning_fingerprint ? finalize
   │                                                                              : 409 FINALIZE_CONFIRMATION_REQUIRED
   │                                                                                (details = current warnings, nothing changed)
```

- **Blockers** (422 `CONTRACT_NOT_READY`, `details[].code`): `REQUIRED` (field = contract_type_id / contract_number / effective_from / term), `CONTRACT_TYPE_INACTIVE`, `EFFECTIVE_FROM_OUTSIDE_PERIOD`, `INVALID_TERM`, `PERIOD_NOT_VALID`. Stale revision (409 `REVISION_CONFLICT`), wrong state (409 `CONTRACT_STATE_CONFLICT` / `CONTRACT_READ_ONLY`) and a duplicate number (409 `DUPLICATE_CONTRACT_NUMBER`) are rejected before warnings are considered.
- **Warnings** (non-blocking, M-17): `OVERLAPPING_CONTRACT` — another operational Finalized/Signed agreement of the same person whose operational range intersects this contract's range (`effective_from` … `effective_to` / period end / open), excluding its renewal parent or child; `CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD` — `effective_to` after the period's end date; `ANOTHER_OPEN_DRAFT_FOR_PERIOD` — another operational Draft on the same period; `GAP_AFTER_PREDECESSOR` — renewals only (reachable from 2A-5). Each warning carries `related_contract_id` where relevant.
- **Fingerprint:** `w1:` + SHA-256 (hex) of the canonical, sorted list of `(code, related_contract_id)` pairs. Server-issued in `ContractDetail.finalize_check.warning_fingerprint` (null when there are no warnings) and recomputed in the writing transaction. It is a change detector, not a security token — the server rule is "do not finalize past warnings HR has not seen", and every blocker is re-checked regardless.
- Confirming creates **no** acknowledgement record and resolves nothing: a remaining overlap/gap shows in `review` (Needs Review) until the data changes.
- UI (built with the 2A-3 screens): one dialog — **Review before finalizing** · warning list (plain-language messages from the i18n catalogue) · **Review Contract** (closes) / **Finalize Anyway** (sends the fingerprint shown). On `FINALIZE_CONFIRMATION_REQUIRED` the UI reloads the contract and shows the dialog again with the new list.

## 4. `ContractDetail` in 2A-2

As API draft §4 with these 2A-2 specifics:
- `state` (document state, disposition, operational, time state + detail, operational end, days to operational end) — computed on read.
- `review` — Needs Review items for Finalized/Signed contracts (`OVERLAPPING_CONTRACT`, `GAP_AFTER_PREDECESSOR`, `CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD`, `EFFECTIVE_FROM_OUTSIDE_PERIOD`, `PERIOD_CANCELLED`, `PERIOD_VOIDED`).
- `finalize_check` — Drafts only: `{ ready, blockers, warnings, warning_fingerprint }`.
- `actions` — `edit`, `discard`, `finalize`, `return_to_draft`, `confirm_signed`, each `{ allowed, reasons[] }` per caller.
- `relationship` — `{ type, parent, renewal }` (renewals appear from 2A-5).
- `attention` — **omitted in 2A-2**; added additively in 2A-4 once PV-36 fixes the reminder window.
- Identity: `employee { person_id, employee_code, full_name }` only (directory level); actors as `{ user_id, display_name }` from `app_user`.

Warnings, review items, blockers and actions come from **one** pure evaluation module (`src/modules/contracts/evaluation.ts`) used by the read model and by the writing services, so the preview and the action can never disagree. It is not a generic rules framework: a fixed list of named checks.

## 5. Error mapping

| Source | API |
|---|---|
| 23505 `contract_number_ci_uq` | 409 `DUPLICATE_CONTRACT_NUMBER` (field `contract_number`) |
| `contract_effective_from_within_period` | 422 `EFFECTIVE_FROM_OUTSIDE_PERIOD` |
| `contract_period_valid` | 422 `PERIOD_NOT_VALID` |
| `contract_term_exclusive_ck`, `contract_dates_ck` | 422 `INVALID_TERM` |
| `contract_disposition_is_terminal` | 409 `CONTRACT_READ_ONLY` |
| Any other contract constraint | 500 (programmer error; the service checks first, the database is the backstop) |

Messages are English developer text; the UI maps codes through `src/i18n`.

## 6. Tests (planned)

Permission matrix for the 8 operations (every actor); create/edit/discard incl. number normalization, duplicate (case-insensitive, held by a discarded Draft), inactive type, period Cancelled/Voided; Finalize — each blocker, no-warning path, warning path (409 + details), fingerprint match, fingerprint stale after another contract changes, blockers re-checked even with a valid fingerprint, warning still in `review` after Finalize Anyway, only a `finalized` event; Return to Draft — unsigned only, reason required, Ended period allowed, Cancelled/Voided period refused, number kept; Confirm Signed — future date refused (Vietnam date boundary), past date and date before period start accepted, `recorded_at` vs `signed_at`; idempotent replay and key reuse; revision conflict; audit old/new values; history ordering and reason visibility; OpenAPI drift; Phase 1 regression (full suite, UAT rounds, integrity scan).

## 7. Points to confirm before implementation

| # | Point | Recommendation |
|---|---|---|
| 1 | Confirm Signed on a Finalized contract whose period was later Cancelled/Voided | **Decided (C-111): Cancelled → allow** (records a true fact; the contract stays non-operational and in Needs Review); **Voided → refuse** (422 `PERIOD_NOT_VALID`, `PERIOD_VOIDED`); a future need goes through a separately approved correction/recovery path |
| 2 | Edit Draft on a Cancelled/Voided period | **Refuse** (`PERIOD_NOT_VALID`); Discard stays allowed for cleanup |
| 3 | `ANOTHER_OPEN_DRAFT_FOR_PERIOD` and `CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD` follow the same M-19 confirmation as overlap/gap | **Yes** — they are M-17 review warnings, never blockers |
| 4 | The *Review before finalizing* dialog ships with the 2A-3 contract screens, not in 2A-2 | **Yes** — 2A-2 has no contract screen to host it |
