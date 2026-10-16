# Slice 2A-3 — Contract user experience (implementation record)

- Status: **Implemented (2026-10-16), awaiting owner checkpoint.** Decisions: C-104 … C-112, M-15 … M-19. Design: ADR-0005; API: `docs/api/contracts-api-draft.md` §2, §5, §6. Phase 2A is **not** complete (2A-4 … 2A-6 and the gated Amendment remain).
- Principle: the browser renders the server projection; it never re-derives document state, time state, Needs Review, warnings, Finalize readiness, allowed actions or denial reasons.

## Routes and screens

| Route / place | What it is | Permission |
|---|---|---|
| Sidebar **Contracts** (Home · Employees · Contracts · Organization) | New navigation item | `contracts.read` |
| `/contracts` | Portfolio list with canonical URL filters | `contracts.read` |
| `/contracts/{id}` | First-class, directly navigable Contract Detail (used by the list, the Employee tab and later Home reminders / documents) | `contracts.read`; actions per server `actions` |
| Employee Detail → **Contracts** tab (`?tab=contracts`) | Overview · Personal · Employment · Assignment · **Contracts** · History; other tabs unchanged | tab shown only with `contracts.read` |
| Create / Edit Draft | Dialog (`ContractDraftForm`): Employment period (only when the employee has more than one valid period), Contract Type, Contract Number ("optional while a draft; required before finalizing"), Effective From, End of term (Ends on a date / Open-ended), Effective To, Summary | `contracts.manage` |
| Lifecycle dialogs | Review before finalizing (M-19), Return to draft (reason), Confirm signed (date), Discard draft | per server `actions` |

New APIs: `GET /api/v1/core-hr/contracts` (list) and `GET /api/v1/core-hr/employees/{id}/contracts` (grouping). Everything else reuses 2A-2.

## Behaviour

- **List:** columns Contract Number · Employee (name + code) · Contract Type · Effective From · Effective To / Open-ended · Document status · Time status · Review. Filters: search (number / name / code), Contract Type, Document status, Time status, Effective-from range, *Needs review only*, *Include discarded and voided*. Filters and page live in the URL with the API parameter names, so `/contracts?needs_review=true`, `?document_state=draft|finalized|signed`, `?time_state=upcoming|active|expired` are the deep links Home will use — no second filter model. No raw ids.
- **Employee Contracts tab:** server groups rendered as *Current* · *Upcoming & drafts* · *Contract history* (discarded / voided / no-longer-effective records muted as evidence). One primary **Create contract**; with no contract yet, a single empty state carries the explanation and the one Create action. A new Draft opens on its Contract Detail.
- **Contract Detail:** header (number or "Draft contract", employee link, type, labelled states, Needs Review), notices for discarded/voided records and for a cancelled/voided employment period, *Needs review* box (plain language, link to the other contract, "finalizing did not resolve this"), *Before finalizing* list of blockers for an editable Draft, details card (employee, employment period, type + Vietnamese name, number, Effective From, end of term + "Ended with the employment period / Replaced by renewal", Signed date, Finalized by/at, Created by/at, Summary) and **Contract history** (action, business date where relevant, Recorded by, Recorded at in Asia/Ho_Chi_Minh, reason where relevant).
- **Actions:** only those the server marks allowed. Finalize (Draft) or Confirm signed (Finalized) is the primary button; Edit draft stays visible; Return to draft and Discard draft sit in *More actions*. A parent-period denial is explained in plain words; a missing permission simply hides the action.
- **M-19 dialog:** Finalize sends no fingerprint; a `409 FINALIZE_CONFIRMATION_REQUIRED` opens *Review before finalizing* with the server's warnings → **Review contract** (closes) / **Finalize anyway** (sends the server's `warning_fingerprint`). If the set changed meanwhile, the server answers with the new set and the dialog shows it again with "The warnings changed since you opened this review". Never a silent retry; no reason, no checkbox per warning; the dialog says finalizing does not resolve the items.
- **Return to draft:** reason required; explains the contract becomes editable and keeps its number and content.
- **Confirm signed:** date field (max = the server's Asia/Ho_Chi_Minh date) with the meaning "date HR confirms the contract was fully executed by all required parties"; the server rejects a future date regardless (verified). Cancelled-parent behaviour follows 2A-2 (C-111).
- **Discard draft:** states that the draft is kept as history, can no longer be changed and its number stays reserved.

## Owner checks before closing the slice

1. **Document status vs Time status** are always labelled separately (`ContractStateBadges`): e.g. *Document status* · Finalized and *Time status* · Active; list columns read "Document status" and "Time status". Signed exists only as a document status; the Signed date is a separate field ("Not confirmed yet" when absent).
2. **Discarded records** stay readable, are marked *Record* · Discarded (or Voided), show no time status (the server projects none for a disposed record) and expose no lifecycle action — a discarded draft whose dates cover today is never shown as Active. Verified in the browser with a discarded draft dated 01 Jun 2026.
3. **Canonical filters** — see Behaviour; the Home deep links use the same parameters.
4. **Employee Contracts empty state** — one empty state, one primary *Create contract*.

## Responsive and browser review (synthetic data, Test HR Editor)

| Width | Contracts list | Contract Detail | Employee Contracts tab | Notes |
|---|---|---|---|---|
| 1440 | no page overflow | no overflow | no overflow | |
| 1366 | no overflow (screenshot) | no overflow | no overflow (screenshot) | |
| 1280 | no overflow | no overflow | no overflow | |
| 900 | table fits | no overflow | no overflow | sidebar becomes the top bar (existing pattern) |
| 768 | table scrolls inside its frame; page does not | no overflow | no overflow | existing table pattern |
| 390 | filters stack; table scrolls in its frame | readable; action row wraps | usable | *More actions* menu within the viewport; *Review before finalizing* dialog fits (16 px margins, both buttons visible) |
| 375 | no overflow; `?needs_review=true` deep link applied | no overflow | no overflow | *Create contract* dialog fits without internal scrolling |

Flows exercised in the browser: create Draft from the Employee tab → Detail; Finalize without warnings; Finalize with warnings → dialog → warning set changed in the background → dialog refreshed with the "changed" notice and nothing saved → Finalize anyway → Finalized with Needs Review; Return to draft (empty reason refused, then with reason; history shows it); Discard draft; Confirm signed (future date refused by the client and, via a direct call, by the server with 422 `SIGNED_AT_IN_FUTURE`; past date accepted). Console: only the expected 409/422 responses.

## Tests

`tests/integration/contract-read.test.ts` (list filters, search with accents, sort, paging, disposed handling, grouping, create periods/default, cancelled-period drafts, permissions, 404); `tests/unit/contract-ui.test.ts` (URL state, server-only actions, denial explanations, M-19 protocol outcomes and request bodies, dialog content rules, warning copy for every code, Document vs Time labelling, discarded presentation, draft bodies, signed-date convenience check, Phase 2A-only fields, no role names); permission matrix + OpenAPI drift updated.

## Deviations / notes

- `include_disposed` (default false) replaces the draft's `include_non_operational`: contracts of a cancelled/voided **period** stay listed because Needs Review points to them; only the record's own disposition is hidden by default.
- List filters not built: department, employee type, employee/period ids, exact number, relationship, `awaiting_signature`, `expiring_within` (2A-4).
- Create from the central Contracts page is not offered (it would need an employee picker); drafts are created from the employee's Contracts tab.
- The Employee Detail URL `?tab=contracts` without `contracts.read` renders no panel (the tab is hidden; the server refuses the data).
