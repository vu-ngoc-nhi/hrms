import { beforeAll, describe, expect, it } from "vitest";
import { GET as getEmployeeRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { getEmployee } from "@/modules/core-hr/people/service";
import { call, catalogIds, key, principalWith, userId } from "../helpers";

// S4.2: read-only employment history. Histories that S4 write actions will create later (relationship change, rehire,
// cancellation) are inserted directly as the application role, exactly as the demo seed does.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let admin: string;
const today = todayInVietnam();

async function createPerson(name: string, personal?: Record<string, string>) {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("hist") },
    body: { full_name: name, ...(personal ? { personal } : {}) },
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function addPeriod(
  personId: string,
  o: { start: string; end?: string; type: string; email?: string; dept: string; cancelled?: boolean },
) {
  return db().$transaction(async (tx) => {
    const e = await tx.employment.create({
      data: {
        personId,
        startDate: toDbDate(o.start),
        endDate: o.end ? toDbDate(o.end) : null,
        employeeTypeId: ids.et[o.type],
        workEmail: o.email ?? null,
        createdBy: admin,
      },
    });
    await tx.employmentEvent.create({ data: { employmentId: e.id, eventType: "start", effectiveDate: toDbDate(o.start), recordedBy: admin } });
    if (o.end) {
      await tx.employmentEvent.create({ data: { employmentId: e.id, eventType: "end", effectiveDate: toDbDate(o.end), recordedBy: admin } });
    }
    await tx.jobAssignment.create({
      data: {
        employmentId: e.id,
        effectiveFrom: toDbDate(o.start),
        effectiveTo: o.end ? toDbDate(addDaysIso(o.end, 1)) : null,
        departmentId: ids.d[o.dept],
        jobTitleId: ids.j.SE,
        changeReason: "initial_assignment",
        createdBy: admin,
      },
    });
    if (o.cancelled) await tx.$executeRaw`UPDATE employment SET cancelled_at = now() WHERE id = ${e.id}::uuid`;
    return e.id;
  });
}
const addDaysIso = (d: string, n: number) => addDays(d, n);

async function detail(personId: string) {
  const r = await call(getEmployeeRoute, { path: "/x", user: "editor", params: { id: personId } });
  expect(r.status).toBe(200);
  return EmployeeDetailSchema.parse(r.body);
}

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
});

describe("Employment history (read-only)", () => {
  it("relationship change: two chronological periods with their own type, lifecycle, events and assignments", async () => {
    const id = await createPerson("Trương Bảo Ngọc");
    await addPeriod(id, { start: "2023-03-01", type: "EMPLOYEE", email: "ngoc.truong@example.test", dept: "ENG" });
    await addPeriod(id, { start: "2021-03-01", end: "2023-02-28", type: "SERVICE_CONTRACTOR", dept: "QA" });
    const d = await detail(id);
    expect(d.employment_status).toBe("active");
    expect(d.employments.map((e) => [e.start_date, e.employee_type?.code, e.period_lifecycle])).toEqual([
      ["2021-03-01", "SERVICE_CONTRACTOR", "ended"],
      ["2023-03-01", "EMPLOYEE", "active"],
    ]);
    expect(d.employments[0].assignments.map((a) => a.department.code)).toEqual(["QA"]);
    expect(d.employments[1].assignments.map((a) => a.department.code)).toEqual(["ENG"]);
    expect(d.employments[0].events.map((e) => e.event_type)).toEqual(["start", "end"]);
    expect(d.employments[1].events.map((e) => e.event_type)).toEqual(["start"]);
  });

  it("rehire after a gap: the old period stays Ended and a future period is Pre-start", async () => {
    const id = await createPerson("Phan Minh Khôi");
    await addPeriod(id, { start: "2019-01-07", end: "2021-06-30", type: "EMPLOYEE", dept: "QA" });
    await addPeriod(id, { start: addDays(today, 30), type: "EMPLOYEE", dept: "ENG" });
    const d = await detail(id);
    expect(d.employment_status).toBe("not_started");
    expect(d.employments.map((e) => e.period_lifecycle)).toEqual(["ended", "not_started"]);
  });

  it("a cancelled planned period is visible with a Cancelled marker and no lifecycle, and excluded from status", async () => {
    const id = await createPerson("Vũ Thu Trang");
    await addPeriod(id, { start: "2022-05-02", end: "2024-04-30", type: "EMPLOYEE", dept: "ENG" });
    await addPeriod(id, { start: addDays(today, 20), type: "EMPLOYEE", dept: "QA", cancelled: true });
    const d = await detail(id);
    expect(d.employment_status).toBe("ended"); // the cancelled future period does not make the person Pre-start
    const cancelled = d.employments.find((e) => e.cancelled_at !== null)!;
    expect(cancelled.period_lifecycle).toBeNull();
    expect(cancelled.assignments).toHaveLength(1); // planned assignment kept for traceability
    expect(d.employments.map((e) => e.start_date)).toEqual(["2022-05-02", addDays(today, 20)]);
  });

  it("a replacement after a cancellation with the same start date is ordered after the cancelled record", async () => {
    const id = await createPerson("Lâm Gia Bảo");
    const start = addDays(today, 25);
    const cancelledId = await addPeriod(id, { start, type: "INTERN", dept: "ENG", cancelled: true });
    const replacementId = await addPeriod(id, { start, type: "EMPLOYEE", dept: "ENG" });
    const d = await detail(id);
    expect(d.employments.map((e) => e.id)).toEqual([cancelledId, replacementId]);
    expect(d.employment_status).toBe("not_started");
  });

  it("does not expose personal data to a caller without employees.read_personal; API_DOCS_READER is refused", async () => {
    const id = await createPerson("Hồ Thanh Vân", { personal_email: "van.ho.contact@example.test", date_of_birth: "1994-02-03" });
    await addPeriod(id, { start: "2024-01-08", type: "EMPLOYEE", email: "van.ho@example.test", dept: "QA" });
    const directoryOnly = await principalWith("editor", ["employees.read"]);
    const d = await getEmployee(directoryOnly, id);
    expect(d).not.toHaveProperty("personal");
    expect(JSON.stringify(d)).not.toContain("van.ho.contact@example.test");
    expect(JSON.stringify(d)).not.toContain("1994-02-03");
    expect(d.employments[0].work_email).toBe("van.ho@example.test"); // directory group
    expect((await call(getEmployeeRoute, { path: "/x", user: "docs", params: { id } })).status).toBe(403);
  });
});
