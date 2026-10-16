# Phase 2A Contract Management — owner acceptance (2026-10-16)

- Status: **Accepted with minor fixes; the four fixes are implemented and verified (C-118). Awaiting the owner's freeze decision** — Phase 2A is not yet marked *Product/UI Frozen — Owner Accepted*. No business rule changed. Phase 2B not started.

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
