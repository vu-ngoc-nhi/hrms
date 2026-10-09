import { beforeAll, describe, expect, it } from "vitest";
import { GET as listRoute } from "@/app/api/v1/core-hr/employees/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { addDays, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId } from "../helpers";

// Regression: the department filter must agree with the department shown in the list when a person has a current
// period AND a later planned period (possible since Rehire / Relationship Change).
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
});
