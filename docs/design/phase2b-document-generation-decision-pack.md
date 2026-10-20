# Eme People — Phase 2B Document Generation Decision Pack

- Status: **Revision 9 (2026-10-18) — owner decisions C-123 … C-131 recorded (C-130 = initial appendix number `<contract number>/PL-01`; C-131 = signing-date lines stay blank in generated documents); everything else remains Pending Validation.**
  - Authorized so far: scope analysis and the **isolated synthetic engine spike (2B-1)** on a separate branch only. Not authorized: production code, API/UI integration, migrations, worker linking/self-service/release, production storage or retention, PDF infrastructure, real data, push, merge or deployment.
  - Open items: **PV-45 … PV-51, PV-57** (Pending Validation). PV-44 resolved as C-126; PV-53 resolved as C-128; PV-55 as C-129; PV-54 as C-130 (edge case → PV-57); PV-56 as C-131. PV-52 (later salary appendices) is **deferred** to the Amendment gate.
  - **Phase 2B implementation not started.**
- Baseline: **Eme People — Contract Management Phase 2A — Product/UI Frozen — Owner Accepted** (C-122, HEAD `50e652e`). Phase 2A is not reopened. Not Production Ready; Gate A open.
- Inputs:
  - `docs/design/phase2-contract-decision-pack.md` (§10–14, §20–22);
  - `docs/adr/0002-identity-and-employee-codes.md`, `docs/adr/0005-contract-domain.md` §14;
  - `docs/design/access-control-direction.md` §9;
  - `docs/decision-register.md`, `docs/production/gate-a-readiness-status.md`;
  - `prisma/schema.prisma`, `src/modules/identity/*`;
  - CLAUDE.md (C-84, C-85, synthetic data only).

### Revision history

| Rev. | Date | Change |
|---|---|---|
| 1 | 2026-10-17 | First proposal: DOCX-first, no stored files (re-render on download), `contracts.finalize` for all document operations, PV-44 … PV-48. |
| 2 | 2026-10-17 | **Owner decisions:** (1) exact historical download (C-123); (2) HR and the contract's own worker may download (C-124); (3) Phase 2B targets real HR use after all gates, development stays synthetic/local (C-125). Storage recommendation replaced by **immutable stored artifact bytes** (PV-48 revised; supersessions in §0.2); access split into four capabilities (§4 H); worker identity prerequisite (PV-50); explicit release (PV-49); real-use gap matrix (§9, PV-51). |
| 9 | 2026-10-18 | **C-130:** initial appendix number = `<contract number>/PL-01`; retry/regeneration never allocates the next number; each generated artifact has its own identity; historical files unchanged. **C-131:** signing-date lines stay blank in the unsigned generated document (no generation or effective date substituted); signing recorded separately via Confirm signed, which never turns the stored unsigned DOCX into a signed document. Contract-number-correction edge case proposed as **PV-57** (§13.4). Spike outcome and next-slice proposal (§14). |
| 8 | 2026-10-18 | **C-129 (PV-55, option A):** the initial allowance appendix takes effect on its parent contract's authoritative `effective_from`; not the generation, signing or employment-period start date; signing date separate; initial appendix only (later appendices stay deferred, PV-52). Draft wording change for HR/Legal review added (§13.5); not approved (PL-12). Earlier artifacts are not rewritten. |
| 7 | 2026-10-18 | **C-128 — initial package approved:** one DOCX (contract + initial allowance appendix); one shared immutable snapshot and generation record; original bytes kept for exact download; seven fixed allowance rows for this template version (not a universal catalog); missing input ≠ "Not applicable" (HR supplies a value, approved policy text or "Not applicable"); contract-linked appendix number format (e.g. HĐ-001/PL-01). New pending: PV-54 numbering rules (proposed §13.4), PV-55 initial appendix effective date, PV-56 signing-date fields. |
| 6 | 2026-10-18 | **C-127:** the allowance appendix supplied with HR's sample is signed together with the initial contract and belongs to the initial package; packaging recommendation (PV-53); later salary-change appendices recorded as a deferred requirement for the Amendment gate (PV-52); §13 added. HR sample review: `spikes/2b-docx-engine/hr-sample/REPORT.md` on branch `spike/2b-docx-engine`. |
| 5 | 2026-10-18 | **Q1 approved (C-126):** 1a DOCX-first, PDF deferred; 1b local synthetic engine spike on a separate branch/worktree with candidate libraries installed only there; 1c library recommendation and evidence return for owner approval — no production library chosen. Q2/Q3 unchanged. |
| 4 | 2026-10-17 | Owner review of the questions: artifact preservation separated from worker visibility (no automatic withdrawal assumed; latest-only vs all-released compared); employment end separated from authentication (former-worker access left to owner/Legal, HR-assisted retrieval as an option); PostgreSQL storage justified with sizes, volumes, limit, backup/restore and integrity; immutable content vs lifecycle metadata vs future disposal; persona × action permission matrix; annual review downgraded to a proposal; gate switches described as technical controls only; §11 rewritten with every subdecision visible. |
| 3 | 2026-10-17 | Complete owner instruction applied: what the three decisions do **not** approve (§0.1); recommended answers for every open release question (§4 J); employer-literal review and maintenance process and gate enforcement before real use (§9); added failure and acceptance cases; open items reduced to **three owner questions** (§11). |

### Labels

| Label | Meaning |
|---|---|
| **DECIDED** | Owner decision with a C-/M- id. |
| **APPROVED RECOMMENDATION** | Accepted in principle with the Phase 2 architecture (C-104); kept unless superseded below. |
| **RECOMMENDED** | This pack's proposal; binding only when the named PV item is approved. |
| **LEGAL / IT INPUT** | Existing Pending Legal Review / IT item; never resolved by engineering. |

---

## 0. Decisions in force and what they change

### 0.1 Owner decisions recorded 2026-10-17 (DECIDED)

| ID | Decision | What it does **not** decide |
|---|---|---|
| **C-123** | A user must be able to download the **exact previously generated file** (the same bytes), not a newly rendered equivalent | The storage technology, retention duration and disposition rules (PV-48, PL-01, PL-11) |
| **C-124** | Generated documents may be downloaded by **authorized HR** and by **the authenticated worker who belongs to that contract**; never by another worker. Not by role name or matching email, name or Employee Code | How a worker account is linked to a person (PV-50); when a document becomes visible to the worker (PV-49); which versions a worker may see (PV-49) |
| **C-125** | Phase 2B prepares documents for **real HR use once all applicable production, IT and Legal gates pass**; development stays synthetic and local | Any gate outcome, template wording or legal content (PL-*, A1–A8) |

**Not approved by these three decisions:**
- DOCX-first versus DOCX + PDF. DOCX-first remains the *recommendation*.
- Any rendering library.
- Dependency installation.
- Production storage or infrastructure.
- Employee self-service implementation, the account link, or a new role or permission.
- The release policy.
- Any Phase 2B implementation slice.

These stay with the questions in §11.

### 0.2 Earlier positions superseded or narrowed (by C-123 and C-124; the storage design itself is PV-48)

| Earlier position | Where | Status now |
|---|---|---|
| "Storage — None in 2B" (APPROVED RECOMMENDATION) | Phase 2 pack §11 | **Superseded by C-123** (a stored artifact is required). The storage design is the PV-48 recommendation below |
| "Generate (recorded) → contract_document → streamed download (not stored)" | Phase 2 pack §11 diagram | **Superseded by C-123**: download returns stored bytes |
| "Reproducibility: content-equivalent, not byte-identical" | Phase 2 pack §11 | **Narrowed**: still true for *re-rendering*; exact downloads come from storage, never from re-rendering |
| Rev. 1 PV-48 / F2: re-render on download and compare the hash | this pack rev. 1 | **Withdrawn** (contradicts C-123) |
| Rev. 1 PV-45 / H1: `contracts.finalize` for preview, generate *and* download | this pack rev. 1 | **Replaced** by the four-capability split (§4 H) |
| "No employee self-service" | Phase 2 pack §13, §20 | **Narrowed by C-124**: a worker may download their own released documents. Nothing else becomes self-service |
| `contracts.documents.read` — "Future (stored files)" | Phase 2 pack §14 | Still reserved for **signed-document** storage (PL-13); not reused for generated artifacts (§4 H) |
| "Scope (self/team/department/all) — extension point only" | access-control direction §9 | C-124 introduces the first **self** scope, for released documents only, through the existing single authorization path. No scope framework |
| Signed-document storage separately gated (PL-13) | Phase 2 pack §12 | **Unchanged.** Generated, unsigned artifacts are not signed documents; they are still personal data (PL-11, PL-01, PL-02) |

### 0.3 Constraints carried forward

| Source | Constraint |
|---|---|
| C-104, ADR-0005 §14 | 2B is additive; the 2A aggregate is not redesigned |
| C-104, C-105 | Generated ≠ Finalized ≠ Signed; generation changes no 2A or Core HR state |
| M-16, PL-03 | No ID, address or salary on the contract merely for templates |
| Phase 2 pack §10 (APPROVED RECOMMENDATION) | Immutable template versions with SHA-256; code-controlled templates; closed placeholder catalogue |
| Phase 2 pack §11 (APPROVED RECOMMENDATION) | Generate from operational Finalized/Signed contracts; Draft preview watermarked and not recorded |
| ADR-0002 | Accounts never create or merge profiles; no matching by name or email |
| C-85, C-93, C-94 | Permissions, not role names; disabled accounts get nothing (enforced in `authenticate.ts`); access changes only through the guarded access-administration routines with reason and security audit |
| M-01 | Single deployment |

---

## 1. Recommended MVP and exclusions

**RECOMMENDED MVP:**

1. **DOCX first** (PV-44). PDF comes in a later gated slice, converted from the stored DOCX.
2. **Templates as controlled files**, registered as immutable versions, compatible by Contract Type code and term kind, plain tags only (PV-46).
3. **Placeholder catalogue v1** with as-of rules. A missing required value blocks; nothing is fabricated (PV-47).
4. **Data review / preview** bound by an input fingerprint. A Draft preview is watermarked and not recorded (PV-45).
5. **Generate:** render, hash and store the **artifact bytes immutably** together with the record, snapshot, template version and generator version, in one transaction (PV-48, C-123).
6. **HR download of the stored bytes** with integrity verification. Re-rendering never stands in for a stored file.
7. **Explicit HR release** of a specific artifact to the worker, and explicit, audited withdrawal (PV-49). Visibility of earlier released versions and former-worker access are open subdecisions (§11 Q3).
8. **Worker download** of their own released artifacts. It requires a trusted account-to-person link created through access administration (PV-50, C-124).

**Excluded:** template upload or designer, template scripting, document-only manual input, e-signature, signed-document upload or storage (PL-13), later appendices or amendments changing terms of an existing contract, e.g. salary changes (deferred: PV-52, PV-38, PL-12), termination documents, bulk generation, e-mail or notifications, OCR and AI clauses, worker access to contract records or history, automatic numbering, any field in the "missing" column of §9 until its gate passes, real data before Gate A8.

---

## 2. Format options

| Criterion | 1. DOCX-first | 2. PDF-first | 3. DOCX + PDF from one template version and snapshot |
|---|---|---|---|
| HR usability | Familiar Word; printable | Read-only; any fix means regenerating | Both |
| Fidelity, Vietnamese text | Opens with HR's own fonts | Needs licensed Vietnamese fonts on the server | PDF converted from DOCX may paginate differently from Word |
| Editing and divergence | Editable copy can diverge; the stored bytes and hash identify the original | Low | DOCX risk remains |
| Reproducibility | Exact download from storage (C-123); re-rendering is content-equivalent only | Same | Same, per artifact |
| Offline and privacy | In-process library | Chromium or converter; a cloud converter would breach PL-02 | Converter sidecar (M-01 exception, IT) |
| Effort and dependencies | Low (template + ZIP library, licences confirmed in the spike) | Medium–high | Highest |
| Template maintenance | One DOCX per version | Second template format if HTML | One DOCX feeds both; PDF checked visually |

**RECOMMENDED: Option 1** for the first slices, with PDF as a gated later slice (PV-44).

**Limitation:** a worker who must receive a non-editable copy would need Option 3 earlier. That is an owner and IT trade-off.

---

## 3. HR and worker journeys

```
HR — Contract Detail ─ Documents (needs the permissions in §4 H)
  Draft            → [Preview] → data review + watermarked DOCX ("DRAFT – NOT VALID"); nothing stored
  Finalized/Signed → [Generate] → choose compatible template → data review (values · sources · as-of · blockers)
                     → [Generate] → artifact stored → [Download]
  Document history: generated at/by · template version · contract revision · Outdated / disposition flags ·
                    release state from events (Not released / Released to worker on … by … / Withdrawn on … by …, reason)
                    → [Download] · [Release to worker] · [Withdraw]
Worker — My documents (only with a trusted account link, PV-50)
  Released artifacts of own contracts only → [Download] (exact stored file)
Print/sign outside the system → Confirm signed (Phase 2A, unchanged)
```

---

## 4. Decision table

Owner = product owner/HR · IT = IT input · Legal = existing PL items.

### A. Contract lifecycle vs document lifecycle (PV-45)

| # | Question | Options | Recommended | HR example | Impact |
|---|---|---|---|---|---|
| A1 | States for preview and generate | (a) Preview Draft/Finalized/Signed; generate operational Finalized/Signed. (b) Generate from Draft. (c) Signed only | **(a)** (pack §11) | HR previews a Draft, then generates after Finalize | Preconditions in API; Documents section per state |
| A2 | Finalize vs snapshot | (a) Snapshot at each Generate. (b) Snapshot at Finalize | **(a)**; Finalize keeps no 2B side effect | Department corrected between Finalize and Generate → the document uses the corrected value and records it | Snapshot on the artifact record |
| A3 | Does generation imply signature or status? | — | **No.** Generated ≠ Finalized ≠ Signed; no state, Home or Needs Review change | Three generations leave the contract in *Awaiting signature* | None to 2A |
| A4 | Correction / Return to Draft / Cancel / Void after generation | (a) Allowed; artifacts flagged *Outdated* or with the disposition. (b) Block Return to Draft once an artifact exists | **(a)** (C-84; recovery must not be blocked by an unsigned file). Release effects in §4 J | A typo after printing → Return to Draft (reason) → fix → regenerate | Computed flags; no new state |

### B. Template lifecycle (PV-46)

| # | Question | Options | Recommended | Impact | Input |
|---|---|---|---|---|---|
| B1 | Draft / publish / retire | (a) Files under review; registration as `active` on release; one-way `retired`. (b) DB draft → published states | **(a)** | `contract_template_version` (code, version, SHA-256, manifest, catalogue version, status, registered/retired at); registration idempotent; a changed hash for an existing version is refused | Owner |
| B2 | Who maintains and publishes | (a) HR/Legal supply wording; engineering adds files under review. (b) HR upload UI | **(a)** for the MVP; upload UI later with file validation | No new permission | Owner; Legal for wording (PL-12) |
| B3 | Contract Type compatibility | (a) Manifest: Contract Type codes + term kind. (b) Any template. (c) One automatic per type | **(a)** | Compatible-template list; inactive types (C-44) still generate for existing contracts | Owner; real mapping after PV-31 |
| B4 | Unsupported constructs | (a) Plain tags only; registration rejects unknown tags, loops, conditions, expressions, macros and embedded objects. (b) A library's full syntax | **(a)**; the engine's parser must never evaluate code (spike) | Validator + tests | Owner |

### C. Data sources and effective dates (PV-47)

| Placeholder | Source | As-of rule | Required? |
|---|---|---|---|
| `contract.number`, `contract.type_name_en`, `contract.type_name_vi`, `contract.effective_from`, `contract.effective_to` | `contract`, `contract_type` | Snapshot's contract revision; catalog names as at generation (no name history) | Per manifest; `effective_to` only in fixed-term templates |
| `person.full_name`, `person.employee_code` | `person` | At generation (no name history) | Required |
| `employment.start_date`, `employment.employee_type_name` | linked period | Period values at generation | Optional |
| `assignment.department_name`, `assignment.job_title_en`, `assignment.job_title_vi`, `assignment.job_level_name` | `job_assignment` → catalogs | Assignment in effect on **`contract.effective_from`**; none → missing, never another assignment | Per manifest |
| `document.generation_date` | system (Asia/Ho_Chi_Minh) | Generation business date, labelled as such; never a signing date | Optional |
| Employer details and signatory | **no source** | Literal text inside the template version (synthetic in development); real values = §9 / PV-51 | — |

- **Excluded from v1:** `contract.signed_at`, date of birth, gender, phone, personal email.
- **Not supported:** legal ID, address, nationality, compensation, workplace, hours, job description, probation terms, bank details.
- **No silent substitution of today's values.**

### D. Missing data (PV-47)

| # | Question | Recommended | HR example |
|---|---|---|---|
| D1 | What blocks generation? | Every placeholder the template version's manifest marks required and that has no value (`MISSING_TEMPLATE_DATA`, with source and fix link) | "Department is missing on 01 Jan 2027 — add or correct the assignment" |
| D2 | Blank values | Optional placeholders render empty; shown as "(blank)" in the review | Job level not set |
| D3 | Document-only manual input | **None in the MVP**; fix the source record. Revisit only for a value with no source after Legal approval (§9). Edits made in Word afterwards are outside the system | Salary line → not possible (PL-03) |

### E. Preview and snapshots (PV-45)

| # | Question | Recommended |
|---|---|---|
| E1 | Is preview ephemeral or saved? | Ephemeral, including the watermarked DOCX; never stored, never released |
| E2 | When is the snapshot captured? | In the Generate transaction. The preview returns an **input fingerprint** (canonical inputs + template version + catalogue version + contract revision) |
| E3 | Data changes after preview | Generate sends the fingerprint; the server recomputes it in-transaction; a mismatch → 409 `DOCUMENT_INPUTS_CHANGED`, nothing stored (M-19 pattern) |
| E4 | Confirmation of review | The one Generate action on the review screen; no checkbox and no reason |

### F. Stored artifacts — exact historical download (C-123 outcome; architecture = PV-48 RECOMMENDED)

**Requirement (DECIDED, C-123):** a download returns the stored original bytes, never a new rendering.
**How to store them:** a recommendation awaiting approval.

**F1. Three kinds of data, three rules**

| Kind | Content | Rule |
|---|---|---|
| **Immutable content** | Artifact bytes; output SHA-256; byte size; format; snapshot (canonical JSON) + SHA-256; template version; catalogue version; generator id + version; contract id + revision; generated at/by; idempotency key | Written once in the Generate transaction. The database refuses UPDATE; the application role cannot DELETE |
| **Authorised lifecycle metadata** | Release and withdrawal (who, when, reason) | **Append-only events** (`contract_history_event` types `document_released`, `document_withdrawn`) plus audit. The current release state is *derived* from them, so lifecycle changes never modify immutable content |
| **Future retention disposal** | Removing bytes and/or the snapshot when a Legal-approved rule says so | Not designed now. Only a privileged, audited routine defined with the PL-01 / PL-11 rule. What a disposal leaves behind (e.g. the hash and a disposal record) is part of that rule. **No retention period and no promise of indefinite availability** |

**F2. Where the bytes live: PostgreSQL vs private object storage**

| Aspect | PostgreSQL table `contract_document_file` (RECOMMENDED for the MVP) | Private object storage (S3-compatible / Azure Blob) |
|---|---|---|
| Consistency | Bytes, record, history and audit are committed in **one transaction**: no orphans, no record without a file, no cleanup job | Two-phase write (upload, then commit, or the reverse) with orphan cleanup and DB ↔ bucket reconciliation |
| Infrastructure | No new system; fits the single deployment (M-01) | A new service to provision, secure, monitor and pay for (IT, PL-02) |
| Access surface | Bytes reachable only through the application after authorization; no keys or URLs exist | Bucket policy, credentials and the temptation of pre-signed URLs must be controlled |
| Backup / restore | Included in the database backup and restore; one restore point covers record and bytes together | Separate backup; restore must keep the bucket and DB consistent at the same point in time |
| Scale and cost | Fine for small volumes; grows backups and restore time | Better for large volumes and scanned signed documents (PL-13); immutability features (object lock) |

**Assumptions (to be measured in the 2B-1 spike):**
- **File size:** a text-only DOCX contract is expected to be roughly 20–100 KB.
- **Volume:** for about 70–100 workers with a few contracts each per year and a few generations per contract, roughly a few hundred to about a thousand artifacts a year. That is well under 100 MB a year, even at the upper size.

**Recommended limits:**
- A maximum artifact size, enforced at generation (proposed 5 MB, configurable). A larger output means the template is wrong (e.g. embedded images) and generation is refused.
- Alerting on total artifact storage.

**Revisit object storage** when signed-document storage (PL-13) arrives, when volume or size grows beyond these assumptions, or when IT prefers it. Migrating stored bytes keeps their hashes, so exact downloads are preserved.

**Backup and restore implications:**
- Database backups grow with the artifacts; IT sizes them (A5, M-14).
- A restore returns record and bytes from the same point in time.
- The restore rehearsal verifies every artifact hash.
- Point-in-time recovery covers artifacts too.
- Encryption at rest follows the database (IT, PL-02).

**F3. Download, integrity and failures**

| # | Rule |
|---|---|
| F3.1 | Download returns the stored bytes after verifying the stored SHA-256; **never invokes the generator**. It works across template retirement and generator upgrades, subject to authorization and any future disposal rule |
| F3.2 | Missing row or hash mismatch → download fails ("This file failed its integrity check; it has not been replaced"), with a technical alert and an audit entry. **No silent re-render.** Recovery: restore from backup, or HR explicitly generates a new artifact (new identity) |
| F3.3 | The integrity scan (`test:integrity-baseline` family) is extended to verify every stored hash; the restore rehearsal runs it |
| F3.4 | Partial failure: render and hash in memory, then one transaction inserts record + bytes + history + audit. Any error stores nothing. A future PDF is its own artifact derived from a stored DOCX; one format's failure never removes another |
| F3.5 | Retry: POST with `Idempotency-Key`, `expected_revision`, `input_fingerprint`; a replay returns the same artifact id; the file is fetched by a separate GET |
| F3.6 | Regeneration always creates a **new artifact identity**; earlier artifacts and bytes are preserved; *Outdated* is computed from the contract revision and disposition |
| F3.7 | Authority: the contract record is authoritative in the system; the executed paper is the legal document (not stored, PL-13); a stored artifact proves what the system generated, not what was signed |
| F3.8 | Footer reference ("Eme People ref. … · template v…"): optional, subject to Legal (PL-12) |

### G. DOCX / PDF behaviour (PV-44)

| # | Recommended | Input |
|---|---|---|
| G1 | PDF, when approved, is **converted from the stored DOCX artifact**, so the content cannot diverge by design. It is stored as its own artifact. Pagination can differ from Word, so PDF is a reference rendering | Owner |
| G2 | MVP engine: in-process DOCX library with a non-evaluating parser and deterministic packaging, chosen by a spike (licence, Vietnamese text, tags split across Word runs, malicious templates). PDF later: LibreOffice headless or Gotenberg as a sidecar; no cloud converter | IT (M-01 exception); dependency approval |
| G3 | An externally edited Word file is the user's own copy; the system does not see or trust it. Changed terms must be reflected in the record (Return to Draft / Correction with a reason) and regenerated | Owner |
| G4 | Fonts with Vietnamese coverage available on HR PCs; simple tables; static signature lines (no images, no e-signature); headers and footers from the template; values NFC-normalized; diacritics tested | Legal for layout (PL-12) |

### H. Access — capabilities and personas (C-124 intent; design = PV-45 / PV-50 RECOMMENDED)

| Action | HR_ADMIN | HR_EDITOR | Hypothetical future read-only role (`contracts.read` only) | API_DOCS_READER | Linked worker (own contract) | Any worker (another person's contract) |
|---|---|---|---|---|---|---|
| View contract records, history, lists | ✓ `contracts.read` | ✓ | ✓ | — | — | — |
| Preview / generate | ✓ `contracts.finalize` | ✓ | — | — | — | — |
| Download any stored artifact | ✓ `contracts.finalize` | ✓ | — | — | — | — |
| Release / withdraw | ✓ `contracts.finalize` | ✓ | — | — | — | — |
| Download own **released** artifacts | (only via own link, like any worker) | (same) | — | — | ✓ `contracts.documents.read_own` + link + release | — (404) |
| See unreleased or internal artifacts | ✓ | ✓ | — | — | — | — |

Roles are listed only to show today's bundles (C-85: checks use permissions, never role names). Workers get no contract records, lists, history or reminders.

**Why HR download requires `contracts.finalize` (RECOMMENDED):**
- *Not `contracts.read`.* `contracts.read` is a viewing capability that a future read-only role (e.g. an auditor or manager view) could hold. A generated file contains the full rendered document: personal data, employer text and terms in a portable, forwardable form. Granting files with "view records" would silently widen that future role.
- *Not a new `contracts.documents.download`.* Today the same HR people generate, check and release documents. A separate capability would not be assigned differently at EmeSoft (C-85). If a role that may download but not generate is ever needed, the split is additive.
- `contracts.documents.read` stays reserved for future **signed**-document storage (PL-13).

**Worker permission:** the new `contracts.documents.read_own` is justified. It is the only capability granted to non-HR accounts, and its boundary (own, explicitly released artifacts) differs from every HR permission. It grants no other endpoint, and HR endpoints never accept it.

**Server-side checks (lookup and file delivery use the same predicate):**
- *HR:* the actor is enabled and holds `contracts.finalize`; the artifact exists. Re-checked on the file request; there is no separate file key.
- *Worker:* the actor is enabled and holds `contracts.documents.read_own`. The actor has an **active trusted link** to person P (PV-50). The artifact's contract → employment → person = P. The artifact's derived release state is **released and not withdrawn**. The approved Q3 visibility rules are also applied.
  - The list endpoint returns only matching rows.
  - The file endpoint re-evaluates the whole predicate by artifact id and returns **404** otherwise.
- *Both:* no public or pre-signed URL; no storage identifier in any response; bytes streamed after authorization; `Content-Disposition: attachment`; `Cache-Control: no-store`; every download (including denials) audited.

### I. Worker identity prerequisite (PV-50)

**Inspection result:** no trusted account-to-person mapping exists.
- `app_user` holds only the Entra tenant + object id.
- ADR-0002 forbids creating or merging profiles from accounts.
- `external_identity` links persons to *other systems* (e.g. the leave tool), not to HRMS login accounts, and is unused in code.
- There is no worker role, no worker UI, and no worker sign-in path beyond Entra (PV-11, still Pending IT Configuration).

**Smallest safe design (RECOMMENDED):**
- An additive **link** `app_user_person_link`: app_user_id unique, person_id unique among active links, linked at/by, reason, unlinked at/by, reason.
- It is created and ended **only through the guarded access-administration routines** (C-93, C-94: reason mandatory, operator from `session_user`, security audit), after out-of-band verification that the Entra account belongs to that person (who verifies: IT + HR, see PV-50).
- **Never derived** from email, name, Employee Code or Entra attributes.
- Unlinking or disabling the account ends worker access immediately.
- An HR user's own account may be linked to their own person; their HR permissions are unaffected.
- **Alternative considered:** reuse `external_identity` with `system = 'entra'`. Rejected: it would bind on an identifier rather than on the authenticated principal, and it bypasses the guarded access path.

**Prerequisites before real worker access:** Entra configuration (PV-11), Entra "assignment required" or an equivalent decision on who may sign in (Gate C item), Gate A3/A4 operations, and Legal on worker access to personal documents (PL-11). In development, test identities can simulate a linked worker.

### J. Release and visibility (PV-49 — pending owner decision)

**Preserving the bytes (C-123) does not decide who may download which version.** Visibility is a separate decision.

**J1. When does a worker see a document?**

| Option | Effect |
|---|---|
| Automatic on generation | Exposes erroneous generations and pre-signature internal versions |
| **Explicit HR release of one specific artifact (RECOMMENDED)** | HR decides; errors stay internal; one action, no approval chain (`contracts.finalize`, recorded as an event) |

**J2. Which released versions stay visible?**

| Option | Effect |
|---|---|
| A. Latest released only | Simple for the worker; but an earlier copy the worker may have signed disappears from their view, and HR's release of a correction silently removes it |
| **B. All previously released versions, clearly labelled (RECOMMENDED)** | The worker keeps every document they were given, each labelled (e.g. "Superseded by the version released on …", "Contract cancelled", "Contract voided — not valid"); HR removes a version only by an explicit, audited **Withdraw** with a reason |

**J3. Events — recommended behaviour, no automatic withdrawal**

| Situation | Recommended behaviour |
|---|---|
| New artifact generated | Not visible until released |
| New artifact released while an older one is released | Both stay visible (option B); the older one is labelled *Superseded*. The release dialog shows the older release and offers Withdraw as a separate explicit action |
| Contract corrected / Return to Draft | Nothing changes for the worker automatically; HR sees *Outdated* and decides whether to release a new version or withdraw |
| Contract cancelled (planned) or voided | **No automatic withdrawal assumed.** The worker sees the label "Contract cancelled" / "Contract voided — not valid"; HR withdraws explicitly if the document must not remain available. Whether Void should withdraw automatically is a visible subdecision (§11 Q3) |
| Withdraw | Removes worker visibility of that artifact only; bytes, release and withdrawal events and download audit preserved |

**J4. Employment end vs authentication (separate questions)**

- **Authentication (DECIDED, C-85):** a disabled or unlinked account cannot sign in or download anything. This follows the account, not Employment Status.
- **Employment end is not an access policy.** Ending employment neither grants nor removes access by itself. Whether a former worker may still obtain their documents is **pending owner and Legal review (PL-11, PL-01)**:

| Option | What it means | Notes |
|---|---|---|
| a. Access while the account stays enabled and linked | Self-service continues until IT disables the account | Depends on IT's leaver process; usually ends quickly |
| b. Self-service ends at employment end (+ optional grace period) | Server-side check against the period end | A rule HR/Legal must define; the grace length is not assumed |
| c. **HR-assisted retrieval** | A former worker asks HR; HR downloads the stored original (`contracts.finalize`, audited, optional reason) and hands it over through an approved channel | Works with no self-service account; channel and identity check are HR/Legal process |
| d. No retrieval after employment end | — | Legal to confirm whether acceptable |

No option is recommended here. Options (a) or (b) can be combined with (c).

## 5. Conceptual relationships (not a schema)

```
contract_template_version [code, version, file SHA-256, manifest, active|retired]
        │
contract ──1──*── contract_document [revision, snapshot + SHA-256, generator version, output SHA-256,
   │                  │              generated at/by]   (immutable)
   │                  ├──1── contract_document_file [bytes, SHA-256]  (insert-only)
   │                  └── contract_history_event: document_generated · document_released · document_withdrawn (append-only; release state derived) (+ audit)
   └── employment ── person ──0..1── app_user_person_link ──1── app_user (Entra principal)
```

All of this is additive. 2A tables, states and rules are untouched.

---

## 6. Failure and recovery

| # | Scenario | User sees | History kept | Recovery |
|---|---|---|---|---|
| 1 | Missing required data | Blockers with source and fix link; Generate refused (`MISSING_TEMPLATE_DATA`) | Nothing stored | Fix the source; review again |
| 2 | Source changes after preview | 409 `DOCUMENT_INPUTS_CHANGED`; new review | Nothing stored | Review, Generate |
| 3 | Template retired after generation | Not offered for new generation; old artifact downloads unchanged (stored bytes) | All | Generate with the active version if needed |
| 4 | Contract corrected after generation | Artifact flagged *Outdated* for HR; worker view unchanged | All | Regenerate and release; withdraw the old one explicitly if needed |
| 5 | DOCX stored, PDF conversion fails (PDF slice) | DOCX available; PDF "not produced — retry" | DOCX artifact; failure in audit/log | Retry PDF from the stored DOCX |
| 6 | Retry after an uncertain response | Same artifact id returned | One artifact | — |
| 7 | Contract cancelled/voided after generation | Labels for HR and (if released) for the worker; Generate unavailable; **no automatic withdrawal** unless Q3 decides otherwise | All bytes and events | HR withdraws explicitly if needed |
| 8 | HR edits the DOCX outside the system | Nothing; the copy no longer matches the stored hash | Stored original | Update record → regenerate → release |
| 9 | Stored file missing or corrupted | Download fails with an integrity message; alert | Record and audit | Restore from backup (A5) or explicitly generate a new artifact; never auto-replaced |
| 10 | Worker requests another worker's artifact | 404 | Denial audited | — |
| 11 | Database write fails during Generate (e.g. connection lost, constraint, disk full) | "Document not generated — try again"; no artifact appears | Nothing (single transaction rolled back); technical log | Retry with the same Idempotency-Key; the earlier failed attempt left nothing to clean up |
| 12 | Real use attempted before gates pass | Document features absent (404) in production; synthetic templates refused | Startup and refusal logged | Operator enables only after the recorded gate decisions (§9.2) |

---

## 7. Acceptance criteria (synthetic data)

1. Preview works for Draft (watermarked, nothing stored). Generate is refused for Draft, Cancelled or Voided contracts and for contracts under a Cancelled or Voided period.
2. Generation changes no 2A field, state, Needs Review result, Home count or Core HR record.
3. Template registration rejects unknown tags, logic constructs, macros and a changed hash for an existing version.
4. Only active, compatible template versions are offered.
5. Values follow the as-of rules (assignment on `effective_from`). Required-missing blocks; optional renders blank.
6. A stale fingerprint returns 409 and nothing is stored. An idempotent replay returns the same artifact. A render failure stores nothing.
7. **Download returns bytes identical to the generation response's SHA-256**, after retiring the template and after a simulated generator-version change, and the generator is not called on download.
8. Tampered or missing bytes → integrity failure, no re-render, audit entry. The integrity scan detects them.
9. Artifacts cannot be updated or deleted by the application role (database-enforced).
10. HR operations return 403 without the stated permission. Worker endpoints return only the linked person's **released, non-withdrawn** artifacts. Another person's artifact id returns 404. An unlinked or disabled account gets nothing. The worker permission grants no HR endpoint.
11. Release, withdraw and download are recorded (history/audit). Withdrawal hides the artifact from the worker and keeps every record.
12. No public or pre-signed URL and no storage identifier appears in any response; downloads are `no-store`.
13. Vietnamese diacritics round-trip. Fixtures and templates are synthetic.
14. **New versions never overwrite old files:**
    - generating twice for one contract yields two artifact ids with both byte sets intact;
    - the first artifact's bytes and hash are unchanged after the second generation, after a template retirement and after a generator upgrade.
15. **Generation and storage failure:**
    - a forced failure at render, at hash and at the database insert each leaves no record, file, history event or release;
    - a retry with the same Idempotency-Key then succeeds once.
16. **Internal vs released:**
    - a generated artifact is invisible to the worker until released;
    - after a second release, the worker's view follows the approved Q3 option (both labelled, or latest only);
    - an explicit Withdraw hides only that artifact and is audited;
    - cancel / void change worker visibility only as Q3 decides;
    - HR always sees all of them.
17. **Gate enforcement:**
    - with production configuration and the Phase 2B enablement switch off, every document and worker endpoint returns 404;
    - the production startup check refuses the switch while required settings are missing;
    - synthetic-classified templates are refused in production;
    - the repository contains only synthetic templates (test).

18. **Size limit:** an output above the configured maximum is refused at Generate and nothing is stored.
19. **Lifecycle vs content:** release and withdrawal only append events; the artifact's bytes, hash and snapshot are byte-for-byte unchanged afterwards.
---

## 8. Slices and dependencies

| Slice | Scope | Needs |
|---|---|---|
| 2B-0 | Record decisions; ADR-0005 addendum; API draft | Answers to §11 Q1–Q3 |
| 2B-1 | **Engine spike** on a branch (library, licence, safety, Vietnamese text, determinism, artifact size) | Q1 (incl. approval to install candidate dependencies on the spike branch) |
| 2B-2 | Template registry, manifest validator (incl. `synthetic`/`approved` classification), catalogue v1, synthetic templates | Q2; spike accepted |
| 2B-3 | Data review / preview with fingerprint; Draft watermark | 2B-2 |
| 2B-4 | Generate; stored artifact (record + bytes, insert-only); HR download with integrity check; history; integrity-scan extension; Phase 2B enablement switch + startup check | Q2, Q3 |
| 2B-5 | Release / withdraw; account-to-person link via access administration; worker "My documents" (test identities only) | Q3; real use also needs PV-11, A3/A4, PL-11 |
| 2B-6 (gated) | PDF from the stored DOCX | A later owner decision to add PDF; IT sidecar approval |
| Real use | Real templates and content (§9), real data | PV-51, PL-12, PV-31, PL-03, PL-11, PL-01, PL-02, A1–A8 |

Owner checkpoint after each slice.

---

## 9. Real HR use — gap matrix (C-125)

Gates: A1–A8 (Gate A), PL-* (Legal), PV-* (owner), IT.

| Required content / capability | Existing source | Missing capability | Decision owner | Gate |
|---|---|---|---|---|
| Employer legal name, address, tax code | None | Source of truth: template literal text per version (recommended, no new domain) vs a small versioned "employer profile" | Owner + Legal | PV-51, PL-12 |
| Employer representative / signatory and title | None | Same choice; whether the signatory varies by contract or date (then effective-dated data) | Owner + Legal | PV-51, PL-12 |
| Worker full name, Employee Code | `person` | No name history (snapshot is the record) | — | — |
| Worker date of birth, gender | `person` (held) | Processing basis for documents | Legal | PL-05, PL-11 |
| Worker legal ID (number, issue date, place), nationality | None (`employees.read_sensitive` not implemented) | Sensitive data group, storage and access | Owner + Legal | PL-03, M-16, A1 |
| Worker address | None | New personal data group | Owner + Legal | PL-03, PL-05 |
| Contract term and dates | `contract` | — | — | — |
| Position: department, job title (EN/VI), level | `job_assignment` (effective-dated) | Department and level have no Vietnamese names (`name_vi` exists for job titles and contract types only) | Owner | PV-51 |
| Workplace, working hours, job description | None | Template text vs structured fields; no new HR domain without approval | Owner + Legal | PV-51, PL-12 |
| Compensation (gross salary in the contract; seven allowance/bonus lines in the initial appendix) | None (excluded, M-16) | New sensitive data group and domain; per-line value rules (amount + unit vs policy text vs "not applicable") | Owner + Legal | PL-03, separate requirement; PV-53 |
| Initial appendix number; contract and appendix signing dates | None (no appendix record; `signed_at` only after Confirm signed) | Numbering rule; signing dates completed by hand at signing vs system-filled | Owner | PV-53 |
| Probation terms | None (PV-16) | Probation module | Owner + Legal | PV-16, PL-08 |
| Historical / effective-date selection | Contract dates; assignment history | Catalog and name history absent → the snapshot at generation is the historical record | — | (technical; documented) |
| Template wording, mandatory content, language (VI, EN, bilingual) | None (synthetic only) | Legal-approved templates per Contract Type | Legal + Owner | PL-12, PV-31 |
| Artifact storage, encryption at rest | Design §4 F | Hosting, encryption, DB sizing | IT + Legal | PL-02, A2 |
| Retention and disposition of artifacts and snapshots | None | Rule, privileged disposition routine, legal hold | Legal | PL-01, PL-11 |
| Backups and restore of artifacts | DB backup design (target only) | Backup and restore rehearsal incl. hash verification | IT | A5, M-14 |
| HR authentication | Entra verifier proven locally | Production Entra | IT | PV-11, A3 |
| Worker authentication and account link | None | Worker sign-in policy, link procedure, new permission and bundle | IT + Owner + Legal | PV-50, PV-11, A3, A4, PL-11 |
| Real data use | — | Go/No-Go | Management | A8 |

No legal requirement, template content or retention rule is assumed in this matrix; each "missing" cell is a question, not a design.

### 9.1 Employer details as versioned template literals (RECOMMENDED, PV-51)

1. HR supplies the employer's legal details and the signatory and title per template; Legal confirms the wording (PL-12). The manifest stores the **approval reference** and `classification: approved`.
2. **Required rule:** when approved employer details or wording change, a **new template version** is created; existing versions are never edited, only retired. Documents already generated keep their stored bytes.
3. Engineering adds new versions under code review; registration verifies the hash and refuses changes to an existing version.
4. *Proposal, not a requirement:* HR periodically checks that the active versions still carry current employer details (e.g. once a year). Who and how often is HR's decision.
5. **Limitation:** a signatory that varies by contract or date cannot be expressed as one literal per version. If needed, an effective-dated source is a separate decision.

### 9.2 Gate enforcement before real use (RECOMMENDED technical control)

- **Development and test:** synthetic templates and data only; every manifest is `classification: synthetic`; a test fails on any other template in the repository.
- **Production:** Phase 2B features are **off by default** behind two switches, one for HR documents and one for worker access. The operator turns a switch on only after the corresponding approvals are recorded (references to the recorded decisions accompany the change):
  - **HR documents:** A8, PL-11, PL-12, PL-01, PL-02, A5.
  - **Worker access:** additionally PV-11, PV-50 and the Q3 decisions.

  While a switch is off, the endpoints return 404. The production startup check refuses a switch that is on while required configuration is missing. Production refuses `synthetic` templates.
- **What the switches are not:** they are technical controls tied to recorded approvals. They are **not proof** that Legal review, production readiness or any gate has been achieved; that evidence lives in the decision records and the Gate A documents.

---

## 10. Open questions

**Owner:** the three questions in §11 (PV-44 … PV-51).

**IT:**
- Database growth and backup size with stored artifacts.
- Encryption at rest.
- A PDF sidecar (M-01).
- Worker sign-in through Entra: who may sign in (assignment required).
- Who verifies account ↔ person links.
- Fonts.
- Dependency and licence policy.

**Legal:**
- PL-12: wording and content; a reference on signed agreements.
- PL-11: worker access to personal documents; snapshot and artifact retention basis.
- PL-01: retention and disposition.
- PL-02: hosting and encryption.
- PL-03 / PL-05: identity, address, compensation, date of birth.
- PL-13: signed files.

---

## 11. Owner questions (three; every subdecision answered separately)

C-123, C-124 and C-125 are confirmed. **Nothing below is approved** until the owner answers each subdecision. Answering one does not answer another.

### Q1 — First step — **DECIDED 2026-10-18 (C-126)**

| # | Subdecision | Owner decision |
|---|---|---|
| 1a | Output format of the MVP | **Approved: DOCX-first; PDF deferred** (any PDF needs a later, separate decision) |
| 1b | Synthetic engine spike (2B-1) | **Approved:** local, synthetic, on a separate branch/worktree; candidate libraries installed and evaluated only there; no external document-processing services |
| 1c | Library choice | **Not decided:** the recommendation and evidence return for owner approval; no production library is approved |

### Q2 — Generation, templates and storage

| # | Subdecision | Recommended answer |
|---|---|---|
| 2a | When documents can be previewed and generated | Preview: Draft (watermarked, not stored), Finalized, Signed. Generate: operational Finalized/Signed only; snapshot + input fingerprint at Generate; recovery actions stay allowed (*Outdated* flag) (§4 A, E) |
| 2b | Template governance | Controlled files under review; immutable versions; Contract Type + term kind compatibility; plain tags only; **a new version whenever approved employer details or wording change**; periodic HR check only as a proposal (§4 B, §9.1) |
| 2c | Data and missing values | Catalogue v1 with as-of rules; missing required values block; no document-only manual input; unsupported fields stay out until their gates (§4 C–D, §9) |
| 2d | HR permissions | View = `contracts.read`; preview, generate, **download**, release, withdraw = `contracts.finalize`; no new HR permission (§4 H) |
| 2e | Artifact storage | Original bytes in PostgreSQL, insert-only, same transaction as the record; hash verified on every download; size limit (proposed 5 MB); no re-render; disposal only by a future Legal-approved routine; object storage revisited at the stated triggers (§4 F) |
| 2f | Gate switches | Off by default; turned on only with recorded approvals; technical control, not proof of readiness (§9.2) |
| 2g | Initial package | **DECIDED (C-128):** one DOCX, one snapshot and generation record, stored bytes, seven fixed allowance rows for this template version, missing ≠ "Not applicable", contract-linked appendix number. Initial appendix effective date **DECIDED (C-129)**: the contract's Effective From. Still pending: numbering rules (PV-54), signing-date fields (PV-56) (§13) |

### Q3 — Worker access, release and visibility (pending owner; Legal where marked)

| # | Subdecision | Recommended answer |
|---|---|---|
| 3a | Trusted account-to-person link | Link created and ended only through guarded access administration after IT + HR verification; never matched by email, name or Employee Code (§4 I) |
| 3b | Worker permission | New `contracts.documents.read_own`, own explicitly released artifacts only; no contract records (§4 H) |
| 3c | When a worker sees a document | **Explicit HR release** of a specific artifact (§4 J1) |
| 3d | Visibility of earlier released versions | **Option B:** all previously released versions stay visible, clearly labelled; removal only by explicit, audited Withdraw (§4 J2) |
| 3e | Effect of a new release, correction, Return to Draft | **No automatic withdrawal**; labels and *Outdated* for HR; HR withdraws explicitly if needed (§4 J3) |
| 3f | Effect of Cancel planned / Void on released documents | **No automatic withdrawal**; worker sees "Contract cancelled" / "Contract voided — not valid"; HR withdraws explicitly. Alternative: automatic withdrawal on Void only (owner's choice) |
| 3g | Former workers | **No recommendation.** Options (a) account-based, (b) ends at employment end, (c) HR-assisted retrieval, (d) none; pending owner + Legal (PL-11, PL-01) (§4 J4) |

**Q1 is decided (C-126);** the spike is the only authorized work. Q2 is needed before 2B-2 / 2B-4. Q3 is needed before 2B-5; 3g is needed before any real worker access.

---

## 13. Initial contract package and later salary appendices

### 13.1 Initial package — **DECIDED 2026-10-18 (C-127, C-128)**

HR's sample contains the labour contract followed by an **allowance appendix that is signed together with it** (C-127). That appendix belongs to the **initial contract document package**; it is not Amendment work.

**Owner-approved design (C-128):**
1. **One DOCX** containing the initial employment contract and its accompanying allowance appendix.
2. **One shared immutable data snapshot and one generation record** for the package; a regeneration (case C) creates a new artifact for the whole package.
3. The **generated original bytes are preserved** for exact historical download (C-123).
4. **Seven fixed allowance rows** for this template version. This is not a universal allowance catalog: another template version may define different rows.
5. **Missing input is not "Not applicable":**
   - missing data is never converted into zero or "Not applicable";
   - HR must explicitly supply the applicable value, approved policy text, or "Không áp dụng / Not applicable";
   - a missing row blocks generation (`MISSING_TEMPLATE_DATA`).

   The production data source and entry mechanism remain **pending** (PL-03, M-16, a separate requirement).
6. **Contract-linked appendix number**, e.g. `HĐ-001/PL-01`. Existing documents are never renumbered. Uniqueness, allocation and retry rules are proposed in §13.4 before any numbering is implemented.

**Still pending:**
- signing-date field behaviour (PV-56);
- production sources for identity, salary and allowance data;
- access, release and storage implementation decisions (Q2/Q3);
- final engine adoption and actual Word validation;
- authorization of slice 2B-2.

### 13.2 Three different things

| | Case | What it is | What it is not |
|---|---|---|---|
| A | Initial contract + accompanying appendix, signed together | One initial package (13.1) | — |
| B | A **later** appendix changing specified terms of an existing contract (e.g. salary) | A separate document with its own identity that references the original contract | Not a regeneration of A; never modifies, overwrites or replaces A or its stored artifacts |
| C | Regenerating to correct a generation error | A new artifact for the same package; the earlier artifact is kept | Not an amendment; changes no agreed terms |

### 13.3 Later salary-change appendix (B) — requirement to evaluate, **deferred** (PV-52)

The owner's scenario: keep the original contract unchanged and issue a new appendix when salary changes. This is recorded for a **later Amendment slice**. It **does not open the Amendment gate** (C-109, PV-38, PL-12) and authorizes no salary-change implementation.

Design constraints to carry forward:
1. The original contract, its initial package and all generated or signed-document references stay unchanged.
2. A later appendix has its own identity (record, number, artifacts) and references the original contract.
3. Earlier artifacts remain available for exact historical download (C-123). A later generation never overwrites them.
4. **Signing date, effective date and generation timestamp are distinct.** Generating or downloading a file means neither "signed" nor "effective".
5. The appendix states **which terms it changes**. It does not by default replace every term of an earlier appendix.
6. Generating an appendix does **not** update any current salary value.
7. **Pending explicit decisions:** salary source of truth, activation, overlapping effective dates, backdating, cancellation and correction rules.
8. Legal suitability and wording are subject to HR/Legal review (PL-12).

No generic amendment framework is built in the DOCX spike.

### 13.4 Appendix number — **DECIDED 2026-10-18 (C-130)**; correction edge case pending (PV-57)

**C-130 (owner-approved):**
- The initial appendix number is `<contract number>/PL-01`.
- A retry or regeneration of the same appendix **never allocates the next appendix number**.
- Each generated artifact version has its **own artifact identity**; the appendix number is a printed value, not the artifact's identity.
- Historical files remain unchanged.
- Existing documents are never renumbered.

MVP mechanics: only the initial appendix exists. Its number is derived at generation from the contract number in the same snapshot and printed in the stored bytes, so no allocation table is needed. Later appendices (`/PL-02` …) are designed only with the deferred Amendment work (PV-52).

**PV-57 — contract number corrected after the initial appendix was generated (RECOMMENDED rule, pending):**

| Aspect | Rule |
|---|---|
| Stable identity | The contract is identified by its record id, and the initial appendix by (contract id, appendix sequence 1). Neither identity depends on the display number |
| Display number in each snapshot | Each generation snapshot records the contract number **as it was** and the appendix number derived from it (`<number at generation>/PL-01`) |
| Previously generated files | Stored bytes and snapshots are **never** changed or renumbered. They are shown as *Outdated* (contract revision changed) with "Contract number changed since generation" |
| Future generation | Uses the **current** contract number and still `/PL-01` (same appendix sequence, not `/PL-02`); a new artifact identity |
| How the number can change | Only through the existing controls: Return to Draft (Finalized, unsigned) or Correction (Signed) (M-15, M-18). **No automatic renumbering workflow** and no automatic regeneration |
| If the old number was already printed on a signed paper | The system corrects the record only. Whether the parties re-execute is an HR/Legal judgement (PL-12); the system does not decide it |
| **Owner decision needed** | Should a contract number that has **already been printed in a generated artifact** stay reserved after a correction, so no other contract can later take it? Recommended **yes**: otherwise two different contracts could have files bearing the same number. This extends M-18, under which a changed number is freed, so it needs explicit approval |

### 13.5 Initial appendix effective date — **DECIDED 2026-10-18 (C-129)**; signing-date lines — **DECIDED (C-131)**

**C-129 (PV-55, option A):** the initial allowance appendix takes effect on the **same Effective From as its parent contract**.
- Derived from the contract's authoritative `contract.effective_from`, as captured in the package snapshot.
- **Not** the generation date, the signing date, or the employment-period start date.
- The signing date stays a separate fact (PV-56; `signed_at` only through Confirm signed, C-105).
- Applies **only to the initial appendix**; later salary-change appendices remain under the deferred Amendment gate (PV-52).
- If the contract's Effective From is later changed (Return to Draft or Correction), **previously generated artifacts are not rewritten**; their stored bytes keep the date they printed. The next generation shows the new date.

**Draft wording change for HR/Legal review (PL-12) — NOT approved wording.** The sample states "effective from signing" in two appendix clauses. Only the effective-date phrase is changed; the rest is kept verbatim.

| Clause (sample) | Current phrase | Proposed phrase (draft) |
|---|---|---|
| Article 2, item 3 (VI) | "…và có hiệu lực kể từ ngày ký." | "…và có hiệu lực kể từ ngày {contract_effective_from} (ngày có hiệu lực của Hợp đồng lao động)." |
| Article 2, item 3 (EN) | "…and come into effect from the signing date." | "…and come into effect on {contract_effective_from} (the effective date of the Labour Contract)." |
| Article 3 Effectiveness (VI) | "Bản phục lục này có hiệu lực kể từ ngày ký kết và là một phần…" | "Bản phục lục này có hiệu lực kể từ ngày {contract_effective_from} (ngày có hiệu lực của Hợp đồng lao động) và là một phần…" |
| Article 3 Effectiveness (EN) | "This Appendix takes effect from the date of signing and is an integral part…" | "This Appendix takes effect on {contract_effective_from} (the effective date of the Labour Contract) and is an integral part…" |

Notes for the reviewers:
- The phrases are drafts. HR/Legal may prefer different wording or a single effectiveness clause.
- Existing spelling in the sample ("phục lục", "dược") is unchanged; corrections, if any, are HR/Legal's call.
- The spike template is **not** changed until the wording is reviewed.

**C-131 (owner-approved, resolves PV-56):**
- Signing-date lines in the contract and the appendix stay **blank** in the unsigned generated document.
- The generation date or the effective date is never substituted.
- Actual signing is recorded separately through the existing Confirm signed workflow (`signed_at`, C-105).
- **Confirm signed does not turn the stored unsigned DOCX into a signed document.** The stored artifact remains the unsigned generated original (C-123); signed-document storage stays gated (PL-13).

---

## 14. Engine spike outcome (2B-1) and next-slice proposal (2B-2) — proposal, not authorized

**Evidence so far** (branch `spike/2b-docx-engine`, worktree `/Users/nhungle/HRMS-spike-2b-docx`, `spikes/2b-docx-engine/README.md`, `hr-sample/REPORT.md`):
- **Engine behaviour:** docxtemplater 3.71.1 + pizzip 3.3.0 passed every automated case under the tested configuration (default parser, throwing missing-value handler, NFC, invalid-character rejection). That covered synthetic templates and HR's real contract + initial appendix layout: 66 placeholder occurrences, 37 distinct; tables, merged cells, numbering and sections preserved; missing and invalid input refused with no file written.
- **Rejected candidates:** docx-templates executes template code; easy-template-x silently blanks missing data and writes corrupt XML.
- **Dependencies:** no known advisories for the exact versions. Conditions: pin versions, keep `@xmldom/xmldom` ≥ 0.9.12 and `lodash` ≥ 4.18.0, declare `lodash` explicitly for `InspectModule`, record the MIT licence option.

**Missing evidence (blocks final engine adoption):**
1. Desktop-Word open/save of the template.
2. Microsoft Word review of the generated samples: repair warnings, accents, long text and tables, both signature areas, contract-to-appendix pagination.

Quick Look evidence was withdrawn.

**Proposed slice 2B-2 — template registry and placeholder catalogue (synthetic only; no generation endpoint, no storage, no UI):**

| | Content |
|---|---|
| Scope | Forward migration `contract_template_version` (local `hrms_dev`/`hrms_test`); registration from controlled files with manifest (code, version, Contract Type codes, term kind, classification `synthetic`, placeholder list with required/optional, catalogue version, SHA-256); validator (plain tags only via `InspectModule`; unknown, loop, condition and inverted tags rejected; hash change on an existing version refused; retire-only); placeholder catalogue v1 including the initial-appendix fields and the derived `/PL-01` number; NFC and invalid-character rules; the two synthetic templates (contract + initial appendix, fixed-term) |
| Prerequisites | Owner adoption of docxtemplater + pizzip (after Word evidence); Q2 answers 2a–2c (generation rules, template governance, data/missing values); dependency approval for the main application (`docxtemplater`, `pizzip`, `lodash` pinned); explicit authorization of 2B-2 |
| Not in 2B-2 | Generation endpoint, artifact storage (2e), HR/worker download, release (Q3), real templates (PL-12), real data, PDF |
| Acceptance criteria | (1) A valid synthetic manifest registers once; a re-registration with the same hash is idempotent, with a different hash refused. (2) Templates with unknown tags, loops, conditions, inverted sections, macros or embedded objects are rejected with the offending tag named. (3) Retired versions cannot be selected; existing versions are never edited. (4) The catalogue resolves every placeholder of the synthetic package from synthetic data with the as-of rules (assignment on `contract.effective_from`; appendix effective date = contract `effective_from`; appendix number derived `/PL-01`; signing lines blank). (5) A required placeholder without a value fails with `MISSING_TEMPLATE_DATA`; "Not applicable" only when explicitly supplied. (6) Production configuration refuses `synthetic` templates. (7) No change to Phase 2A behaviour (full regression suite green); migration forward-only, local only |

---

## 12. Self-review

| Check | Result |
|---|---|
| Unnecessary framework | Two artifact tables, one link table, one permission; no policy engine, scope matrix, approval chain or storage abstraction |
| Unsupported assumptions | No retention period, legal content, salary rule or template wording assumed; no automatic withdrawal assumed; former-worker access left open; annual review only a proposal; gate switches not treated as proof |
| Generated / Finalized / Signed / Released | Kept distinct: Released = visible to the worker, not signed and not official |
| Mutable-data dependence | Snapshot and stored bytes; downloads never touch live data or the generator |
| History and retry | Insert-only artifacts; idempotent Generate; release and withdraw recorded; integrity failures never auto-repaired |
| Access leaks | One predicate for lookup and delivery; 404 for others' artifacts; no URLs or keys; the worker permission grants nothing else; HR download not widened to `contracts.read` |
| Immutability | Content immutable; release state from append-only events; disposal deferred to a Legal-approved routine |
| Deferrable | PDF, footer reference, object storage and upload UI deferred without weakening the MVP |
