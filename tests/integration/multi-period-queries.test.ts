import { beforeAll, describe, expect, it } from "vitest";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as cancelRoute } from "@/app/api/v1/core-hr/employments/[id]/cancel-planned/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as initialAssignmentRoute } from "@/app/api/v1/core-hr/employments/[id]/initial-assignment/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as initialEmploymentRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { GET as detailRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, type TestUser } from "../helpers";

// H2: current vs future vs historical vs cancelled state for people with several periods. Future periods must never
// replace the current operational state, and cancelled periods must never become operational.
let ids: Awaited<ReturnType<typeof catalogIds>>;
const today = todayInVietnam();

type Route = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
async function ok(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "admin") {
  const r = await call(route, { path: "/x", method: "POST", user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("mq") } });
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
  return r.body;
}
async function person(name: string, start: string, type: string, dept: string, email?: string) {
  const c = await call(createRoute, { path: "/x", method: "POST", user: "admin", headers: { "idempotency-key": key("mqp") }, body: { full_name: name } });
  const personId = c.body.id as string;
  const d = await ok(initialEmploymentRoute, personId, personId, { start_date: start, employee_type_id: type, ...(email ? { work_email: email } : {}), ...(start < today ? { reason: "Capture" } : {}) });
  const employmentId = d.employments[0].id as string;
  await ok(initialAssignmentRoute, employmentId, personId, { effective_date: start, department_id: dept, job_title_id: ids.j.SE, ...(start < today ? { reason: "Capture" } : {}) });
  return { personId, employmentId };
}
const list = async (name: string, qs = "") =>
  (await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(name)}${qs}`, user: "editor" })).body.data as {
    id: string;
    employment_status: string;
    department: { id: string } | null;
    employee_type: { id: string } | null;
    work_email: string | null;
    operational_completeness: string;
  }[];
const detail = async (personId: string) => (await call(detailRoute, { path: "/x", user: "editor", params: { id: personId } })).body;

beforeAll(async () => {
  ids = await catalogIds();
});

describe("Multi-period query consistency (H2)", () => {
  it("current period + future Relationship Change: list/detail/filters show the CURRENT state only", async () => {
    const name = "Test Query Current Plus Future RC";
    const p = await person(name, "2024-02-05", ids.et.SERVICE_CONTRACTOR, ids.d.ENG, "query.current.rc@example.test");
    await ok(rcRoute, p.employmentId, p.personId, {
      start_date: addDays(today, 20),
      employee_type_id: ids.et.EMPLOYEE,
      reason: "Conversion",
      work_email: "query.future.rc@example.test",
      initial_assignment: { department_id: ids.d.QA, job_title_id: ids.j.QAE },
    });
    const [row] = await list(name);
    expect(row).toMatchObject({
      employment_status: "active",
      department: { id: ids.d.ENG },
      employee_type: { id: ids.et.SERVICE_CONTRACTOR },
      work_email: "query.current.rc@example.test",
    });
    expect(await list(name, `&department_id=${ids.d.QA}`)).toEqual([]);
    expect(await list(name, `&department_id=${ids.d.ENG}`)).toHaveLength(1);
    expect(await list(name, "&employment_status=not_started")).toEqual([]);
    expect(await list(name, "&employment_status=active")).toHaveLength(1);
    expect((await detail(p.personId)).employment_status).toBe("active");
  });

  it("ended period + future Rehire: Pre-start with the future period's first assignment and type", async () => {
    const name = "Test Query Ended Plus Future Rehire";
    const p = await person(name, "2021-03-01", ids.et.EMPLOYEE, ids.d.ENG);
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, -40), end_reason_code: "VOLUNTARY_RESIGNATION" });
    const rh = await ok(rehireRoute, p.personId, p.personId, { start_date: addDays(today, 10), employee_type_id: ids.et.INTERN, reason: "Return" });
    await ok(initialAssignmentRoute, rh.employments[1].id, p.personId, { effective_date: addDays(today, 10), department_id: ids.d.QA, job_title_id: ids.j.QAE });
    const [row] = await list(name);
    expect(row).toMatchObject({ employment_status: "not_started", department: { id: ids.d.QA }, employee_type: { id: ids.et.INTERN } });
    expect(await list(name, `&department_id=${ids.d.QA}`)).toHaveLength(1);
    expect(await list(name, "&employment_status=ended")).toEqual([]);
    expect(await list(name, "&employment_status=not_started")).toHaveLength(1);
  });

  it("current period + cancelled future period: the cancelled period never becomes operational", async () => {
    const name = "Test Query Current Plus Cancelled";
    const p = await person(name, "2024-02-05", ids.et.EMPLOYEE, ids.d.ENG);
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 5), end_reason_code: "PLANNED_TERM_COMPLETED" }, "editor");
    const rh = await ok(rehireRoute, p.personId, p.personId, { start_date: addDays(today, 6), employee_type_id: ids.et.INTERN, reason: "Return" }, "editor");
    await ok(initialAssignmentRoute, rh.employments[1].id, p.personId, { effective_date: addDays(today, 6), department_id: ids.d.QA, job_title_id: ids.j.QAE }, "editor");
    await ok(cancelRoute, rh.employments[1].id, p.personId, { reason: "Withdrawn" }, "editor");
    const [row] = await list(name);
    expect(row).toMatchObject({ employment_status: "active", department: { id: ids.d.ENG }, employee_type: { id: ids.et.EMPLOYEE } });
    expect(await list(name, `&department_id=${ids.d.QA}`)).toEqual([]);
  });

  it("only cancelled periods: no employment, no department/type, matched by the no_employment filter; one row per person", async () => {
    const name = "Test Query Only Cancelled";
    const p = await person(name, addDays(today, 15), ids.et.EMPLOYEE, ids.d.QA, "query.only.cancelled@example.test");
    await ok(cancelRoute, p.employmentId, p.personId, { reason: "Withdrawn" }, "editor");
    const rows = await list(name);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employment_status: "no_employment", department: null, employee_type: null, work_email: null });
    expect(await list(name, "&employment_status=no_employment")).toHaveLength(1);
    expect(await list(name, `&department_id=${ids.d.QA}`)).toEqual([]);
  });

  it("manager resolution uses the manager's period valid on the date (never a cancelled or future one)", async () => {
    const mgr = await person("Test Query Manager With Gap", "2020-01-06", ids.et.EMPLOYEE, ids.d.ENG);
    await ok(endRoute, mgr.employmentId, mgr.personId, { end_date: addDays(today, -20), end_reason_code: "VOLUNTARY_RESIGNATION" });
    const rh = await ok(rehireRoute, mgr.personId, mgr.personId, { start_date: addDays(today, 30), employee_type_id: ids.et.EMPLOYEE, reason: "Return" });
    const report = await person("Test Query Report", "2023-01-02", ids.et.EMPLOYEE, ids.d.ENG);
    const now = await call(changeRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: report.employmentId },
      body: { expected_revision: await revision(report.personId), effective_date: addDays(today, 1), reason: "Manager", manager_person_id: mgr.personId },
      headers: { "idempotency-key": key("mgr") },
    });
    expect(now.status).toBe(422);
    expect(now.body.details[0].code).toBe("MANAGER_NOT_EMPLOYED_ON_DATE");
    await ok(changeRoute, report.employmentId, report.personId, { effective_date: addDays(today, 35), reason: "Manager returns", manager_person_id: mgr.personId });
    const row = await db().jobAssignment.findFirstOrThrow({ where: { employmentId: report.employmentId, managerEmploymentId: { not: null } } });
    expect(row.managerEmploymentId).toBe(rh.employments[1].id);
  });
});
