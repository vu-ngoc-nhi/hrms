import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getEmployeeRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { call, catalogIds, key } from "../helpers";

// S4.0 (C-29): a cancelled planned period stays in history but has no operational effect.
// The Cancel Planned Period action arrives in S4.10, so these tests set the marker directly as the app role.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
const today = todayInVietnam();
const start = addDays(today, 40);
let cancelledPersonId: string;
let cancelledEmploymentId: string;

const create = (body: unknown) =>
  call(createRoute, { path: "/api/v1/core-hr/employees", method: "POST", user: "editor", body, headers: { "idempotency-key": key("cx") } });

beforeAll(async () => {
  ids = await catalogIds();
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  const r = await create({
    full_name: "Test Cancelled Planned",
    personal: { personal_email: "cancelled.planned.contact@example.test" },
    employment: {
      start_date: start,
      employee_type_id: ids.et.EMPLOYEE,
      work_email: "cancelled.planned@example.test",
      assignment: { department_id: ids.d.QA, job_title_id: ids.j.QAE },
    },
  });
  expect(r.status).toBe(201);
  expect(r.body.employment_status).toBe("not_started");
  cancelledPersonId = r.body.id;
  cancelledEmploymentId = r.body.employments[0].id;
  await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [cancelledEmploymentId]);
});

afterAll(async () => {
  await app.end();
});

describe("Cancelled planned periods (operational vs history)", () => {
  it("are kept in history (flagged) but excluded from status and completeness", async () => {
    const r = await call(getEmployeeRoute, { path: "/x", user: "editor", params: { id: cancelledPersonId } });
    expect(r.status).toBe(200);
    EmployeeDetailSchema.parse(r.body);
    expect(r.body.employment_status).toBe("no_employment"); // not Pre-start; Cancelled is not a status
    expect(r.body.employments).toHaveLength(1);
    expect(r.body.employments[0].cancelled_at).toEqual(expect.any(String));
    expect(r.body.employments[0].assignments).toHaveLength(1); // planned assignment kept for traceability
    const items = r.body.completeness.operational.items as { code: string; satisfied: boolean }[];
    expect(items.find((i) => i.code === "employment_status")?.satisfied).toBe(false);
    expect(items.find((i) => i.code === "department")?.satisfied).toBe(false);
  });

  it("do not appear as Pre-start or in department filters; appear as no employment", async () => {
    const list = async (qs: string) =>
      // Search by name so the assertion does not depend on how many profiles other test files created.
      (await call(listRoute, { path: `/api/v1/core-hr/employees?page_size=100&search=Test%20Cancelled%20Planned&${qs}`, user: "editor" })).body.data.map(
        (x: { id: string }) => x.id,
      );
    expect(await list("employment_status=not_started")).not.toContain(cancelledPersonId);
    expect(await list("employment_status=no_employment")).toContain(cancelledPersonId);
    expect(await list(`department_id=${ids.d.QA}`)).not.toContain(cancelledPersonId);
    const row = (await call(listRoute, { path: "/api/v1/core-hr/employees?page_size=100&search=Test%20Cancelled%20Planned", user: "editor" })).body.data.find(
      (x: { id: string }) => x.id === cancelledPersonId,
    );
    expect(row).toMatchObject({ employment_status: "no_employment", department: null, employee_type: null, work_email: null });
  });

  it("are not resolved as a manager's employment", async () => {
    const r = await create({
      full_name: "Test Report Of Cancelled",
      employment: {
        start_date: addDays(start, 1),
        employee_type_id: ids.et.EMPLOYEE,
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, manager_person_id: cancelledPersonId },
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("MANAGER_NOT_EMPLOYED_ON_DATE");
  });

  it("do not reserve their Work Email", async () => {
    const r = await create({
      full_name: "Test Reuses Cancelled Email",
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        work_email: "CANCELLED.PLANNED@example.test",
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE },
      },
    });
    expect(r.status).toBe(201);
  });

  it("do not block a replacement period with the same dates for the same person", async () => {
    const u = await app.query("SELECT id FROM app_user ORDER BY display_name LIMIT 1");
    await app.query("INSERT INTO employment (person_id, start_date, created_by) VALUES ($1, $2, $3)", [
      cancelledPersonId,
      start,
      u.rows[0].id,
    ]);
    const r = await call(getEmployeeRoute, { path: "/x", user: "editor", params: { id: cancelledPersonId } });
    expect(r.body.employment_status).toBe("not_started");
    expect(r.body.employments).toHaveLength(2);
  });
});
