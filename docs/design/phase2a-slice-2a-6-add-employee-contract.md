# Slice 2A-6 — Add Employee + optional Contract Draft (implementation record)

- Status: **Implemented (2026-10-16), awaiting owner visual / UAT checkpoint.** Register C-117. Builds on UI-8 (Add Employee wizard, `docs/design/ui-refresh-implementation-map.md` §17), C-109 (staged slices; 2A-6 = optional Contract Draft in Add Employee), C-44, C-115, C-116. Not started: Phase 2B, Amendment, early termination, documents/templates/e-signature, self-service, AI, Entra, real Contract data.

## 1. Wizard

Personal → Employment → Assignment → **Contract (optional)** → Review. The Contract step appears only with `contracts.manage`; without it the wizard is the unchanged Phase 1 four-step flow and Review shows *Contract Draft — Optional: Not available for your account … the employee is saved as usual*. Personal / Employment / Assignment fields and their rules are unchanged. The shared `Stepper` now sizes its columns from the number of steps (four steps look as before) and lets a long label wrap instead of truncating.

Contract step: one checkbox **Create a Contract Draft for this employee**, off by default, with the explanation that the employee is saved first and the Draft is a separate step that stays a Draft (not finalized, signed or legally approved). It needs an Employment Period (a Start Date); without one the checkbox is disabled with an explanation. When on, Phase 2A Draft fields only: Contract Type (**active types only**), Contract Number (blank, never generated), Effective From (**defaults to the Employment Start Date**, follows it until HR changes it, must not be before it), End of term — **HR must choose** *Ends on a date* (then Effective To) or *Open-ended* (nothing is derived from Employee Type or Contract Type), Summary. No salary, ID, address, clauses, templates, documents or amendment data.

Review adds a **Contract Draft — Optional** section: whether a Draft will be created ("Will be created after the employee is saved"), Contract Type, Contract Number or "Not assigned yet", Effective From, End of term; or "No Contract Draft will be created. The employee does not need a contract to be saved." A note explains the separation and that a failed Draft leaves the employee saved.

## 2. Submission model (`src/app/employees/new/onboardingSubmit.ts`)

Two independent operations; no combined transaction, no rollback, no new API:

1. `POST /employees` — the existing atomic Add Employee with its own Idempotency-Key (unchanged per-content key).
2. Only if (1) succeeded **and** a Draft was requested: `POST /contracts` with its own Idempotency-Key and `employment_id` = the Employment Period id **returned by (1)** (the only non-disposed period of the new person, starting on the requested Start Date). If the response does not identify exactly that period, nothing is sent (`no_period`) and HR is pointed to the employee's Contracts tab — the period is never inferred later from dates or status. The browser never supplies a person or period of its own.

The Contract API re-validates everything against the created period (e.g. Effective From before the period start → `EFFECTIVE_FROM_OUTSIDE_PERIOD`; duplicate number → `DUPLICATE_CONTRACT_NUMBER`). The Draft is exactly a Draft: no Finalize, no Confirm Signed, no effect on Employment status, assignment or Record Health, no reminders (Drafts are excluded from every reminder, M-20).

## 3. Outcomes

| Outcome | What HR sees |
|---|---|
| Employee fails | The unchanged Phase 1 failure ("Nothing was saved", field errors on their step, retry safe). **No Contract request is made.** |
| A — employee created, no Draft requested | Unchanged Phase 1 result: the new record's Overview with "Employee record created." (see §8, interpretation 1). |
| B — employee + Draft created | Result screen *Employee saved*: ✓ **Employee created successfully.** ✓ **Contract Draft created successfully.** (still a Draft); buttons *Open Contract Draft*, *Open employee*. |
| C — employee created, Draft not created | ✓ **Employee created successfully.** ! **Contract Draft could not be created.** "The employee record is saved and was not affected." + the server's reason; buttons *Open employee* (Contracts tab), *Review contract details* (the kept contract form), *Retry Contract Draft*. Never "employee creation failed". |

## 4. Retry and idempotency

- Separate scopes: the employee key and the contract key are different values (enforced: the submission refuses equal keys before any request); the server scopes idempotency by actor + operation + key as well.
- One contract key per onboarding, reused by every retry. *Retry Contract Draft* repeats **only** `POST /contracts`; it never resubmits Add Employee.
- A definite rejection leaves the key unused (existing behaviour), so HR can correct the details and retry with the same key.
- An uncertain result (network / 5xx) → "it is not known whether the Contract Draft was created. Retrying is safe …"; retrying the same request replays the same Draft. If HR changed the details after an uncertain result and the first attempt had in fact been processed, the server answers `IDEMPOTENCY_KEY_REUSED`; the UI then says a Draft may already exist and offers no further retry — never a second Draft.
- An uncertain Add Employee result keeps the Phase 1 behaviour (save again with the same key → replay); the Contract request runs once, after the replayed success.

## 5. Permissions

The Contract step needs `employees.create` (the page) and `contracts.manage`. Without `contracts.manage` Add Employee works exactly as in Phase 1 and the step is omitted with the Review note; the server independently refuses `POST /contracts` without `contracts.manage`. No role-name checks.

## 6. C-44 alignment (Contract Type in Correction)

`contractTypeOptions` in `src/app/contracts/contractModel.ts`:

| Screen | Choices |
|---|---|
| Correct contract (historical Correction, Signed) | Active **and** inactive types; inactive labelled e.g. "Fixed-term Contract (Inactive)". API semantics unchanged (C-44). |
| Create Draft, Renew, Add Employee Contract step | Active types only. |
| Edit Draft | Active types only; a Draft's current inactive type is shown labelled "(Inactive)" but **not selectable** (the server already blocks Finalize on it). |

## 7. Tests

- `tests/integration/add-employee-contract.test.ts` (8) — the browser's submission module against the real route handlers on `hrms_test`: Add Employee without a Draft (one request); Employee + Draft (period id from the response, separate keys, a pure Draft, employee unaffected, no reminders); employee failure → no Contract request; Contract failure → partial success, employee intact, server re-validation, Contract-only retry with the same key, no duplicate employee or Draft; lost Contract response → retry replays the same Draft; changed details after a lost response → `IDEMPOTENCY_KEY_REUSED`, no second Draft; lost Add Employee response → replay, Draft created once; one shared key refused.
- `tests/unit/add-employee-contract.test.ts` (18) — optionality and permissions, defaults (Effective From follows Start Date, blank number, no term invented), client checks, Draft fields only, period from the response, active types only, the five outcomes with a fake server, Contract-only retry, separate keys, Review and result wording, no Finalize / Confirm Signed.
- `tests/unit/add-employee-wizard.test.ts` — Phase 1 regression with the four Phase 1 steps for users without `contracts.manage`; five steps with it; capabilities.
- `tests/unit/contract-ui.test.ts` — C-44 choices per mode and per screen.
- Full regression: see the slice report (typecheck, lint, all unit + integration suites, UAT rounds 1–2, integrity baseline and scan, build).
- There is no separate Contract UAT harness; Contract scenarios are covered by the Contract integration suites and the browser walkthrough.

## 8. Interpretations recorded (no new business rule)

1. **Outcome A keeps the Phase 1 result** (navigate to the new Overview with its success notice) — the owner asked to preserve the Phase 1 flow for users who do not choose a Draft; the explicit result screen is used whenever a Draft was requested (B / C). A result screen for A too is a one-line change if the owner prefers it.
2. The Contract step requires an Employment Period (a Draft always documents a period); a profile-only Add Employee cannot request a Draft.
3. *End of term* must be chosen in the wizard (owner instruction: HR chooses; nothing assumed), although a Draft created elsewhere may still leave it empty.
4. Edit Draft shows a current inactive type as non-selectable (stricter wording of "only active types" — previously it stayed selectable as the existing value).

## 9. Browser review (synthetic data, local Test HR Editor)

Contract step off by default; client check "Choose Ends on a date or Open-ended."; active types only; Effective From prefilled 02 Nov 2026 from the Start Date. Review section as specified. Save with an already-used number SYN-HD-2026-001 → partial success C (employee *Trần Minh Onboard* ES0038 created; Draft refused with the duplicate-number reason); *Review contract details* kept the form; number changed to SYN-HD-2026-007 → *Retry Contract Draft* → B. Network log: one `POST /employees` (201), `POST /contracts` 409, `POST /contracts` 201 — Add Employee never resent. The Draft is linked to ES0038's period from 02 Nov 2026, Draft state, only "Contract created" in history. Widths 1440 / 1366 / 1280 / 900 / 768 / 390 / 375: no page-level horizontal overflow on the Contract step, Review and the partial-success screen; stepper one row from 768 up, two columns on phones; result buttons stack on phones.
