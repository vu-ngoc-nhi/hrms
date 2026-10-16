# Slice 2A-4 — Contract Attention & Home integration (implementation record)

- Status: **Implemented (2026-10-16), awaiting owner checkpoint.** Decisions: M-20 (PV-36, Home expiry window), C-113. Builds on ADR-0005, M-17, M-19, C-111, C-112. Phase 2A is **not** complete (2A-5, 2A-6 and the gated Amendment remain). No renewal content.

## Reminder semantics (server-side, `src/modules/contracts/evaluation.ts`)

One definition per signal, used by the Home section **and** the Contracts filters, so Home count = Home list source = filtered Contracts result.

| Signal | Rule | Contracts filter |
|---|---|---|
| **Expiring soon** | Finalized or Signed; operational (not discarded/cancelled/voided, period not Cancelled/Voided); not open-ended; **own Effective To from today through today + N, both ends inclusive** (Asia/Ho_Chi_Minh business dates: T and T+N count, T+N+1 and T−1 do not); excluded if its employment period already ended before today, or if a finalized renewal replaced it (C-104; no renewals exist before 2A-5). Home: N = 30 (M-20). | `expiring_within=30\|60\|90` |
| **Awaiting signature** | Finalized, not Signed, operational. No deadline implied; an already-ended unsigned contract still counts (a true open item). A contract of a Cancelled/Voided period is shown under Needs review instead. | `awaiting_signature=true` |
| **Needs review** | The 2A-2 Needs Review model, unchanged (overlap, gap, another open draft at Finalize-time warnings as review items, end after the period end, Effective From outside the period, period cancelled/voided). | `needs_review=true` |

Drafts are not expiry reminders: they have no time state until Finalized (interpretation of "non-disposed contract" consistent with the approved pack §17 and the server projection; recorded in C-113).

## API

`GET /api/v1/core-hr/contract-reminders` (`contracts.read`; no parameters → 400):

```json
{ "as_of": "2026-10-16", "window_days": 30,
  "expiring_soon":      { "total": 1, "items": [ { "id": "…", "contract_number": "…", "employee": { "person_id": "…", "employee_code": "…", "full_name": "…" },
                                                   "contract_type": "…", "effective_from": "…", "effective_to": "…", "document_state": "finalized",
                                                   "days_to_end": 20, "review_reason": null } ] },
  "awaiting_signature": { "total": 2, "items": [ … ] },
  "needs_review":       { "total": 2, "items": [ … "review_reason": "OVERLAPPING_CONTRACT" … ] } }
```

At most five items per signal (Home shows three). Ordering: Expiring soon by end date; the others by Effective From. `review_reason` is the main condition as a stable code; the UI shows plain words, never the code. `GET /contracts` gained `expiring_within` (30 / 60 / 90) and `awaiting_signature`.

## Home — Contract Attention

One section below the existing Home panels (Workforce summary cards, Needs Attention, Workforce Snapshot and Upcoming unchanged), shown only with `contracts.read` and loaded separately (a failure never hides the rest of Home). Three signals, each with: title + authoritative count (warning tone when > 0, neutral at 0), one line saying what HR should do, up to three contracts (number, employee, "Ends in N days · date" / type · start / plain-language review reason) linking to the Contract Detail, and **View all →** to the canonical Contracts filter. Zero → "Nothing to do." No charts, trends, KPI cards, recommendations, notifications or renewal content.

## Contracts page

One compact **Attention** select (All · Needs review · Awaiting signature · Expiring within 30 / 60 / 90 days) replaces the earlier "Needs review only" checkbox; it writes the canonical parameters, so `/contracts?expiring_within=30`, `?awaiting_signature=true`, `?needs_review=true` are both the Home links and what a user gets by choosing the option.

**Defect found and fixed:** the page read its initial filters from `window.location`, which is not yet updated during a client-side navigation — following a Home link landed on `/contracts` with the filter lost. It now reads the router's search params (`useSearchParams`, inside a Suspense boundary). **The same defect exists in the frozen Phase 1 Employees list** (Home *Needs Attention → View all* → `/employees?operational_completeness=incomplete` opens unfiltered); it was **not** changed in this slice; it was fixed afterwards, with owner approval, as the Phase 1 post-freeze regression fix C-114.

## Responsive / browser review (synthetic data, Test HR Editor)

| Width | Home | Contracts | Notes |
|---|---|---|---|
| 1440 | no overflow; 3 signal columns | no overflow | |
| 1366 | no overflow (screenshot) | no overflow; Home links verified (1 / 2 / 2 results = Home counts) | |
| 1280 | no overflow; 3 columns | no overflow | |
| 900 | no overflow; signals stacked | no overflow | |
| 768 | no overflow; stacked | no overflow | |
| 390 | no overflow; one compact stacked section (screenshot) | no overflow; Attention filter applied from the URL | |
| 375 | no overflow (screenshot) | no overflow (screenshot) | |

## Tests

`tests/integration/contract-attention.test.ts` (T, T+30 in, T+31 and T−1 out, 60/90 windows, open-ended / draft / voided / ended-with-period / cancelled- and voided-period exclusions, Awaiting signature semantics, Needs review reuse, Home totals = filtered list totals, bounded lists, ordering, no parameters, permissions); `tests/unit/contract-attention.test.ts` (pure predicates incl. Asia/Ho_Chi_Minh day boundary at 17:00 UTC, canonical links round-trip, one Attention control, end text, Home gating and no client rule, no renewal/chart content, router search params). Home guard test narrowed to allow exactly this approved section.
