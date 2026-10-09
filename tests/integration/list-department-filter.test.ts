import { beforeAll, describe, expect, it } from "vitest";
import { GET as listRoute } from "@/app/api/v1/core-hr/employees/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { addDays, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId } from "../helpers";

// The Department filter uses the same representative Department as the displayed row (C-76): active → assignment
// effective today; pre-start → first assignment of the upcoming period; ended → last assignment of the latest ended
// period; no valid period → none. Status filters restrict lifecycle separately.
let ids: Awaited<ReturnType<typeof catalogIds>>;
const today = todayInVietnam();

beforeAll(async () => {
  ids = await catalogIds();
});

describe("Employee list — department filter with several periods", () => {
  it("matches the current assignment, not a later planned period's assignment", async () => {
    const r = await call(createRoute, {
      path: "/api/v1/core-hr/employees",
      method: "POST",
      user: "admin",
      headers: { "idempotency-key": key("lf") },
      body: {
        full_name: "Test Filter Two Periods",
        employment: { start_date: "2024-01-08", employee_type_id: ids.et.SERVICE_CONTRACTOR, assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE } },
      },
    });
    expect(r.status).toBe(201);
    const current = r.body.employments[0].id as string;
    const admin = await userId("admin");
    const later = addDays(today, 30);
    await db().$transaction(async (tx) => {
      await tx.employment.update({ where: { id: current }, data: { endDate: toDbDate(addDays(later, -1)) } });
      await tx.jobAssignment.updateMany({ where: { employmentId: current }, data: { effectiveTo: toDbDate(later) } });
      const next = await tx.employment.create({ data: { personId: r.body.id, startDate: toDbDate(later), employeeTypeId: ids.et.EMPLOYEE, createdBy: admin } });
      await tx.jobAssignment.create({
        data: { employmentId: next.id, effectiveFrom: toDbDate(later), departmentId: ids.d.QA, jobTitleId: ids.j.QAE, changeReason: "initial_assignment", createdBy: admin },
      });
    });
    const list = async (dept: string) =>
      (await call(listRoute, { path: `/api/v1/core-hr/employees?search=Test%20Filter%20Two%20Periods&department_id=${dept}`, user: "editor" })).body.data;
    expect(await list(ids.d.QA)).toEqual([]);
    const eng = await list(ids.d.ENG);
    expect(eng).toHaveLength(1);
    expect(eng[0].department.code).toBe("ENG");
  });

  it("still matches the first planned assignment of someone who has not started yet", async () => {
    const r = await call(createRoute, {
      path: "/api/v1/core-hr/employees",
      method: "POST",
      user: "admin",
      headers: { "idempotency-key": key("lf2") },
      body: {
        full_name: "Test Filter Not Started",
        employment: { start_date: addDays(today, 15), employee_type_id: ids.et.EMPLOYEE, assignment: { department_id: ids.d.QA, job_title_id: ids.j.QAE } },
      },
    });
    expect(r.status).toBe(201);
    const found = (await call(listRoute, { path: `/api/v1/core-hr/employees?search=Test%20Filter%20Not%20Started&department_id=${ids.d.QA}`, user: "editor" })).body.data;
    expect(found).toHaveLength(1);
  });

  const listed = async (name: string, qs = "") =>
    (await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(name)}${qs}`, user: "editor" })).body;
  async function withPeriods(
    name: string,
    periods: { start: string; end?: string; rows: { from: string; to: string | null; dept: string }[]; cancelled?: boolean }[],
  ) {
    const c = await call(createRoute, { path: "/x", method: "POST", user: "admin", headers: { "idempotency-key": key("lfp") }, body: { full_name: name } });
    const admin = await userId("admin");
    for (const p of periods) {
      await db().$transaction(async (tx) => {
        const e = await tx.employment.create({
          data: { personId: c.body.id, startDate: toDbDate(p.start), endDate: p.end ? toDbDate(p.end) : null, employeeTypeId: ids.et.EMPLOYEE, createdBy: admin, ...(p.cancelled ? { cancelledAt: new Date() } : {}) },
        });
        for (const r of p.rows) {
          await tx.jobAssignment.create({
            data: { employmentId: e.id, effectiveFrom: toDbDate(r.from), effectiveTo: r.to ? toDbDate(r.to) : null, departmentId: r.dept, jobTitleId: ids.j.SE, changeReason: "initial_assignment", createdBy: admin },
          });
        }
      });
    }
    return c.body.id as string;
  }

  it("C-76 active: the assignment effective today", async () => {
    const name = "Test Dept Active";
    await withPeriods(name, [{ start: "2023-01-02", rows: [{ from: "2023-01-02", to: addDays(today, -10), dept: ids.d.QA }, { from: addDays(today, -10), to: null, dept: ids.d.ENG }] }]);
    expect((await listed(name)).data[0].department.code).toBe("ENG");
    expect((await listed(name, `&department_id=${ids.d.ENG}`)).total).toBe(1);
    expect((await listed(name, `&department_id=${ids.d.QA}`)).total).toBe(0);
  });

  it("C-76 pre-start: the first assignment of the upcoming period, even when it starts after the period start", async () => {
    const name = "Test Dept Prestart Late Assignment";
    await withPeriods(name, [{ start: addDays(today, 10), rows: [{ from: addDays(today, 15), to: null, dept: ids.d.QA }] }]);
    const body = await listed(name);
    expect(body.data[0]).toMatchObject({ employment_status: "not_started", department: { code: "QA" } });
    expect((await listed(name, `&department_id=${ids.d.QA}`)).total).toBe(1);
  });

  it("C-76 ended: the last assignment of the latest ended period; combined with status filters", async () => {
    const name = "Test Dept Ended";
    await withPeriods(name, [
      { start: "2020-01-06", end: "2021-12-31", rows: [{ from: "2020-01-06", to: "2022-01-01", dept: ids.d.HRA }] },
      { start: "2022-03-01", end: "2024-06-30", rows: [{ from: "2022-03-01", to: "2023-03-01", dept: ids.d.ENG }, { from: "2023-03-01", to: "2024-07-01", dept: ids.d.QA }] },
    ]);
    expect((await listed(name)).data[0]).toMatchObject({ employment_status: "ended", department: { code: "QA" } });
    expect((await listed(name, `&department_id=${ids.d.QA}`)).total).toBe(1);
    expect((await listed(name, `&department_id=${ids.d.QA}&employment_status=ended`)).total).toBe(1);
    expect((await listed(name, `&department_id=${ids.d.QA}&employment_status=active`)).total).toBe(0);
    expect((await listed(name, `&department_id=${ids.d.ENG}`)).total).toBe(0);
    expect((await listed(name, `&department_id=${ids.d.HRA}`)).total).toBe(0);
  });

  it("C-76 ended QA + future cancelled ENG period: QA only; cancelled-only employment has no Department", async () => {
    const name = "Test Dept Ended Plus Cancelled";
    await withPeriods(name, [
      { start: "2021-01-04", end: "2023-12-29", rows: [{ from: "2021-01-04", to: "2023-12-30", dept: ids.d.QA }] },
      { start: addDays(today, 20), rows: [{ from: addDays(today, 20), to: null, dept: ids.d.ENG }], cancelled: true },
    ]);
    expect((await listed(name)).data[0]).toMatchObject({ employment_status: "ended", department: { code: "QA" } });
    expect((await listed(name, `&department_id=${ids.d.QA}`)).total).toBe(1);
    expect((await listed(name, `&department_id=${ids.d.ENG}`)).total).toBe(0);

    const only = "Test Dept Cancelled Only";
    await withPeriods(only, [{ start: addDays(today, 30), rows: [{ from: addDays(today, 30), to: null, dept: ids.d.ENG }], cancelled: true }]);
    expect((await listed(only)).data[0]).toMatchObject({ employment_status: "no_employment", department: null });
    expect((await listed(only, `&department_id=${ids.d.ENG}`)).total).toBe(0);
  });

  it("pages and totals the filtered result consistently", async () => {
    const prefix = "Test Dept Paging";
    for (const s of ["A", "B", "C"]) await withPeriods(`${prefix} ${s}`, [{ start: "2024-01-08", rows: [{ from: "2024-01-08", to: null, dept: ids.d.HRA }] }]);
    const page1 = await listed(prefix, `&department_id=${ids.d.HRA}&page_size=2&page=1`);
    const page2 = await listed(prefix, `&department_id=${ids.d.HRA}&page_size=2&page=2`);
    expect([page1.total, page2.total]).toEqual([3, 3]);
    expect([page1.data.length, page2.data.length]).toEqual([2, 1]);
    expect(new Set([...page1.data, ...page2.data].map((x: { id: string }) => x.id)).size).toBe(3);
  });
});
