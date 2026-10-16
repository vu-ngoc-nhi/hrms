import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as remindersRoute } from "@/app/api/v1/core-hr/contract-reminders/route";
import { GET as getContractRoute } from "@/app/api/v1/core-hr/contracts/[id]/route";
import { POST as createContractRoute } from "@/app/api/v1/core-hr/contracts/route";
import { GET as getEmployeeRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { POST as createEmployeeRoute } from "@/app/api/v1/core-hr/employees/route";
import { CONTRACTS_PATH, EMPLOYEES_PATH, createContractDraft, submitOnboarding, type PostFn } from "@/app/employees/new/onboardingSubmit";
import { buildPayload, contractDraftBody, EMPTY_CONTRACT, EMPTY_VALUES, type ContractStepValues, type WizardValues } from "@/app/employees/new/wizardModel";
import { addDays, todayInVietnam } from "@/lib/dates";
import { ApiCallError } from "@/lib/client/api";
import { db } from "@/lib/db";
import { EmployeeCreateSchema } from "@/contracts/core-hr/schemas";
import { createEmployee } from "@/modules/core-hr/people/service";
import { wantsContractDraft, wizardCapabilities } from "@/app/employees/new/wizardModel";
import { call, catalogIds, key, principalWith, type TestUser } from "../helpers";

// Slice 2A-6: Add Employee + optional Contract Draft, end to end. The browser's own submission module
// (onboardingSubmit.ts) runs against the real route handlers on hrms_test, so the two-operation model, the separate
// idempotency scopes, partial success and Contract-only retry are exercised as the wizard performs them.
// Synthetic data only.
const today = todayInVietnam();
let typeA: string;
let ids: Awaited<ReturnType<typeof catalogIds>>;
let seq = 0;

beforeAll(async () => {
  typeA = (await db().contractType.findFirstOrThrow({ where: { code: "TEST_TYPE_A" } })).id;
  ids = await catalogIds();
});
afterAll(async () => {
  /* the shared client is closed by the test runner */
});

type Call = { path: string; key: string; body: Record<string, unknown> };
/** A PostFn over the route handlers. `loseResponse` simulates a network failure AFTER the server processed the request. */
function server(user: TestUser = "editor", opts: { loseResponseFor?: string } = {}) {
  const calls: Call[] = [];
  const routes: Record<string, typeof createEmployeeRoute> = { [EMPLOYEES_PATH]: createEmployeeRoute, [CONTRACTS_PATH]: createContractRoute };
  let lost = false;
  const post: PostFn = async (path, body, idempotencyKey) => {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    calls.push({ path, key: idempotencyKey, body: parsed });
    const r = await call(routes[path], { path, method: "POST", user, body: parsed, headers: { "idempotency-key": idempotencyKey } });
    if (opts.loseResponseFor === path && !lost) {
      lost = true;
      throw new TypeError("Failed to fetch"); // the request reached the server; the answer never arrived
    }
    if (r.status >= 300) throw new ApiCallError(r.status, r.body);
    return r.body;
  };
  return { post, calls };
}

const person = (o: Partial<WizardValues> = {}): WizardValues => {
  seq += 1;
  return { ...EMPTY_VALUES, full_name: `Synthetic Onboarding ${seq} ${Date.now()}`, start_date: addDays(today, 10), ...o };
};
const contract = (o: Partial<ContractStepValues> = {}): ContractStepValues => ({ ...EMPTY_CONTRACT, enabled: true, contract_type_id: typeA, term: "fixed", effective_to: addDays(today, 375), ...o });
const ALL = { writePersonal: true, setCode: false };
const employeeCount = async (fullName: string) => db().person.count({ where: { fullName } });

async function onboard(v: WizardValues, c: ContractStepValues | null, srv = server(), keys = { employee: key("emp"), contract: key("ctr") }) {
  const outcome = await submitOnboarding(srv.post, {
    employeePayload: JSON.stringify(buildPayload(v, ALL)),
    employeeKey: keys.employee,
    startDate: v.start_date,
    contract: c ? { key: keys.contract, body: (employmentId) => contractDraftBody(employmentId, v, c) } : null,
  });
  return { outcome, srv, keys };
}

describe("Add Employee without a Contract Draft (Phase 1 behaviour preserved)", () => {
  it("one request only: the existing atomic Add Employee", async () => {
    const v = person({ department_id: ids.d.ENG, job_title_id: ids.j.SE });
    const { outcome, srv } = await onboard(v, null);
    expect(outcome).toMatchObject({ kind: "employee_created", contract: null });
    expect(srv.calls.map((c) => c.path)).toEqual([EMPLOYEES_PATH]);
    expect(await db().contract.count({ where: { employment: { personId: (outcome as { personId: string }).personId } } })).toBe(0);
  });
});

describe("Employee success + Contract Draft success", () => {
  it("links the Draft to the Employment Period returned by Add Employee; separate keys; exactly a Draft with no side effects", async () => {
    const v = person({ department_id: ids.d.ENG, job_title_id: ids.j.SE });
    const { outcome, srv, keys } = await onboard(v, contract());
    if (outcome.kind !== "employee_created" || outcome.contract?.status !== "created") throw new Error(JSON.stringify(outcome));
    expect(srv.calls.map((c) => [c.path, c.key])).toEqual([
      [EMPLOYEES_PATH, keys.employee],
      [CONTRACTS_PATH, keys.contract],
    ]);
    expect(keys.employee).not.toBe(keys.contract);

    const period = await db().employment.findFirstOrThrow({ where: { personId: outcome.personId } });
    expect(outcome.employmentId).toBe(period.id);
    expect(srv.calls[1].body.employment_id).toBe(period.id);

    const draft = (await call(getContractRoute, { path: `${CONTRACTS_PATH}/${outcome.contract.contractId}`, user: "editor", params: { id: outcome.contract.contractId } })).body;
    expect(draft).toMatchObject({
      employee: { person_id: outcome.personId },
      employment: { id: period.id },
      contract_type: { id: typeA },
      contract_number: null, // never generated
      effective_from: v.start_date, // default = Employment Start Date
      state: { document_state: "draft", disposition: null, time_state: null },
      signed_at: null,
      finalized_at: null,
    });
    // No contract side effects: the employee record is identical before and after the Draft exists.
    const employeeNow = (await call(getEmployeeRoute, { path: `${EMPLOYEES_PATH}/${outcome.personId}`, user: "editor", params: { id: outcome.personId } })).body;
    const fresh = await onboard(person({ full_name: v.full_name + " twin", department_id: ids.d.ENG, job_title_id: ids.j.SE }), null);
    const twin = (await call(getEmployeeRoute, { path: `${EMPLOYEES_PATH}/${(fresh.outcome as { personId: string }).personId}`, user: "editor", params: { id: (fresh.outcome as { personId: string }).personId } })).body;
    expect(employeeNow.employments[0].period_lifecycle).toBe(twin.employments[0].period_lifecycle);
    expect(employeeNow.completeness).toEqual(twin.completeness);
    expect(employeeNow.employments[0].assignments?.length ?? 0).toBe(twin.employments[0].assignments?.length ?? 0);
    // Not an operational contract: no reminders.
    const reminders = (await call(remindersRoute, { path: "/api/v1/core-hr/contract-reminders", user: "editor" })).body;
    for (const signal of ["expiring_soon", "awaiting_signature", "needs_review"]) {
      expect(reminders[signal].items.map((i: { id: string }) => i.id), signal).not.toContain(outcome.contract.contractId);
    }
  });
});

describe("Employee failure", () => {
  it("no Contract request is made when Add Employee fails", async () => {
    const v = person({ work_email: "not-an-email" }); // invalid → the server refuses Add Employee
    const { outcome, srv } = await onboard(v, contract());
    expect(outcome.kind).toBe("employee_failed");
    expect(srv.calls.map((c) => c.path)).toEqual([EMPLOYEES_PATH]);
    expect(await employeeCount(v.full_name)).toBe(0);
  });
});

describe("Employee success + Contract failure (partial success) and Contract-only retry", () => {
  it("the server re-validates against the created period; the employee stays; retry repeats only the Contract request with the same key", async () => {
    const v = person();
    const c = contract({ effective_from: addDays(today, 5) }); // before the created period's start → refused by the Contract API
    const { outcome, srv, keys } = await onboard(v, c);
    if (outcome.kind !== "employee_created" || outcome.contract?.status !== "failed") throw new Error(JSON.stringify(outcome));
    expect(outcome.contract.error?.body.error).toBe("EFFECTIVE_FROM_OUTSIDE_PERIOD");
    expect(outcome.contract).toMatchObject({ uncertain: false, keyUsed: false });
    expect(await employeeCount(v.full_name)).toBe(1); // employee intact
    expect((await call(getEmployeeRoute, { path: `${EMPLOYEES_PATH}/${outcome.personId}`, user: "editor", params: { id: outcome.personId } })).status).toBe(200);

    // HR reviews the contract details (form data kept) and retries: Contract request only, same contract key.
    const fixed = { ...c, effective_from: null };
    const retry = await createContractDraft(srv.post, contractDraftBody(outcome.employmentId!, v, fixed), keys.contract);
    expect(retry.status).toBe("created");
    expect(srv.calls.map((x) => x.path)).toEqual([EMPLOYEES_PATH, CONTRACTS_PATH, CONTRACTS_PATH]);
    expect(srv.calls.filter((x) => x.path === CONTRACTS_PATH).map((x) => x.key)).toEqual([keys.contract, keys.contract]);
    expect(await employeeCount(v.full_name)).toBe(1); // retry never duplicated the employee
    expect(await db().contract.count({ where: { employmentId: outcome.employmentId! } })).toBe(1);
  });

  it("an uncertain Contract result (lost response) is resolved by idempotency: retry returns the SAME draft, no duplicate", async () => {
    const v = person();
    const srv = server("editor", { loseResponseFor: CONTRACTS_PATH });
    const { outcome, keys } = await onboard(v, contract(), srv);
    if (outcome.kind !== "employee_created" || outcome.contract?.status !== "failed") throw new Error(JSON.stringify(outcome));
    expect(outcome.contract).toMatchObject({ uncertain: true, keyUsed: false });
    const retry = await createContractDraft(srv.post, contractDraftBody(outcome.employmentId!, v, contract()), keys.contract);
    if (retry.status !== "created") throw new Error(JSON.stringify(retry));
    expect(await db().contract.count({ where: { employmentId: outcome.employmentId! } })).toBe(1);
    expect(await employeeCount(v.full_name)).toBe(1);
  });

  it("after an uncertain result, changed details with the same key are refused (IDEMPOTENCY_KEY_REUSED) instead of creating a second draft", async () => {
    const v = person();
    const srv = server("editor", { loseResponseFor: CONTRACTS_PATH });
    const { outcome, keys } = await onboard(v, contract(), srv);
    if (outcome.kind !== "employee_created") throw new Error(JSON.stringify(outcome));
    const changed = await createContractDraft(srv.post, contractDraftBody(outcome.employmentId!, v, contract({ summary: "edited after the lost answer" })), keys.contract);
    expect(changed).toMatchObject({ status: "failed", keyUsed: true });
    expect(await db().contract.count({ where: { employmentId: outcome.employmentId! } })).toBe(1);
  });

  it("an uncertain Add Employee result is retried with the employee key only; the Contract runs once after the replayed success", async () => {
    const v = person();
    const srv = server("editor", { loseResponseFor: EMPLOYEES_PATH });
    const keys = { employee: key("emp"), contract: key("ctr") };
    const first = await onboard(v, contract(), srv, keys);
    expect(first.outcome.kind).toBe("employee_failed");
    expect(srv.calls.map((c) => c.path)).toEqual([EMPLOYEES_PATH]); // no Contract request yet
    const second = await onboard(v, contract(), srv, keys); // "Save" again: same payload, same employee key → replay
    if (second.outcome.kind !== "employee_created" || second.outcome.contract?.status !== "created") throw new Error(JSON.stringify(second.outcome));
    expect(await employeeCount(v.full_name)).toBe(1);
    expect(await db().contract.count({ where: { employmentId: second.outcome.employmentId! } })).toBe(1);
  });
});

describe("Separate idempotency scopes", () => {
  it("the two operations never share a key; a Contract retry never replays Add Employee", async () => {
    const v = person();
    const srv = server();
    const shared = key("same");
    await expect(
      submitOnboarding(srv.post, { employeePayload: JSON.stringify(buildPayload(v, ALL)), employeeKey: shared, startDate: v.start_date, contract: { key: shared, body: () => ({}) } }),
    ).rejects.toThrow(/separate Idempotency-Keys/);
    expect(srv.calls).toHaveLength(0); // refused before any request
  });
});

describe("Owner close-out checks for 2A-6", () => {
  it("1. without contracts.manage: Add Employee works unchanged and no Contract request is sent", async () => {
    const perms = ["employees.read", "employees.read_personal", "employees.create", "employees.write_personal", "employment.manage", "catalogs.read"] as const;
    const principal = await principalWith("editor", [...perms]);
    const caps = wizardCapabilities((p) => (perms as readonly string[]).includes(p));
    expect(caps).toMatchObject({ create: true, createContract: false });
    const calls: string[] = [];
    // Transport: the Add Employee service as this principal; a Contract call would be recorded and fail the test.
    const post: PostFn = async (path, body, idempotencyKey) => {
      calls.push(path);
      if (path !== EMPLOYEES_PATH) throw new Error("no Contract request may be sent");
      return (await createEmployee(principal, EmployeeCreateSchema.parse(JSON.parse(body)), idempotencyKey, "req-2a6-noperm")).body;
    };
    const v = person({ department_id: ids.d.ENG, job_title_id: ids.j.SE });
    const stale = contract(); // even an "on" value left in state is ignored without the permission
    const outcome = await submitOnboarding(post, {
      employeePayload: JSON.stringify(buildPayload(v, ALL)),
      employeeKey: key("noperm"),
      startDate: v.start_date,
      contract: wantsContractDraft(caps, stale) ? { key: key("never"), body: (id) => contractDraftBody(id, v, stale) } : null,
    });
    expect(outcome).toMatchObject({ kind: "employee_created", contract: null });
    expect(calls).toEqual([EMPLOYEES_PATH]);
    const personId = (outcome as { personId: string }).personId;
    expect(await db().employment.count({ where: { personId } })).toBe(1);
    expect(await db().jobAssignment.count({ where: { employment: { personId } } })).toBe(1); // not degraded: period + assignment as before
    expect(await db().contract.count({ where: { employment: { personId } } })).toBe(0);
  });

  it("2. separate idempotency: Employee POST once; Contract POST fails; Retry sends only the Contract operation with the contract key", async () => {
    const v = person();
    const keys = { employee: key("emp-idem"), contract: key("ctr-idem") };
    const bad = contract({ effective_from: addDays(today, 5) }); // refused by the Contract API
    const { outcome, srv } = await onboard(v, bad, server(), keys);
    if (outcome.kind !== "employee_created" || outcome.contract?.status !== "failed") throw new Error(JSON.stringify(outcome));
    const editor = (await db().appUser.findFirstOrThrow({ where: { displayName: "Test HR Editor" } })).id;
    const records = async () =>
      (await db().idempotencyRecord.findMany({ where: { actorUserId: editor, idempotencyKey: { in: [keys.employee, keys.contract] } } })).map((r) => `${r.operation}:${r.idempotencyKey === keys.employee ? "E" : "C"}`).sort();
    // The rejected Contract request left its key unused; the employee key belongs to createEmployee only.
    expect(await records()).toEqual(["createEmployee:E"]);

    const fixed = { ...bad, effective_from: null };
    const retry = await createContractDraft(srv.post, contractDraftBody(outcome.employmentId!, v, fixed), keys.contract);
    if (retry.status !== "created") throw new Error(JSON.stringify(retry));
    const again = await createContractDraft(srv.post, contractDraftBody(outcome.employmentId!, v, fixed), keys.contract); // double click / repeat
    expect(again).toEqual(retry); // replayed: the same Draft
    expect(srv.calls.map((x) => `${x.path === EMPLOYEES_PATH ? "employee" : "contract"}:${x.key === keys.employee ? "E" : "C"}`)).toEqual([
      "employee:E",
      "contract:C",
      "contract:C",
      "contract:C",
    ]);
    expect(await records()).toEqual(["createContract:C", "createEmployee:E"]);
    expect(await employeeCount(v.full_name)).toBe(1);
    expect(await db().contract.count({ where: { employmentId: outcome.employmentId! } })).toBe(1);
  });

  it("3. the Draft links to the Employment Period id returned by the successful Add Employee response — nothing else", async () => {
    const v = person();
    const responses: unknown[] = [];
    const base = server();
    const post: PostFn = async (path, body, k) => {
      const r = await base.post(path, body, k);
      responses.push(r);
      return r;
    };
    const { outcome } = await onboard(v, contract(), { post, calls: base.calls });
    if (outcome.kind !== "employee_created" || outcome.contract?.status !== "created") throw new Error(JSON.stringify(outcome));
    const returnedPeriod = (responses[0] as { employments: { id: string }[] }).employments[0].id;
    expect(outcome.employmentId).toBe(returnedPeriod);
    expect(base.calls[1].body.employment_id).toBe(returnedPeriod);
    expect(base.calls.map((c) => c.path)).toEqual([EMPLOYEES_PATH, CONTRACTS_PATH]); // no lookup of a "current" period in between
    const draft = await db().contract.findUniqueOrThrow({ where: { id: outcome.contract.contractId }, include: { employment: true } });
    expect([draft.employmentId, draft.employment.personId]).toEqual([returnedPeriod, outcome.personId]);
  });
});
