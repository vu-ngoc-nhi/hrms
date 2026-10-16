# Eme People — Phase 2 Contract Product & Architecture Decision Pack

- Status: **Revision 4 (2026-10-15) — approved; staged implementation authorized (C-109).** Phase 2A is implemented slice by slice (2A-0 … 2A-6) with an **owner checkpoint between slices**; **2A-0 done; 2A-1 Contract foundation implemented (2026-10-15, C-110); 2A-2 core lifecycle API implemented (2026-10-16, M-19, C-111)** — no contract screen yet. Owner decisions: **C-104 … C-109**, **M-15 … M-18** in `docs/decision-register.md`. Frozen contract design: `docs/adr/0005-contract-domain.md`; API draft: `docs/api/contracts-api-draft.md`. Amendment workflow and Phase 2B are **not** authorized.
- Baseline: **Eme People — Core HR Phase 1 Product/UI Frozen — Owner Accepted** (C-101, C-103). Release status unchanged: *UAT Passed With Pre-Production Actions*, **not Production Ready**; Gate A is in external execution.
- Governing principles: C-84, C-85, C-13 (Employee Type ≠ Contract Type), C-16, C-17, C-19 (9), PL-10.
- Data: synthetic only (C-03). No real employee or contract data, template or signed file.

### Revision history

| Rev. | Date | Change |
|---|---|---|
| 1 | 2026-10-15 | First decision pack. |
| 2 | 2026-10-15 | Owner review: `signed_at` definition; four permission semantics; amendment term change = Legal input; Finalized definition; overlap/gap = warning/review; explicit 2A/2B split; three-table model with `parent_contract_id` + `relationship_type`. |
| 3 | 2026-10-15 | Owner approval in principle with corrections: **(A1)** Return to Draft is a controlled reversal with an exact MVP rule (§4.3); Signed never returns to Draft. **(A2)** No speculative `amended_end_date`; a confirmed need is added later by forward-only additive migration. **(A3)** 2B compatibility = *additive, no redesign or invalidation of the 2A aggregate*, not "zero changes". Owner decisions recorded (§22). Date boundary clarified (§3.1). Consequential simplifications: `contract_type.term_kind` removed (type-specific term rules are not approved — PV-31/PL-12); `effective_to` + explicit `is_open_ended` replace a nullable end date (C-106 / M-16). |
| 4 | 2026-10-15 | **Final implementation authorization (staged, C-109)**: PV-42 Contract Number uniqueness (M-18); Return to Draft uses `contracts.finalize`; past-dated registration/finalization with `contracts.finalize`; `signed_at` never a future business date (Asia/Ho_Chi_Minh); Return to Draft no longer coupled to Employment Status — only to the period's validity (not Cancelled/Voided); **Amendment workflow gated** (PL-12/PV-38); slices 2A-0 … 2A-6. Employee Type / Contract Type mismatch warning removed from 2A (no compatibility rule exists — PV-31). |

Design principle reaffirmed by A2: **prepare the architecture for extension, not the database for hypothetical fields.**

### Classification

| Label | Meaning |
|---|---|
| **DECIDED** | Recorded owner decision (C-/M- id given). |
| **APPROVED RECOMMENDATION** | Within the approved-in-principle architecture; no open business question. |
| **BUSINESS DECISION REQUIRED** | Still Pending Validation. |
| **LEGAL INPUT REQUIRED** | Pending Legal Review; never resolved by engineering. |
| **TECHNICAL DECISION** | Implementation choice without business meaning. |

---

## 0. Executive summary

1. A **Contract** is a document record attached to exactly one **Employment Period**. It never changes Employment Status, Employee Type, period dates, Assignment or Probation. Expiry creates an HR review/action item, never an automatic End Employment. (C-104)
2. **Phase 2A model:** `contract_type`, `contract`, `contract_history_event`; renewal/amendment through `parent_contract_id` + `relationship_type`. No Contract Version subsystem, no speculative fields. (C-104)
3. **Lifecycle:** document state Draft → Finalized → Signed (markers `finalized_at`, `signed_at`); computed time state Upcoming / Active / Expired; terminal dispositions Cancelled / Voided. Finalized = content locked from normal editing. Signed = HR confirms full execution. (C-104, C-105)
4. **Return to Draft** only for Finalized-unsigned contracts, as a controlled reversal (reason, history event, permission, safety conditions). Signed never returns to Draft. (C-104, C-107)
5. **Overlap/gap:** detect → warn → Needs Review. Only structural integrity blocks. (M-17)
6. **Permissions:** `contracts.read`, `contracts.manage`, `contracts.finalize`, `contracts.correct`; HR Editor may hold `contracts.finalize`. (C-106)
7. **Phase 2A = Contract Management; Phase 2B = Contract Generation**, additive to 2A. Real signed-document storage is separately gated. (C-104)
8. Material objections remain: Legal Pack 01 said contracts are not collected (PL-11); real generation needs data the system rejects (PL-03).

---

## 1. HR user journey

```
Login → Home (Contracts: Expiring soon · Drafts · Awaiting signature · Needs review)
      → Employees → Employee Detail → [Contracts] tab
      → Contracts (portfolio module, canonical filters)
```

| # | Journey | Where | Phase |
|---|---|---|---|
| J1 | Current contract, upcoming/draft contracts, contract history | Employee Detail → Contracts | 2A |
| J2 | Create a Contract Draft for an existing employee | Employee Detail → Contracts | 2A |
| J3 | Optional Contract Draft during Add Employee | Add Employee wizard | 2A (last slice) |
| J4 | Review before Finalize: on-screen summary, validation, warnings | Contract detail | 2A |
| J5 | Finalize → Confirm signed | Contract detail | 2A |
| J6 | Preview, generate Word/PDF | Contract detail | **2B** |
| J7 | Portfolio tracking with filters; Home click-through | Contracts module | 2A |
| J8 | Act on expiry: Renew / New contract / Relationship Change / End Employment / no action | Home → list → Employee Detail | 2A |
| J9 | Renew (successor draft prefilled, linked) | Contract detail | 2A |
| J10 | Amend (amendment draft linked to the agreement) | Contract detail | **Gated** (separate checkpoint, PL-12/PV-38) |
| J11 | Recover: Edit / Discard / Return to Draft / Correct / Cancel / Void | Contract detail | 2A |

Relationship Change and End Employment stay the existing Phase 1 workflows; the Contracts screen only links to them. **APPROVED RECOMMENDATION.**

---

## 2. Contract domain model (C-104)

### 2.1 Boundary

| Concept | Is | Owns | Never owns |
|---|---|---|---|
| **Person** | The human | Employee Code, name, personal fields | Anything contractual |
| **Employment Period** | The working relationship — **source of truth** for lifecycle | Start/end dates, Employee Type, Work Email, End Reason, lifecycle events, Employment Status (computed) | Contract terms or dates |
| **Assignment** | Organisational placement | Department, Job Title, Level, Manager | Contract terms |
| **Contract** | A written agreement or amendment documenting terms of **one** Employment Period | Contract Type, number, effective dates, `signed_at`, document lifecycle, renewal/amendment link | Employment Status, Employee Type, period dates, Assignment, Probation |

- `contract.employment_id` is mandatory. A Person without an operational period gets no contract (use *Add Initial Employment Period* / *Rehire* first). A planned (Pre-start) period is valid.
- Operational end of an agreement = `least(effective_to, period end, renewal successor effective_from − 1)`; open-ended → period end or successor.
- Contract Type never implies Employee Type; mismatch = warning (PV-31).
- A probation-type agreement never creates, ends or evaluates Probation (C-17, PV-16).
- Intern → Employee is a Relationship Change; the new period gets new contracts, never a cross-period "renewal".

### 2.2 Entities

| Entity | Phase | Verdict |
|---|---|---|
| `contract_type` | 2A | Catalog (code, name, `name_vi`, active). No behaviour flags until type-specific rules are approved (PV-31/PL-12). |
| `contract` | 2A | Aggregate: agreements and amendments. |
| `contract_history_event` | 2A | HR business history (pattern of `employment_event`); separate from technical `audit_event`. |
| Contract Version | — | **Rejected**: drafts need no versions, finalized content is locked, agreed changes are amendments, 2B reproducibility comes from document snapshots. |
| `contract_template_version` | 2B | Immutable template versions. |
| `contract_document` | 2B | Generation traceability record. |

### 2.3 Renewal / amendment link

`parent_contract_id` (nullable self-FK) + `relationship_type` (`renewal` \| `amendment`); CHECK both null or both set. Record kind is derived: no parent → original agreement; `renewal` → agreement; `amendment` → amendment. Chosen over two FKs + `kind` (three columns for one fact) and over a link table (multi-parent consolidations EmeSoft has not needed).

Structural integrity (TECHNICAL DECISION, database-enforced):
- parent in the **same Employment Period** (composite FK `(parent_contract_id, employment_id) → contract(id, employment_id)`);
- parent is an **agreement** (amendments are flat under their agreement);
- **at most one operational `renewal` child** per parent (partial unique index); any number of amendments;
- no cycles.

### 2.4 Conceptual attributes (not a schema)

`contract` — id · employment_id · parent_contract_id · relationship_type · contract_type_id (agreements; amendments inherit) · contract_number · effective_from · effective_to · is_open_ended · summary (bounded note; amendment description) · finalized_at · finalized_by · signed_at (DATE) · cancelled_at · voided_at · revision · created_at · created_by.

Finalize consistency (agreements): exactly one of `effective_to` (≥ `effective_from`) or `is_open_ended = true`. Amendments carry `effective_from` only; they end with their agreement.

`contract_history_event` — id · contract_id · event_type · effective_date (where applicable) · recorded_at · recorded_by · reason · metadata (related contract id).

Who recorded the signature confirmation and when lives in the `signed_confirmed` history event and the audit trail, not in extra columns (C-105).

Not on the contract in 2A: salary, department, job title, workplace, hours, ID number, address (M-16).

### 2.5 Phase 2B compatibility (A3)

**Phase 2B must be additive and must not require redesigning or invalidating the Phase 2A Contract aggregate.** Additive schema changes (new tables, new nullable columns, new history event types) remain allowed when an approved business requirement supports them. Enablers already in 2A: `contract.revision` identifies the exact content a document is generated from; generation needs Finalized/Signed (locked) content; history events are typed and extensible.

---

## 3. Relationship with Employment Period

### 3.1 Date boundary (structural rule)

The structural rule concerns **Contract Effective From** only:

> At Finalize, `contract.effective_from` must fall inside the linked operational Employment Period (`period.start_date ≤ effective_from` and, when the period has an end date, `effective_from ≤ period.end_date`).

It does **not** concern Created At, Finalized At or Signed At. **A contract may be created, finalized or signed before the linked Employment Period starts** — the normal new-hire case. (C-104)

"Operational period" in this pack is the Phase 1 **disposition** predicate only — the period is **not Cancelled and not Voided**. **Employment Status (Pre-start / Active / Ended) never gates a contract action**: a contract may be registered, finalized, returned to Draft or confirmed signed on an Ended period (C-109).

### 3.2 Interactions

| Situation | Behaviour | Class |
|---|---|---|
| Contract expires, employment continues | Time state Expired; review item if no finalized renewal; employment unchanged | DECIDED (C-104) |
| Employment ends before contract end | End Employment not blocked; operational end = period end (*Closed by employment end*); no event synthesized | DECIDED (C-104) |
| `effective_from` outside its period | Blocked at Finalize (structural) | DECIDED (C-104) |
| `effective_to` after period (planned) end | Warning → Needs Review | DECIDED (M-17) |
| Period correction / Cancel Planned Period / Void Period affecting a contract | Phase 1 workflows not blocked; affected contracts leave operations via the shared query and show Needs Review; nothing cascades | DECIDED (C-107) |
| Relationship Change / Rehire | New period → new contracts | APPROVED RECOMMENDATION |
| Employee Type correction | No effect; mismatch warning | APPROVED RECOMMENDATION |

Shared query module: operational contract = `cancelled_at IS NULL AND voided_at IS NULL AND <parent period operational>`, defined once beside `operationalEmploymentWhere` (`src/modules/core-hr/employments/queries.ts` or a sibling) with a contract test. **TECHNICAL DECISION.**

---

## 4. Lifecycle (C-104, C-105, C-107)

### 4.1 Dimensions

| Dimension | Value | Stored / computed | Meaning |
|---|---|---|---|
| A. Document state | **Draft** | `finalized_at IS NULL` | Working record, normal editing |
| | **Finalized** | `finalized_at` set | **Contract record content locked from normal editing.** Not Signed, not Active, not Employment started |
| | **Signed** | `signed_at` set (requires Finalized) | **`signed_at` = the business date on which HR confirms the Contract has been fully executed by all required parties.** No individual signers. Not Active by itself |
| B. Time state (Finalized/Signed, operational) | **Upcoming / Active / Expired** | Computed, Asia/Ho_Chi_Minh, date-based | From `effective_from` and the operational end; sub-labels *Closed by employment end*, *Replaced by renewal*. Drafts have none; amendments Upcoming / Effective |
| C. Disposition | **Cancelled / Voided** | Markers, mutually exclusive, terminal | Evidence kept; excluded from operations |

`signed_at` rules (C-105, C-109): Finalized first; **never a future business date in Asia/Ho_Chi_Minh** (`signed_at ≤ today`); created/recorded at remain system timestamps; may precede `finalized_at`, `effective_from` and the period start. Time state does not depend on `signed_at`.

### 4.2 Transitions

| From | Action | To | Permission | Reason / history |
|---|---|---|---|---|
| — | Create Draft (incl. renewal draft; amendment gated) | Draft | manage | `created` |
| Draft | Edit | Draft | manage | audited field names |
| Draft | Discard | Cancelled | manage | optional reason; `discarded` |
| Draft | **Finalize** | Finalized | finalize | `finalized` |
| Finalized, unsigned | **Return to Draft** (controlled, §4.3) | Draft | finalize | **mandatory**; `returned_to_draft` |
| Finalized, unsigned | **Confirm signed** | Signed | finalize | `signed_confirmed` (recorded by/at) |
| Finalized/Signed, Upcoming | **Cancel planned contract** | Cancelled | finalize | **mandatory**; `cancelled` |
| Finalized/Signed | **Void** | Voided | **correct** | **mandatory**; `voided` |
| Signed | **Correct** recorded data (incl. wrong `signed_at`) | Signed | **correct** | **mandatory**; `corrected` (field names) |
| Signed | Return to Draft | — | — | **Not allowed** — use Correction, Amendment or Void |
| Cancelled / Voided | anything | — | — | Terminal |

Not provided: Unvoid, Un-cancel, Un-sign, hard delete, "Terminate contract". Past `effective_from` / `signed_at` at registration or Finalize needs only `contracts.finalize` — never `contracts.correct` merely because HR entered an existing contract after its business dates; history preserves when the record was actually entered (`recorded_at`). **DECIDED (C-109).**

### 4.3 Return to Draft — exact MVP rule (C-104, C-107, C-109)

A **controlled reversal**, not an ordinary Finalize action. Allowed only when **all** hold:

1. the contract is Finalized and **not Signed** (`signed_at IS NULL`);
2. the contract is neither Cancelled nor Voided;
3. the linked Employment Period still validly exists — it is **not Cancelled and not Voided** (a disposition that would orphan the contract). **An Ended period does not block**; Employment Status is irrelevant;
4. **no downstream contract relationship makes it unsafe**: no renewal child that is not Cancelled/Voided (code `DEPENDENT_CONTRACTS_EXIST`; HR discards/cancels the child first; nothing cascades). Phase 2B may add artifact-based restrictions once generated documents exist;
5. the actor holds **`contracts.finalize`** (not `contracts.correct`);
6. a **reason** is supplied (stored in the history event and audit);
7. `expected_revision` matches and an `Idempotency-Key` is supplied.

Effect, in one transaction: `finalized_at` / `finalized_by` cleared; `contract_number` and all content kept; `revision` + 1; history event `returned_to_draft` (reason, recorded by/at); audit. The contract then has no time state, leaves *Expiring soon* and appears under *Drafts*. No time limit. Signed contracts never return to Draft (use Correction, Amendment when approved, or Void).

### 4.4 Finalize checks

**Block (structural):** Contract Type active and set; Contract Number present and unique (M-18); `effective_from` set and inside the period (§3.1); exactly one of `effective_to ≥ effective_from` or `is_open_ended`; valid renewal parent (same period, agreement, Finalized/Signed, one operational renewal); period not Cancelled/Voided.

**Warn → Needs Review (M-17):** unlinked overlap with another operational agreement of the same person; gap after a renewal's predecessor; `effective_to` after the period's end; another open draft for the period. Finalize proceeds after one explicit confirmation (M-19). (No Employee Type / Contract Type mismatch warning in 2A: no compatibility rule exists until PV-31.)

---

## 5. Renewal

*Renew A* creates agreement B (prefilled) with `parent_contract_id = A`, `relationship_type = renewal`; A is never modified. **DECIDED (C-104)** for the model.

| Question | Position | Class |
|---|---|---|
| When can a renewal be created? | A Finalized/Signed, operational; Upcoming, Active, or Expired while the period is operational | BUSINESS DECISION REQUIRED (PV-39) |
| Future-dated renewal | Allowed | APPROVED RECOMMENDATION |
| Same Employment Period | Structural | DECIDED (C-104) |
| One operational renewal per contract | Structural | DECIDED (C-104) |
| Different Contract Type | Allowed, labelled *Follow-on contract* | BUSINESS DECISION REQUIRED (PV-39) |
| Overlap with predecessor | Intended; A's operational end = `B.effective_from − 1`; A's own dates kept | DECIDED (M-17) |
| Gap / unlinked overlap | Warning → Needs Review | DECIDED (M-17) |
| Cancel planned renewal | Cancel B (reason); A returns to *Expiring soon* automatically | APPROVED RECOMMENDATION |
| Reminders | A leaves *Expiring soon* only with a **finalized** operational renewal; a draft renewal shows *Renewal in draft* | APPROVED RECOMMENDATION |
| Renewal-count limits / conversion to open-ended | Not enforced | LEGAL INPUT REQUIRED (PL-12) |

---

## 6. Amendment

| Action | Meaning | Effect | Permission |
|---|---|---|---|
| Edit Draft | Prepare content | Update draft | manage |
| Return to Draft | Fix Finalized-unsigned content (§4.3) | Controlled reversal | finalize |
| Correction | Record mis-transcribes an executed document | In place, reason, old/new audit | correct |
| **Amendment** | Parties agreed to change terms from a date | New `contract` row, `relationship_type = amendment`; **original record preserved** | manage → finalize |
| Renewal | New agreement continuing/replacing the current one | New agreement row | manage → finalize |
| Cancel | Finalized, not started, will not take effect | `cancelled_at` | finalize |
| Void | Never existed | `voided_at`, terminal | correct |

- An amendment never creates or changes an Employment Period, Assignment or Employee Type. **DECIDED (C-104, C-107).**
- **Amendment workflow is gated (C-109).** Phase 2A keeps the architecture extensible (`parent_contract_id`, `relationship_type`) but implements **no** amendment action, and the 2A schema admits only `relationship_type = renewal`; `amendment` is added by forward migration when the amendment checkpoint approves its semantics. Agreement field requirements are **not** forced onto amendment records; amendment-specific required fields are part of that checkpoint (PV-38, PL-12).
- **Whether an amendment may change the contract term or type — LEGAL INPUT REQUIRED (PL-12).** No field is reserved for it (A2). If Legal confirms the need, a forward-only additive migration adds the structure and the operational-end rule. Until then the system does not interpret term changes in amendments; an agreed new term that must drive reminders is recorded as a renewal. Whether amendments need more structured content: **BUSINESS DECISION REQUIRED (PV-38)**.

---

## 7. Correction / Cancel / Void (C-107)

| Scenario | Recovery |
|---|---|
| Wrong data in a Draft | Edit (`manage`) |
| Draft not needed | Discard (Cancelled, kept, hidden by default) |
| Wrong content, Finalized, unsigned | Return to Draft (§4.3) → edit → Finalize |
| Signed record has a transcription error / wrong `signed_at` | Correction (`correct`, reason, audit) |
| Agreed change to a signed contract | Amendment (original preserved) or Renewal |
| Executed paper itself wrong, parties re-sign | Amendment or new agreement + Cancel/Void of the wrong record — HR/Legal judgement (PL-12) |
| Contract never existed / wrong employee | Void (`correct`, reason); re-create |
| Planned contract will not start | Cancel planned contract (`finalize`, reason) |
| Mistaken Void | **No Unvoid**; create a new contract |

Void is final. No hard delete of business contract history. Cancel = a plan that will not take effect; Void = a record that should never have existed; both are dispositions, never statuses.

---

## 8. Contract Type strategy

- Catalog `contract_type` (code, EN name, `name_vi`, active) managed with `catalogs.manage` on the Organization page (Contract Types tab, approved C-110); deactivate, never delete; immutable code. **APPROVED RECOMMENDATION.**
- No behaviour flags in 2A (no `term_kind`): fixed-term vs open-ended is captured per contract (`effective_to` or `is_open_ended`, M-16). Type-specific rules are added additively once approved.
- Dev/test seed: synthetic placeholders marked as examples (`EXAMPLE_FIXED_TERM`, `EXAMPLE_OPEN_ENDED`, `EXAMPLE_SERVICE`, `EXAMPLE_INTERNSHIP`). **TECHNICAL DECISION.**
- Real catalog and Employee Type compatibility: **BUSINESS DECISION REQUIRED (PV-31)** + **LEGAL INPUT REQUIRED (PL-12)**.

---

## 9. Contract Number (M-15, M-18)

Optional while Draft; **required before Finalize**; HR-entered; **no automatic numbering** and no format policy in Phase 2A (formatting stays an HR/business policy). **Once assigned, unique case-insensitively across the whole Contract register** after trimming surrounding whitespace (a value that is empty after trimming = no number). Uniqueness covers every record that holds a number — Draft, Finalized, Signed, discarded (Cancelled) and Voided; **voiding never frees a number for reuse**. Changeable after Finalize only through Return to Draft (unsigned) or Correction (signed).

---

## 10. Template / versioning model — Phase 2B

- `contract_template_version`: template_code, version, applicable contract type(s), source asset reference + SHA-256, merge-field schema version, status (`active` \| `retired`), published_at/by. Immutable; retiring never affects generated documents. **APPROVED RECOMMENDATION.**
- Code-controlled **synthetic** templates in 2B; no HR upload, editor or generic document platform. **APPROVED RECOMMENDATION.**
- Closed, versioned merge-field catalogue built from data the system already holds: contract (number, type EN/VI, effective dates or open-ended, `signed_at`), person (full name, Employee Code), period (Employee Type, start date), assignment at `effective_from` (Department, Job Title, Level), company constants. **ID number, address and salary are not introduced for generation (M-16)**; they require PL-03 and a separate approved requirement.
- Real template wording: **LEGAL INPUT REQUIRED (PL-12)**.

## 11. Word / PDF generation — Phase 2B

```
Draft ──Preview (watermarked "DRAFT – NOT VALID", not recorded)
Finalized/Signed ──Generate (recorded) → contract_document → streamed download (not stored)
```

| Decision | Position | Class |
|---|---|---|
| Authority | Contract record authoritative; PDF = reference rendering; DOCX labelled "Editable working copy — not authoritative" | BUSINESS DECISION REQUIRED (at 2B) |
| When | Generate only from Finalized/Signed operational contracts | APPROVED RECOMMENDATION |
| Permissions | Preview `contracts.manage`; Generate `contracts.finalize` | BUSINESS DECISION REQUIRED (at 2B) |
| Traceability | contract_id · contract revision · template_version_id · format · canonical merge-data snapshot + SHA-256 · output SHA-256 · generated_at · generated_by | APPROVED RECOMMENDATION |
| Reproducibility | Content-equivalent from snapshot + immutable template; not byte-identical | TECHNICAL DECISION |
| Snapshot retention | Follows the contract (PL-11); fallback hash only | LEGAL INPUT REQUIRED |
| Return to Draft after generation | 2B may restrict (e.g. block, or mark documents superseded) | BUSINESS DECISION REQUIRED (at 2B) |
| Engine | Spike: DOCX template + converter sidecar vs HTML → headless Chromium | TECHNICAL DECISION (+ IT input if sidecar) |
| Storage | None in 2B | APPROVED RECOMMENDATION |

## 12. Document-storage boundary (separately gated)

Real signed-document storage remains **separately gated by Legal, identity, authorization and infrastructure readiness** (PL-13, PV-11, C-104). Future requirements: private object storage, no public URLs, short-lived principal-bound links; encryption at rest (application-level envelope encryption evaluated) and in transit; `contracts.documents.read` checked server-side per download; download audit; file validation (allow-list, size, magic bytes, no active content); malware quarantine; signed documents as immutable linked versions with SHA-256; append-only versions; retention and legal hold per PL-01/PL-11/PL-13 with deletion only through a privileged audited process; two-phase upload with orphan cleanup and DB ↔ storage reconciliation; inclusion in the restore rehearsal (M-14).

---

## 13. Identity abstraction (APPROVED RECOMMENDATION — reuses Phase 1)

```
external identity (Entra tid + oid, or the local test issuer)
   → app_user (internal principal, app_user.id UUID, enabled flag)
   → app_user_role → permissions (server-side)
   → audit / history actor = app_user.id
```

All contract actor references (`created_by`, `finalized_by`, `contract_history_event.recorded_by`, 2B `generated_by`, `audit_event.actor_user_id`) store `app_user.id` — never e-mail, display name, UPN or Entra OID. Switching to Entra (PV-11) changes no contract table. No employee self-service.

---

## 14. Permissions (C-106)

| Permission | Semantics | Actions |
|---|---|---|
| `contracts.read` | See contract data | Contracts module, Employee Contracts tab, contract history, Home contract cards |
| `contracts.manage` | Prepare working records | Create/edit/discard drafts; renewal drafts (amendment drafts when approved); (2B) preview |
| `contracts.finalize` | Make, reverse or certify the official record | Finalize; Return to Draft (§4.3); Confirm signed; Cancel planned contract; (2B) generate |
| `contracts.correct` | Change official history | Void; correct Signed data |
| `contracts.documents.read` | Future (stored files) | — |

Grants (C-106): HR_ADMIN all four; HR_EDITOR read + manage + finalize; API_DOCS_READER none. HR_ADMIN is **not** required merely to Finalize. Permissions stay semantically separate so role composition can change without domain changes. `employees.read` never implies contract access; access administration grants no contract data; `ADMINISTRATIVE_PERMISSIONS` (C-93 B) unchanged; DB administrators remain a stated residual risk. Whether HR roles may see contract data at all is still **LEGAL INPUT REQUIRED (PL-11)** before real data.

---

## 15. Audit / history (C-108)

| Layer | Audience | Content |
|---|---|---|
| **Contract History** (`contract_history_event`) | HR (`contracts.read`), on the Contracts tab / contract detail | Business action · effective date where applicable · **Recorded By** · **Recorded At** · **reason where relevant** |
| **Technical audit** (`audit_event`, `audit_field_change`) | Not shown raw to HR | Actor principal, action, outcome (incl. denied), request id, field names, reason, old/new for approved fields |

- Event types (2A): `created`, `edited` (optional; audit may suffice), `discarded`, `finalized`, `returned_to_draft`, `signed_confirmed`, `corrected`, `cancelled`, `voided`, `renewal_created` (on the parent, linking the child; `amendment_created` when the amendment checkpoint approves). 2B adds `document_generated`.
- "Reason where relevant" = reasons of Return to Draft, Cancel, Void and Correction, shown on the contract's own history to `contracts.read` holders (a deliberate difference from C-24 for Core HR, approved by C-108). Free text never enters old/new audit values.
- C-24 old/new allow-list (DB CHECK) extended with non-personal fields: `contract.contract_type_id`, `contract.contract_number`, `contract.effective_from`, `contract.effective_to`, `contract.is_open_ended`, `contract.signed_at`, `contract.finalized_at`.
- The Core HR **History tab is unchanged** and is **not** turned into a raw audit viewer; contract events are not merged into Employment History.

## 16. Concurrency / idempotency (TECHNICAL DECISION)

| Risk | Protection |
|---|---|
| Duplicate creation | `Idempotency-Key`, claimed in the business transaction |
| Two drafts for one period | Allowed; warning |
| Double Finalize / Confirm signed / Return to Draft | Idempotency-Key + `expected_revision` + state precondition; replay returns the original result |
| Concurrent edits | `contract.revision` → `REVISION_CONFLICT`; `person.revision` untouched (M-11 unchanged) |
| Renewal race | Partial unique index + row lock on the parent |
| Return to Draft vs child creation race | Lock the parent row in both operations; child creation requires parent Finalized/Signed |
| Overlap race | Warning-only (M-17): Finalize locks the period row and evaluates warnings in-transaction; the computed Needs Review filter catches the rest |
| Duplicate number | Unique index on the normalized number (M-18); 409 `DUPLICATE_CONTRACT_NUMBER` |
| Stale UI | 409 → reload |

## 17. Home (C-108)

Visible only with `contracts.read`; separate read-only endpoint; real contract data only; no charts.

| Card | Rule | HR action | Click-through |
|---|---|---|---|
| Expiring soon | Operational Finalized/Signed agreement, operational end within N days (PV-36; recommended 30), no finalized renewal, period not ending first | Renew, new contract, Relationship Change, End Employment, or nothing | `/contracts?expiring_within=30` |
| Drafts | Operational drafts, oldest first | Finalize or discard | `/contracts?document_status=draft` |
| Awaiting signature | Finalized, `signed_at` null, effective_from ≤ today + N | Confirm signed when fully executed | `/contracts?document_status=finalized` |
| Needs review | Overlap, gap, end after period end, effective from outside period (after a period correction), period Cancelled/Voided | Correct, cancel/void, renew, or confirm intent | `/contracts?needs_review=true` |

No persistent "acknowledged" state in 2A.

## 18. Add Employee integration (C-108)

`Personal → Employment → Assignment → Contract (optional) → Review`. Two independent requests: existing `POST /api/v1/core-hr/employees` (unchanged), then `POST /api/v1/core-hr/contracts` (Draft) with the new `employment_id` and its own Idempotency-Key. A failed draft never rolls back the employee; the result screen offers *Create contract draft* prefilled. The step only creates a Draft and never affects employee validation or operational completeness (M-04). Skipping creates nothing.

---

## 19. Phase split and slices (C-104, C-109)

**Phase 2A — Contract Management**, implemented **slice by slice with an owner checkpoint between slices**:

| Slice | Scope |
|---|---|
| **2A-0** ✅ | Architecture records: decision pack, register, ADR-0005, Phase 2A API draft (no schema, no code) |
| **2A-1** ✅ | Contract foundation (catalog, aggregate schema, permissions, shared query); Organization → Contract Types tab (C-110) |
| **2A-2** ✅ | Core lifecycle: create/edit/discard Draft, Finalize (M-19), Return to Draft, Confirm signed, history — API only (C-111) |
| **2A-3** | Employee Contracts tab + central Contracts module |
| **2A-4** | Contract reminders / Home integration |
| **2A-5** | Renewal, Cancel Planned, Correction, Void (**Amendment remains gated** unless approved) |
| **2A-6** | Optional Contract Draft during Add Employee |

**Phase 2B — Contract Generation:** template/version model · preview · reproducible document snapshot · Word generation · PDF generation. Additive to 2A (§2.5). **Not started.**

**Separately gated:** real signed-document storage (Legal, identity, authorization, infrastructure readiness).

Contracts module filters: Employee (name/code), Contract Type, Document status, Time status, Needs review, Department (representative, C-76), Employee Type (of the contract's period), Effective from/to range, Expiring within 30/60/90, Contract Number, Relationship (original / renewal), *Include cancelled/voided* (off by default). No export (D-UI-5).

Employee Detail Contracts tab: *Current contract* (active agreement) · *Upcoming & drafts* · *Contract history* (expired/replaced; cancelled/voided muted, D-UI-15 analogue). No other frozen Core HR screen is redesigned.

**Phase 2B — Contract Generation:** template/version model · preview · reproducible document snapshot · Word generation · PDF generation. Additive to 2A (§2.5).

**Separately gated:** real signed-document storage (Legal, identity, authorization, infrastructure readiness).

## 20. Deferred scope

Signed-document storage/upload · e-signature · individual signers · approval workflow · employee self-service · AI features · HR-editable templates/workflow builder · automatic numbering · salary/compensation · ID/address fields · notifications · export/reports · bulk renewal · probation coupling (PV-16) · statutory renewal-limit enforcement (PL-12) · structured amendment term changes (PL-12) · legacy contract import · access scope · persistent review acknowledgement.

AI-first (all future): field extraction from uploaded contracts with HR confirmation; expiry/action summaries citing records; natural-language search compiled to canonical filters; anomaly hints beyond rule-based Needs Review. Preconditions: storage (PL-13), AI processing approval (PL-02). The authoritative record stays deterministic and auditable.

## 21. Risks / objections

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Legal Pack 01 states contracts are not collected; contract metadata is new processing | **High** | PL-11 before real data; synthetic only |
| R2 | Real generation needs rejected data (ID, address, salary — PL-03) | **High** | 2B synthetic/partial; no hand-completed DOCX as authority |
| R3 | Paper vs record divergence until storage exists | Medium | `signed_at` confirmation; Correction |
| R4 | DOCX edited outside taken as official | Medium | Working-copy label; record authoritative |
| R5 | PDF converter sidecar vs single deployment (M-01) | Medium | 2B spike first |
| R6 | Phase 2 build while Phase 1 not Production Ready, Gate A external | Medium | Local/synthetic only; must not delay Gate A |
| R7 | Warning-only overlaps let inconsistencies accumulate | Medium | Needs Review card/filter; stricter rule later only by approved forward migration |
| R8 | Amendment term changes unresolved → reminders follow the agreement's dates in the interim | Medium | Renewal for term changes; PL-12; additive migration if confirmed |
| R9 | Number reserved forever once assigned (incl. discarded drafts and voided records) — HR typos can consume numbers | Low | Edit the Draft instead of discarding; Correction for signed records (M-18) |
| R10 | Scope creep toward CLM | Medium | Closed merge fields; code-controlled templates; no approvals |
| R11 | "Probation contract" confused with probation condition | Low | Contract never drives probation |
| R12 | Document snapshots duplicate personal data | Low/Med | PL-11; hash-only fallback |
| R13 | DB administrators can read metadata | Low | Stated residual risk |

---

## 22. Decisions

### 22.1 Owner decisions recorded 2026-10-15

| Item | Decision | Register |
|---|---|---|
| Architecture | Approved in principle: boundary, three-table model, `parent_contract_id` + `relationship_type`, lifecycle dimensions, Finalized definition, date boundary on Effective From, Return to Draft rule, no speculative fields, 2B additive, phase split, storage separately gated | **C-104** (Confirmed) |
| PV-32 Contract Number | Optional while Draft; required before Finalize; no automatic numbering policy until separately approved | **M-15** (MVP) |
| PV-33 Required fields | Linked Employment Period; Contract Type; Effective From; Effective To **or** explicit Open-ended; Contract Number before Finalize. Salary excluded from 2A. No ID/address/salary merely for future generation | **M-16** (MVP) |
| PV-34 Signature | `signed_at` = business date on which HR confirms full execution by all required parties; no individual signers; timestamp and actor of the confirmation in history/audit | **C-105** (Confirmed) |
| PV-35 Overlap / gap | Detect → warn → Needs Review; no hard block unless a separately approved business/legal invariant requires it; structural integrity may block invalid relationships | **M-17** (MVP) |
| PV-37 Permissions | `contracts.read/manage/finalize/correct`; HR Editor may hold `contracts.finalize`; HR_ADMIN not required merely to Finalize; semantics kept separate | **C-106** (Confirmed; role bundles per M-03) |
| PV-40 Correction / Void | Draft normal edit; Finalized-unsigned controlled Return to Draft where safe (reason, history); Signed never returns to Draft; Signed corrections need `contracts.correct`; amendments preserve the original; Void final; no Unvoid; no hard delete | **C-107** (Confirmed) |
| PV-41 Phase 1 UI extension | Contracts sidebar module; Employee Detail Contracts tab; Home contract signals from real data; optional Contract Draft step in Add Employee; no redesign of unrelated frozen screens; contract history shows action, effective date, Recorded By/At, reason where relevant; Core HR History tab not turned into an audit viewer | **C-108** (Confirmed) |

| PV-42 Contract Number uniqueness | Unique case-insensitively across the register once assigned, after trimming surrounding whitespace; voiding does not free a number; no automatic generation; formatting is HR policy | **M-18** (MVP) |
| Final authorization | Staged slices 2A-0 … 2A-6 with owner checkpoints; Return to Draft = `contracts.finalize`; past-dated registration/finalization with `contracts.finalize`; `signed_at` never a future business date; Return to Draft depends on the period's validity (not Cancelled/Voided), never on Employment Status; Amendment workflow gated; Phase 2B not started | **C-109** (Confirmed) |

### 22.2 Remaining business decisions (Pending Validation)

| ID | Question | Recommendation | Needed before |
|---|---|---|---|
| PV-31 | Real Contract Type catalog; Employee Type compatibility | HR/Legal supply; synthetic placeholders meanwhile | Real catalog (not the 2A build) |
| PV-36 | Reminder window | Home 30 days; filters 30/60/90 | 2A-4 |
| PV-38 | Amendment semantics, required fields, structured content | Separate amendment checkpoint after PL-12 | Amendment checkpoint |
| PV-39 | Renewal eligibility (incl. late renewal of an expired contract) and different-type successor ("Follow-on contract") | As §5 | 2A-5 |
| 2B | Document authority (PDF/DOCX), Generate permission, Return to Draft after generation | §11 | Phase 2B |

### 22.3 Remaining Legal decisions (Pending Legal Review)

| ID | Question | Needed before |
|---|---|---|
| **PL-11** | Contract data processing: lawful basis/notice, retention (incl. 2B snapshots), which HR roles may access contract data — Legal Pack 01 said contracts are not collected | Any real contract data |
| **PL-12** | Contract type classification; mandatory content; whether an amendment/appendix may change the term or type; renewal-count limits and conversion to open-ended; statutory notice before expiry; legitimacy of parallel agreements; re-execution scenarios; official template wording | Real catalog/templates; any structured amendment term change |
| **PL-13** | Signed-document storage, e-signature validity, retention, legal hold | Any document-storage phase |
| PL-10 | Withdrawing/cancelling a signed agreement | Real use of Cancel/Void on signed contracts |
| PL-03 | Sensitive data groups (ID, address, salary) | Real document generation |

---

## 23. Implementation sequence (C-109)

| Slice | Work | Gate |
|---|---|---|
| **2A-0** | Commit pack + register; ADR-0005; Phase 2A API draft | Owner checkpoint |
| 2A-1 | Forward migration, local `hrms_dev`/`hrms_test` only: `contract_type`, `contract`, `contract_history_event`; CHECKs (link pair with `relationship_type IN ('renewal')`, dispositions exclusive, term consistency on Finalized rows, `finalized_at` required for `signed_at`), terminal trigger, same-period composite FK, one operational renewal, unique normalized number; audit allow-list extension; insert-only synthetic seed. Permissions in `ROLE_PERMISSIONS` + `access_role_permission` mirror + permission-matrix tests; shared contract query + contract test; Contract Type catalog API | Owner checkpoint |
| 2A-2 | Draft create/read/edit/discard, Finalize (blockers + warning confirmation, M-19), Return to Draft, Confirm signed, history, idempotency, revision; integration tests on `hrms_test` | Owner checkpoint |
| 2A-3 | Employee Contracts tab + Contracts module (list/filter) | Owner checkpoint |
| 2A-4 | Reminder endpoint + Home cards | PV-36; owner checkpoint |
| 2A-5 | Renewal, Cancel Planned, Correction, Void | PV-39; owner checkpoint |
| 2A-6 | Optional Contract Draft step in Add Employee | Owner checkpoint |
| — | Amendment | PL-12, PV-38, separate checkpoint |
| — | Phase 2B | 2B decisions |
| — | Real contract data, real templates, document storage | **PL-11, PL-12, PL-13, PL-03 + Real Data Gate** |

**STOP after each slice** for the owner checkpoint. No real contract data.
