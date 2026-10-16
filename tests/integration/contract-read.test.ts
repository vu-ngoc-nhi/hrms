import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as employeeContractsRoute } from "@/app/api/v1/core-hr/employees/[id]/contracts/route";
import { POST as discardRoute } from "@/app/api/v1/core-hr/contracts/[id]/discard/route";
import { POST as finalizeRoute } from "@/app/api/v1/core-hr/contracts/[id]/finalize/route";
import { GET as getRoute } from "@/app/api/v1/core-hr/contracts/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/contracts/route";
import { ContractListSchema, EmployeeContractsSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { call, key, type TestUser } from "../helpers";

// Slice 2A-3 read models: GET /contracts (portfolio list with canonical filters) and GET /employees/{id}/contracts
// (server-side grouping for the Employee Contracts tab). Synthetic data only; every fixture is tagged "RDX" so the
// assertions do not depend on contracts created by other test files in the shared test database.
let app: pg.Client;
let userId: string;
let typeA: string;
let typeB: string;
const today = todayInVietnam();
const PATH = "/api/v1/core-hr/contracts";

beforeAll(async () => {
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  userId = (await app.query("SELECT id FROM app_user ORDER BY display_name LIMIT 1")).rows[0].id;
  typeA = (await app.query("SELECT id FROM contract_type WHERE code = 'TEST_TYPE_A'")).rows[0].id;
  typeB = (await app.query("SELECT id FROM contract_type WHERE code = 'TEST_TYPE_B'")).rows[0].id;
});
afterAll(async () => {
  await app.end();
});

let seq = 0;
async function person(name: string): Promise<string> {
  seq += 1;
  const code = `RDX${String(seq).padStart(3, "0")}`;
  await app.query("BEGIN");
  const p = await app.query("INSERT INTO person (employee_code, full_name, created_by) VALUES ($1, $2, $3) RETURNING id", [code, name, userId]);
  await app.query("INSERT INTO employee_code_registry (code, person_id, source, issued_by) VALUES ($1, $2, 'legacy', $3)", [code, p.rows[0].id, userId]);
  await app.query("COMMIT");
  return p.rows[0].id;
}
const period = async (personId: string, start: string, end: string | null = null) =>
  (await app.query("INSERT INTO employment (person_id, start_date, end_date, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [personId, start, end, userId])).rows[0].id as string;

const create = async (body: Record<string, unknown>) => {
  const r = await call(createRoute, { path: PATH, method: "POST", user: "editor", body, headers: { "idempotency-key": key("rd") } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
};
const finalize = async (id: string, fingerprint?: string) => {
  const rev = (await call(getRoute, { path: `${PATH}/${id}`, user: "editor", params: { id } })).body.revision;
  return call(finalizeRoute, {
    path: `${PATH}/${id}/finalize`,
    method: "POST",
    user: "editor",
    params: { id },
    body: fingerprint ? { expected_revision: rev, confirmed_warning_fingerprint: fingerprint } : { expected_revision: rev },
    headers: { "idempotency-key": key("rdf") },
  });
};
const finalizeAnyway = async (id: string) => {
  const first = await finalize(id);
  return first.status === 201 ? first : finalize(id, first.body.warning_fingerprint);
};
const list = (qs: string, user: TestUser = "editor") => call(listRoute, { path: `${PATH}?${qs}`, user });

let fx: { anna: string; binh: string; annaPeriod: string; active: string; upcoming: string; expired: string; draft: string; overlap: string; discarded: string };

beforeAll(async () => {
  const anna = await person("Test Anna Reader");
  const binh = await person("Test Bình Reader");
  const old = await period(anna, "2023-01-01", addDays(today, -200));
  const annaPeriod = await period(anna, addDays(today, -199));
  const binhPeriod = await period(binh, addDays(today, -30));
  const expired = await create({ employment_id: old, contract_type_id: typeA, contract_number: "RDX-EXPIRED", effective_from: "2023-01-01", effective_to: addDays(today, -200) });
  await finalizeAnyway(expired);
  const active = await create({ employment_id: annaPeriod, contract_type_id: typeA, contract_number: "RDX-ACTIVE", effective_from: addDays(today, -199), effective_to: addDays(today, 100) });
  await finalizeAnyway(active);
  const upcoming = await create({ employment_id: annaPeriod, contract_type_id: typeB, contract_number: "RDX-UPCOMING", effective_from: addDays(today, 101), is_open_ended: true });
  await finalizeAnyway(upcoming);
  const draft = await create({ employment_id: annaPeriod, contract_number: "RDX-DRAFT" });
  // Binh: an overlapping pair finalized with confirmation → Needs Review on both.
  const binhFirst = await create({ employment_id: binhPeriod, contract_type_id: typeA, contract_number: "RDX-BINH-1", effective_from: addDays(today, -30), is_open_ended: true });
  await finalizeAnyway(binhFirst);
  const overlap = await create({ employment_id: binhPeriod, contract_type_id: typeB, contract_number: "RDX-BINH-2", effective_from: addDays(today, -10), effective_to: addDays(today, 50) });
  await finalizeAnyway(overlap);
  const discarded = await create({ employment_id: binhPeriod, contract_number: "RDX-DISCARDED" });
  await call(discardRoute, { path: `${PATH}/${discarded}/discard`, method: "POST", user: "editor", params: { id: discarded }, body: { expected_revision: 1 }, headers: { "idempotency-key": key("rdd") } });
  fx = { anna, binh, annaPeriod, active, upcoming, expired, draft, overlap, discarded };
});

describe("GET /contracts — portfolio list (server-side filters)", () => {
  it("returns summaries with server-computed state; discarded/voided are excluded unless asked", async () => {
    const r = await list("search=RDX&page_size=100");
    expect(r.status).toBe(200);
    const page = ContractListSchema.parse(r.body);
    expect(page.as_of).toBe(today);
    const numbers = page.data.map((c) => c.contract_number).sort();
    expect(numbers).toEqual(["RDX-ACTIVE", "RDX-BINH-1", "RDX-BINH-2", "RDX-DRAFT", "RDX-EXPIRED", "RDX-UPCOMING"]);
    const byNumber = Object.fromEntries(page.data.map((c) => [c.contract_number, c]));
    expect(byNumber["RDX-ACTIVE"].state).toMatchObject({ document_state: "finalized", time_state: "active" });
    expect(byNumber["RDX-UPCOMING"].state.time_state).toBe("upcoming");
    expect(byNumber["RDX-EXPIRED"].state.time_state).toBe("expired");
    expect(byNumber["RDX-DRAFT"].state).toMatchObject({ document_state: "draft", time_state: null });
    expect(byNumber["RDX-BINH-2"].review).toEqual({ needs_review: true, codes: ["OVERLAPPING_CONTRACT"] });
    const withDisposed = ContractListSchema.parse((await list("search=RDX&include_disposed=true&page_size=100")).body);
    expect(withDisposed.data.find((c) => c.contract_number === "RDX-DISCARDED")?.state.disposition).toBe("cancelled");
  });

  it("searches by Contract Number, employee name (accents included) and Employee Code, case-insensitively", async () => {
    expect((await list("search=rdx-active")).body.data.map((c: { id: string }) => c.id)).toEqual([fx.active]);
    const binh = (await list("search=b%C3%ACnh%20reader&page_size=100")).body.data.map((c: { contract_number: string }) => c.contract_number).sort();
    expect(binh).toEqual(["RDX-BINH-1", "RDX-BINH-2"]);
    const code = (await call(getRoute, { path: `${PATH}/${fx.active}`, user: "editor", params: { id: fx.active } })).body.employee.employee_code;
    expect((await list(`search=${code.toLowerCase()}&page_size=100`)).body.total).toBe(4); // Anna's four non-discarded contracts
  });

  it("filters by type, document state, time state, Needs Review and the Effective From range", async () => {
    const numbers = async (qs: string) => (await list(`search=RDX&page_size=100&${qs}`)).body.data.map((c: { contract_number: string }) => c.contract_number).sort();
    expect(await numbers(`contract_type_id=${typeB}`)).toEqual(["RDX-BINH-2", "RDX-UPCOMING"]);
    expect(await numbers("document_state=draft")).toEqual(["RDX-DRAFT"]);
    expect(await numbers("time_state=active")).toEqual(["RDX-ACTIVE", "RDX-BINH-1", "RDX-BINH-2"]);
    expect(await numbers("needs_review=true")).toEqual(["RDX-BINH-1", "RDX-BINH-2"]);
    expect(await numbers(`effective_from_from=${addDays(today, 1)}`)).toEqual(["RDX-UPCOMING"]);
    expect(await numbers("effective_from_to=2023-12-31")).toEqual(["RDX-EXPIRED"]);
    expect((await list("document_state=pending")).status).toBe(400); // unknown values are refused, never guessed
  });

  it("sorts by operational end by default (soonest first, no end last) and pages", async () => {
    const r = (await list("search=RDX&page_size=100")).body.data.map((c: { contract_number: string }) => c.contract_number);
    expect(r.indexOf("RDX-EXPIRED")).toBeLessThan(r.indexOf("RDX-ACTIVE"));
    expect(r.at(-1)).toBe("RDX-DRAFT");
    const p2 = await list("search=RDX&page_size=2&page=2");
    expect(p2.body).toMatchObject({ total: 6, page: 2, page_size: 2 });
    expect(p2.body.data).toHaveLength(2);
  });

  it("is contracts.read only: API_DOCS_READER and role-less users get nothing", async () => {
    expect((await list("", "docs")).status).toBe(403);
    expect((await list("", "noroles")).status).toBe(403);
    expect((await list("", "admin")).status).toBe(200);
  });
});

describe("GET /employees/{id}/contracts — server-side grouping", () => {
  it("groups Current · Upcoming · Drafts · History · Not operational and offers the valid periods for a new Draft", async () => {
    const r = await call(employeeContractsRoute, { path: `/api/v1/core-hr/employees/${fx.anna}/contracts`, user: "editor", params: { id: fx.anna } });
    expect(r.status).toBe(200);
    const g = EmployeeContractsSchema.parse(r.body);
    expect(g.current.map((c) => c.id)).toEqual([fx.active]);
    expect(g.upcoming.map((c) => c.id)).toEqual([fx.upcoming]);
    expect(g.drafts.map((c) => c.id)).toEqual([fx.draft]);
    expect(g.history.map((c) => c.id)).toEqual([fx.expired]);
    expect(g.not_operational).toEqual([]);
    expect(g.create.allowed).toBe(true);
    expect(g.create.periods).toHaveLength(2); // the ended period stays available for registering older contracts
    expect(g.create.periods.find((p) => p.is_default)?.id).toBe(fx.annaPeriod);
  });

  it("keeps discarded contracts as non-operational evidence and contracts of a cancelled period out of the active groups", async () => {
    const g = (await call(employeeContractsRoute, { path: `/api/v1/core-hr/employees/${fx.binh}/contracts`, user: "editor", params: { id: fx.binh } })).body;
    expect(g.not_operational.map((c: { id: string }) => c.id)).toEqual([fx.discarded]);
    expect(g.current.every((c: { review: { needs_review: boolean } }) => c.review.needs_review)).toBe(true);

    const solo = await person("Test Cancelled Reader");
    const planned = await period(solo, addDays(today, 40));
    const c = await create({ employment_id: planned, contract_number: "RDX-CANC-DRAFT" });
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [planned]);
    const after = (await call(employeeContractsRoute, { path: `/api/v1/core-hr/employees/${solo}/contracts`, user: "editor", params: { id: solo } })).body;
    expect(after.drafts).toEqual([]);
    expect(after.not_operational.map((x: { id: string; review: { codes: string[] } }) => [x.id, x.review.codes])).toEqual([[c, ["PERIOD_CANCELLED"]]]);
    expect(after.create).toEqual({ allowed: false, reasons: ["NO_VALID_EMPLOYMENT_PERIOD"], periods: [] });
  });

  it("reflects the caller's permission for creating and is 404 for an unknown person", async () => {
    const r = await call(employeeContractsRoute, { path: `/api/v1/core-hr/employees/${fx.anna}/contracts`, user: "admin", params: { id: fx.anna } });
    expect(r.body.create.allowed).toBe(true);
    expect((await call(employeeContractsRoute, { path: `/api/v1/core-hr/employees/${fx.anna}/contracts`, user: "docs", params: { id: fx.anna } })).status).toBe(403);
    const unknown = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect((await call(employeeContractsRoute, { path: `/api/v1/core-hr/employees/${unknown}/contracts`, user: "editor", params: { id: unknown } })).status).toBe(404);
  });
});
