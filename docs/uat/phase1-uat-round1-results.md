# Core HR Phase 1 — Business UAT Round 1 Results

- Baseline: tag `phase1-uat-ready` (commit `648e281`), milestone **Core HR Phase 1 — UAT Ready With Known Limitations**.
- Executed: 2026-10-10 (business date, Asia/Ho_Chi_Minh). Synthetic data only; no real employee data.
- **This is not a UAT acceptance.** Final UAT acceptance requires human HR confirmation, especially for the items marked *HUMAN VALIDATION*.
- No product code or business rule was changed during this round. The resolutions accepted afterwards are listed in *Round 1 resolutions (2026-10-10)* at the end.

## How the round was run

| Part | Where | How |
|---|---|---|
| Business flows UAT-01 to UAT-20, UAT-22 (data part), UAT-23 (API part) | `hrms_test`, freshly reset through the guard | Automated UAT suite `tests/uat/round1.test.ts` (`npm run test:uat-round1`, separate config, never mixed with the main suite). Every scenario drives the real API as HR_EDITOR / HR_ADMIN and checks the final database state. 22/22 scenario tests pass (run twice). |
| UI checks UAT-21 to UAT-24 | `hrms_dev`, controlled synthetic records | Browser pass with the development test identity. Records created (all prefixed `UAT`): ES0014 *UAT UI Visibility*, ES0015 *UAT UI History*, ES0016 *UAT UI Ended*, ES0017 *UAT UI Planned* (plus ES0013 from the hardening pass). `hrms_dev` was not reset. |

Synthetic names used in `hrms_test`: UAT Alice Employee, UAT Ben Contractor, UAT Bella Planned RC, UAT Carol Rehire, UAT Carla Planned Rehire, UAT Diana PreStart, UAT Evan Legacy, UAT Frank Concurrent, UAT Grace SameDay, UAT Hana History, UAT Manager Morgan/Future and supporting `UAT …` records. All emails use `@example.test`.

## Results

| UAT ID | Scenario | Role | Expected Result | Actual Result | Result | Finding Type | Severity | Evidence / notes |
|---|---|---|---|---|---|---|---|---|
| UAT-01 | Create profile-only person | HR_EDITOR | Person + Employee Code; no period, assignment or event | Created with code `ES…`, revision 1, 0 periods, audit `employee.create` only | PASS | PASS | None | |
| UAT-02 | Add Initial Employment (today, Employee) | HR_EDITOR | Same person/code, one period, Active, Start event, no assignment, completeness shows gaps | As expected; missing items included Department and Job Title | PASS | PASS | None | |
| UAT-03 | Add Initial Assignment | HR_EDITOR | Assignment on the period; list = detail; manager resolves; audit | ENG / SE / L2 + manager resolved; list shows ENG; audit `assignment.initial`; 1 row | PASS | PASS | None | |
| UAT-04 | Work Email add, update once, duplicate | HR_EDITOR | On the period; completeness complete; duplicate blocked; no raw email in audit | Complete after add; revision +1 per real change; duplicate (case-insensitive) → `409 WORK_EMAIL_IN_USE`; audit has field name only | PASS | PASS | None | |
| UAT-05 | Profile edit reason rules | HR_EDITOR | Phone/personal email/DOB fill: no reason; Full Name and DOB change: reason | 200/200/422→200/200/422→200; same-value edit leaves revision unchanged; no raw personal values in audit | PASS | PASS | None | |
| UAT-06 | Assignment Change; backdated by Editor | HR_EDITOR | New row, old row kept and closed, no gap/overlap, reason required; backdated denied | Old row (same id) closed at the change date; new row from that date; missing reason → 400; list still ENG before the change date; backdated → 403; audit structural values | PASS | PASS | None | |
| UAT-07 | End Employment; OTHER without note | HR_EDITOR | End date set, assignment closed at end + 1, metadata captured, reason in history, note hidden | Future end: still Active until then; row closed at end + 1; event metadata (previous end null, closed row, previous effective_to null); End Reason in history; note not exposed; OTHER without note → `NOTE_REQUIRED` | PASS | PASS | None | |
| UAT-08 | Admin-only actions as Editor | HR_EDITOR | Denied server-side | Period correction, assignment correction, Reverse End, Clear Work Email → 403 / 403 / 403 / 403 | PASS | PASS | None | |
| UAT-09 | Reverse End Employment | HR_ADMIN | Exact pre-End state; original End kept; End Reversed added | End date and every assignment row identical to before End; original End event byte-identical; `end_reversed` references it; End Reason preserved; reversal reason hidden; revision +1; one audit; integrity scan clean | PASS | PASS | None | |
| UAT-10 | Historical corrections | HR_ADMIN | Reason required; in-place; inactive values only in corrections; timeline kept; event sync | Blank reason → `REASON_REQUIRED`; Employee Type corrected; start date corrected and Start event synced; assignment effective_from moved the previous row; inactive Department accepted in correction, refused in Assignment Change (`NOT_ACTIVE`); no new rows | PASS | PASS | None | |
| UAT-11 | Clear legacy end date (no End event) | HR_ADMIN | Allowed with reason; no synthetic event | Cleared; no event created; last assignment reopened; Editor → 403 | PASS | PASS | None | |
| UAT-12 | Rehire after ended period (same type) | HR_EDITOR | Same person/code; new period; nothing copied; old period unchanged | As expected; Work Email and assignment not copied; old period, rows and events identical; reason required | PASS | PASS | None | |
| UAT-13 | Planned Rehire (different type) → Cancel → Rehire again | HR_EDITOR | Pre-start; cancel keeps history; email released; previous unchanged; Rehire again allowed | As expected; cancelled period keeps its assignment and events (Start → Planned start cancelled); its Work Email reused by another person immediately | PASS | PASS | None | |
| UAT-14 | Relationship Change Service Contractor → Employee | HR_EDITOR | Old end = new start − 1; RELATIONSHIP_CHANGE; nothing copied | As expected; old assignment closed at the new start | PASS | PASS | None | |
| UAT-15 | Planned Relationship Change recovery (P0) | HR_EDITOR / HR_ADMIN | Reverse End blocked → cancel successor → Reverse End restores exactly | `409 LATER_PERIOD_EXISTS` → cancel OK → Reverse End OK; old period and assignments identical to before; cancelled successor visible with its assignment | PASS | PASS | None | **P0 scenario passed.** |
| UAT-16 | Department display = filter with several periods | HR_EDITOR | A: ENG not QA; B: QA; C: QA; D: none | A shown ENG (QA filter 0, ENG 1); B shown QA (QA 1); C shown QA (QA 1, ENG 0); D none (ENG 0) | PASS | PASS | None | C-76 confirmed |
| UAT-17 | Pre-start with first assignment after the start date | HR_EDITOR | Observe, do not change | Before D1: Department **QA** shown and completeness **Complete**. Between D1 and D2: **Incomplete** (Department, Job Title, Work Email missing). After D2: only Work Email missing | HUMAN VALIDATION | BUSINESS_DECISION | Medium | See BD-1 |
| UAT-18 | Period starting today entered by mistake | HR_EDITOR | No Cancel Planned; no void workflow | Cancel Planned → `PERIOD_ALREADY_STARTED`; no void / Reverse Rehire endpoint; remaining actions are End Employment (records an End, not a void), Correct Period (HR_ADMIN, moves dates), Relationship Change | HUMAN VALIDATION | KNOWN_LIMITATION / BUSINESS_DECISION | High | PV-25 — see BD-2 |
| UAT-19 | Stale revision (two clients) | HR_EDITOR | `409 REVISION_CONFLICT`; no partial write | Client A 200; client B 409 `STALE_REVISION`; no row or audit from B; UI message: "This profile was changed by someone else. Reload…" | PASS | PASS | None | |
| UAT-20 | Cancelled manager reference | HR_EDITOR | Reference kept; resolution excludes; scan flags; no auto repair | Reference not rewritten; new reference → `MANAGER_NOT_EMPLOYED_ON_DATE`; scan: 1 warning `manager_not_employed_on_date` | PASS | KNOWN_LIMITATION | Low | C-73 expected behaviour |
| UAT-21 | Role visibility | HR_EDITOR / HR_ADMIN | Editor: operational actions only; Admin: + corrections and Reverse End | Editor never saw Correct Period / Correct / Reverse End Employment / Clear or Correct Work Email; Admin saw them where eligible; server enforcement also covered by UAT-08 and the permission matrix | PASS | PASS | None | See BD-5 |
| UAT-22 | History readability | HR_EDITOR | Deterministic, grouped, Cancelled not a status, End Reason shown, free text hidden | All automated checks pass (no free-text reason/note anywhere in the response). Readability concern: see UX-2 | HUMAN VALIDATION | UX | Medium | ES0015 in `hrms_dev` |
| UAT-23 | Error responses | HR_EDITOR / HR_ADMIN | Stable codes; no stack/SQL; actionable | All 9 probes: stable codes, no stack traces or SQL; messages name the next action. One misleading case: UX-1 | PASS | UX | Medium | |
| UAT-24 | Mobile smoke (375 px) | HR_EDITOR | No page overflow; Save/Cancel reachable; labels readable | List, detail and the Edit Profile / Change Assignment / End Employment / Relationship Change / Cancel Planned Period / Rehire forms: no page overflow, Save and Cancel within width, labels ≥ 12 px; the list table scrolls inside its card | PASS | PASS | None | See UX-3 |

## A. PASS SUMMARY

- **21 of 24** scenarios PASS (UAT-01 to UAT-16, UAT-19, UAT-20, UAT-21, UAT-23, UAT-24); **0 FAIL**; **3 HUMAN VALIDATION** (UAT-17, UAT-18, UAT-22).
- Automated UAT suite: 22/22 scenario tests pass (two consecutive runs). The P0 Relationship Change recovery (UAT-15) passes with exact restoration.
- Integrity: `hrms_test` after UAT → 0 errors, 1 warning, which is the **intentional** UAT-20 cancelled-manager reference; `hrms_dev` → **0 errors, 0 warnings**.
- Quality gate after the round: main suite 351/351 (three runs), clean integrity baseline 1/1, typecheck, lint, production build and OpenAPI generation all pass. Tag `phase1-uat-ready` unchanged.

## B. BUGS

**No confirmed deviation from an approved rule.**

Test defects found and corrected in the UAT suite itself (not product bugs): a name search that also matched a longer name (UAT-16), an assumed detail code (`STALE_REVISION`, UAT-23), an assumed error order for a gap after a normal End (UAT-23, now recorded as UX-1), and an invalid synthetic name in the UAT-17 evaluation.

## C. BUSINESS DECISIONS / HUMAN VALIDATION

| ID | Topic | Current behaviour | Question for HR |
|---|---|---|---|
| BD-1 | **Pre-start assignment vs Department completeness** (UAT-17) | Before the period start D1, the first assignment (starting at D2 > D1) already fills Department/Job Title, so the profile is *Complete*. From D1 until D2 no assignment is in effect, so it becomes *Incomplete*; after D2 it is complete again (except Work Email, which an Employee needs once started). | Should a future assignment that begins after the Employment Start Date satisfy Department completeness before D1? (Alternatives: require the assignment to start on the period start date, or show the gap explicitly.) |
| BD-2 | **PV-25 — effective period entered by mistake** (UAT-18) | A period starting today is effective: Cancel Planned Period is refused. There is no void or Reverse Rehire. HR can only End Employment (adds an End to the record), move the dates with Correct Period (HR_ADMIN), or change the relationship — none of which removes the mistaken record. | Highest operational priority to validate: how often does this happen, who may fix it, and what should a "void" look like in the history? |
| BD-3 | **Relationship Change right after a normal End Employment** (UAT-23 observation) | A period ended through End Employment always has an Active End Event, so a continuous Relationship Change starting the next day is blocked (`ACTIVE_END_EVENT_EXISTS`); HR must first Reverse End Employment and then run Relationship Change. The "exact next day" rule for ended periods (C-64 case C) therefore only applies to legacy periods. | Is "Reverse End, then Relationship Change" the intended procedure, or should a Relationship Change be possible directly after an End Employment? |
| BD-4 | **History with several End events** (UAT-22, UX-2) | Events are ordered by effective date, so the current End (e.g. 10 Sep) can appear above an earlier-recorded, later-dated End that was reversed (20 Oct) and its reversal. Nothing marks which End is reversed. | Is the history understandable for HR, or should reversed Ends be visually paired/marked? |
| BD-5 | **Planned Rehire offered while still Active** (UAT-21) | When an Active period has a known future end date, HR_EDITOR sees **Rehire** (planned Rehire, C-61). | Is it expected that Rehire is offered before the person has left? |

## D. KNOWN LIMITATIONS (confirmed in this round)

- No automatic **Reverse Relationship Change** after the new period has started (PV-24) — prioritise by real UAT frequency.
- No same-day **Cancel Planned Period**: a period starting today is effective (C-69) — confirmed by UAT-18.
- No **Reverse Rehire** and no void for an effective period (PV-25) — confirmed by UAT-18.
- No automatic repair of manager references to cancelled/ended periods (C-73) — confirmed by UAT-20 (reported by the integrity scan).
- No Assignment hard delete; no generic Employment Period delete.
- Relationship Change requires a known current Employee Type (C-68).
- Legal interpretation remains Pending Legal Review; Entra sign-in remains Pending IT Configuration; other Pending items in the decision register stay pending.

## UX findings proposed for a separate batch (not fixed in this round)

| ID | Finding | Severity | Proposal |
|---|---|---|---|
| UX-1 | API message for `ACTIVE_END_EVENT_EXISTS` from Relationship Change says "If it was recorded by mistake, use Reverse End Employment first" also when the person genuinely left (a gap), where Rehire is the right action. The UI hides Relationship Change in that state, so it mainly affects direct API use. | Medium | Mention Rehire for a genuine return in that message (copy only; code unchanged). Depends on BD-3. |
| UX-2 | Period history interleaves reversed and current End events (BD-4). | Medium | Mark reversed End events or show each End with its reversal — after HR feedback. |
| UX-3 | The Employee List ignores filter values in the URL (e.g. `?search=UAT`), so filtered lists cannot be shared as links. | Low | Optional; not required by Phase 1. |
| UX-4 | Future-dated End events read "End of employment — <date>" while the period badge still says Active. | Low | Consider "End of employment (planned)" for future dates — after HR feedback. |

## Recommendation

**UAT ROUND 1 PASSED WITH BUSINESS DECISIONS REQUIRED**

No blocking bugs were found and the P0 recovery scenario passes. HR must decide BD-1 to BD-5 (with BD-2 / PV-25 the most important), and confirm the history readability before final UAT acceptance. Not "UAT Passed"; not production ready.

## Round 1 resolutions (2026-10-10)

Round 1 was accepted (21/24 PASS, 0 FAIL, 3 human/business validation). **This is still not full UAT acceptance**; UAT Round 2 follows. Decisions are recorded in `docs/decision-register.md`.

| Item | Resolution | Status |
|---|---|---|
| UAT-17 / BD-1 Pre-start completeness | **Business decision resolved (C-78):** for a Pre-start period an assignment counts for Department / Job Title completeness only if it is ready on the Employment Start Date (`first assignment effective_from <= start date`). The profile stays incomplete from the beginning (no complete → incomplete → complete). Department display and filter keep C-76. | Implemented (`c450f35`); regression tests; UAT-17 assertion updated |
| UAT-18 / BD-2 PV-25 | **HIGH PRIORITY — must be resolved before production readiness.** Not implemented. Must not be solved by DELETE, a same-day Cancel Planned exception, a fake End Employment, Rehire or date manipulation. Likely direction: explicit *Void Effective Employment Period* — design after UAT Round 2. | Unresolved (by decision) |
| BD-3 Relationship Change after End | **Current procedure confirmed (C-79):** an Active End Event keeps blocking Relationship Change; if the relationship was actually continuous: (1) Reverse End Employment, (2) Relationship Change. | Confirmed; guidance improved (UX-1) |
| UX-1 Gap guidance | A gap after a recorded End now says "use Rehire"; a continuous start says "Reverse End Employment first, then Relationship Change". Stable code `ACTIVE_END_EVENT_EXISTS` unchanged. | Fixed (`84dfc8e`) |
| BD-4 / UX-2 History readability | **UX fix approved and implemented (C-80):** reversed End events are struck through with a *Reversed* badge, the current End has a *Current end* badge, and *End of employment reversed* names the End it reverses. Order and data unchanged. | Fixed (`757dc21`) |
| UX-3 URL filters | Employee List reads and keeps search / status / department / page in the URL. Count copy fixed ("Profiles found: N"). | Fixed (`2bfeb32`) |
| UX-4 Future End label | A future-dated End reads *Planned end of employment*; once effective, *End of employment* (display only). | Fixed (`757dc21`) |
| BD-5 / UX-5 Planned Rehire | **Behaviour confirmed (C-61, C-81).** When the previous period ends in the future the action is shown as *Plan Rehire* with "The current employment is scheduled to end on <date>. This will create a future employment period starting after that date." Same API. | UX clarification implemented |

Next: **UAT Round 2** (human HR confirmation). PV-25 design only after Round 2.

