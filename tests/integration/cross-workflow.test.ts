import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as assignmentCorrectionRoute } from "@/app/api/v1/core-hr/assignments/[id]/corrections/route";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as cancelRoute } from "@/app/api/v1/core-hr/employments/[id]/cancel-planned/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as initialAssignmentRoute } from "@/app/api/v1/core-hr/employments/[id]/initial-assignment/route";
import { POST as periodCorrectionRoute } from "@/app/api/v1/core-hr/employments/[id]/period-corrections/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as reverseRoute } from "@/app/api/v1/core-hr/employments/[id]/reverse-end/route";
import { PATCH as workEmailRoute } from "@/app/api/v1/core-hr/employments/[id]/work-email/route";
import { POST as initialEmploymentRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { PATCH as profileRoute, GET as detailRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { runIntegrityChecks } from "../../scripts/integrity-checks";
import { call, catalogIds, key, type TestUser } from "../helpers";

// H3: real workflow SEQUENCES (not isolated actions), verified on the final database state and with the read-only
// integrity scan scoped to the people each scenario creates.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
const today = todayInVietnam();
let n = 0;

type Route = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
async function act(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "editor", method = "POST") {
  const r = await call(route, {
    path: "/x",
    method,
    user,
    params: { id },
    body: { expected_revision: await revision(personId), ...body },
    headers: { "idempotency-key": key("xw") },
  });
  return r;
}
async function ok(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "editor", method = "POST") {
  const r = await act(route, id, personId, body, user, method);
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
  return EmployeeDetailSchema.parse(r.body);
}
async function newPerson(name?: string) {
  n += 1;
  const r = await call(createRoute, {
    path: "/x",
    method: "POST",
    user: "editor",
    headers: { "idempotency-key": key("xp") },
    body: { full_name: name ?? `Vương Thị Ngọc ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}` },
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function hired(start: string, type: string, email?: string) {
  const personId = await newPerson();
  const d = await ok(initialEmploymentRoute, personId, personId, { start_date: start, employee_type_id: type, ...(email ? { work_email: email } : {}), ...(start < today ? { reason: "Data capture" } : {}) });
  const employmentId = d.employments[0].id;
  await ok(initialAssignmentRoute, employmentId, personId, { effective_date: start, department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L2, ...(start < today ? { reason: "Data capture" } : {}) });
  return { personId, employmentId };
}

/** Structural snapshot of a person's periods (no timestamps that legitimately change). */
async function snapshot(personId: string) {
  const periods = await db().employment.findMany({
    where: { personId },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    include: { assignments: { orderBy: { effectiveFrom: "asc" } }, events: { orderBy: [{ effectiveDate: "asc" }, { recordedAt: "asc" }] } },
  });
  return periods.map((e) => ({
    id: e.id,
    start: fromDbDate(e.startDate),
    end: fromDbDate(e.endDate),
    type: e.employeeTypeId,
    workEmail: e.workEmail,
    cancelled: e.cancelledAt !== null,
    assignments: e.assignments.map((a) => ({ id: a.id, from: fromDbDate(a.effectiveFrom), to: fromDbDate(a.effectiveTo), dept: a.departmentId, title: a.jobTitleId, level: a.jobLevelId, mgr: a.managerEmploymentId })),
    events: e.events.map((v) => ({ id: v.id, type: v.eventType, date: fromDbDate(v.effectiveDate), reverses: v.reversesEventId, reason: v.endReasonCode })),
  }));
}
async function expectClean(personId: string, allow: string[] = []) {
  const findings = (await runIntegrityChecks(app, today, [personId])).filter((f) => !allow.includes(f.check));
  expect(findings).toEqual([]);
}

beforeAll(async () => {
  ids = await catalogIds();
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("Cross-workflow sequences (H3)", () => {
  it("A. Person → Initial Employment → Initial Assignment → Profile Edit → Work Email → Assignment Change → End Employment", async () => {
    const personId = await newPerson();
    await ok(profileRoute, personId, personId, { full_name: "Vương Thị Ngọc Updated", reason: "Name spelling" }, "editor", "PATCH");
    const p = await ok(initialEmploymentRoute, personId, personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE });
    const employmentId = p.employments[0].id;
    expect(p.completeness.operational.status).toBe("incomplete");
    await ok(initialAssignmentRoute, employmentId, personId, { effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE });
    const withEmail = await ok(workEmailRoute, employmentId, personId, { work_email: "ngoc.lifecycle.a@example.test" }, "editor", "PATCH");
    expect(withEmail.completeness.operational.status).toBe("complete");
    await ok(changeRoute, employmentId, personId, { effective_date: addDays(today, 10), reason: "Transfer", department_id: ids.d.QA });
    const ended = await ok(endRoute, employmentId, personId, { end_date: addDays(today, 30), end_reason_code: "VOLUNTARY_RESIGNATION" });
    expect(ended.employment_status).toBe("active"); // a future end date does not end the period yet (C-49)
    const s = await snapshot(personId);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ start: today, end: addDays(today, 30), workEmail: "ngoc.lifecycle.a@example.test" });
    expect(s[0].assignments.map((a) => [a.from, a.to, a.dept])).toEqual([
      [today, addDays(today, 10), ids.d.ENG],
      [addDays(today, 10), addDays(today, 31), ids.d.QA],
    ]);
    expect(s[0].events.map((e) => [e.type, e.reason])).toEqual([
      ["start", null],
      ["end", "VOLUNTARY_RESIGNATION"],
    ]);
    await expectClean(personId);
  });

  it("B. Active → End Employment → Reverse End → exact original state restored", async () => {
    const p = await hired("2024-03-04", ids.et.EMPLOYEE, "ngoc.reverse.b@example.test");
    await ok(changeRoute, p.employmentId, p.personId, { effective_date: "2025-01-06", reason: "Promotion", job_level_id: ids.l.L3 }, "admin");
    const before = await snapshot(p.personId);
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, -3), end_reason_code: "EMPLOYER_INITIATED_END" }, "admin");
    const reversed = await ok(reverseRoute, p.employmentId, p.personId, { reason: "Wrong person" }, "admin");
    expect(reversed.employment_status).toBe("active");
    const after = await snapshot(p.personId);
    expect({ ...after[0], events: [] }).toEqual({ ...before[0], events: [] });
    expect(after[0].events.map((e) => e.type)).toEqual(["start", "end", "end_reversed"]);
    await expectClean(p.personId);
  });

  it("C. Ended period → Rehire → new Assignment; old history unchanged", async () => {
    const p = await hired("2022-01-03", ids.et.EMPLOYEE, "ngoc.rehire.c@example.test");
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, -90), end_reason_code: "VOLUNTARY_RESIGNATION" }, "admin");
    const old = (await snapshot(p.personId))[0];
    const r = await ok(rehireRoute, p.personId, p.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, reason: "Returned", work_email: "ngoc.rehire.c@example.test" });
    const newId = r.employments[1].id;
    await ok(initialAssignmentRoute, newId, p.personId, { effective_date: today, department_id: ids.d.QA, job_title_id: ids.j.QAE });
    const s = await snapshot(p.personId);
    expect(s[0]).toEqual(old);
    expect(s[1]).toMatchObject({ start: today, end: null, assignments: [{ from: today, to: null, dept: ids.d.QA }] });
    const detail = EmployeeDetailSchema.parse((await call(detailRoute, { path: "/x", user: "editor", params: { id: p.personId } })).body);
    expect(detail).toMatchObject({ employment_status: "active", completeness: { operational: { status: "complete" } } });
    await expectClean(p.personId);
  });

  it("D. Planned-end period → future Rehire → Cancel Planned Rehire → Rehire again", async () => {
    const p = await hired("2023-01-02", ids.et.SERVICE_CONTRACTOR);
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 15), end_reason_code: "PLANNED_TERM_COMPLETED" });
    const old = (await snapshot(p.personId))[0];
    const rh = await ok(rehireRoute, p.personId, p.personId, { start_date: addDays(today, 30), employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "Next project" });
    await ok(cancelRoute, rh.employments[1].id, p.personId, { reason: "Project postponed" });
    const again = await ok(rehireRoute, p.personId, p.personId, { start_date: addDays(today, 60), employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "New project date" });
    expect(again.employment_status).toBe("active");
    const s = await snapshot(p.personId);
    expect(s.map((e) => [e.start, e.cancelled])).toEqual([
      ["2023-01-02", false],
      [addDays(today, 30), true],
      [addDays(today, 60), false],
    ]);
    expect(s[0]).toEqual(old);
    await expectClean(p.personId);
  });

  it("E. Contractor → Relationship Change → RELATIONSHIP_CHANGE end, new period, explicit Work Email and Initial Assignment", async () => {
    const p = await hired("2024-06-03", ids.et.SERVICE_CONTRACTOR, "ngoc.rc.e@example.test");
    const r = await ok(rcRoute, p.employmentId, p.personId, {
      start_date: addDays(today, 15),
      employee_type_id: ids.et.EMPLOYEE,
      reason: "Conversion",
      work_email: "ngoc.rc.e@example.test",
      initial_assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L3 },
    });
    const [old, fresh] = r.employments;
    expect(old.events.at(-1)).toMatchObject({ event_type: "end", end_reason: { code: "RELATIONSHIP_CHANGE" } });
    expect(fresh).toMatchObject({ start_date: addDays(today, 15), work_email: "ngoc.rc.e@example.test", employee_type: { id: ids.et.EMPLOYEE } });
    expect(fresh.assignments.map((a) => [a.effective_from, a.job_level?.id])).toEqual([[addDays(today, 15), ids.l.L3]]);
    expect(r.employment_status).toBe("active"); // the old period is still current until the transition
    await expectClean(p.personId);
  });

  it("F. Future Relationship Change → Reverse End blocked → Cancel successor → Reverse old End → exact old state; C-72 guidance data", async () => {
    const p = await hired("2024-06-03", ids.et.INTERN);
    const before = (await snapshot(p.personId))[0];
    const r = await ok(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 20), employee_type_id: ids.et.EMPLOYEE, reason: "Conversion" });
    const blocked = await act(reverseRoute, p.employmentId, p.personId, { reason: "Mistake" }, "admin");
    expect(blocked.body.error).toBe("LATER_PERIOD_EXISTS");
    const cancelled = await ok(cancelRoute, r.employments[1].id, p.personId, { reason: "Conversion withdrawn" });
    // Guidance condition (C-72): Active End Event with RELATIONSHIP_CHANGE and a cancelled successor.
    expect(cancelled.employments[0].active_end_event?.end_reason?.code).toBe("RELATIONSHIP_CHANGE");
    expect(cancelled.employments[1].cancelled_at).not.toBeNull();
    await ok(reverseRoute, p.employmentId, p.personId, { reason: "Conversion withdrawn" }, "admin");
    const s = await snapshot(p.personId);
    expect({ ...s[0], events: [] }).toEqual({ ...before, events: [] });
    expect(s[1]).toMatchObject({ cancelled: true });
    await expectClean(p.personId);
  });

  it("G. Future Initial Employment → planned Assignment → Cancel Planned → Person remains → Initial Employment again", async () => {
    const personId = await newPerson();
    const d = await ok(initialEmploymentRoute, personId, personId, { start_date: addDays(today, 25), employee_type_id: ids.et.INTERN });
    await ok(initialAssignmentRoute, d.employments[0].id, personId, { effective_date: addDays(today, 25), department_id: ids.d.QA, job_title_id: ids.j.QAE });
    const c = await ok(cancelRoute, d.employments[0].id, personId, { reason: "Offer withdrawn" });
    expect(c.employment_status).toBe("no_employment");
    const again = await ok(initialEmploymentRoute, personId, personId, { start_date: addDays(today, 40), employee_type_id: ids.et.INTERN });
    expect(again.employment_status).toBe("not_started");
    const s = await snapshot(personId);
    expect(s.map((e) => [e.cancelled, e.assignments.length])).toEqual([
      [true, 1],
      [false, 0],
    ]);
    await expectClean(personId);
  });

  it("H. End Employment → End Date correction → Reverse End → pre-End state restored (not the corrected date)", async () => {
    const p = await hired("2024-06-03", ids.et.EMPLOYEE);
    const before = (await snapshot(p.personId))[0];
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 20), end_reason_code: "MUTUAL_AGREEMENT" });
    await ok(periodCorrectionRoute, p.employmentId, p.personId, { end_date: addDays(today, 25), reason: "Agreed later date" }, "admin");
    await expectClean(p.personId);
    await ok(reverseRoute, p.employmentId, p.personId, { reason: "End recorded by mistake" }, "admin");
    const s = await snapshot(p.personId);
    expect({ ...s[0], events: [] }).toEqual({ ...before, events: [] });
    await expectClean(p.personId);
  });

  it("I. Historical assignment correction with an inactive catalog value keeps the timeline continuous", async () => {
    const p = await hired("2023-03-06", ids.et.EMPLOYEE);
    await ok(changeRoute, p.employmentId, p.personId, { effective_date: "2024-01-08", reason: "Move", department_id: ids.d.QA }, "admin");
    const [, second] = (await snapshot(p.personId))[0].assignments;
    await ok(assignmentCorrectionRoute, second.id, p.personId, { effective_from: "2023-12-04", department_id: ids.d.OLD, reason: "Historical department" }, "admin");
    const rows = (await snapshot(p.personId))[0].assignments;
    expect(rows.map((a) => [a.from, a.to, a.dept])).toEqual([
      ["2023-03-06", "2023-12-04", ids.d.ENG],
      ["2023-12-04", null, ids.d.OLD],
    ]);
    await expectClean(p.personId);
  });
});
