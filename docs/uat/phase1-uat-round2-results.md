# Core HR Phase 1 — UAT Round 2 Results

- Baseline: tag `phase1-uat-ready` (`648e281`, unchanged) plus the accepted UAT Round 1 resolution batch (C-78 to C-81, last commit `52ebd82`).
- Executed: 2026-10-10 (business date, Asia/Ho_Chi_Minh). Synthetic data only. No product code or business rule changed in this round; PV-25 not implemented.
- **This is not UAT sign-off.** Items marked *HUMAN VALIDATION* need HR confirmation.

## How the round was run

| Part | Where | How |
|---|---|---|
| R2-01, R2-02, R2-03 (data), R2-05 (data), R2-07 (API) | `hrms_test`, freshly reset | Automated `tests/uat/round2.test.ts` (`npm run test:uat-round2`): 5/5 pass, two runs |
| R2-03 / R2-04 / R2-05 / R2-06 / R2-07 UI | `hrms_dev` (not reset) | Browser with the development test identity; new synthetic records ES0018 *UAT R2 History*, ES0019 *UAT R2 Effective End*, ES0020 *UAT R2 Planned Rehire*, ES0021 *UAT R2 SameDay* |

## Results

| ID | Scenario | Role | Expected | Actual (evidence) | Result | Finding Type | Severity |
|---|---|---|---|---|---|---|---|
| R2-01 | Pre-start completeness (D1 = 2026-10-20, first assignment D2 = 2026-10-25) | HR_EDITOR | Incomplete for Department / Job Title readiness; display/filter may follow C-76 | Status *Pre-start*; Operational Profile *Incomplete*; items Department ✗ and Job Title ✗; list shows Department **QA** and *Incomplete*; Department = QA filter returns the person (C-76) | PASS | PASS | None |
| R2-02 | Gap guidance | HR_EDITOR | Gap → Rehire; continuous with Active End → Reverse End then Relationship Change; codes unchanged | Gap: 422 `BUSINESS_RULE_VIOLATION` / `ACTIVE_END_EVENT_EXISTS` — "This employment ended on 2026-10-30. A return after a gap is a Rehire: use Rehire for the new period." Continuous: same codes — "…If the relationship actually continued, use Reverse End Employment first, then Relationship Change. If the person genuinely left and returns later, use Rehire." The End event was not replaced | PASS | PASS (minor copy note F-2) | None |
| R2-03 | Start → End #1 → Reverse End #1 → End #2 | HR_EDITOR / HR_ADMIN | End #1 *Reversed*, reversal linked, End #2 *Current end*, reasons attached, free text hidden, deterministic order | Technical: order start → end (Voluntary Resignation) → end_reversed → end (Mutual Agreement); reversal `reverses_event_id` = End #1; End #2 is the Active End Event; repeated reads identical; no free text in the response. UI evidence below | PASS (technical) · **HUMAN VALIDATION** (readability) | UX | None |
| R2-04 | Future End wording | HR_EDITOR | Future End → "Planned end of employment"; effective → "End of employment" | ES0018: "Planned end of employment — 19 Nov 2026 · Mutual Agreement" (period *Active*). ES0019: "End of employment — 05 Oct 2026 · Mutual Agreement" (period *Ended*) | PASS | PASS | None |
| R2-05 | Planned Rehire | HR_ADMIN | "Plan Rehire", planned save wording, scheduled-end text, nothing copied | Button "Plan Rehire"; title "Plan Rehire"; save "Save Planned Rehire"; text "The current employment is scheduled to end on 30 Oct 2026. This will create a future employment period starting after that date."; Employee Type, planned end and Work Email empty (previous Work Email not prefilled); start prefilled with the earliest allowed date 31 Oct 2026. API: new period has no Work Email and no assignment | PASS (technical) · **HUMAN VALIDATION** (operational clarity) | UX | None |
| R2-06 | URL filter state | HR_EDITOR / HR_ADMIN | Direct URL initialises controls and results; refresh keeps state; changes update URL; navigation consistent | With the implemented names `search`, `employment_status`, `department_id`, `page`: direct URL → controls and results correct (1 match); refresh → same; changing Department / clearing Status → URL updated; open a row and Back → identical state; `?page=2` → "Page 2 of 2". The short names `?status=` and `?department=` are **not recognised**: they are ignored and removed from the address bar (finding F-1) | PASS (implemented names) | UX | Low |
| R2-07 | Period effective today entered by mistake (PV-25) | HR_EDITOR / HR_ADMIN | No Cancel Planned, no Reverse Rehire, no Void, no DELETE | Initial Employment today and Rehire today → Cancel Planned `422 PERIOD_ALREADY_STARTED`; no void / reverse-rehire route; no DELETE handler on any API route. UI (ES0021, HR_ADMIN): Edit Profile, Edit Work Email, Correct Period, End Employment, Relationship Change, Add Initial Assignment — none removes the mistaken record | **HUMAN VALIDATION** | KNOWN_LIMITATION | High (pre-production) |

### R2-03 exact UI evidence (ES0018 *UAT R2 History*, Period 1 badge *Active*)

| Line as displayed | Badge | Style |
|---|---|---|
| Start of employment — 02 Jan 2023 | — | normal |
| Planned end of employment — 25 Oct 2026 · Voluntary Resignation | **Reversed** | struck through, muted |
| End of employment reversed — 25 Oct 2026 (reverses the end of employment dated 25 Oct 2026) | — | normal |
| Planned end of employment — 19 Nov 2026 · Mutual Agreement | **Current end** | bold |

Free-text note and reversal reason ("UAT R2 secret …") were not visible anywhere on the page.

## Findings (not fixed — reported only)

| ID | Finding | Type | Severity | Proposal |
|---|---|---|---|---|
| F-1 | Employee List URL uses the API parameter names (`employment_status`, `department_id`). The short names `status` / `department` used in the Round 2 instructions are silently ignored and stripped from the URL, so such a link shows an unfiltered list. | UX | Low | Decide the canonical URL names; optionally accept `status` / `department` as aliases. Not blocking. |
| F-2 | The gap guidance message shows the date in ISO form ("ended on 2026-10-30"), while the UI elsewhere shows "30 Oct 2026". | UX (copy) | Low | Format the date in the message, or keep ISO in API messages. Not blocking. |

## Questions for HR

**R2-03 / R2-05 — readability and clarity:** Is the End / Reversed / Current end presentation understandable? Is "Plan Rehire" with the scheduled-end text clear enough?

**R2-07 — PV-25 (KNOWN LIMITATION, HUMAN VALIDATION):**

1. Is it acceptable **during UAT** that an Initial Employment or Rehire effective today and entered by mistake cannot be voided (HR can only end it, move its dates, or change the relationship)?
2. Must PV-25 be solved **before Production Readiness**? Current approved direction: **PV-25 = HIGH PRIORITY — MUST BE RESOLVED BEFORE PRODUCTION READINESS**; likely an explicit *Void Effective Employment Period* workflow, design not approved and only after this UAT.

## Quality gate

| Check | Result |
|---|---|
| Round 2 automated tests | 5/5 (two runs) |
| UAT Round 1 automated suite | 22/22 |
| Main test suite | 359/359 |
| Clean integrity baseline | 1/1 (0 errors, 0 warnings) |
| `hrms_dev` integrity scan (read-only) | 0 errors, 0 warnings |
| Typecheck · lint · production build · OpenAPI generation | pass · pass · pass · pass (no contract change) |
| Tag `phase1-uat-ready` | unchanged (`648e281`) |

## Summary

- 7 scenarios: **4 PASS** (R2-01, R2-02, R2-04, R2-06 with the implemented parameter names), **2 PASS technically with HUMAN VALIDATION** (R2-03, R2-05), **1 HUMAN VALIDATION / KNOWN LIMITATION** (R2-07, PV-25). **0 FAIL.**
- No blocking technical failure; two Low UX findings (F-1, F-2).

## Recommendation

**READY FOR HR UAT SIGN-OFF**

HR sign-off still has to confirm R2-03 and R2-05 (readability / clarity) and answer the two PV-25 questions. Not production ready: PV-25 remains a pre-production requirement.
