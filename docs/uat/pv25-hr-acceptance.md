# PV-25 Void Employment Period — HR acceptance (focused set)

- Scope: closure verification of PV-25 (C-86). Not a new UAT round. **Synthetic data only**, in local `hrms_dev` (not reset).
- Business date: 2026-10-10 (Asia/Ho_Chi_Minh). Prepared by engineering; human acceptance performed by HR.
- **Result: PV-25 — Accepted / Closed** (HR human acceptance 2026-10-10: V-1 to V-5 PASS). See *HR acceptance result* at the end.
- Production Readiness is **not** declared by this document.

## Records

| Purpose | Employee Code | Name (synthetic) | State |
|---|---|---|---|
| V-1 executed | ES0024 | PV25 HR V1 Initial Error | Initial Employment 10 Oct 2026 — **voided** |
| V-2 executed | ES0025 | PV25 HR V2 Rehire Error | Period 1 04 Mar 2024 – 30 Sept 2026 (End: Voluntary Resignation); Rehire 10 Oct 2026 — **voided** |
| V-3 / V-5 executed | ES0026 | PV25 HR V3 Internal Records | 01 Sept 2026 – 31 Oct 2026, assignment, Work Email `pv25.v3@example.test`, End Employment 31 Oct 2026 (Mutual Agreement) — **voided** |
| V-4 executed | ES0022 / ES0023 | UAT PV25 Void Initial / UAT PV25 Report | ES0023's assignment used ES0022 as manager → blocked → manager corrected → Check again → **voided** |
| HR hands-on V-1 | ES0031 | PV25 HR Try V1 Initial | Initial Employment 10 Oct 2026, Work Email `pv25.v3@example.test` (reused from the voided ES0026 period) — **not voided** |
| HR hands-on V-2 | ES0027 | PV25 HR Try V2 Rehire | Ended period + Rehire 10 Oct 2026 — **not voided** |
| HR hands-on V-3 | ES0028 | PV25 HR Try V3 Internal Records | Same shape as ES0026, Work Email `pv25.try.v3@example.test` — **not voided** |
| HR hands-on V-4 | ES0029 / ES0030 | PV25 HR Try V4 Manager / Report | ES0030's assignment uses ES0029 as manager — **not voided** (Void blocked until corrected) |

Sign in with the development identity **Test HR Admin** (Void requires `employment.correct`; HR Editor does not see the action and the API refuses it).

## Cases

### V-1 — Effective Initial Employment entered by mistake

| | |
|---|---|
| Expected | Preview eligible; Void succeeds; the Person and Employee Code remain; status **No Employment Record**; *Add Initial Employment Period* available |
| Actual (ES0024) | Preview: eligible, no blockers/warnings; consequences `NO_OPERATIONAL_EFFECT`, `PERSON_HAS_NO_VALID_EMPLOYMENT`, `VOID_IS_PERMANENT`; internal records: 1 assignment, Start event. Void → 201. Employee Code ES0024 before and after; status Active → **No Employment Record**; period kept (1 assignment), events `start`, `employment_voided` |
| Automated evidence | `tests/integration/void-employment.test.ts` › *Void — effective Initial Employment* (both tests); UAT `tests/uat/round2.test.ts` › R2-07 |
| UI evidence | ES0024 detail page: header "No Employment Record", "Operational Profile: Incomplete"; button *Add Initial Employment Period*; "Period 1: 10 Oct 2026 – no end date" badge *Voided* with the voided note; assignment row kept (10 Oct 2026, Engineering) |
| Human confirmation | **PASS** — HR human acceptance, 2026-10-10 |

### V-2 — Effective Rehire entered by mistake

| | |
|---|---|
| Expected | Void succeeds; the previous ended period (dates, End event, assignment) is unchanged; a wrong previous End would need a separate Reverse End |
| Actual (ES0025) | Preview: eligible; consequences `NO_OPERATIONAL_EFFECT`, `PREVIOUS_PERIOD_UNCHANGED`, `VOID_IS_PERMANENT`. Void → 201. Status Active → **Ended**; previous period byte-for-byte identical in the API response before/after (04 Mar 2024 – 30 Sept 2026, events `start`, `end`, Active End Event kept) |
| Automated evidence | `void-employment.test.ts` › *voiding an erroneous Rehire leaves the previous period and its End unchanged; Reverse End then becomes possible*; clean integrity baseline scenario *Baseline Voided Rehire* |
| UI evidence | ES0025 detail page: header "Ended"; "Period 1: 04 Mar 2024 – 30 Sept 2026" *Ended* with "Start of employment — 04 Mar 2024", "End of employment — 30 Sept 2026 · Voluntary Resignation" *Current end* (the genuine previous End, correctly still current); "Period 2: 10 Oct 2026 – no end date" *Voided* with "Start of employment — 10 Oct 2026" then "Employment period voided — entered in error" |
| Human confirmation | **PASS** — HR human acceptance, 2026-10-10 |

### V-3 — Erroneous period with Assignment, Work Email and End Employment

| | |
|---|---|
| Expected | Preview shows the retained internal records and the consequences; Void keeps the history and makes the period non-operational; no Reverse End prerequisite |
| Actual (ES0026) | Preview: eligible; internal records: 1 assignment, events Start 01 Sept 2026 and End 31 Oct 2026, Active End Event, Work Email `pv25.v3@example.test`, planned end 31 Oct 2026; consequences `NO_OPERATIONAL_EFFECT`, `WORK_EMAIL_RELEASED`, `PERSON_HAS_NO_VALID_EMPLOYMENT`, `VOID_IS_PERMANENT`. Void → 201. Dates, assignment (01 Sept – 01 Nov 2026), Work Email value and End event kept; period lifecycle null (Voided) |
| Automated evidence | `void-employment.test.ts` › *internal activity never blocks: Assignment Change, Work Email change, planned end, Active End Event, End + End Reversed* |
| UI evidence (ES0028, preview only) | "Use Void only when this Employment Period was entered in error and the relationship never existed in reality." · *Kept unchanged as history*: "Assignments: 1", "Lifecycle events: Start of employment (01 Sept 2026), Planned end of employment (31 Oct 2026)", "The recorded End Employment stays in the history; no Reverse End is needed.", "Work Email (value kept): pv25.try.v3@example.test", "Planned end date (kept): 31 Oct 2026" · *What happens*: four consequence lines incl. "Its Work Email is no longer reserved and can be used again." and "Void cannot be undone…" |
| Human confirmation | **PASS** — HR human acceptance, 2026-10-10 |

### V-4 — External manager dependency

| | |
|---|---|
| Expected | Preview blocks Void, identifies the dependent assignment and gives a corrective direction; after HR explicitly corrects the dependent assignment, *Check again* shows eligible and Void succeeds; nothing is changed automatically |
| Actual | ES0029 preview (hands-on fixture): `eligible: false`, blocker `MANAGER_DEPENDENCY`, reference ES0030 · PV25 HR Try V4 Report, assignment from 10 Oct 2026 (open). ES0022 (executed): same blocker for ES0023 → ES0023's assignment corrected (manager cleared, reason given) → *Check again* eligible → Void 201; ES0023's manager is now empty only because HR corrected it |
| Automated evidence | `void-employment.test.ts` › *Void — manager dependency (design §4)* (4 tests: blocked/listed then eligible after correction; other period of the same manager, cancelled dependent period and non-overlapping reference do not block — scan agrees; blocker created after the preview caught by the POST; voided period not resolvable as manager) and *concurrent Void vs another employee choosing this period as manager*; `integrity-scan.test.ts` › *voided_period_referenced_as_manager uses the Void checker's semantics* |
| UI evidence (ES0029) | "Void is not possible yet" · "Other employees' assignments use this period as their manager. Open each employee listed below and change their Line Manager first (Change Assignment for a current or future assignment, Correct for a past one); they are never changed automatically. Then use Check again." · "ES0030 · PV25 HR Try V4 Report — assignment from 10 Oct 2026" · reason field and the Void button disabled |
| Human confirmation | **PASS** — HR human acceptance, 2026-10-10 |

### V-5 — After Void

| | |
|---|---|
| Expected | *Voided* badge; Void shown as the final disposition; previous Start/End history kept; free-text reason hidden; no *Current end* badge; Work Email reusable; Employee List, status and completeness ignore the period |
| Actual (ES0026) | Period badge **Voided** + note "This period was recorded in error and voided. It is kept for traceability and has no operational effect."; events in order "Start of employment — 01 Sept 2026", "Planned end of employment — 31 Oct 2026 · Mutual Agreement", "Employment period voided — entered in error" (last, badge *Voided*); no "Current end" text on the page; the void reason is absent from the page and its HTML; only *Edit Profile* and *Add Initial Employment Period* actions remain. Work Email `pv25.v3@example.test` reused by ES0031 (201). Employee List: ES0026 *No Employment Record*, completeness *Incomplete*, Department / Employee Type / Work Email empty; filter Department = Engineering → 0 rows; filter status Active → 0 rows |
| Automated evidence | `void-employment.test.ts` › *status, list, department filter and current employment ignore the voided period; every write path is read-only*, *the person keeps the Employee Code… Work Email and dates are released*; history order and badges via `EmployeeDetailSchema` assertions; clean baseline *Baseline Voided Initial* (same Work Email reused) |
| UI evidence | Detail page of ES0026 as described in *Actual* |
| Human confirmation | **PASS** — HR human acceptance, 2026-10-10 |

## Relationship Change predecessor (guidance only, for information)

A period ended by a Relationship Change is **not forbidden** from Void. The preview shows the warning `RELATIONSHIP_CHANGE_PREDECESSOR`: "This period was ended by a Relationship Change. If the original relationship was genuine, do not void it: the normal recovery is to cancel the new period (Cancel Planned Period, if it has not started) and then use Reverse End Employment on this period. Void applies only if HR has independently confirmed that this period itself was entered in error and the relationship it represents never existed; it is then evaluated under the normal Void rules, and any blocker must be resolved first." A valid successor still blocks (`LATER_PERIOD_EXISTS`); the successor itself is blocked (`RELATIONSHIP_CHANGE_SUCCESSOR`, PV-24).

## Integrity

`npm run integrity:scan` on `hrms_dev` (read-only) after preparing these records: **0 errors, 0 warnings**.

## HR acceptance result (2026-10-10)

| Case | Result |
|---|---|
| V-1 Effective Initial Employment entered by mistake | **PASS** |
| V-2 Effective Rehire entered by mistake | **PASS** |
| V-3 Erroneous period with Assignment, Work Email and End Employment | **PASS** |
| V-4 External manager dependency | **PASS** |
| V-5 After Void | **PASS** |

**PV-25 — Void Employment Period is accepted for Core HR Phase 1. Status: Accepted / Closed.**

HR human acceptance confirms:

- the Void preview is understandable;
- an Initial Employment entered in error can be safely voided;
- an erroneous Rehire can be voided without changing the previous period;
- internal Assignment / Work Email / End history is retained correctly;
- manager dependencies are understandable and safely blocked;
- post-Void history and operational state are clear;
- the Person and Employee Code remain;
- the Work Email becomes reusable;
- no Unvoid is required for Phase 1.

Milestone unchanged: **Core HR Phase 1 — UAT Passed With Pre-Production Actions**. PV-25 is no longer a pre-production blocker. **Production Ready is not declared**; the remaining Production Readiness gates are separate: Legal / Privacy review (Pending Legal Review items); Entra / identity configuration; security readiness; backup / restore; deployment / rollback; real-data readiness; configurable RBAC planning/implementation (C-85) as separately approved.

