# Phase 2A Contract Management — owner acceptance (2026-10-16)

- Status: **Eme People — Contract Management Phase 2A — Product/UI Frozen — Owner Accepted** (2026-10-17, C-122). The owner accepted the minor fixes (C-118), the M-19 fingerprint fix (C-120) and, after explicit visual review, the current Home dashboard UI (C-119, C-121). This is a **product/UI milestone only**: it is not production readiness, release approval or deployment approval (see *Freeze and close-out* below). Phase 2B not started.

## Acceptance journey (synthetic data, local test identities, 1366 px and 390 px)

All eight scenarios passed: Add Employee without a contract; with a Contract Draft; partial success and Contract-only retry; Draft → Edit → Finalize → Confirm Signed; warning → Finalize anyway → Needs review; Home Contract Attention counts = filtered Contracts results; renewal A → B → C with Signed-only projection, Awaiting signature for an unsigned renewal, branching refused, gap warning; Discard, Return to Draft, Cancel planned, Correct, Void. HR Editor / HR Admin permission split confirmed in the browser; the "employee creator without `contracts.manage`" path has no local test identity and is covered by automated tests (C-117).

## Minor fixes (owner-approved package)

| # | Finding | Fix |
|---|---|---|
| 1 | Employee Detail tab links (`/employees/{id}?tab=contracts`, Phase 1 Home Upcoming `?tab=employment` / `?tab=assignment`) opened Overview on in-app navigation and the URL lost `?tab=`. Root cause: the initial tab was read from `window.location`, which still holds the previous page during a client-side navigation; the URL-sync effect then rewrote the address without the tab. A Phase 1 defect surfaced by the new contract links. | `src/app/employees/[id]/tabQuery.ts` + page: the tab is read from the router's search params and later URL changes are adopted while mounted (C-114 pattern); tab clicks keep updating the address in place. Verified: Home Upcoming → tab, Contract → Employee Contracts tab, direct URL, refresh, Back / Forward. |
| 2 | Overlap / gap warnings did not name the other contract or the dates. | The server adds presentation facts to each finding — `related_contract_number`, `affected_from`, `affected_to` (overlap: the overlapping days of the two operational ranges; gap: the uncovered days after the parent's own Effective To; renewal overlap: renewal start to parent end). Codes unchanged. *Correction (C-120): keeping the M-19 fingerprint at code + related id was a defect — a confirmation survived a change of the dates HR had reviewed; the fingerprint now covers these facts.* UI: "Overlaps with ACC-B-001 from 01 Jun 2027 to 31 Oct 2027.", "Coverage gap after ACC-R-B-001 from 06 Nov 2027 to 30 Nov 2027." The browser derives no date. |
| 3 | History "Planned contract cancelled · 01 Jun 2027" read as if the cancellation happened on that date. | The business date is labelled: "Planned contract cancelled · Planned start date: 01 Jun 2027"; *Recorded at* remains the time of the action ("Signed date" is labelled the same way). Data unchanged. |
| 4 | "1 contracts". | "1 contract" / "N contracts" on the Contracts list count and the Home "View all" accessible name. |

## Verification

Unit `tests/unit/acceptance-minor-fixes.test.ts` (8) and integration additions in `tests/integration/contract-renewal.test.ts` (facts on overlap, gap and renewal overlap; the fingerprint assertion there was later replaced by C-120). Typecheck, lint, 66 files / 865 tests, UAT rounds 1–2, integrity baseline and scan, production build — green.

## Non-blocking improvements recorded for later (not implemented)

Correction history could show what changed (old → new is in the audit only); two "Renewal created" entries could name their renewal; Contracts list on phones scrolls the table horizontally (status columns off-screen); Create contract defaults to "Ends on a date" while Add Employee asks HR to choose; the partial-success error box shows a technical Request ID; the skipped optional wizard step shows ✓ (Phase 1 convention); Home *Expiring soon* guidance does not mention Renew.

## Freeze and close-out (2026-10-17)

**Owner visual acceptance — explicit.** The owner approved the current Home dashboard UI, including: the full-width layout beside the sidebar (C-121); the summary cards and the unavailable-data placeholders ("—"; Total Employees = Active people only; On Leave, ratios and trends unavailable); the Active-only workforce charts and department counts (C-119); and the Needs Attention, Upcoming and Contract Attention layout (balanced operational row with discoverable internal scrolling; Contract Attention unchanged in behaviour).

**Final code verified at HEAD `fe23a62`** (working tree clean before close-out):

| Check | Result |
|---|---|
| M-19 fix (C-120) present | `warningFingerprintFacts` and the `w2:` fingerprint in `src/modules/contracts/evaluation.ts`; tests `tests/unit/contract-fingerprint.test.ts`, `tests/integration/contract-renewal.test.ts` (implementation commit `d046ca9`) |
| Full-width Home present | `.page:has(> .home) { max-width: none; margin: 0; }`; no `--home-max-width` token (commits `dbb40dd`, `fe23a62`) |
| `npm test` (guarded `hrms_test`) | 67 files, 893/893 pass — run on the final source of `fe23a62` |
| `npm run build` | pass — run on the final source of `fe23a62` |
| `npm run typecheck`, `npm run lint` | pass — run after the last TypeScript change; later edits in `fe23a62` were CSS-only (not covered by either tool) and are covered by the test suite and build above |
| Rendered layout | measured at 1366 / 1440 / 1920 / 2560 / 2880 and 390 CSS px (`docs/product/home-action-center-design.md` §L.4) |

No check was re-run for the close-out: the close-out commit changes documentation only.

**What the freeze means.** The Phase 2A Contract Management product and UI baseline — contract register and lifecycle (Draft, Finalize with M-19 confirmation, Return to Draft, Confirm Signed, Discard, Cancel planned, Correct, Void), renewal chains, Contracts screens, Employee Contracts tab, Add Employee with an optional Contract Draft, Home Contract Attention and the refreshed Home dashboard — is accepted as designed. Further Phase 2A product/UI changes need explicit owner approval (as with the Phase 1 freeze, C-101).

**What it does not mean.** It is **not** *Production Ready*, not a release decision and not deployment approval. Real employee data and real contract files remain prohibited. Phase 2A runs only locally on synthetic data; no staging or production migration has been run. Open before any production use of contracts:

- **Gate A** (Phase 1 pre-production readiness, `docs/production/gate-a-readiness-status.md`): still open; external execution is on hold until IT, Legal and HR inputs return.
- **Pending Legal Review:** PL-11 (contract data processing: lawful basis, notice, retention), PL-12 (Vietnam-specific contract rules), PL-13 (signed contract documents: storage, e-signature, retention), PL-10 (withdrawing a signed agreement).
- **Pending Validation:** PV-31 (real Contract Type catalog — only synthetic types exist), PV-38 (amendment content; the Amendment workflow stays gated).
- **Phase 2A migrations** (`20261015000000_contract_foundation`, `20261016000000_contract_voided_parent_guard`, `20261017000000_contract_renewal_chains`) are applied only to the local `hrms_dev` / `hrms_test`; staging/production application needs the attended runbook and explicit approval.
