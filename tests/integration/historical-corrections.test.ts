import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as assignmentCorrectionModule from "@/app/api/v1/core-hr/assignments/[id]/corrections/route";
import { POST as assignmentCorrectionRoute } from "@/app/api/v1/core-hr/assignments/[id]/corrections/route";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as periodCorrectionRoute } from "@/app/api/v1/core-hr/employments/[id]/period-corrections/route";
import { PATCH as workEmailRoute } from "@/app/api/v1/core-hr/employments/[id]/work-email/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// S4.6 Historical corrections (C-40 to C-46, contract C-48). HR_ADMIN only, reason mandatory, edits in place.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let admin: string;
let inactiveType: string;
let inactiveDept: string;
const today = todayInVietnam();
const UNKNOWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let n = 0;

const nextName = () => {
  n += 1;
  return `Quách Minh Đức ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
};

/** Hired through the API: has a `start` lifecycle event and a first assignment aligned with the start date. */
async function hired(start: string, workEmail?: string) {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("hc") },
    body: {
      full_name: nextName(),
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        ...(workEmail ? { work_email: workEmail } : {}),
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L1 },
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}

/** A person without any period (periods are then added directly, like legacy/seed data: no lifecycle events). */
async function bare() {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("bare") },
    body: { full_name: nextName() },
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function legacyPeriod(
  personId: string,
  o: { start: string; end?: string; email?: string; rows?: { from: string; to: string | null }[] },
) {
  return db().$transaction(async (tx) => {
    const e = await tx.employment.create({
      data: {
        personId,
        startDate: toDbDate(o.start),
        endDate: o.end ? toDbDate(o.end) : null,
        employeeTypeId: ids.et.EMPLOYEE,
        workEmail: o.email ?? null,
        createdBy: admin,
      },
    });
    for (const r of o.rows ?? [{ from: o.start, to: o.end ? addDays(o.end, 1) : null }]) {
      await tx.jobAssignment.create({
        data: {
          employmentId: e.id,
          effectiveFrom: toDbDate(r.from),
          effectiveTo: r.to ? toDbDate(r.to) : null,
          departmentId: ids.d.ENG,
          jobTitleId: ids.j.SE,
          changeReason: "initial_assignment",
          createdBy: admin,
        },
      });
    }
    return e.id;
  });
}

const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;

const correctPeriod = (employmentId: string, body: Record<string, unknown>, user: TestUser = "admin", idem = key("pc")) =>
  call(periodCorrectionRoute, { path: "/x", method: "POST", user, params: { id: employmentId }, body, headers: { "idempotency-key": idem } });

const correctRow = (assignmentId: string, body: Record<string, unknown>, user: TestUser = "admin", idem = key("ac")) =>
  call(assignmentCorrectionRoute, { path: "/x", method: "POST", user, params: { id: assignmentId }, body, headers: { "idempotency-key": idem } });

const change = (employmentId: string, body: Record<string, unknown>, user: TestUser = "admin") =>
  call(changeRoute, { path: "/x", method: "POST", user, params: { id: employmentId }, body, headers: { "idempotency-key": key("chg") } });

const workEmail = (employmentId: string, body: Record<string, unknown>, user: TestUser = "admin") =>
  call(workEmailRoute, { path: "/x", method: "PATCH", user, params: { id: employmentId }, body });

const rows = async (employmentId: string) =>
  (await db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } })).map((a) => ({
    id: a.id,
    from: fromDbDate(a.effectiveFrom),
    to: fromDbDate(a.effectiveTo),
    dept: a.departmentId,
  }));

const audits = (entityIds: string[]) =>
  db().auditEvent.findMany({ where: { entityId: { in: entityIds } }, include: { fieldChanges: true }, orderBy: { id: "asc" } });

const values = (ev: { fieldChanges: { field: string; oldValue: string | null; newValue: string | null }[] }) =>
  Object.fromEntries(ev.fieldChanges.map((c) => [c.field, [c.oldValue, c.newValue]]));

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  inactiveType = (await db().employeeType.create({ data: { code: "HC_RETIRED_TYPE", name: "Retired Type", isActive: false } })).id;
  inactiveDept = (await db().department.create({ data: { code: "HC_RETIRED", name: "Retired Department", isActive: false } })).id;
});
afterAll(async () => {
  await app.end();
});

describe("Permissions", () => {
  it("HR_EDITOR and API_DOCS_READER are denied every historical correction; nothing changes", async () => {
    const p = await hired("2024-03-04", "denied.person@example.test");
    const [row] = await rows(p.employmentId);
    const rev = await revision(p.personId);
    for (const user of ["editor", "docs"] as const) {
      expect((await correctPeriod(p.employmentId, { expected_revision: rev, reason: "Fix", start_date: "2024-03-01" }, user)).status).toBe(403);
      expect((await correctPeriod(p.employmentId, { expected_revision: rev, reason: "Fix", employee_type_id: ids.et.INTERN }, user)).status).toBe(403);
      expect((await correctRow(row.id, { expected_revision: rev, reason: "Fix", department_id: ids.d.QA }, user)).status).toBe(403);
    }
    // Clearing a Work Email is a correction too (C-36).
    expect((await workEmail(p.employmentId, { expected_revision: rev, work_email: null, reason: "Wrong" }, "editor")).status).toBe(403);
    expect(await revision(p.personId)).toBe(rev);
    expect(await audits([p.employmentId, row.id])).toEqual([]);
  });
});

describe("Employment Period correction", () => {
  it("corrects the Employee Type on the same period (inactive types allowed, unknown rejected)", async () => {
    const p = await hired("2024-03-04");
    const rev = await revision(p.personId);
    const r = await correctPeriod(p.employmentId, { expected_revision: rev, reason: "Wrong type selected", employee_type_id: ids.et.SERVICE_CONTRACTOR });
    expect(r.status).toBe(200);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.employments).toHaveLength(1);
    expect(d.employments[0].employee_type?.id).toBe(ids.et.SERVICE_CONTRACTOR);
    expect(d.revision).toBe(rev + 1);
    const [ev] = await audits([p.employmentId]);
    expect(ev).toMatchObject({ action: "employment.correct", reason: "Wrong type selected", changedFields: ["employment.employee_type_id"] });
    expect(values(ev)).toEqual({ employee_type_id: [ids.et.EMPLOYEE, ids.et.SERVICE_CONTRACTOR] });

    const inactive = await correctPeriod(p.employmentId, { expected_revision: rev + 1, reason: "It was the retired type", employee_type_id: inactiveType });
    expect(inactive.status).toBe(200);
    const unknown = await correctPeriod(p.employmentId, { expected_revision: rev + 2, reason: "Fix", employee_type_id: UNKNOWN });
    expect(unknown.status).toBe(422);
    expect(unknown.body.details[0].code).toBe("UNKNOWN_REFERENCE");
  });

  it("corrects the start date: the aligned first assignment and the existing start event move with it", async () => {
    const p = await hired("2024-03-04");
    const before = await db().employmentEvent.findFirstOrThrow({ where: { employmentId: p.employmentId, eventType: "start" } });
    const [row] = await rows(p.employmentId);
    const rev = await revision(p.personId);
    const r = await correctPeriod(p.employmentId, { expected_revision: rev, reason: "Actual first day was 26 Feb", start_date: "2024-02-26" });
    expect(r.status).toBe(200);
    expect(r.body.employments[0].start_date).toBe("2024-02-26");
    expect((await rows(p.employmentId))[0]).toMatchObject({ id: row.id, from: "2024-02-26", to: null });
    const after = await db().employmentEvent.findFirstOrThrow({ where: { employmentId: p.employmentId, eventType: "start" } });
    // Only the business-effective date changes; actor, reason and recorded timestamp are untouched (C-43).
    expect(fromDbDate(after.effectiveDate)).toBe("2024-02-26");
    expect({ ...after, effectiveDate: null }).toEqual({ ...before, effectiveDate: null });
    expect(await db().employmentEvent.count({ where: { employmentId: p.employmentId } })).toBe(1);

    const evs = await audits([p.employmentId, row.id]);
    expect(evs.map((e) => [e.action, e.entityType])).toEqual([
      ["employment.correct", "employment"],
      ["assignment.correct", "job_assignment"],
    ]);
    expect(new Set(evs.map((e) => e.requestId)).size).toBe(1);
    expect(evs.every((e) => e.reason === "Actual first day was 26 Feb")).toBe(true);
    expect(evs[0].changedFields).toEqual(["employment.start_date", "employment_event.effective_date"]);
    expect(values(evs[0])).toEqual({ "employment.start_date": ["2024-03-04", "2024-02-26"] });
    expect(values(evs[1])).toEqual({ "assignment.effective_from": ["2024-03-04", "2024-02-26"] });
  });

  it("does not move a non-aligned first assignment, blocks a start after it, and never synthesizes an event", async () => {
    const personId = await bare();
    const employmentId = await legacyPeriod(personId, { start: "2023-01-02", rows: [{ from: "2023-03-01", to: null }] });
    const rev = await revision(personId);
    const ok = await correctPeriod(employmentId, { expected_revision: rev, reason: "Legacy start was wrong", start_date: "2023-02-01" });
    expect(ok.status).toBe(200);
    expect((await rows(employmentId))[0]).toMatchObject({ from: "2023-03-01" });
    expect(await db().employmentEvent.count({ where: { employmentId } })).toBe(0);
    expect((await audits([employmentId]))[0].changedFields).toEqual(["employment.start_date"]);

    const blocked = await correctPeriod(employmentId, { expected_revision: rev + 1, reason: "Fix", start_date: "2023-04-03" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.details[0].code).toBe("ASSIGNMENT_OUTSIDE_PERIOD");
    expect(await revision(personId)).toBe(rev + 1);
  });

  it("corrects an end date past → past and syncs the existing end event; the aligned last row follows", async () => {
    const personId = await bare();
    const employmentId = await legacyPeriod(personId, { start: "2020-01-06", end: "2022-12-31" });
    const endEvent = await db().employmentEvent.create({
      data: { employmentId, eventType: "end", effectiveDate: toDbDate("2022-12-31"), reason: "synthetic test event", recordedBy: admin },
    });
    const r = await correctPeriod(employmentId, { expected_revision: await revision(personId), reason: "Last day was 30 Nov", end_date: "2022-11-30" });
    expect(r.status).toBe(200);
    expect(r.body.employments[0]).toMatchObject({ end_date: "2022-11-30", period_lifecycle: "ended" });
    expect((await rows(employmentId))[0]).toMatchObject({ to: "2022-12-01" });
    const synced = await db().employmentEvent.findUniqueOrThrow({ where: { id: endEvent.id } });
    expect(fromDbDate(synced.effectiveDate)).toBe("2022-11-30");
    expect({ ...synced, effectiveDate: null }).toEqual({ ...endEvent, effectiveDate: null });
    const [period, row] = await audits([employmentId, (await rows(employmentId))[0].id]);
    expect(values(period)).toEqual({ "employment.end_date": ["2022-12-31", "2022-11-30"] });
    expect(values(row)).toEqual({ "assignment.effective_to": ["2023-01-01", "2022-12-01"] });
  });

  it("corrects an end date past → future (the period becomes Active again with a known end)", async () => {
    const personId = await bare();
    const employmentId = await legacyPeriod(personId, { start: "2021-02-01", end: "2023-06-30" });
    const future = addDays(today, 60);
    const r = await correctPeriod(employmentId, { expected_revision: await revision(personId), reason: "End date entered far too early", end_date: future });
    expect(r.status).toBe(200);
    expect(r.body.employment_status).toBe("active");
    expect((await rows(employmentId))[0].to).toBe(addDays(future, 1));
  });

  it("rejects an end date on an open period (USE_END_EMPLOYMENT) and an end before the start", async () => {
    const personId = await bare();
    const ended = await legacyPeriod(personId, { start: "2019-01-07", end: "2019-12-31" });
    const rev = await revision(personId);
    const open = await hired("2024-03-04");
    const set = await correctPeriod(open.employmentId, { expected_revision: await revision(open.personId), reason: "Left", end_date: "2025-01-31" });
    expect(set.status).toBe(422);
    expect(set.body.details[0].code).toBe("USE_END_EMPLOYMENT");
    expect((await db().employment.findUniqueOrThrow({ where: { id: open.employmentId } })).endDate).toBeNull();
    const before = await correctPeriod(ended, { expected_revision: rev, reason: "Fix", end_date: "2018-12-31" });
    expect(before.status).toBe(422);
    expect(before.body.details[0].code).toBe("END_BEFORE_START");
    const noop = await correctPeriod(open.employmentId, { expected_revision: await revision(open.personId), reason: "Fix", end_date: null });
    expect(noop.status).toBe(422);
    expect(noop.body.details[0].code).toBe("NO_CHANGE");
  });

  it("C-58: clears a legacy end date without an Active End Event (HR_ADMIN, reason); the aligned last row reopens; no event is synthesized", async () => {
    const personId = await bare();
    const ended = await legacyPeriod(personId, { start: "2019-01-07", end: "2019-12-31" });
    const [row] = await rows(ended);
    const rev = await revision(personId);
    expect((await correctPeriod(ended, { expected_revision: rev, reason: "Never left", end_date: null }, "editor")).status).toBe(403);
    const blank = await correctPeriod(ended, { expected_revision: rev, reason: " ", end_date: null });
    expect(blank.status).toBe(422);
    expect(blank.body.details[0].code).toBe("REASON_REQUIRED");
    const r = await correctPeriod(ended, { expected_revision: rev, reason: "Imported end date was wrong", end_date: null });
    expect(r.status).toBe(200);
    expect(r.body.employments[0]).toMatchObject({ end_date: null, period_lifecycle: "active", has_active_end_event: false });
    expect((await rows(ended))[0]).toEqual({ ...row, to: null });
    expect(await db().employmentEvent.count({ where: { employmentId: ended } })).toBe(0);
    const [period, moved] = await audits([ended, row.id]);
    expect(period).toMatchObject({ action: "employment.correct", reason: "Imported end date was wrong" });
    expect(values(period)).toEqual({ "employment.end_date": ["2019-12-31", null] });
    expect(values(moved)).toEqual({ "assignment.effective_to": ["2020-01-01", null] });
  });

  it("C-58: clearing an end date still enforces period overlap and Work Email constraints", async () => {
    const personId = await bare();
    const a = await legacyPeriod(personId, { start: "2018-01-08", end: "2018-12-31" });
    await legacyPeriod(personId, { start: "2019-06-03" });
    const overlap = await correctPeriod(a, { expected_revision: await revision(personId), reason: "Fix", end_date: null });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toBe("PERIOD_OVERLAP");

    const x = await bare();
    const xPeriod = await legacyPeriod(x, { start: "2017-01-09", end: "2017-12-29", email: "cleared.end@example.test" });
    const y = await bare();
    await legacyPeriod(y, { start: "2018-03-01", email: "cleared.end@example.test" });
    const email = await correctPeriod(xPeriod, { expected_revision: await revision(x), reason: "Fix", end_date: null });
    expect(email.status).toBe(409);
    expect(email.body.error).toBe("WORK_EMAIL_IN_USE");
    expect(fromDbDate((await db().employment.findUniqueOrThrow({ where: { id: xPeriod } })).endDate)).toBe("2017-12-29");
  });

  it("blocks an end date before an assignment start without touching any assignment", async () => {
    const p = await hired("2023-01-02");
    expect((await change(p.employmentId, { expected_revision: await revision(p.personId), effective_date: "2024-01-08", reason: "Move", department_id: ids.d.QA })).status).toBe(201);
    const personId = p.personId;
    await db().$transaction([
      db().employment.update({ where: { id: p.employmentId }, data: { endDate: toDbDate("2024-06-30") } }),
      db().jobAssignment.updateMany({ where: { employmentId: p.employmentId, effectiveTo: null }, data: { effectiveTo: toDbDate("2024-07-01") } }),
    ]);
    const timeline = await rows(p.employmentId);
    const r = await correctPeriod(p.employmentId, { expected_revision: await revision(personId), reason: "Fix", end_date: "2023-12-31" });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("ASSIGNMENT_OUTSIDE_PERIOD");
    expect(r.body.details[0].message).toContain(timeline[1].id);
    expect(await rows(p.employmentId)).toEqual(timeline);
  });

  it("blocks overlapping periods (409 PERIOD_OVERLAP) and leaves everything unchanged", async () => {
    const personId = await bare();
    const a = await legacyPeriod(personId, { start: "2020-01-06", end: "2021-12-31" });
    const b = await legacyPeriod(personId, { start: "2022-03-01" });
    const rev = await revision(personId);
    const extend = await correctPeriod(a, { expected_revision: rev, reason: "Fix", end_date: "2022-06-30" });
    expect(extend.status).toBe(409);
    expect(extend.body.error).toBe("PERIOD_OVERLAP");
    const earlier = await correctPeriod(b, { expected_revision: rev, reason: "Fix", start_date: "2021-12-01" });
    expect(earlier.status).toBe(409);
    expect(earlier.body.error).toBe("PERIOD_OVERLAP");
    expect(await revision(personId)).toBe(rev);
    expect(await audits([a, b])).toEqual([]);
  });

  it("preserves the Work Email constraint and rolls the whole correction back (assignment move included)", async () => {
    const x = await bare();
    const xPeriod = await legacyPeriod(x, { start: "2020-01-06", end: "2021-12-31", email: "shared.history@example.test" });
    const y = await bare();
    await legacyPeriod(y, { start: "2022-02-01", email: "shared.history@example.test" });
    const timeline = await rows(xPeriod);
    const rev = await revision(x);
    const r = await correctPeriod(xPeriod, { expected_revision: rev, reason: "Fix", end_date: "2022-03-31" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("WORK_EMAIL_IN_USE");
    expect(await rows(xPeriod)).toEqual(timeline); // the last row had been moved inside the transaction
    expect(fromDbDate((await db().employment.findUniqueOrThrow({ where: { id: xPeriod } })).endDate)).toBe("2021-12-31");
    expect(await revision(x)).toBe(rev);
    expect(await audits([xPeriod, timeline[0].id])).toEqual([]);
  });

  it("requires a reason, a change and the current revision; cancelled periods are read-only", async () => {
    const p = await hired("2024-03-04");
    const rev = await revision(p.personId);
    const blank = await correctPeriod(p.employmentId, { expected_revision: rev, reason: "   ", start_date: "2024-03-01" });
    expect(blank.status).toBe(422);
    expect(blank.body.details[0].code).toBe("REASON_REQUIRED");
    expect((await correctPeriod(p.employmentId, { expected_revision: rev, start_date: "2024-03-01" })).status).toBe(400);
    expect((await correctPeriod(p.employmentId, { expected_revision: rev, reason: "Fix" })).status).toBe(400);
    const same = await correctPeriod(p.employmentId, { expected_revision: rev, reason: "Fix", start_date: "2024-03-04" });
    expect(same.status).toBe(422);
    expect(same.body.details[0].code).toBe("NO_CHANGE");
    const stale = await correctPeriod(p.employmentId, { expected_revision: rev - 1 || 99, reason: "Fix", start_date: "2024-03-01" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
    expect(fromDbDate((await db().employment.findUniqueOrThrow({ where: { id: p.employmentId } })).startDate)).toBe("2024-03-04");

    const c = await hired(addDays(today, 40));
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [c.employmentId]);
    const cancelled = await correctPeriod(c.employmentId, { expected_revision: await revision(c.personId), reason: "Fix", start_date: addDays(today, 41) });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");
    const [row] = await rows(c.employmentId);
    expect((await correctRow(row.id, { expected_revision: await revision(c.personId), reason: "Fix", department_id: ids.d.QA })).status).toBe(409);
    expect((await correctPeriod(UNKNOWN, { expected_revision: 1, reason: "Fix", start_date: "2024-01-01" })).status).toBe(404);
  });
});

describe("Assignment row correction", () => {
  /** Three contiguous rows: A [2024-03-04, 2024-06-03), B [2024-06-03, 2025-01-06), C [2025-01-06, open). */
  async function threeRows() {
    const p = await hired("2024-03-04");
    expect((await change(p.employmentId, { expected_revision: await revision(p.personId), effective_date: "2024-06-03", reason: "Move", department_id: ids.d.QA })).status).toBe(201);
    expect((await change(p.employmentId, { expected_revision: await revision(p.personId), effective_date: "2025-01-06", reason: "Move", department_id: ids.d.HRA })).status).toBe(201);
    const [a, b, c] = await rows(p.employmentId);
    return { ...p, a, b, c };
  }

  it("corrects catalog values in place: same row, no new rows, no lifecycle events; audit with old/new ids", async () => {
    const p = await hired("2024-03-04");
    const [row] = await rows(p.employmentId);
    const events = await db().employmentEvent.count({ where: { employmentId: p.employmentId } });
    const r = await correctRow(row.id, {
      expected_revision: await revision(p.personId),
      reason: "Department and title were mistyped",
      department_id: ids.d.QA,
      job_title_id: ids.j.QAE,
      job_level_id: null,
    });
    expect(r.status).toBe(200);
    const after = await db().jobAssignment.findMany({ where: { employmentId: p.employmentId } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: row.id, departmentId: ids.d.QA, jobTitleId: ids.j.QAE, jobLevelId: null, changeReason: "initial_assignment" });
    expect(await db().employmentEvent.count({ where: { employmentId: p.employmentId } })).toBe(events);
    const [ev] = await audits([row.id]);
    expect(ev).toMatchObject({ action: "assignment.correct", entityType: "job_assignment", reason: "Department and title were mistyped" });
    expect(values(ev)).toEqual({
      department_id: [ids.d.ENG, ids.d.QA],
      job_title_id: [ids.j.SE, ids.j.QAE],
      job_level_id: [ids.l.L1, null],
    });
  });

  it("allows an existing inactive catalog value only in corrections; unknown values are rejected", async () => {
    const p = await hired("2024-03-04");
    const [row] = await rows(p.employmentId);
    const rev = await revision(p.personId);
    expect((await correctRow(row.id, { expected_revision: rev, reason: "It was the retired department", department_id: inactiveDept })).status).toBe(200);
    const unknown = await correctRow(row.id, { expected_revision: rev + 1, reason: "Fix", job_title_id: UNKNOWN });
    expect(unknown.status).toBe(422);
    expect(unknown.body.details[0].code).toBe("UNKNOWN_REFERENCE");
    // Normal business actions keep requiring active values (C-44).
    const normal = await change(p.employmentId, { expected_revision: rev + 1, effective_date: today, reason: "Move", department_id: inactiveDept });
    expect(normal.status).toBe(422);
    expect(normal.body.details[0].code).toBe("NOT_ACTIVE");
  });

  it("moving a non-first row's start moves the previous row's end; unrelated future rows stay untouched; both rows audited", async () => {
    const t = await threeRows();
    const earlier = await correctRow(t.b.id, { expected_revision: await revision(t.personId), reason: "Transfer was on 20 May", effective_from: "2024-05-20" });
    expect(earlier.status).toBe(200);
    expect(await rows(t.employmentId)).toEqual([
      { ...t.a, to: "2024-05-20" },
      { ...t.b, from: "2024-05-20" },
      t.c,
    ]);
    const evs = await audits([t.a.id, t.b.id, t.c.id]);
    expect(evs.map((e) => e.entityId)).toEqual([t.b.id, t.a.id]);
    expect(new Set(evs.map((e) => e.requestId)).size).toBe(1);
    expect(evs.every((e) => e.reason === "Transfer was on 20 May" && e.action === "assignment.correct")).toBe(true);
    expect(values(evs[0])).toEqual({ "assignment.effective_from": ["2024-06-03", "2024-05-20"] });
    expect(values(evs[1])).toEqual({ "assignment.effective_to": ["2024-06-03", "2024-05-20"] });

    const later = await correctRow(t.b.id, { expected_revision: await revision(t.personId), reason: "Actually 1 July", effective_from: "2024-07-01" });
    expect(later.status).toBe(200);
    expect(await rows(t.employmentId)).toEqual([
      { ...t.a, to: "2024-07-01" },
      { ...t.b, from: "2024-07-01" },
      t.c,
    ]);
  });

  it("blocks invalid timelines: empty rows, outside the period, and a non-contiguous previous row", async () => {
    const t = await threeRows();
    const rev = await revision(t.personId);
    const timeline = await rows(t.employmentId);
    const empty = await correctRow(t.b.id, { expected_revision: rev, reason: "Fix", effective_from: "2025-01-06" });
    expect(empty.body.details[0].code).toBe("ASSIGNMENT_WOULD_BE_EMPTY");
    const prevEmpty = await correctRow(t.b.id, { expected_revision: rev, reason: "Fix", effective_from: "2024-03-04" });
    expect(prevEmpty.body.details[0].code).toBe("PREVIOUS_ASSIGNMENT_WOULD_BE_EMPTY");
    const outside = await correctRow(t.a.id, { expected_revision: rev, reason: "Fix", effective_from: "2024-03-01" });
    expect(outside.body.details[0].code).toBe("OUTSIDE_EMPLOYMENT_PERIOD");
    for (const r of [empty, prevEmpty, outside]) expect(r.status).toBe(422);
    expect(await rows(t.employmentId)).toEqual(timeline);
    expect(await revision(t.personId)).toBe(rev);

    const personId = await bare();
    const gapped = await legacyPeriod(personId, {
      start: "2020-01-06",
      rows: [
        { from: "2020-01-06", to: "2020-06-01" },
        { from: "2020-07-01", to: null },
      ],
    });
    const [, second] = await rows(gapped);
    const gap = await correctRow(second.id, { expected_revision: await revision(personId), reason: "Fix", effective_from: "2020-06-15" });
    expect(gap.status).toBe(422);
    expect(gap.body.details[0].code).toBe("ASSIGNMENT_TIMELINE_GAP");
  });

  it("future-dated rows are corrected by HR_ADMIN only", async () => {
    const p = await hired("2024-03-04");
    expect((await change(p.employmentId, { expected_revision: await revision(p.personId), effective_date: addDays(today, 30), reason: "Planned move", department_id: ids.d.QA }, "editor")).status).toBe(201);
    const [, planned] = await rows(p.employmentId);
    const rev = await revision(p.personId);
    expect((await correctRow(planned.id, { expected_revision: rev, reason: "Fix", department_id: ids.d.HRA }, "editor")).status).toBe(403);
    const r = await correctRow(planned.id, { expected_revision: rev, reason: "Planned department was wrong", department_id: ids.d.HRA });
    expect(r.status).toBe(200);
    expect((await rows(p.employmentId))[1]).toMatchObject({ id: planned.id, dept: ids.d.HRA });
  });

  it("never hard-deletes: no DELETE handler and no DELETE privilege on assignments", async () => {
    expect("DELETE" in assignmentCorrectionModule).toBe(false);
    const { rows: priv } = await app.query("SELECT has_table_privilege('job_assignment', 'DELETE') AS d, has_table_privilege('employment', 'DELETE') AS e");
    expect(priv[0]).toEqual({ d: false, e: false });
    expect((await correctRow(UNKNOWN, { expected_revision: 1, reason: "Fix", department_id: ids.d.QA })).status).toBe(404);
  });
});

describe("Idempotency and concurrency (C-34)", () => {
  it("period correction: same key + same payload executes once; different payload is IDEMPOTENCY_KEY_REUSED", async () => {
    const p = await hired("2024-03-04");
    const k = key("pc-same");
    const body = { expected_revision: await revision(p.personId), reason: "Fix", start_date: "2024-03-01" };
    const results = await Promise.all([correctPeriod(p.employmentId, body, "admin", k), correctPeriod(p.employmentId, body, "admin", k)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect(results.map((r) => r.body.revision)).toEqual([body.expected_revision + 1, body.expected_revision + 1]);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId, action: "employment.correct" } })).toBe(1);
    const reused = await correctPeriod(p.employmentId, { ...body, start_date: "2024-02-28" }, "admin", k);
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("assignment correction: different keys + same expected_revision → one REVISION_CONFLICT; same key replays", async () => {
    const p = await hired("2024-03-04");
    const [row] = await rows(p.employmentId);
    const rev = await revision(p.personId);
    const race = await Promise.all([
      correctRow(row.id, { expected_revision: rev, reason: "A", department_id: ids.d.QA }, "admin", key("x1")),
      correctRow(row.id, { expected_revision: rev, reason: "B", department_id: ids.d.HRA }, "admin", key("x2")),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(race.find((r) => r.status === 409)!.body.error).toBe("REVISION_CONFLICT");
    expect(await db().auditEvent.count({ where: { entityId: row.id } })).toBe(1);

    const k = key("ac-same");
    const body = { expected_revision: rev + 1, reason: "Level", job_level_id: ids.l.L2 };
    const first = await correctRow(row.id, body, "admin", k);
    const again = await correctRow(row.id, body, "admin", k);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await db().auditEvent.count({ where: { entityId: row.id } })).toBe(2);
  });
});

describe("Work Email clearing / correction (C-36)", () => {
  it("clearing needs HR_ADMIN and a reason; audit stores no address; null → null is a no-op", async () => {
    const p = await hired("2024-03-04", "to.clear@example.test");
    const rev = await revision(p.personId);
    const noReason = await workEmail(p.employmentId, { expected_revision: rev, work_email: null });
    expect(noReason.status).toBe(422);
    expect(noReason.body.details[0].code).toBe("REASON_REQUIRED");
    const r = await workEmail(p.employmentId, { expected_revision: rev, work_email: null, reason: "Address was never issued" });
    expect(r.status).toBe(200);
    expect(r.body.employments[0].work_email).toBeNull();
    const [ev] = await audits([p.employmentId]);
    expect(ev).toMatchObject({ action: "employment.work_email.clear", changedFields: ["employment.work_email"], reason: "Address was never issued" });
    expect(JSON.stringify({ ...ev, id: String(ev.id) })).not.toContain("to.clear");
    const noop = await workEmail(p.employmentId, { expected_revision: rev + 1, work_email: null }, "editor");
    expect(noop.status).toBe(200);
    expect(noop.body.revision).toBe(rev + 1);
    // Adding an address again on an active period stays a normal HR_EDITOR update.
    expect((await workEmail(p.employmentId, { expected_revision: rev + 1, work_email: "re.added@example.test" }, "editor")).status).toBe(200);
  });

  it("on an ended period any change (including adding one) is an HR_ADMIN correction with a reason", async () => {
    const personId = await bare();
    const employmentId = await legacyPeriod(personId, { start: "2019-02-04", end: "2020-12-31" });
    const rev = await revision(personId);
    expect((await workEmail(employmentId, { expected_revision: rev, work_email: "late.add@example.test", reason: "Missing" }, "editor")).status).toBe(403);
    expect((await workEmail(employmentId, { expected_revision: rev, work_email: "late.add@example.test" })).status).toBe(422);
    const ok = await workEmail(employmentId, { expected_revision: rev, work_email: "late.add@example.test", reason: "Address missing from records" });
    expect(ok.status).toBe(200);
    expect((await audits([employmentId])).at(-1)!.action).toBe("employment.work_email.correct");
  });
});

describe("Lifecycle event date guard (C-43)", () => {
  it("the application role can only change effective_date of start/end events", async () => {
    const p = await hired("2024-03-04");
    const ev = await db().employmentEvent.findFirstOrThrow({ where: { employmentId: p.employmentId } });
    await expect(app.query("UPDATE employment_event SET reason = 'x' WHERE id = $1", [ev.id])).rejects.toMatchObject({ code: "42501" });
    const cancelEvent = await db().employmentEvent.create({
      data: { employmentId: p.employmentId, eventType: "suspend", effectiveDate: toDbDate("2024-05-01"), recordedBy: admin },
    });
    await expect(app.query("UPDATE employment_event SET effective_date = '2024-05-02' WHERE id = $1", [cancelEvent.id])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(app.query("DELETE FROM employment_event WHERE id = $1", [ev.id])).rejects.toMatchObject({ code: "42501" });
  });
});
