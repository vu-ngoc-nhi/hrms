import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACTS_PATH, EMPLOYEES_PATH, createContractDraft, createdPeriodId, submitOnboarding, type PostFn } from "@/app/employees/new/onboardingSubmit";
import {
  EMPTY_CONTRACT,
  EMPTY_VALUES,
  buildPayload,
  contractDraftBody,
  contractEffectiveFrom,
  contractErrors,
  isDirty,
  stepsFor,
  wizardCapabilities,
  type ContractStepValues,
  type WizardValues,
} from "@/app/employees/new/wizardModel";
import { t } from "@/i18n";
import { ApiCallError } from "@/lib/client/api";

// Slice 2A-6: optional Contract Draft in Add Employee — model, defaults, checks and the two-operation submission.
/** Source without comment lines, so wording checks look at code only. */
const code = (f: string) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
const v = (o: Partial<WizardValues> = {}): WizardValues => ({ ...EMPTY_VALUES, full_name: "Synthetic Person", start_date: "2026-11-02", ...o });
const c = (o: Partial<ContractStepValues> = {}): ContractStepValues => ({ ...EMPTY_CONTRACT, enabled: true, ...o });
const PERIOD = "11111111-1111-4111-8111-111111111111";
const created = { id: "p-1", employments: [{ id: PERIOD, start_date: "2026-11-02", cancelled_at: null, voided_at: null }] };

/** Fake server: records calls; answers per path. */
function fake(answers: Partial<Record<string, (body: Record<string, unknown>) => unknown>>) {
  const calls: { path: string; key: string; body: Record<string, unknown> }[] = [];
  const post: PostFn = async (path, body, key) => {
    const parsed = JSON.parse(body);
    calls.push({ path, key, body: parsed });
    return answers[path]!(parsed);
  };
  return { post, calls };
}
const reject = (status: number, error: string) => () => {
  throw new ApiCallError(status, { error, message: error, request_id: "r" } as never);
};

describe("Optionality and permissions", () => {
  it("the Contract step exists only with contracts.manage; Add Employee never needs it", () => {
    const can = (set: string[]) => (p: string) => set.includes(p);
    expect(stepsFor(wizardCapabilities(can(["employees.create"])))).toEqual(["personal", "employment", "assignment", "review"]);
    expect(stepsFor(wizardCapabilities(can(["employees.create", "contracts.manage"])))).toEqual(["personal", "employment", "assignment", "contract", "review"]);
  });
  it("off by default; when off it adds no checks and nothing to the employee request", () => {
    expect(EMPTY_CONTRACT.enabled).toBe(false);
    expect(contractErrors(v(), EMPTY_CONTRACT)).toEqual({});
    expect(contractErrors(v({ start_date: "" }), EMPTY_CONTRACT)).toEqual({});
    expect(isDirty(EMPTY_VALUES, EMPTY_CONTRACT)).toBe(false);
    expect(isDirty(EMPTY_VALUES, c())).toBe(true);
    // The employee request is the unchanged Phase 1 payload: no contract field ever enters it.
    expect(JSON.stringify(buildPayload(v(), { writePersonal: true, setCode: false }))).not.toMatch(/contract|effective_to|is_open_ended/);
  });
  it("a user without contracts.manage gets a clear Review note, never a blocked save", () => {
    expect(t("wizard.review.contractUnavailable")).toMatch(/Not available for your account.*the employee is saved as usual/);
    const page = readFileSync("src/app/employees/new/page.tsx", "utf8");
    expect(page).toContain('!caps.createContract ? t("wizard.review.contractUnavailable")');
    expect(page).toContain("const wantsContract = caps.createContract && c.enabled;");
  });
});

describe("Defaults (no invented values)", () => {
  it("Effective From follows the Employment Start Date until HR changes it; number blank; no term chosen", () => {
    expect(EMPTY_CONTRACT).toMatchObject({ contract_number: "", effective_from: null, term: "", effective_to: "", contract_type_id: "" });
    expect(contractEffectiveFrom(v(), c())).toBe("2026-11-02");
    expect(contractEffectiveFrom(v({ start_date: "2026-12-01" }), c())).toBe("2026-12-01");
    expect(contractEffectiveFrom(v(), c({ effective_from: "2026-11-15" }))).toBe("2026-11-15");
  });
  it("HR must choose Ends on a date or Open-ended — no duration from Employee Type or Contract Type", () => {
    expect(contractErrors(v(), c()).term).toBe("wizard.contract.error.termRequired");
    expect(contractErrors(v(), c({ term: "fixed" })).effective_to).toBe("wizard.contract.error.effectiveToRequired");
    expect(contractErrors(v(), c({ term: "open" }))).toEqual({});
    const model = code("src/app/employees/new/wizardModel.ts");
    expect(model).not.toMatch(/employee_type_id[^\n]*term|addDays|addMonths|duration/);
  });
});

describe("Client checks (convenience only; the Contract API re-validates)", () => {
  it("needs an Employment Period; Effective From not before the Start Date; Effective To not before Effective From", () => {
    expect(contractErrors(v({ start_date: "" }), c()).enabled).toBe("wizard.contract.error.needsEmployment");
    expect(contractErrors(v(), c({ effective_from: "2026-11-01", term: "open" })).effective_from).toBe("wizard.contract.error.beforeStart");
    expect(contractErrors(v(), c({ term: "fixed", effective_to: "2026-11-01" })).effective_to).toBe("contracts.form.error.effectiveTo");
    expect(contractErrors(v(), c({ term: "fixed", effective_to: "2027-11-01" }))).toEqual({});
  });
});

describe("Contract Draft request", () => {
  it("Phase 2A Draft fields only; the period is the server-returned id, never a form value", () => {
    const body = contractDraftBody(PERIOD, v(), c({ contract_type_id: "t1", contract_number: " HD-9 ", term: "fixed", effective_to: "2027-11-01", summary: " note " }));
    expect(body).toEqual({ employment_id: PERIOD, contract_type_id: "t1", contract_number: "HD-9", effective_from: "2026-11-02", effective_to: "2027-11-01", summary: "note" });
    expect(contractDraftBody(PERIOD, v(), c({ term: "open" }))).toEqual({ employment_id: PERIOD, effective_from: "2026-11-02", is_open_ended: true });
    expect(Object.keys(body).some((k) => /salary|passport|address|clause|template|document|amend|person|employee/.test(k))).toBe(false);
  });
  it("the created period is taken from the Add Employee response; anything ambiguous is never guessed", () => {
    expect(createdPeriodId(created, "2026-11-02")).toBe(PERIOD);
    expect(createdPeriodId({ id: "p", employments: [] }, "2026-11-02")).toBeNull();
    expect(createdPeriodId(created, "2026-11-03")).toBeNull();
    expect(createdPeriodId({ id: "p", employments: [...created.employments, { id: "x", start_date: "2026-11-02" }] }, "2026-11-02")).toBeNull();
  });
  it("the Add Employee and Contract steps use only active Contract Types", () => {
    expect(readFileSync("src/app/employees/new/page.tsx", "utf8")).toContain('contractTypeOptions(typeRows ?? [], "new")');
  });
});

describe("Two independent operations", () => {
  const input = (contract: boolean) => ({
    employeePayload: JSON.stringify({ full_name: "Synthetic Person", employment: { start_date: "2026-11-02" } }),
    employeeKey: "emp-key-0001",
    startDate: "2026-11-02",
    contract: contract ? { key: "ctr-key-0001", body: (id: string) => contractDraftBody(id, v(), c({ term: "open" })) } : null,
  });

  it("A: no Contract requested → one request (Add Employee)", async () => {
    const f = fake({ [EMPLOYEES_PATH]: () => created });
    expect(await submitOnboarding(f.post, input(false))).toEqual({ kind: "employee_created", personId: "p-1", employmentId: PERIOD, contract: null });
    expect(f.calls.map((x) => x.path)).toEqual([EMPLOYEES_PATH]);
  });
  it("B: employee then Contract Draft, separate keys, period id from the response", async () => {
    const f = fake({ [EMPLOYEES_PATH]: () => created, [CONTRACTS_PATH]: () => ({ id: "k-1" }) });
    const out = await submitOnboarding(f.post, input(true));
    expect(out).toEqual({ kind: "employee_created", personId: "p-1", employmentId: PERIOD, contract: { status: "created", contractId: "k-1" } });
    expect(f.calls.map((x) => [x.path, x.key])).toEqual([
      [EMPLOYEES_PATH, "emp-key-0001"],
      [CONTRACTS_PATH, "ctr-key-0001"],
    ]);
    expect(f.calls[1].body.employment_id).toBe(PERIOD);
  });
  it("employee failure → no Contract call", async () => {
    const f = fake({ [EMPLOYEES_PATH]: reject(422, "VALIDATION_ERROR"), [CONTRACTS_PATH]: () => ({ id: "never" }) });
    expect((await submitOnboarding(f.post, input(true))).kind).toBe("employee_failed");
    expect(f.calls.map((x) => x.path)).toEqual([EMPLOYEES_PATH]);
  });
  it("C: employee success + Contract failure is a partial success; uncertain and already-used results are told apart", async () => {
    const definite = await submitOnboarding(fake({ [EMPLOYEES_PATH]: () => created, [CONTRACTS_PATH]: reject(422, "EFFECTIVE_FROM_OUTSIDE_PERIOD") }).post, input(true));
    expect(definite).toMatchObject({ kind: "employee_created", personId: "p-1", contract: { status: "failed", uncertain: false, keyUsed: false } });
    const network = await submitOnboarding(
      fake({
        [EMPLOYEES_PATH]: () => created,
        [CONTRACTS_PATH]: () => {
          throw new TypeError("Failed to fetch");
        },
      }).post,
      input(true),
    );
    expect(network).toMatchObject({ kind: "employee_created", contract: { status: "failed", uncertain: true, keyUsed: false } });
    const used = await submitOnboarding(fake({ [EMPLOYEES_PATH]: () => created, [CONTRACTS_PATH]: reject(409, "IDEMPOTENCY_KEY_REUSED") }).post, input(true));
    expect(used).toMatchObject({ contract: { status: "failed", keyUsed: true } });
    const noPeriod = fake({ [EMPLOYEES_PATH]: () => ({ id: "p-2", employments: [] }), [CONTRACTS_PATH]: () => ({ id: "never" }) });
    expect(await submitOnboarding(noPeriod.post, input(true))).toMatchObject({ contract: { status: "no_period" } });
    expect(noPeriod.calls.map((x) => x.path)).toEqual([EMPLOYEES_PATH]);
  });
  it("Retry repeats ONLY the Contract request, with the same contract key", async () => {
    const f = fake({ [CONTRACTS_PATH]: () => ({ id: "k-2" }) });
    expect(await createContractDraft(f.post, contractDraftBody(PERIOD, v(), c({ term: "open" })), "ctr-key-0001")).toEqual({ status: "created", contractId: "k-2" });
    expect(f.calls.map((x) => [x.path, x.key])).toEqual([[CONTRACTS_PATH, "ctr-key-0001"]]);
    const page = readFileSync("src/app/employees/new/page.tsx", "utf8");
    expect(page).toContain("createContractDraft(post, contractDraftBody(result.employmentId, v, c), contractKey.current!)");
  });
  it("one key for both operations is refused before any request", async () => {
    const f = fake({ [EMPLOYEES_PATH]: () => created });
    await expect(submitOnboarding(f.post, { ...input(true), contract: { key: "emp-key-0001", body: () => ({}) } })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});

describe("Review and result wording", () => {
  it("Review shows a separate optional Contract Draft section and never implies a contract is required", () => {
    expect(t("wizard.review.contractTitle")).toBe("Contract Draft — Optional");
    expect(t("wizard.review.notAssigned")).toBe("Not assigned yet");
    expect(t("wizard.review.contractNone")).toMatch(/does not need a contract/);
    const page = readFileSync("src/app/employees/new/page.tsx", "utf8");
    for (const k of ["wizard.review.contractWillCreate", "contracts.fields.contractType", "contracts.fields.contractNumber", "contracts.fields.effectiveFrom", "contracts.form.termLabel"]) expect(page).toContain(k);
  });
  it("partial success can never read as an employee failure", () => {
    expect(t("wizard.result.employeeCreated")).toBe("Employee created successfully.");
    expect(t("wizard.result.contractCreated")).toBe("Contract Draft created successfully.");
    expect(t("wizard.result.contractFailed")).toBe("Contract Draft could not be created.");
    expect(t("wizard.result.employeeIntact")).toMatch(/saved and was not affected/);
    const result = code("src/app/employees/new/OnboardingResult.tsx");
    expect(result).toContain('t("wizard.result.retryContract")');
    expect(result).toContain('t("wizard.result.openEmployee")');
    expect(result).toContain('t("wizard.result.reviewDetails")');
    expect(result).not.toMatch(/nothingSaved|creation failed/i);
  });
  it("the Draft stays a Draft: no Finalize or Confirm Signed during onboarding", () => {
    const src = ["onboardingSubmit.ts", "page.tsx", "OnboardingResult.tsx"].map((f) => code(`src/app/employees/new/${f}`)).join("\n");
    expect(src).not.toMatch(/\/finalize|confirm-signed|signed_at/);
  });
});
