import { writeFileSync } from "node:fs";
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
import { GET as detailRoute, PATCH as profileRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { completenessView } from "@/modules/core-hr/people/completeness";
import { completenessAssignment, employmentStatus, representativeEmployment } from "@/modules/core-hr/employments/status";
import { runIntegrityChecks } from "../../scripts/integrity-checks";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// Core HR Phase 1 — Business UAT Round 1 (synthetic data only, fresh hrms_test). Each scenario asserts the approved
// expected behaviour and records evidence for docs/uat/phase1-uat-round1-results.md. No business rule is changed here.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let admin: string;
const today = todayInVietnam();
const evidence: Record<string, unknown> = {};
const note = (id: string, data: unknown) => {
  evidence[id] = data;
};

type Route = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
async function send(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser, method = "POST", idem = key("uat")) {
  return call(route, { path: "/x", method, user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": idem } });
}
async function ok(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser, method = "POST") {
  const r = await send(route, id, personId, body, user, method);
  expect([200, 201], `${r.status} ${JSON.stringify(r.body)}`).toContain(r.status);
  return EmployeeDetailSchema.parse(r.body);
}
async function newPerson(name: string, body: Record<string, unknown> = {}) {
  const r = await call(createRoute, { path: "/x", method: "POST", user: "editor", headers: { "idempotency-key": key("uatp") }, body: { full_name: name, ...body } });
  expect(r.status).toBe(201);
  return r.body as { id: string; employee_code: string; revision: number };
}
async function hired(name: string, start: string, type: string, o: { email?: string; dept?: string; title?: string; user?: TestUser } = {}) {
  const p = await newPerson(name);
  const user = o.user ?? "admin";
  const d = await ok(initialEmploymentRoute, p.id, p.id, { start_date: start, employee_type_id: type, ...(o.email ? { work_email: o.email } : {}), ...(start < today ? { reason: "UAT data capture" } : {}) }, user);
  const employmentId = d.employments[0].id;
  await ok(initialAssignmentRoute, employmentId, p.id, { effective_date: start, department_id: o.dept ?? ids.d.ENG, job_title_id: o.title ?? ids.j.SE, ...(start < today ? { reason: "UAT data capture" } : {}) }, user);
  return { personId: p.id, employmentId, code: p.employee_code };
}
const detail = async (personId: string, user: TestUser = "editor") => EmployeeDetailSchema.parse((await call(detailRoute, { path: "/x", user, params: { id: personId } })).body);
const listRow = async (name: string, qs = "") =>
  (await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(name)}${qs}`, user: "editor" })).body;
const rows = async (employmentId: string) =>
  (await db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } })).map((a) => ({
    id: a.id,
    from: fromDbDate(a.effectiveFrom),
    to: fromDbDate(a.effectiveTo),
    dept: a.departmentId,
    title: a.jobTitleId,
    level: a.jobLevelId,
    mgr: a.managerEmploymentId,
  }));
const events = (employmentId: string) => db().employmentEvent.findMany({ where: { employmentId }, orderBy: [{ effectiveDate: "asc" }, { recordedAt: "asc" }] });
const audits = (entityIds: string[]) => db().auditEvent.findMany({ where: { entityId: { in: entityIds } }, include: { fieldChanges: true }, orderBy: { id: "asc" } });
const raw = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? String(v) : v));
const scan = async (personIds: string[]) => {
  await app.query("BEGIN READ ONLY");
  try {
    return await runIntegrityChecks(app, today, personIds);
  } finally {
    await app.query("ROLLBACK");
  }
};

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
  if (process.env.UAT_EVIDENCE_FILE) writeFileSync(process.env.UAT_EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
});

// Shared Alice state across UAT-01..09 (one person, sequential business flow).
const alice = { personId: "", employmentId: "", code: "", firstRow: "" };

describe("UAT Round 1 — Alice lifecycle (HR_EDITOR, then HR_ADMIN)", () => {
  it("UAT-01 create profile-only person", async () => {
    const p = await newPerson("UAT Alice Employee");
    Object.assign(alice, { personId: p.id, code: p.employee_code });
    const d = await detail(p.id);
    expect(d.employee_code).toMatch(/^ES\d{4,}$/);
    expect(d.employments).toEqual([]);
    expect(d.employment_status).toBe("no_employment");
    expect(d.revision).toBe(1);
    expect(await db().employment.count({ where: { personId: p.id } })).toBe(0);
    const a = await audits([p.id]);
    expect(a.map((x) => x.action)).toEqual(["employee.create"]);
    note("UAT-01", { code: d.employee_code, revision: d.revision, periods: 0, audit: a.map((x) => x.action) });
  });

  it("UAT-02 add initial employment (today, Employee) as HR_EDITOR", async () => {
    const d = await ok(initialEmploymentRoute, alice.personId, alice.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE }, "editor");
    alice.employmentId = d.employments[0].id;
    expect(d).toMatchObject({ id: alice.personId, employee_code: alice.code, employment_status: "active", revision: 2 });
    expect(d.employments).toHaveLength(1);
    expect(d.employments[0].events.map((e) => e.event_type)).toEqual(["start"]);
    expect(d.employments[0].assignments).toEqual([]);
    const missing = d.completeness.operational.items.filter((i) => !i.satisfied).map((i) => i.code);
    expect(missing).toEqual(expect.arrayContaining(["department", "job_title"]));
    note("UAT-02", { status: d.employment_status, events: ["start"], assignments: 0, missing });
  });

  it("UAT-03 add initial assignment; list department matches detail", async () => {
    const mgr = await hired("UAT Manager Morgan", "2020-01-06", ids.et.EMPLOYEE);
    const d = await ok(
      initialAssignmentRoute,
      alice.employmentId,
      alice.personId,
      { effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L2, manager_person_id: mgr.personId },
      "editor",
    );
    const [row] = await rows(alice.employmentId);
    alice.firstRow = row.id;
    expect(d.employments[0].assignments).toHaveLength(1);
    expect(d.employments[0].assignments[0]).toMatchObject({ department: { code: "ENG" }, job_title: { code: "SE" }, job_level: { code: "L2" }, manager: { person_id: mgr.personId } });
    const list = await listRow("UAT Alice Employee");
    expect(list.data[0].department.code).toBe("ENG");
    expect((await audits([alice.employmentId])).map((a) => a.action)).toContain("assignment.initial");
    note("UAT-03", { list_department: list.data[0].department.code, manager_resolved: true, assignment_rows: 1 });
  });

  it("UAT-04 work email on the period; update once; duplicate blocked; no raw email in audit", async () => {
    let d = await ok(workEmailRoute, alice.employmentId, alice.personId, { work_email: "uat.alice@example.test" }, "editor", "PATCH");
    expect(d.employments[0].work_email).toBe("uat.alice@example.test");
    expect(d.completeness.operational.status).toBe("complete");
    const rev = d.revision;
    d = await ok(workEmailRoute, alice.employmentId, alice.personId, { work_email: "uat.alice.updated@example.test" }, "editor", "PATCH");
    expect(d.revision).toBe(rev + 1);
    expect(d.employee_code).toBe(alice.code);
    const other = await hired("UAT Dup Email Holder", "2024-01-08", ids.et.EMPLOYEE);
    const dup = await send(workEmailRoute, other.employmentId, other.personId, { work_email: "UAT.Alice.Updated@example.test" }, "editor", "PATCH");
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("WORK_EMAIL_IN_USE");
    const a = (await audits([alice.employmentId])).filter((x) => x.action.startsWith("employment.work_email"));
    expect(a).toHaveLength(2);
    expect(raw(a)).not.toContain("uat.alice");
    note("UAT-04", { audits: a.map((x) => x.action), duplicate: dup.body.error, revision_step: 1 });
  });

  it("UAT-05 profile edit reason rules and audit", async () => {
    const patch = (body: Record<string, unknown>) => send(profileRoute, alice.personId, alice.personId, body, "editor", "PATCH");
    const results: Record<string, number | string> = {};
    let r = await patch({ personal: { mobile_phone: "0900000101" } });
    results.mobile = r.status;
    r = await patch({ personal: { personal_email: "alice.personal@example.test" } });
    results.personal_email = r.status;
    r = await patch({ full_name: "UAT Alice Employee Renamed" });
    results.full_name_without_reason = r.status;
    r = await patch({ full_name: "UAT Alice Employee Renamed", reason: "Spelling" });
    results.full_name_with_reason = r.status;
    r = await patch({ personal: { date_of_birth: "1990-04-12" } });
    results.dob_fill = r.status;
    r = await patch({ personal: { date_of_birth: "1990-04-21" } });
    results.dob_change_without_reason = r.status;
    r = await patch({ personal: { date_of_birth: "1990-04-21" }, reason: "Typo in day" });
    results.dob_change_with_reason = r.status;
    const before = await revision(alice.personId);
    r = await patch({ personal: { mobile_phone: "0900000101" } });
    results.noop_revision_unchanged = String((await revision(alice.personId)) === before);
    expect(results).toEqual({
      mobile: 200,
      personal_email: 200,
      full_name_without_reason: 422,
      full_name_with_reason: 200,
      dob_fill: 200,
      dob_change_without_reason: 422,
      dob_change_with_reason: 200,
      noop_revision_unchanged: "true",
    });
    const a = (await audits([alice.personId])).filter((x) => x.action === "employee.update");
    expect(a.flatMap((x) => x.fieldChanges)).toEqual([]);
    expect(raw(a)).not.toMatch(/0900000101|alice\.personal|1990-04/);
    // Restore the original name for the rest of the scenario.
    await ok(profileRoute, alice.personId, alice.personId, { full_name: "UAT Alice Employee", reason: "UAT reset" }, "editor", "PATCH");
    note("UAT-05", results);
  });

  it("UAT-06 assignment change (future) keeps history; backdated denied for HR_EDITOR", async () => {
    const future = addDays(today, 7);
    const noReason = await send(changeRoute, alice.employmentId, alice.personId, { effective_date: future, department_id: ids.d.QA }, "editor");
    expect(noReason.status).toBe(400);
    await ok(changeRoute, alice.employmentId, alice.personId, { effective_date: future, reason: "Transfer to QA", department_id: ids.d.QA, job_title_id: ids.j.QAE }, "editor");
    const r = await rows(alice.employmentId);
    expect(r.map((x) => [x.from, x.to, x.dept])).toEqual([
      [today, future, ids.d.ENG],
      [future, null, ids.d.QA],
    ]);
    expect(r[0].id).toBe(alice.firstRow);
    expect((await listRow("UAT Alice Employee")).data[0].department.code).toBe("ENG"); // still ENG until the change
    const back = await send(changeRoute, alice.employmentId, alice.personId, { effective_date: addDays(today, -1), reason: "Late entry", department_id: ids.d.HRA }, "editor");
    expect(back.status).toBe(403);
    const audit = (await audits([alice.employmentId])).find((x) => x.action === "assignment.change")!;
    expect(audit.fieldChanges.map((c) => c.field).sort()).toEqual(["assignment.effective_from", "assignment.effective_to", "department_id", "job_title_id"]);
    note("UAT-06", { timeline: r.map((x) => [x.from, x.to]), backdated_editor: back.status });
  });

  const alicePreEnd = { rows: [] as Awaited<ReturnType<typeof rows>>, end: null as string | null, revision: 0 };
  it("UAT-07 end employment (future) with structured reason; OTHER without note blocked", async () => {
    alicePreEnd.rows = await rows(alice.employmentId);
    alicePreEnd.end = fromDbDate((await db().employment.findUniqueOrThrow({ where: { id: alice.employmentId } })).endDate);
    const end = addDays(today, 30);
    const other = await send(endRoute, alice.employmentId, alice.personId, { end_date: end, end_reason_code: "OTHER" }, "editor");
    expect(other.status).toBe(422);
    expect(other.body.details[0].code).toBe("NOTE_REQUIRED");
    const d = await ok(endRoute, alice.employmentId, alice.personId, { end_date: end, end_reason_code: "VOLUNTARY_RESIGNATION", note: "Relocating (UAT note)" }, "editor");
    alicePreEnd.revision = d.revision - 1;
    expect(d.employments[0]).toMatchObject({ end_date: end, period_lifecycle: "active", has_active_end_event: true });
    expect(d.employments[0].events.at(-1)).toMatchObject({ event_type: "end", end_reason: { code: "VOLUNTARY_RESIGNATION" } });
    expect(raw(d)).not.toContain("Relocating");
    const r = await rows(alice.employmentId);
    expect(r.at(-1)!.to).toBe(addDays(end, 1));
    const ev = (await events(alice.employmentId)).find((e) => e.eventType === "end")!;
    expect([ev.previousEndDate, ev.closedAssignmentId, ev.closedAssignmentPreviousEffectiveTo]).toEqual([null, r.at(-1)!.id, null]);
    note("UAT-07", { end_date: end, status: "active until end (future date)", closed_row_to: addDays(end, 1), other_without_note: "NOTE_REQUIRED" });
  });

  it("UAT-08 HR_EDITOR cannot use admin-only corrections or reversal (server-side)", async () => {
    const r1 = await send(periodCorrectionRoute, alice.employmentId, alice.personId, { reason: "x", start_date: addDays(today, -1) }, "editor");
    const r2 = await send(assignmentCorrectionRoute, alice.firstRow, alice.personId, { reason: "x", department_id: ids.d.HRA }, "editor");
    const r3 = await send(reverseRoute, alice.employmentId, alice.personId, { reason: "x" }, "editor");
    const r4 = await send(workEmailRoute, alice.employmentId, alice.personId, { work_email: null, reason: "x" }, "editor", "PATCH");
    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([403, 403, 403, 403]);
    note("UAT-08", { period_correction: r1.status, assignment_correction: r2.status, reverse_end: r3.status, clear_work_email: r4.status });
  });

  it("UAT-09 HR_ADMIN reverses End Employment: exact pre-End state restored", async () => {
    const endEvent = (await events(alice.employmentId)).find((e) => e.eventType === "end")!;
    const revBefore = await revision(alice.personId);
    const d = await ok(reverseRoute, alice.employmentId, alice.personId, { reason: "UAT: resignation withdrawn" }, "admin");
    expect(d.revision).toBe(revBefore + 1);
    expect(d.employments[0]).toMatchObject({ end_date: alicePreEnd.end, has_active_end_event: false });
    expect(await rows(alice.employmentId)).toEqual(alicePreEnd.rows);
    const evs = await events(alice.employmentId);
    expect(evs.find((e) => e.id === endEvent.id)).toEqual(endEvent);
    expect(evs.map((e) => e.eventType)).toEqual(["start", "end", "end_reversed"]);
    expect(evs.at(-1)!.reversesEventId).toBe(endEvent.id);
    expect(d.employments[0].events.find((e) => e.event_type === "end")?.end_reason?.code).toBe("VOLUNTARY_RESIGNATION");
    expect(raw(d)).not.toContain("resignation withdrawn");
    expect((await audits([alice.employmentId])).filter((a) => a.action === "employment.end.reverse")).toHaveLength(1);
    expect(await scan([alice.personId])).toEqual([]);
    note("UAT-09", { restored_end: alicePreEnd.end, rows_equal: true, events: evs.map((e) => e.eventType), revision_step: 1 });
  });
});

describe("UAT Round 1 — corrections, legacy, rehire", () => {
  it("UAT-10 historical corrections (HR_ADMIN): type, start date with event sync, assignment fields and effective_from", async () => {
    const p = await hired("UAT Corrections Case", "2023-03-06", ids.et.EMPLOYEE);
    await ok(changeRoute, p.employmentId, p.personId, { effective_date: "2024-01-08", reason: "Transfer", department_id: ids.d.QA }, "admin");
    const blank = await send(periodCorrectionRoute, p.employmentId, p.personId, { reason: " ", employee_type_id: ids.et.INTERN }, "admin");
    expect(blank.body.details[0].code).toBe("REASON_REQUIRED");
    await ok(periodCorrectionRoute, p.employmentId, p.personId, { reason: "Wrong type", employee_type_id: ids.et.INTERN }, "admin");
    await ok(periodCorrectionRoute, p.employmentId, p.personId, { reason: "Actual first day", start_date: "2023-02-27" }, "admin");
    const start = (await events(p.employmentId)).find((e) => e.eventType === "start")!;
    expect(fromDbDate(start.effectiveDate)).toBe("2023-02-27");
    const [first, second] = await rows(p.employmentId);
    expect(first.from).toBe("2023-02-27");
    await ok(assignmentCorrectionRoute, second.id, p.personId, { reason: "Historical department", department_id: ids.d.OLD, effective_from: "2023-12-04" }, "admin");
    const after = await rows(p.employmentId);
    expect(after.map((x) => [x.from, x.to, x.dept])).toEqual([
      ["2023-02-27", "2023-12-04", ids.d.ENG],
      ["2023-12-04", null, ids.d.OLD],
    ]);
    const inactiveInChange = await send(changeRoute, p.employmentId, p.personId, { effective_date: today, reason: "x", department_id: ids.d.OLD }, "admin");
    expect(inactiveInChange.body.details[0].code).toBe("NOT_ACTIVE");
    expect(await db().jobAssignment.count({ where: { employmentId: p.employmentId } })).toBe(2);
    expect(await scan([p.personId])).toEqual([]);
    note("UAT-10", { start_event_synced: true, inactive_in_correction: "allowed", inactive_in_business_event: "NOT_ACTIVE", rows: after.length });
  });

  it("UAT-11 legacy end date without End event can be cleared by HR_ADMIN with a reason", async () => {
    const p = await newPerson("UAT Evan Legacy");
    const e = await db().employment.create({ data: { personId: p.id, startDate: toDbDate("2018-01-08"), endDate: toDbDate("2021-06-30"), employeeTypeId: ids.et.EMPLOYEE, createdBy: admin } });
    await db().jobAssignment.create({ data: { employmentId: e.id, effectiveFrom: toDbDate("2018-01-08"), effectiveTo: toDbDate("2021-07-01"), departmentId: ids.d.ENG, jobTitleId: ids.j.SE, changeReason: "initial_assignment", createdBy: admin } });
    const blank = await send(periodCorrectionRoute, e.id, p.id, { reason: " ", end_date: null }, "admin");
    expect(blank.body.details[0].code).toBe("REASON_REQUIRED");
    const editor = await send(periodCorrectionRoute, e.id, p.id, { reason: "x", end_date: null }, "editor");
    expect(editor.status).toBe(403);
    const d = await ok(periodCorrectionRoute, e.id, p.id, { reason: "Imported end date was wrong", end_date: null }, "admin");
    expect(d.employments[0]).toMatchObject({ end_date: null, period_lifecycle: "active" });
    expect(await events(e.id)).toEqual([]);
    expect((await rows(e.id))[0].to).toBeNull();
    expect(await scan([p.id])).toEqual([]);
    note("UAT-11", { cleared: true, events_created: 0, editor: 403 });
  });

  it("UAT-12 rehire after a properly ended period (same Employee Type)", async () => {
    const c = await hired("UAT Carol Rehire", "2021-03-01", ids.et.EMPLOYEE, { email: "uat.carol@example.test" });
    await ok(endRoute, c.employmentId, c.personId, { end_date: addDays(today, -60), end_reason_code: "VOLUNTARY_RESIGNATION" }, "admin");
    const old = { e: await db().employment.findUniqueOrThrow({ where: { id: c.employmentId } }), rows: await rows(c.employmentId), events: await events(c.employmentId) };
    const noReason = await send(rehireRoute, c.personId, c.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE }, "editor");
    expect(noReason.status).toBe(400);
    const d = await ok(rehireRoute, c.personId, c.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, reason: "Returned after a break" }, "editor");
    expect(d).toMatchObject({ id: c.personId, employee_code: c.code, employment_status: "active" });
    expect(d.employments[1]).toMatchObject({ work_email: null, assignments: [], employee_type: { id: ids.et.EMPLOYEE } });
    expect(d.employments[1].events.map((e) => e.event_type)).toEqual(["start"]);
    expect(await db().employment.findUniqueOrThrow({ where: { id: c.employmentId } })).toEqual(old.e);
    expect(await rows(c.employmentId)).toEqual(old.rows);
    expect(await events(c.employmentId)).toEqual(old.events);
    expect(await scan([c.personId])).toEqual([]);
    note("UAT-12", { same_person: true, same_code: true, copied_email: null, copied_assignments: 0, old_period_unchanged: true });
  });

  it("UAT-13 planned rehire (different type) → cancel → rehire again", async () => {
    const c = await hired("UAT Carla Planned Rehire", "2022-05-02", ids.et.EMPLOYEE, { email: "uat.carla@example.test" });
    await ok(endRoute, c.employmentId, c.personId, { end_date: addDays(today, -20), end_reason_code: "PLANNED_TERM_COMPLETED" }, "admin");
    const before = await db().employment.findUniqueOrThrow({ where: { id: c.employmentId }, include: { assignments: true, events: true } });
    const planned = await ok(rehireRoute, c.personId, c.personId, { start_date: addDays(today, 15), employee_type_id: ids.et.INTERN, reason: "Internship return", work_email: "uat.carla.new@example.test" }, "editor");
    expect(planned.employment_status).toBe("not_started");
    const newId = planned.employments[1].id;
    await ok(initialAssignmentRoute, newId, c.personId, { effective_date: addDays(today, 15), department_id: ids.d.QA, job_title_id: ids.j.QAE }, "editor");
    const cancelled = await ok(cancelRoute, newId, c.personId, { reason: "Return postponed" }, "editor");
    const p2 = cancelled.employments[1];
    expect(p2.cancelled_at).not.toBeNull();
    expect(p2.period_lifecycle).toBeNull();
    expect(p2.assignments).toHaveLength(1);
    expect(p2.events.map((e) => e.event_type)).toEqual(["start", "cancel_planned_start"]);
    const reuse = await hired("UAT Email Reuse After Cancel", addDays(today, 16), ids.et.EMPLOYEE, { email: "uat.carla.new@example.test" });
    expect(reuse.personId).toBeTruthy(); // the cancelled period no longer reserves the address
    expect(await db().employment.findUniqueOrThrow({ where: { id: c.employmentId }, include: { assignments: true, events: true } })).toEqual(before);
    const again = await ok(rehireRoute, c.personId, c.personId, { start_date: addDays(today, 40), employee_type_id: ids.et.EMPLOYEE, reason: "New return date" }, "editor");
    expect(again.employments.filter((e) => !e.cancelled_at)).toHaveLength(2);
    expect(await scan([c.personId])).toEqual([]);
    note("UAT-13", { planned_status: "not_started", cancelled_badge: true, email_reusable: true, previous_unchanged: true, rehire_again: "allowed" });
  });
});

describe("UAT Round 1 — relationship change and recovery", () => {
  it("UAT-14 Service Contractor → Employee relationship change (effective today)", async () => {
    const b = await hired("UAT Ben Contractor", "2024-01-08", ids.et.SERVICE_CONTRACTOR, { email: "uat.ben@example.test" });
    const oldRow = (await rows(b.employmentId))[0];
    const d = await ok(rcRoute, b.employmentId, b.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, reason: "Converted to employee" }, "editor");
    const [old, fresh] = d.employments;
    expect(old.end_date).toBe(addDays(today, -1));
    expect(fresh.start_date).toBe(today);
    expect(d).toMatchObject({ id: b.personId, employee_code: b.code });
    expect(old.events.at(-1)).toMatchObject({ event_type: "end", end_reason: { code: "RELATIONSHIP_CHANGE" } });
    expect(fresh.events.map((e) => e.event_type)).toEqual(["start"]);
    expect(fresh).toMatchObject({ work_email: null, assignments: [], employee_type: { id: ids.et.EMPLOYEE } });
    expect((await rows(b.employmentId))[0]).toEqual({ ...oldRow, to: today });
    expect(await scan([b.personId])).toEqual([]);
    note("UAT-14", { old_end: old.end_date, new_start: fresh.start_date, end_reason: "RELATIONSHIP_CHANGE", copied_email: null, copied_assignments: 0 });
  });

  it("UAT-15 planned relationship change recovery (P0)", async () => {
    const b = await hired("UAT Bella Planned RC", "2024-01-08", ids.et.SERVICE_CONTRACTOR, { email: "uat.bella@example.test" });
    const before = { e: await db().employment.findUniqueOrThrow({ where: { id: b.employmentId } }), rows: await rows(b.employmentId) };
    const d = await ok(rcRoute, b.employmentId, b.personId, {
      start_date: addDays(today, 20),
      employee_type_id: ids.et.EMPLOYEE,
      reason: "Planned conversion",
      work_email: "uat.bella@example.test",
      initial_assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE },
    }, "editor");
    const successor = d.employments[1].id;
    const a = await send(reverseRoute, b.employmentId, b.personId, { reason: "Mistake" }, "admin");
    expect(a.status).toBe(409);
    expect(a.body.error).toBe("LATER_PERIOD_EXISTS");
    await ok(cancelRoute, successor, b.personId, { reason: "Conversion withdrawn" }, "editor");
    const c = await ok(reverseRoute, b.employmentId, b.personId, { reason: "Conversion withdrawn" }, "admin");
    expect(await db().employment.findUniqueOrThrow({ where: { id: b.employmentId } })).toEqual(before.e);
    expect(await rows(b.employmentId)).toEqual(before.rows);
    expect(c.employments[1]).toMatchObject({ id: successor, period_lifecycle: null });
    expect(c.employments[1].cancelled_at).not.toBeNull();
    expect(c.employments[1].assignments).toHaveLength(1);
    expect(await scan([b.personId])).toEqual([]);
    note("UAT-15", { reverse_first: a.body.error, cancel: "ok", reverse_after_cancel: "ok", old_period_equal: true, successor_visible: true });
  });
});

describe("UAT Round 1 — list, completeness, effective mistakes, concurrency, references", () => {
  it("UAT-16 department display = department filter with several periods", async () => {
    const a = await hired("UAT Dept Active ENG Future QA", "2024-01-08", ids.et.SERVICE_CONTRACTOR);
    await ok(rcRoute, a.employmentId, a.personId, { start_date: addDays(today, 25), employee_type_id: ids.et.EMPLOYEE, reason: "Planned", initial_assignment: { department_id: ids.d.QA, job_title_id: ids.j.QAE } }, "editor");
    const b = await hired("UAT Dept Ended QA Only", "2021-01-04", ids.et.EMPLOYEE, { dept: ids.d.QA });
    await ok(endRoute, b.employmentId, b.personId, { end_date: addDays(today, -30), end_reason_code: "MUTUAL_AGREEMENT" }, "admin");
    const c = await hired("UAT Dept Ended QA Cancelled ENG", "2021-01-04", ids.et.EMPLOYEE, { dept: ids.d.QA });
    await ok(endRoute, c.employmentId, c.personId, { end_date: addDays(today, -30), end_reason_code: "MUTUAL_AGREEMENT" }, "admin");
    const rh = await ok(rehireRoute, c.personId, c.personId, { start_date: addDays(today, 10), employee_type_id: ids.et.EMPLOYEE, reason: "Return" }, "editor");
    await ok(initialAssignmentRoute, rh.employments[1].id, c.personId, { effective_date: addDays(today, 10), department_id: ids.d.ENG, job_title_id: ids.j.SE }, "editor");
    await ok(cancelRoute, rh.employments[1].id, c.personId, { reason: "Withdrawn" }, "editor");
    const dd = await hired("UAT Dept Cancelled Only", addDays(today, 12), ids.et.EMPLOYEE, { dept: ids.d.ENG, user: "editor" });
    await ok(cancelRoute, dd.employmentId, dd.personId, { reason: "Withdrawn" }, "editor");

    const show = async (name: string) => (await listRow(name)).data[0]?.department?.code ?? null;
    const filtered = async (name: string, dept: string) => (await listRow(name, `&department_id=${dept}`)).total as number;
    const result = {
      A: { shown: await show("UAT Dept Active ENG Future QA"), qa: await filtered("UAT Dept Active ENG Future QA", ids.d.QA), eng: await filtered("UAT Dept Active ENG Future QA", ids.d.ENG) },
      B: { shown: await show("UAT Dept Ended QA Only"), qa: await filtered("UAT Dept Ended QA Only", ids.d.QA) },
      C: { shown: await show("UAT Dept Ended QA Cancelled ENG"), qa: await filtered("UAT Dept Ended QA Cancelled ENG", ids.d.QA), eng: await filtered("UAT Dept Ended QA Cancelled ENG", ids.d.ENG) },
      D: { shown: await show("UAT Dept Cancelled Only"), eng: await filtered("UAT Dept Cancelled Only", ids.d.ENG) },
    };
    expect(result).toEqual({ A: { shown: "ENG", qa: 0, eng: 1 }, B: { shown: "QA", qa: 1 }, C: { shown: "QA", qa: 1, eng: 0 }, D: { shown: null, eng: 0 } });
    note("UAT-16", result);
  });

  it("UAT-17 pre-start person whose first assignment starts after the period start (HUMAN VALIDATION)", async () => {
    const d1 = addDays(today, 10);
    const d2 = addDays(today, 20);
    const p = await newPerson("UAT Diana PreStart", { personal: { personal_email: "uat.diana.contact@example.test" } });
    const e = await ok(initialEmploymentRoute, p.id, p.id, { start_date: d1, employee_type_id: ids.et.EMPLOYEE }, "editor");
    await ok(initialAssignmentRoute, e.employments[0].id, p.id, { effective_date: d2, department_id: ids.d.QA, job_title_id: ids.j.QAE }, "editor");
    const row = (await listRow("UAT Diana PreStart")).data[0];
    const det = await detail(p.id);
    // Same shared rules evaluated at later dates (no time travel in the database).
    const periods = [{ startDate: d1, endDate: null as string | null }];
    const asg = [{ effectiveFrom: d2, effectiveTo: null as string | null, departmentId: ids.d.QA }];
    const at = (asOf: string) => {
      const rep = representativeEmployment(periods, asOf)!;
      const a = completenessAssignment(rep, asg, asOf); // C-78 readiness rule
      return completenessView({
        fullName: "UAT Diana PreStart",
        personalEmail: "uat.diana.contact@example.test",
        employmentStatus: employmentStatus(periods, asOf),
        period: { startDate: d1, workEmail: null, employeeType: { requiresWorkEmail: true }, departmentId: a?.departmentId ?? null, jobTitleId: a ? ids.j.QAE : null },
      }).operational;
    };
    const today_ = { department: row.department?.code ?? null, completeness: row.operational_completeness };
    const between = at(addDays(d1, 1));
    const result = {
      before_D1: today_,
      detail_before_D1: det.completeness.operational.status,
      between_D1_and_D2: { status: between.status, missing: between.items.filter((i) => !i.satisfied).map((i) => i.code) },
      after_D2: at(addDays(d2, 1)).items.filter((i) => !i.satisfied).map((i) => i.code),
    };
    note("UAT-17", result);
    // C-78 (resolved after Round 1): incomplete for Department/Job Title from the start until D2; display stays QA (C-76).
    expect(today_).toEqual({ department: "QA", completeness: "incomplete" });
    expect(result.between_D1_and_D2.missing).toEqual(expect.arrayContaining(["department", "job_title"]));
    expect(result.after_D2).toEqual(["work_email"]);
  });

  it("UAT-18 period starting today entered by mistake (PV-25)", async () => {
    const p = await newPerson("UAT Grace SameDay");
    const d = await ok(initialEmploymentRoute, p.id, p.id, { start_date: today, employee_type_id: ids.et.EMPLOYEE }, "editor");
    const e = d.employments[0].id;
    const cancel = await send(cancelRoute, e, p.id, { reason: "Entered for the wrong person" }, "editor");
    expect(cancel.status).toBe(422);
    expect(cancel.body.details[0].code).toBe("PERIOD_ALREADY_STARTED");
    // What remains available today (observed, not executed): End Employment (a lifecycle action, not a void),
    // HR_ADMIN start-date correction (moves the period, not a void) and Relationship Change.
    note("UAT-18", {
      cancel_planned: "PERIOD_ALREADY_STARTED",
      void_or_reverse_rehire_endpoint: "none",
      remaining_actions: ["End Employment (records an End event; not a void)", "Correct Period start date (HR_ADMIN; moves the period, not a void)", "Relationship Change"],
    });
  });

  it("UAT-19 stale revision: second client gets REVISION_CONFLICT, no partial write", async () => {
    const f = await hired("UAT Frank Concurrent", "2024-01-08", ids.et.EMPLOYEE);
    const stale = await revision(f.personId);
    const a = await call(workEmailRoute, { path: "/x", method: "PATCH", user: "editor", params: { id: f.employmentId }, body: { expected_revision: stale, work_email: "uat.frank@example.test" } });
    expect(a.status).toBe(200);
    const auditsBefore = await db().auditEvent.count({ where: { entityId: f.employmentId } });
    const b = await call(changeRoute, {
      path: "/x",
      method: "POST",
      user: "editor",
      params: { id: f.employmentId },
      body: { expected_revision: stale, effective_date: addDays(today, 3), reason: "Client B", department_id: ids.d.QA },
      headers: { "idempotency-key": key("frank") },
    });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe("REVISION_CONFLICT");
    expect(await rows(f.employmentId)).toHaveLength(1);
    expect(await db().auditEvent.count({ where: { entityId: f.employmentId } })).toBe(auditsBefore);
    expect((await detail(f.personId)).employments[0].work_email).toBe("uat.frank@example.test");
    note("UAT-19", { client_a: a.status, client_b: b.body.error, partial_write: false });
  });

  it("UAT-20 cancelled manager reference stays; resolution excludes it; scan flags it", async () => {
    const m = await hired("UAT Manager Future", addDays(today, 5), ids.et.EMPLOYEE);
    const r = await hired("UAT Report Of Future Manager", "2024-01-08", ids.et.EMPLOYEE);
    await ok(changeRoute, r.employmentId, r.personId, { effective_date: addDays(today, 10), reason: "New manager", manager_person_id: m.personId }, "editor");
    await ok(cancelRoute, m.employmentId, m.personId, { reason: "Offer withdrawn" }, "editor");
    const ref = (await rows(r.employmentId)).at(-1)!;
    expect(ref.mgr).toBe(m.employmentId); // not rewritten
    const again = await send(changeRoute, r.employmentId, r.personId, { effective_date: addDays(today, 12), reason: "Manager", manager_person_id: m.personId, job_level_id: ids.l.L3 }, "editor");
    expect(again.body.details?.[0]?.code).toBe("MANAGER_NOT_EMPLOYED_ON_DATE");
    const findings = await scan([r.personId]);
    expect(findings.map((f) => f.check)).toEqual(["manager_not_employed_on_date"]);
    note("UAT-20", { reference_kept: true, new_reference: "MANAGER_NOT_EMPLOYED_ON_DATE", scan: findings.map((f) => `${f.severity}:${f.check}`) });
  });

  it("UAT-23 error responses: stable codes, no stack traces or SQL details", async () => {
    const p = await hired("UAT Error Probe", "2024-01-08", ids.et.SERVICE_CONTRACTOR, { email: "uat.errors@example.test" });
    const out: Record<string, unknown> = {};
    const leak = (b: unknown) => /stack|at \w+ \(|SELECT |INSERT |violates|constraint|prisma/i.test(raw(b));
    const rec = (name: string, r: { status: number; body: { error: string; details?: { code: string; message: string }[]; message: string } }) => {
      out[name] = { status: r.status, error: r.body.error, detail: r.body.details?.[0]?.code ?? null, message: r.body.details?.[0]?.message ?? r.body.message, leak: leak(r.body) };
    };
    const stale = await revision(p.personId);
    await ok(workEmailRoute, p.employmentId, p.personId, { work_email: "uat.errors.2@example.test" }, "editor", "PATCH");
    rec("REVISION_CONFLICT", await call(workEmailRoute, { path: "/x", method: "PATCH", user: "editor", params: { id: p.employmentId }, body: { expected_revision: stale, work_email: "uat.errors.3@example.test" } }));
    const q = await hired("UAT Error Probe Two", "2024-01-08", ids.et.EMPLOYEE);
    rec("WORK_EMAIL_IN_USE", await send(workEmailRoute, q.employmentId, q.personId, { work_email: "uat.errors.2@example.test" }, "editor", "PATCH"));
    const ov = await newPerson("UAT Error Overlap");
    const e1 = await db().employment.create({ data: { personId: ov.id, startDate: toDbDate("2019-01-07"), endDate: toDbDate("2019-12-31"), employeeTypeId: ids.et.EMPLOYEE, createdBy: admin } });
    await db().employment.create({ data: { personId: ov.id, startDate: toDbDate("2020-03-02"), employeeTypeId: ids.et.EMPLOYEE, createdBy: admin } });
    rec("PERIOD_OVERLAP", await send(periodCorrectionRoute, e1.id, ov.id, { reason: "x", end_date: "2020-06-30" }, "admin"));
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 30), end_reason_code: "MUTUAL_AGREEMENT" }, "editor");
    rec("ACTIVE_END_EVENT_EXISTS", await send(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 31), employee_type_id: ids.et.EMPLOYEE, reason: "x" }, "editor"));
    rec("USE_REVERSE_END_EMPLOYMENT", await send(periodCorrectionRoute, p.employmentId, p.personId, { reason: "x", end_date: null }, "admin"));
    const later = await newPerson("UAT Error Later Period");
    const ini = await ok(initialEmploymentRoute, later.id, later.id, { start_date: addDays(today, 10), end_date: addDays(today, 20), employee_type_id: ids.et.EMPLOYEE }, "editor");
    await ok(rehireRoute, later.id, later.id, { start_date: addDays(today, 40), reason: "x", employee_type_id: ids.et.EMPLOYEE }, "editor");
    rec("LATER_PERIOD_EXISTS", await send(cancelRoute, ini.employments[0].id, later.id, { reason: "x" }, "editor"));
    // Observation: after a normal End Employment the Active End Event check comes first (C-64), so a gap is reported as
    // ACTIVE_END_EVENT_EXISTS. GAP_USE_REHIRE is reached for a legacy ended period without an End event.
    const ended = await hired("UAT Error Ended Then Gap", "2022-01-03", ids.et.SERVICE_CONTRACTOR);
    await ok(endRoute, ended.employmentId, ended.personId, { end_date: addDays(today, -40), end_reason_code: "MUTUAL_AGREEMENT" }, "admin");
    rec("RC_AFTER_GAP_WITH_END_EVENT", await send(rcRoute, ended.employmentId, ended.personId, { start_date: addDays(today, -10), employee_type_id: ids.et.EMPLOYEE, reason: "x" }, "admin"));
    const legacy = await newPerson("UAT Error Legacy Gap");
    const le = await db().employment.create({ data: { personId: legacy.id, startDate: toDbDate("2021-01-04"), endDate: toDbDate("2023-06-30"), employeeTypeId: ids.et.SERVICE_CONTRACTOR, createdBy: admin } });
    rec("GAP_USE_REHIRE", await send(rcRoute, le.id, legacy.id, { start_date: "2023-09-01", employee_type_id: ids.et.EMPLOYEE, reason: "x" }, "admin"));
    const na = await newPerson("UAT Error No Assignment");
    const naE = await ok(initialEmploymentRoute, na.id, na.id, { start_date: today, employee_type_id: ids.et.EMPLOYEE }, "editor");
    rec("NO_ASSIGNMENT_YET", await send(changeRoute, naE.employments[0].id, na.id, { effective_date: today, reason: "x", department_id: ids.d.QA }, "editor"));
    note("UAT-23", out);
    // UX-1 (resolved after Round 1): a gap after a normal End now guides to Rehire.
    expect((out.RC_AFTER_GAP_WITH_END_EVENT as { message: string }).message).toContain("use Rehire");
    expect(Object.values(out).every((x) => !(x as { leak: boolean }).leak)).toBe(true);
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, (v as { detail: string | null; error: string }).detail ?? (v as { error: string }).error]))).toEqual({
      REVISION_CONFLICT: "STALE_REVISION",
      WORK_EMAIL_IN_USE: "IN_USE",
      PERIOD_OVERLAP: "PERIOD_OVERLAP",
      ACTIVE_END_EVENT_EXISTS: "ACTIVE_END_EVENT_EXISTS",
      USE_REVERSE_END_EMPLOYMENT: "USE_REVERSE_END_EMPLOYMENT",
      LATER_PERIOD_EXISTS: "LATER_PERIOD_EXISTS",
      RC_AFTER_GAP_WITH_END_EVENT: "ACTIVE_END_EVENT_EXISTS",
      GAP_USE_REHIRE: "GAP_USE_REHIRE",
      NO_ASSIGNMENT_YET: "NO_ASSIGNMENT_YET",
    });
  });

  it("UAT-22 history of a person with many lifecycle actions (automated part)", async () => {
    const h = await hired("UAT Hana History", "2021-02-01", ids.et.INTERN);
    await ok(changeRoute, h.employmentId, h.personId, { effective_date: "2022-01-03", reason: "Move", department_id: ids.d.QA }, "admin");
    await ok(endRoute, h.employmentId, h.personId, { end_date: addDays(today, 10), end_reason_code: "VOLUNTARY_RESIGNATION", note: "UAT secret note" }, "editor");
    await ok(reverseRoute, h.employmentId, h.personId, { reason: "UAT secret reversal reason" }, "admin");
    await ok(endRoute, h.employmentId, h.personId, { end_date: addDays(today, -30), end_reason_code: "PLANNED_TERM_COMPLETED" }, "admin");
    const rh = await ok(rehireRoute, h.personId, h.personId, { start_date: addDays(today, -5), employee_type_id: ids.et.INTERN, reason: "UAT secret rehire reason" }, "admin");
    await ok(rcRoute, rh.employments[1].id, h.personId, { start_date: addDays(today, 20), employee_type_id: ids.et.EMPLOYEE, reason: "UAT secret rc reason" }, "editor");
    const d = await detail(h.personId);
    await ok(cancelRoute, d.employments[2].id, h.personId, { reason: "UAT secret cancel reason" }, "editor");
    const final = await detail(h.personId);
    const history = final.employments.map((e) => ({
      period: `${e.start_date}..${e.end_date ?? "open"}`,
      lifecycle: e.period_lifecycle,
      cancelled: e.cancelled_at !== null,
      events: e.events.map((v) => `${v.event_type}@${v.effective_date}${v.end_reason ? `(${v.end_reason.code})` : ""}`),
    }));
    expect(raw(final)).not.toMatch(/UAT secret/);
    expect(final.employments.map((e) => e.start_date)).toEqual([...final.employments.map((e) => e.start_date)].sort());
    expect(final.employments[2].period_lifecycle).toBeNull();
    expect(await scan([h.personId])).toEqual([]);
    note("UAT-22", { status: final.employment_status, history });
  });
});
