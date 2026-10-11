import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { operations, type Operation } from "@/contracts/core-hr/operations";
import { permissionsForRoles, type Permission } from "@/modules/identity/permissions";
import { call, key, type TestUser } from "../helpers";

// H1 Phase 1 permission matrix: every operation in the contract registry, every actor, enforced SERVER-SIDE
// (never relying on UI hiding). The documented model below is the reference (design §6, C-22, C-25, ADR-0003);
// any registry or route divergence fails here.
const DOCUMENTED: Record<string, Permission | null> = {
  getHealth: null,
  getMe: null,
  getMyCoreHrPermissions: null,
  listEmployees: "employees.read",
  createEmployee: "employees.create",
  getEmployee: "employees.read",
  updateEmployee: "employees.update",
  updateEmploymentWorkEmail: "employment.manage", // clearing / ended periods additionally need employment.correct
  createAssignmentChange: "employment.manage", // past dates additionally need employment.correct
  createInitialAssignment: "employment.manage",
  createEndEmployment: "employment.manage", // past dates additionally need employment.correct
  createReverseEnd: "employment.correct",
  createPeriodCorrection: "employment.correct",
  createAssignmentCorrection: "employment.correct",
  createAssignmentCancelPlanned: "employment.manage",
  getCoreHrDashboard: "employees.read",
  createInitialEmployment: "employment.manage",
  createRehire: "employment.manage", // past dates additionally need employment.correct
  createRelationshipChange: "employment.manage", // past dates additionally need employment.correct
  createCancelPlanned: "employment.manage",
  getVoidEligibility: "employment.correct", // PV-25 / C-85: reuses employment.correct, no employment.void
  createVoidEmployment: "employment.correct",
  listDepartments: "catalogs.read",
  createDepartment: "catalogs.manage",
  updateDepartment: "catalogs.manage",
  listJobTitles: "catalogs.read",
  createJobTitle: "catalogs.manage",
  updateJobTitle: "catalogs.manage",
  listJobLevels: "catalogs.read",
  createJobLevel: "catalogs.manage",
  updateJobLevel: "catalogs.manage",
  listEmployeeTypes: "catalogs.read",
  createEmployeeType: "catalogs.manage",
  updateEmployeeType: "catalogs.manage",
  getInternalOpenApi: "docs.read",
};

const ROLES: Record<TestUser, string[]> = { admin: ["HR_ADMIN"], editor: ["HR_EDITOR"], docs: ["API_DOCS_READER"], noroles: [], disabled: [] };
const ACTORS: (TestUser | "anonymous")[] = ["anonymous", "noroles", "disabled", "docs", "editor", "admin"];
const DUMMY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Route = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
async function routeFor(op: Operation): Promise<Route> {
  const dir = op.path.replace(/^\//, "").replace(/\{id\}/g, "[id]");
  const file = path.join(process.cwd(), "src/app", dir, "route.ts");
  expect(existsSync(file), `route file for ${op.operationId}`).toBe(true);
  const mod = (await import(file)) as Record<string, Route>;
  const fn = mod[op.method.toUpperCase()];
  expect(fn, `${op.method.toUpperCase()} handler for ${op.operationId}`).toBeTypeOf("function");
  return fn;
}

describe("Permission matrix (H1)", () => {
  const ops = Object.values(operations) as Operation[];

  it("the contract registry matches the documented permission model for every operation", () => {
    expect(Object.fromEntries(ops.map((o) => [o.operationId, o.permission]))).toEqual(DOCUMENTED);
    // HR_EDITOR never holds employment.correct; API_DOCS_READER holds no HR permission.
    expect(permissionsForRoles(["HR_EDITOR"]).has("employment.correct")).toBe(false);
    expect([...permissionsForRoles(["API_DOCS_READER"])]).toEqual(["docs.read"]);
  });

  for (const op of ops.filter((o) => o.auth)) {
    it(`${op.method.toUpperCase()} ${op.path} (${op.operationId}) is enforced server-side for every actor`, async () => {
      const fn = await routeFor(op);
      for (const actor of ACTORS) {
        const r = await call(fn, {
          path: op.path.replace("{id}", DUMMY_ID),
          method: op.method.toUpperCase(),
          ...(actor === "anonymous" ? {} : { user: actor }),
          params: { id: DUMMY_ID },
          // Invalid on purpose: an authorized caller must get past authorization (to 400/404/422), never 401/403.
          ...(op.method === "get" ? {} : { body: {}, headers: { "idempotency-key": key("pm") } }),
        });
        const allowed = actor !== "anonymous" && actor !== "disabled" && (op.permission === null || permissionsForRoles(ROLES[actor]).has(op.permission));
        if (actor === "anonymous") expect(r.status, `${op.operationId} anonymous`).toBe(401);
        else if (!allowed) expect([401, 403], `${op.operationId} ${actor} → ${r.status}`).toContain(r.status);
        else expect([401, 403], `${op.operationId} ${actor} → ${r.status}`).not.toContain(r.status);
      }
    });
  }
});

describe("Effective-date and correction separation (C-22, C-25)", () => {
  let ids: { d: Record<string, string>; j: Record<string, string>; et: Record<string, string> };
  beforeAll(async () => {
    ids = await (await import("../helpers")).catalogIds();
  });

  it("HR_EDITOR is denied past-dated business events but allowed past Initial Data Capture; HR_ADMIN is allowed both", async () => {
    const { POST: createRoute } = await import("@/app/api/v1/core-hr/employees/route");
    const person = async (withPeriod: boolean) => {
      const r = await call(createRoute, {
        path: "/x",
        method: "POST",
        user: "admin",
        headers: { "idempotency-key": key("pmp") },
        body: {
          full_name: "Test Permission Matrix Person",
          ...(withPeriod
            ? { employment: { start_date: "2022-01-03", employee_type_id: ids.et.SERVICE_CONTRACTOR, assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE } } }
            : {}),
        },
      });
      return { personId: r.body.id as string, employmentId: r.body.employments?.[0]?.id as string, revision: r.body.revision as number };
    };
    const past = "2024-01-02";
    const routes = {
      change: (await import("@/app/api/v1/core-hr/employments/[id]/assignment-changes/route")).POST,
      end: (await import("@/app/api/v1/core-hr/employments/[id]/end/route")).POST,
      rc: (await import("@/app/api/v1/core-hr/employments/[id]/relationship-change/route")).POST,
      initial: (await import("@/app/api/v1/core-hr/employees/[id]/initial-employment/route")).POST,
    };
    const send = (fn: Route, id: string, body: Record<string, unknown>, user: TestUser) =>
      call(fn, { path: "/x", method: "POST", user, params: { id }, body, headers: { "idempotency-key": key("pmd") } });

    const p = await person(true);
    expect((await send(routes.change, p.employmentId, { expected_revision: p.revision, effective_date: past, reason: "x", department_id: ids.d.QA }, "editor")).status).toBe(403);
    expect((await send(routes.end, p.employmentId, { expected_revision: p.revision, end_date: past, end_reason_code: "MUTUAL_AGREEMENT" }, "editor")).status).toBe(403);
    expect((await send(routes.rc, p.employmentId, { expected_revision: p.revision, start_date: past, employee_type_id: ids.et.EMPLOYEE, reason: "x" }, "editor")).status).toBe(403);
    expect((await send(routes.rc, p.employmentId, { expected_revision: p.revision, start_date: past, employee_type_id: ids.et.EMPLOYEE, reason: "x" }, "admin")).status).toBe(201);

    const q = await person(false);
    expect((await send(routes.initial, q.personId, { expected_revision: q.revision, start_date: past, reason: "Data capture" }, "editor")).status).toBe(201);
  });
});
