# Contract API — Phase 2A draft (not implemented)

- Status: **Draft (2A-0, 2026-10-15); slice 2A-1 implemented the Contract Type catalog operations** (`listContractTypes`, `createContractType`, `updateContractType`, now in the generated OpenAPI contract) and the four `contracts.*` permissions. Every operation not marked ✅ is still a draft and enters the contract only in its slice. Finalize warnings follow **M-19** (PV-43, 2026-10-16): explicit confirmation with a server-issued warning fingerprint (§3, §4.3). **Slice 2A-2 implemented the core lifecycle** (create / read / edit / discard Draft, Finalize, Return to Draft, Confirm Signed, history — §2 rows marked ✅); design and decisions: `docs/design/phase2a-slice-2a-2-lifecycle.md`, C-111. In 2A-2 `ContractDetail` omits `attention` (added in 2A-4, PV-36) and `relationship` is `{ type, parent_id, renewal_id }`. **Slice 2A-3 implemented `listContracts` and `listEmployeeContracts`** (§5, §6) and the contract screens (`docs/design/phase2a-slice-2a-3-ux.md`). **Slice 2A-4 implemented `getContractReminders`** and the attention filters (§5, §7). **Slice 2A-5 implemented Renew, Cancel planned, Correction and Void** (§2 rows marked ✅, §3) with renewal lineage on the detail and list (`docs/design/phase2a-slice-2a-5-renewal.md`, C-115, C-116). **Slice 2A-6 added no operation:** Add Employee may optionally call the existing `createContract` after `createEmployee` succeeded, as a separate request with its own Idempotency-Key and the returned Employment Period id (`docs/design/phase2a-slice-2a-6-add-employee-contract.md`, C-117).
- Frozen design: `docs/adr/0005-contract-domain.md`. Decisions: C-104 … C-109, M-15 … M-18 (`docs/decision-register.md`).
- **Amendment is not specified as implementation-ready** (gated, C-109). Phase 2B generation is out of scope.

## 1. Conventions

All Core HR conventions apply unchanged (`docs/api/core-hr-api.md`): JSON, snake_case, UUID ids, stable English machine codes; business dates `YYYY-MM-DD`; timestamps ISO 8601 with offset; "today" = Asia/Ho_Chi_Minh; paging `page` / `page_size` (≤ 100) with `{ data, total, page, page_size }`; error envelope `{ error, message, request_id, details? }`; strict bodies (unknown fields → 400 `FIELD_NOT_ALLOWED`); `Cache-Control: no-store`, `X-Request-Id`; permission declared once per operation in the contract registry and enforced by the shared handler before the body is parsed.

**Namespace (TECHNICAL DECISION):** `/api/v1/core-hr/contracts` and `/api/v1/core-hr/contract-types`. Contracts attach to Core HR Employment Periods and reuse the same handler, error envelope, OpenAPI document (`/internal/docs`, tag **Contracts**) and `GET /api/v1/core-hr/me/permissions` (which will list `contracts.*` once 2A-1 adds them). `core-hr` is a kept technical identifier (C-103). The domain code lives in its own module (e.g. `src/modules/hr-contracts/`, name fixed in 2A-1). Alternative considered: a separate `/api/v1/contracts` namespace — rejected for now because it duplicates permission discovery and OpenAPI wiring without a demonstrated need.

**Writes:**

| Kind | Headers / body | Success |
|---|---|---|
| POST create / lifecycle action | `Idempotency-Key` required; `expected_revision` on every action on an existing contract | `201` + `ContractDetail` (replay: same status + `Idempotent-Replayed: true`, current representation) |
| PATCH Draft | `expected_revision`; no key (Phase 1 PATCH convention) | `200` + `ContractDetail` (unchanged if nothing differed: no revision bump, no history) |

## 2. Operation surface

| Slice | operationId | Method + path | Permission | Purpose |
|---|---|---|---|---|
| 2A-1 ✅ | listContractTypes | GET `/contract-types` | catalogs.read | Catalog (`include_inactive` flag) |
| 2A-1 ✅ | createContractType | POST `/contract-types` | catalogs.manage | `{ code, name, name_vi? }`; 409 `DUPLICATE_CATALOG_CODE` |
| 2A-1 ✅ | updateContractType | PATCH `/contract-types/{id}` | catalogs.manage | `name`, `name_vi`, `is_active`; code immutable |
| 2A-2 ✅ | createContract | POST `/contracts` | contracts.manage | Create a Draft |
| 2A-2 ✅ | getContract | GET `/contracts/{id}` | contracts.read | `ContractDetail` |
| 2A-2 ✅ | updateContractDraft | PATCH `/contracts/{id}` | contracts.manage | Edit a Draft |
| 2A-2 ✅ | createContractDiscard | POST `/contracts/{id}/discard` | contracts.manage | Draft → Cancelled |
| 2A-2 ✅ | createContractFinalize | POST `/contracts/{id}/finalize` | contracts.finalize | Draft → Finalized |
| 2A-2 ✅ | createContractReturnToDraft | POST `/contracts/{id}/return-to-draft` | contracts.finalize | Finalized (unsigned) → Draft |
| 2A-2 ✅ | createContractSignatureConfirmation | POST `/contracts/{id}/confirm-signed` | contracts.finalize | Finalized → Signed |
| 2A-2 ✅ | listContractHistory | GET `/contracts/{id}/history` | contracts.read | Business history |
| 2A-3 ✅ | listContracts | GET `/contracts` | contracts.read | Portfolio list/filter (§5) |
| 2A-3 ✅ | listEmployeeContracts | GET `/employees/{id}/contracts` | contracts.read | Grouped for the Employee Contracts tab (§6) |
| 2A-4 ✅ | getContractReminders | GET `/contract-reminders` | contracts.read | Home Contract Attention (§7) |
| 2A-5 ✅ | createContractRenewal | POST `/contracts/{id}/renewals` | contracts.manage | Renewal Draft linked to `{id}` (parent: Finalized/Signed, not disposed, finite term, no non-disposed renewal — C-115) |
| 2A-5 ✅ | createContractCancelPlanned | POST `/contracts/{id}/cancel-planned` | contracts.finalize | Finalized **unsigned**, Effective From > today → Cancelled (Signed withdrawal = PL-10, not offered; C-115) |
| 2A-5 ✅ | createContractCorrection | POST `/contracts/{id}/corrections` | contracts.correct | Correct Signed data |
| 2A-5 ✅ | createContractVoid | POST `/contracts/{id}/void` | contracts.correct | Finalized/Signed **erroneous record** → Voided (never to stop a valid contract that has begun) |
| 2A-6 | — | (wizard uses `createContract`) | contracts.manage | Optional Draft after `createEmployee` succeeded |
| gated | — | Amendment | — | Not specified until PL-12 / PV-38 checkpoint |

Paths are relative to `/api/v1/core-hr`.

## 3. Request bodies

**createContract** (`Idempotency-Key`)
```json
{
  "employment_id": "uuid (required; period must not be Cancelled/Voided)",
  "contract_type_id": "uuid | null",
  "contract_number": "string ≤ 100 | null (trimmed; empty → null; unique once assigned)",
  "effective_from": "YYYY-MM-DD | null",
  "effective_to": "YYYY-MM-DD | null",
  "is_open_ended": false,
  "summary": "string ≤ 1000 | null"
}
```
Draft-time checks (objectively invalid input only): `effective_to < effective_from` → 422 `INVALID_TERM`; `is_open_ended = true` with `effective_to` → 422 `INVALID_TERM`; inactive type → 422 `CONTRACT_TYPE_INACTIVE`; number taken → 409 `DUPLICATE_CONTRACT_NUMBER`. Missing fields are allowed in a Draft.

**updateContractDraft** — same fields except `employment_id`, all optional (`null` clears), plus `expected_revision`. Only Drafts: otherwise 409 `CONTRACT_NOT_DRAFT`.

**createContractDiscard** — `{ expected_revision, reason?: string ≤ 1000 }`.

**createContractFinalize** (M-19) — `{ expected_revision, confirmed_warning_fingerprint?: string }`. The server recomputes blockers and warnings in the writing transaction. Blockers → 422 `CONTRACT_NOT_READY` (never overridable). No warnings → finalize. Warnings and no fingerprint, or a fingerprint that no longer matches the current warning set → 409 `FINALIZE_CONFIRMATION_REQUIRED` with the current warnings in `details`; nothing changes. Matching fingerprint → finalize (warnings are not resolved; the contract stays under Needs Review). The 409 body carries the current `warning_fingerprint` next to `details`.

**createContractReturnToDraft** — `{ expected_revision, reason: string 1–1000 }`.

**createContractSignatureConfirmation** — `{ expected_revision, signed_at: "YYYY-MM-DD" }` (≤ today in Asia/Ho_Chi_Minh, else 422 `SIGNED_AT_IN_FUTURE`). C-111: allowed under a Cancelled period; refused under a Voided period (422 `PERIOD_NOT_VALID`, detail `PERIOD_VOIDED`).

**2A-5 (C-115; implemented in slice 2A-5, C-116 — gate `docs/design/phase2a-slice-2a-5-renewal-gate.md`, record `docs/design/phase2a-slice-2a-5-renewal.md`):** all four return `201` with the affected `ContractDetail` (Renew: the new renewal Draft) and take an Idempotency-Key.
- **Renewal** `POST /contracts/{id}/renewals` `{ contract_type_id?, contract_number?, effective_from?, effective_to?, is_open_ended?, summary? }` + Idempotency-Key → new Draft with `relationship.type = renewal`. Defaults (also exposed read-only as `renewal_defaults` on the parent's `ContractDetail`): parent's Contract Type when still active, `effective_from` = parent Effective To + 1 (Asia/Ho_Chi_Minh); the number is never prefilled; there is no `employment_id` (always the parent's period). Refused: parent Draft / disposed / open-ended → 422 `PARENT_NOT_RENEWABLE`; Effective From not after the parent's → 422 `RENEWAL_STARTS_BEFORE_PARENT`; non-disposed renewal exists → 409 `RENEWAL_EXISTS`; period Cancelled/Voided → 422 `PERIOD_NOT_VALID`. Finalize blocker `RENEWAL_STARTS_BEFORE_PARENT`; warnings `GAP_AFTER_PREDECESSOR`, `RENEWAL_OVERLAPS_PREDECESSOR` (M-19 confirmation). Parent history gets one `renewal_created` event ("Renewal created") with `related_contract_id` = the renewal; the renewal gets `created`. Audit `contract.renew`.
- **Cancel planned** `{ expected_revision, reason }` — contract-wide: Finalized, not Signed, Effective From after today (Draft → Discard; Signed → 409 `CONTRACT_STATE_CONFLICT`, PL-10; started → 422 `NOT_UPCOMING`); blocked while a non-disposed renewal child exists (409 `DEPENDENT_CONTRACTS_EXIST`, detail `related_contract_id`). History `cancelled` (business date = Effective From). Audit `contract.cancel_planned`.
- **Corrections** `{ expected_revision, reason, contract_type_id?, contract_number?, effective_from?, effective_to?, is_open_ended?, signed_at? }` — Signed data, transcription errors (Finalized-unsigned → 409 `CONTRACT_STATE_CONFLICT`, detail `NOT_SIGNED`: return it to Draft instead). At least one field; `employment_id`, `parent_contract_id`, `relationship_type` are not accepted (400 `FIELD_NOT_ALLOWED`; lineage is never rewritten); `contract_type_id` may keep or reference an existing inactive type (C-44), never a non-existent one (404); unchanged values → 400; `signed_at` not in the future and never cleared; the database keeps lineage valid (a renewed parent stays finite and starts before its renewal). History `corrected` with the reason; audit `contract.correct` with old/new values.
- **Void** `{ expected_revision, reason }` — erroneous Finalized/Signed records only, never early termination; stored values are kept; blocked while a non-disposed renewal child exists. History `voided`; audit `contract.void`.

## 4. Response representation — `ContractDetail`

The server is authoritative for document state, time state, allowed actions and review items. The UI renders these fields and never re-derives lifecycle rules.

```json
{
  "id": "uuid",
  "revision": 3,
  "as_of": "2026-10-15",

  "employee": { "person_id": "uuid", "employee_code": "ES0042", "full_name": "Nguyễn Văn An" },
  "employment": {
    "id": "uuid",
    "start_date": "2026-01-05",
    "end_date": null,
    "employment_status": "active",
    "disposition": null,
    "employee_type": { "id": "uuid", "code": "EMPLOYEE", "name": "Employee" }
  },

  "contract_type": { "id": "uuid", "code": "EXAMPLE_FIXED_TERM", "name": "Example fixed-term", "name_vi": null, "is_active": true },
  "contract_number": "HD-2026-001",
  "effective_from": "2026-01-05",
  "effective_to": "2027-01-04",
  "is_open_ended": false,
  "summary": null,
  "signed_at": "2026-01-03",

  "relationship": {
    "type": null,
    "parent": null,
    "renewal": { "id": "uuid", "contract_number": "HD-2027-014", "document_state": "draft" }
  },

  "state": {
    "document_state": "signed",
    "disposition": null,
    "operational": true,
    "time_state": "active",
    "time_state_detail": null,
    "operational_end": "2027-01-04",
    "days_to_operational_end": 81
  },

  "attention": {
    "expiring_soon": false,
    "awaiting_signature": false,
    "renewal_state": "draft"
  },

  "review": {
    "needs_review": false,
    "items": []
  },

  "finalize_check": null,

  "actions": {
    "edit":             { "allowed": false, "reasons": ["NOT_DRAFT"] },
    "discard":          { "allowed": false, "reasons": ["NOT_DRAFT"] },
    "finalize":         { "allowed": false, "reasons": ["NOT_DRAFT"] },
    "return_to_draft":  { "allowed": false, "reasons": ["ALREADY_SIGNED"] },
    "confirm_signed":   { "allowed": false, "reasons": ["ALREADY_SIGNED"] }
  },

  "finalized_at": "2026-01-02T09:12:00+07:00",
  "finalized_by": { "user_id": "uuid", "display_name": "HR Editor (test)" },
  "created_at": "2026-01-02T08:40:00+07:00",
  "created_by": { "user_id": "uuid", "display_name": "HR Editor (test)" }
}
```

### 4.1 State fields

| Field | Values | Rule |
|---|---|---|
| `state.document_state` | `draft` \| `finalized` \| `signed` | From the markers (ADR §4) |
| `state.disposition` | `null` \| `cancelled` \| `voided` | Markers |
| `state.operational` | boolean | Shared predicate: not Cancelled/Voided and period not Cancelled/Voided |
| `state.time_state` | `null` \| `upcoming` \| `active` \| `expired` | Only for operational Finalized/Signed contracts (ADR §5) |
| `state.time_state_detail` | `null` \| `closed_by_employment_end` \| `replaced_by_renewal` | Which bound produced the operational end |
| `state.operational_end` | date \| null | `least(effective_to, period end, signed renewal start − 1)` (only a **Signed** renewal counts, C-115); null when open-ended and unbounded |
| `state.days_to_operational_end` | integer \| null | Relative to `as_of` |
| `attention.expiring_soon` | boolean | (not exposed on the detail; Home uses `GET /contract-reminders`) Expiring within the window and no **Signed** renewal (C-115) |
| `attention.awaiting_signature` | boolean | Finalized, not Signed |
| `relationship.renewal_state` | `null` \| `draft` \| `finalized` \| `signed` | (2A-5) Document state of the non-disposed direct renewal (`relationship` also carries `parent_number` and, on the detail, `renewal_number`) |
| `renewal_defaults` | `null` \| `{ contract_type_id, effective_from }` | (2A-5, detail only) Server prefill for Renew; `null` when Renew is not available |
| `employment.employment_status` | `not_started` \| `active` \| `ended` | Core HR computation (context only; never gates contract actions) |

### 4.2 Review items (warnings / Needs Review)

`review.items[]` = `{ code, message, related_contract_id?, related_contract_number?, affected_from?, affected_to? }` (the last three are server-computed presentation facts added at owner acceptance, C-118: the other contract's number and the first / last business date concerned — overlapping days, uncovered gap days; `affected_from` / `affected_to` are part of the warning fingerprint (C-120), the number is not; the same shape is used for `finalize_check.warnings` and the `FINALIZE_CONFIRMATION_REQUIRED` details); `needs_review` is true when any item exists. Computed on read for Finalized/Signed contracts and for contracts on an invalid period:

| Code | Meaning |
|---|---|
| `OVERLAPPING_CONTRACT` | Overlaps another operational agreement of the person that is not its renewal parent/child (that pair uses `RENEWAL_OVERLAPS_PREDECESSOR`) |
| `GAP_AFTER_PREDECESSOR` | Renewal starts after the day following its parent's own Effective To |
| `RENEWAL_OVERLAPS_PREDECESSOR` | (2A-5, C-115) Renewal starts on or before its parent's own Effective To |
| `CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD` | `effective_to` after the period's end date |
| `EFFECTIVE_FROM_OUTSIDE_PERIOD` | Became outside the period after a period correction |
| `PERIOD_CANCELLED` / `PERIOD_VOIDED` | The linked period lost validity; contract left operations |

### 4.3 Finalize check (Drafts only, otherwise `null`)

```json
"finalize_check": {
  "ready": false,
  "blockers": [ { "field": "contract_number", "code": "REQUIRED", "message": "…" } ],
  "warnings": [ { "code": "ANOTHER_OPEN_DRAFT_FOR_PERIOD", "message": "…" } ],
  "warning_fingerprint": "w2:3f9a…  (null when there are no warnings; C-120: SHA-256 of the sorted JSON facts code / related_contract_id / field / affected_from / affected_to of each warning)"
}
```
Blocker codes: `REQUIRED` (contract_type_id, contract_number, effective_from, term), `CONTRACT_TYPE_INACTIVE`, `EFFECTIVE_FROM_OUTSIDE_PERIOD`, `PERIOD_NOT_VALID`, `INVALID_TERM`, `RENEWAL_STARTS_BEFORE_PARENT` (2A-5). Warning codes: `OVERLAPPING_CONTRACT`, `GAP_AFTER_PREDECESSOR`, `RENEWAL_OVERLAPS_PREDECESSOR` (2A-5), `CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD`, `ANOTHER_OPEN_DRAFT_FOR_PERIOD`. The Finalize action re-evaluates; this block is a preview.

### 4.4 Actions (per caller)

`actions` lists **only operations implemented in the current slice** (keys are added as slices land; clients ignore unknown keys). Each entry: `{ allowed, reasons[] }`; `allowed` = the caller has the permission **and** the state rules pass. Reason codes:

| Code | Meaning |
|---|---|
| `PERMISSION_REQUIRED` | Caller lacks the operation's permission (UI may hide or disable) |
| `NOT_DRAFT` / `NOT_FINALIZED` | Wrong document state |
| `ALREADY_SIGNED` | Signed contracts cannot be edited, returned to Draft or re-confirmed |
| `CONTRACT_CANCELLED` / `CONTRACT_VOIDED` | Terminal disposition |
| `PERIOD_NOT_VALID` | Linked period Cancelled/Voided |
| `DEPENDENT_CONTRACTS_EXIST` | A renewal child that is not Cancelled/Voided |
| `NOT_READY` | Finalize blockers exist (see `finalize_check`) |
| `NOT_UPCOMING` | (2A-5) Cancel planned requires Effective From after today |
| `ALREADY_SIGNED` | also: Cancel planned is not offered for Signed contracts (PL-10) |
| `RENEWAL_EXISTS` | (2A-5) A non-disposed direct renewal already exists |
| `OPEN_ENDED` | (2A-5) Open-ended contracts are not renewed (the Renew request answers 422 `PARENT_NOT_RENEWABLE`) |
| `NOT_SIGNED` | (2A-5) Correction applies to Signed contracts only |

Capabilities are advisory: every action re-checks permission and state on the server.

### 4.5 `ContractSummary` (lists)

`id`, `revision`, `employee`, `employment { id, employment_status, disposition, employee_type }`, `contract_type { id, code, name }`, `contract_number`, `effective_from`, `effective_to`, `is_open_ended`, `signed_at`, `relationship { type, parent_id, parent_number, renewal_id, renewal_state }` (2A-5), `state` (§4.1), `attention`, `review { needs_review, codes[] }`. No `actions`, `finalize_check`, audit or reasons.

## 5. `GET /contracts` — list and filter (implemented in 2A-3)

As built (the smallest useful set the server provides authoritatively):

| Parameter | Type | Meaning |
|---|---|---|
| `search` | string ≤ 100 | Contract Number, employee name or Employee Code (case-insensitive, contains; accents kept) |
| `contract_type_id` | uuid | |
| `document_state` | `draft` \| `finalized` \| `signed` | |
| `time_state` | `upcoming` \| `active` \| `expired` | Computed for today (Asia/Ho_Chi_Minh); Drafts have none |
| `needs_review` | `true` \| `false` | Computed Needs Review |
| `effective_from_from`, `effective_from_to` | date | Range on Effective From |
| `include_disposed` | `true` \| `false` (default false) | Include discarded/cancelled and voided records. Contracts of a cancelled/voided **period** are always listed (they are what Needs Review points to) |
| `sort` | `operational_end` (default; soonest end first, no end last) \| `effective_from` \| `contract_number` \| `employee_code` | Ties by number, then id |
| `page`, `page_size` | | Standard |

Response: `{ data: ContractSummary[], total, page, page_size, as_of }`. These names are also the URL parameters of the Contracts page (`/contracts?needs_review=true`, `?document_state=draft|finalized|signed`, `?time_state=upcoming|active|expired`, …), so Home cards deep-link with the same filter model. Added in 2A-4: `expiring_within` (`30` \| `60` \| `90`; own Effective To from today through today + N, inclusive) and `awaiting_signature=true`. Not built (deferred until needed): `department_id`, `employee_type_id`, `employee_id`, `employment_id`, `contract_number` exact match, `relationship`. No export (D-UI-5). Scale note: computed states are evaluated in memory over the register (EmeSoft size); stored-field filters move to SQL if it ever grows to thousands of rows.

## 6. `GET /employees/{id}/contracts` — Employee Contracts tab (implemented in 2A-3)

Server-side grouping so the tab does not infer lifecycle rules:

```json
{
  "as_of": "2026-10-16",
  "current":  [ "ContractSummary (operational, Finalized/Signed, time_state active)" ],
  "upcoming": [ "ContractSummary (operational, Finalized/Signed, upcoming)" ],
  "drafts":   [ "ContractSummary (operational Drafts)" ],
  "history":  [ "ContractSummary (operational, expired)" ],
  "not_operational": [ "ContractSummary (discarded/cancelled, voided, or on a Cancelled/Voided period)" ],
  "create": {
    "allowed": true,
    "reasons": [],
    "periods": [ { "id": "uuid", "start_date": "2020-03-02", "end_date": null, "employee_type": "Employee", "is_default": true } ]
  }
}
```
`current` may hold more than one contract (overlap is a warning, M-17). `create.periods` = the person's periods that are not Cancelled/Voided (Ended included, C-109); `is_default` marks the representative period (C-76). `create.reasons`: `PERMISSION_REQUIRED`, `NO_VALID_EMPLOYMENT_PERIOD`. The tab shows Current · Upcoming & drafts · Contract history (with `not_operational` as muted evidence).

## 7. `GET /contract-reminders` — Home Contract Attention (implemented in 2A-4)

`contracts.read`; no query parameters (400); window fixed at 30 days (M-20). Response `{ as_of, window_days: 30, expiring_soon, awaiting_signature, needs_review }`, each `{ total, items[≤5] }`; item = `{ id, contract_number, employee, contract_type, effective_from, effective_to, document_state, days_to_end, review_reason }`. Totals equal `GET /contracts` with `expiring_within=30`, `awaiting_signature=true`, `needs_review=true` (same predicates). Expiring soon = own Effective To from today through today + 30, **both inclusive**, Finalized/Signed operational contracts only. Details and semantics: `docs/design/phase2a-slice-2a-4-attention.md`.

## 8. `GET /contracts/{id}/history` (2A-2)

```json
{
  "data": [
    {
      "event_type": "returned_to_draft",
      "effective_date": null,
      "recorded_at": "2026-10-15T10:02:11+07:00",
      "recorded_by": { "user_id": "uuid", "display_name": "HR Editor (test)" },
      "reason": "Wrong end date before signing",
      "related_contract": null
    }
  ]
}
```
Ordered by `recorded_at`. `reason` present for `returned_to_draft`, `discarded`, `cancelled`, `corrected`, `voided`; otherwise `null`. `effective_date` for events with a business date (`signed_confirmed` → `signed_at`, `cancelled` → planned `effective_from`). No technical audit fields.

## 9. Errors

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `FIELD_NOT_ALLOWED`, `IDEMPOTENCY_KEY_REQUIRED` |
| 401 / 403 | `UNAUTHENTICATED` / `FORBIDDEN` (audited, no payload) |
| 404 | `NOT_FOUND` (contract, employment, contract type) |
| 409 | `FINALIZE_CONFIRMATION_REQUIRED` (details = current warnings; M-19), `REVISION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `DUPLICATE_CONTRACT_NUMBER`, `CONTRACT_NOT_DRAFT`, `CONTRACT_STATE_CONFLICT` (e.g. already Finalized/Signed), `CONTRACT_READ_ONLY` (Cancelled/Voided), `DEPENDENT_CONTRACTS_EXIST`, `RENEWAL_EXISTS` (2A-5) |
| 422 | `CONTRACT_NOT_READY` (details = blockers), `INVALID_TERM`, `CONTRACT_TYPE_INACTIVE`, `EFFECTIVE_FROM_OUTSIDE_PERIOD`, `PERIOD_NOT_VALID`, `SIGNED_AT_IN_FUTURE`, `REASON_REQUIRED`, `NOT_UPCOMING` (2A-5) |

## 10. Open points

Resolved at the 2A-1 checkpoint (C-110): Organization gains a **Contract Types** tab (catalog permissions); a number stays occupied by every record that currently holds it — including discarded Drafts and Voided records — while a Draft may still change or clear its own number.

Later checkpoints:

- Resolved by C-115: Cancel planned / Void of a contract with a non-disposed renewal child is blocked (`DEPENDENT_CONTRACTS_EXIST`); renewal eligibility (PV-39). Resolved by M-20: reminder window (PV-36).
- Amendment operations and representation: separate checkpoint (PL-12, PV-38).
