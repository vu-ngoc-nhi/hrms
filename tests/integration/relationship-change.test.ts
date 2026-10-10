import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as periodCorrectionRoute } from "@/app/api/v1/core-hr/employments/[id]/period-corrections/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as reverseRoute } from "@/app/api/v1/core-hr/employments/[id]/reverse-end/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// S4.9 Relationship Change (C-63 to C-67).
let ids: Awaited<ReturnType<typeof catalogIds>>;
let admin: string;
let manager: string;
const today = todayInVietnam();
let n = 0;

async function hired(start: string, o: { type?: string | null; email?: string } = {}) {
  n += 1;
  const type = o.type === undefined ? ids.et.SERVICE_CONTRACTOR : o.type;
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("rc") },
    body: {
      full_name: `Hà Minh Tuấn ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`,
      employment: {
        start_date: start,
        ...(type ? { employee_type_id: type } : {}),
        ...(o.email ? { work_email: o.email } : {}),
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L2 },
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string, code: r.body.employee_code as string };
}

async function plannedEnd(employmentId: string, end: string) {
  await db().$transaction([
    db().employment.update({ where: { id: employmentId }, data: { endDate: toDbDate(end) } }),
    db().jobAssignment.updateMany({ where: { employmentId, effectiveTo: null }, data: { effectiveTo: toDbDate(addDays(end, 1)) } }),
  ]);
}

const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
const periods = (personId: string) => db().employment.findMany({ where: { personId }, orderBy: { startDate: "asc" } });
const rows = async (employmentId: string) =>
  (await db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } })).map((a) => ({
    id: a.id,
    from: fromDbDate(a.effectiveFrom),
    to: fromDbDate(a.effectiveTo),
  }));
const events = (employmentId: string) => db().employmentEvent.findMany({ where: { employmentId }, orderBy: { recordedAt: "asc" } });
const values = (ev: { fieldChanges: { field: string; oldValue: string | null; newValue: string | null }[] }) =>
  Object.fromEntries(ev.fieldChanges.map((c) => [c.field, [c.oldValue, c.newValue]]));

const rc = async (p: { personId: string; employmentId: string }, body: Record<string, unknown>, user: TestUser = "editor", idem = key("rcx")) =>
  call(rcRoute, {
    path: "/x",
    method: "POST",
    user,
    params: { id: p.employmentId },
    body: { expected_revision: await revision(p.personId), employee_type_id: ids.et.EMPLOYEE, reason: "Converted to a permanent contract", ...body },
    headers: { "idempotency-key": idem },
  });

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  manager = (await hired("2015-01-05", { type: ids.et.EMPLOYEE })).personId;
});

describe("Relationship Change — core", () => {
  it("ends the old period the day before, creates the new period (same person and code) with a start event; nothing copied", async () => {
    const p = await hired("2024-01-08", { email: "contractor.one@example.test" });
    const [oldRow] = await rows(p.employmentId);
    const persons = await db().person.count();
    const rev = await revision(p.personId);
    const r = await rc(p, { start_date: today });
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d).toMatchObject({ id: p.personId, employee_code: p.code, revision: rev + 1, employment_status: "active" });
    expect(await db().person.count()).toBe(persons);
    const [old, fresh] = d.employments;
    expect(old).toMatchObject({ id: p.employmentId, end_date: addDays(today, -1), has_active_end_event: true, work_email: "contractor.one@example.test" });
    expect(old.events.map((e) => [e.event_type, e.end_reason?.code ?? null])).toEqual([
      ["start", null],
      ["end", "RELATIONSHIP_CHANGE"],
    ]);
    expect(fresh).toMatchObject({ start_date: today, end_date: null, work_email: null, assignments: [], employee_type: { id: ids.et.EMPLOYEE } });
    expect(fresh.events.map((e) => [e.event_type, e.effective_date])).toEqual([["start", today]]);
    expect(await rows(p.employmentId)).toEqual([{ ...oldRow, to: today }]);
    expect(JSON.stringify(r.body)).not.toContain("permanent contract");

    const endEvent = (await events(p.employmentId)).find((e) => e.eventType === "end")!;
    expect({
      date: fromDbDate(endEvent.effectiveDate),
      prev: endEvent.previousEndDate,
      closed: endEvent.closedAssignmentId,
      closedPrev: endEvent.closedAssignmentPreviousEffectiveTo,
      code: endEvent.endReasonCode,
      reason: endEvent.reason,
    }).toEqual({ date: addDays(today, -1), prev: null, closed: oldRow.id, closedPrev: null, code: "RELATIONSHIP_CHANGE", reason: "Converted to a permanent contract" });

    const audits = await db().auditEvent.findMany({
      where: { entityId: { in: [p.employmentId, oldRow.id, fresh.id] } },
      include: { fieldChanges: true },
      orderBy: { id: "asc" },
    });
    const mine = audits.filter((a) => a.action !== "employee.create");
    expect(mine.map((a) => `${a.action}:${a.entityId}`).sort()).toEqual(
      [`assignment.close:${oldRow.id}`, `employment.relationship_change:${fresh.id}`, `employment.relationship_change:${p.employmentId}`].sort(),
    );
    expect(new Set(mine.map((a) => a.requestId)).size).toBe(1);
    expect(mine.every((a) => a.reason === "Converted to a permanent contract")).toBe(true);
    expect(values(mine.find((a) => a.entityId === p.employmentId)!)).toEqual({ "employment.end_date": [null, addDays(today, -1)] });
    expect(values(mine.find((a) => a.entityId === fresh.id)!)).toEqual({ "employment.start_date": [null, today], employee_type_id: [null, ids.et.EMPLOYEE] });
    expect(values(mine.find((a) => a.entityId === oldRow.id)!)).toEqual({ "assignment.effective_to": [null, today] });
  });

  it("rejects the same Employee Type and an unknown current type; writes nothing", async () => {
    const p = await hired("2024-01-08");
    const same = await rc(p, { start_date: today, employee_type_id: ids.et.SERVICE_CONTRACTOR });
    expect(same.status).toBe(422);
    expect(same.body.details[0].code).toBe("SAME_EMPLOYEE_TYPE");
    const u = await hired("2024-01-08", { type: null });
    const unknown = await rc(u, { start_date: today });
    expect(unknown.body.details[0].code).toBe("OLD_EMPLOYEE_TYPE_UNKNOWN");
    expect(await periods(p.personId)).toHaveLength(1);
    expect(await periods(u.personId)).toHaveLength(1);
  });

  it("only the latest non-cancelled period; a cancelled later period does not count", async () => {
    const p = await hired("2018-01-08");
    await db().$transaction([
      db().employment.update({ where: { id: p.employmentId }, data: { endDate: toDbDate("2019-12-31") } }),
      db().jobAssignment.updateMany({ where: { employmentId: p.employmentId }, data: { effectiveTo: toDbDate("2020-01-01") } }),
    ]);
    await db().employment.create({ data: { personId: p.personId, startDate: toDbDate("2021-03-01"), employeeTypeId: ids.et.INTERN, createdBy: admin } });
    const r = await rc(p, { start_date: "2020-01-01" }, "admin");
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("NOT_LATEST_PERIOD");

    const q = await hired(addDays(today, -30));
    await db().employment.create({
      data: { personId: q.personId, startDate: toDbDate(addDays(today, 60)), employeeTypeId: ids.et.INTERN, createdBy: admin, cancelledAt: new Date() },
    });
    expect((await rc(q, { start_date: addDays(today, 5) })).status).toBe(201);
  });

  it("C-25: HR_EDITOR today/future, HR_ADMIN may backdate; a reason is mandatory", async () => {
    const f = await hired("2024-01-08");
    expect((await rc(f, { start_date: addDays(today, 14) })).status).toBe(201);
    const b = await hired("2023-01-02");
    expect((await rc(b, { start_date: addDays(today, -7) })).status).toBe(403);
    expect((await rc(b, { start_date: addDays(today, -7), reason: "   " }, "admin")).body.details[0].code).toBe("REASON_REQUIRED");
    const ok = await rc(b, { start_date: addDays(today, -7) }, "admin");
    expect(ok.status).toBe(201);
    expect(ok.body.employments[0].end_date).toBe(addDays(today, -8));
    const before = await rc(await hired("2024-05-06"), { start_date: "2024-05-06" }, "admin");
    expect(before.body.details[0].code).toBe("START_NOT_AFTER_PERIOD_START");
  });
});

describe("Existing end date of the current period", () => {
  it("a future planned end date is shortened; previous_end_date and the assignment's previous end are captured", async () => {
    const p = await hired("2024-01-08");
    const planned = addDays(today, 90);
    await plannedEnd(p.employmentId, planned);
    const [row] = await rows(p.employmentId);
    const r = await rc(p, { start_date: addDays(today, 30) });
    expect(r.status).toBe(201);
    expect(r.body.employments[0].end_date).toBe(addDays(today, 29));
    expect((await rows(p.employmentId))[0]).toEqual({ ...row, to: addDays(today, 30) });
    const end = (await events(p.employmentId)).find((e) => e.eventType === "end")!;
    expect([fromDbDate(end.previousEndDate), end.closedAssignmentId, fromDbDate(end.closedAssignmentPreviousEffectiveTo)]).toEqual([planned, row.id, addDays(planned, 1)]);
  });

  it("a future planned end date is extended (later boundary); the aligned assignment follows and is captured", async () => {
    const p = await hired("2024-01-08");
    const planned = addDays(today, 10);
    await plannedEnd(p.employmentId, planned);
    const [row] = await rows(p.employmentId);
    const r = await rc(p, { start_date: addDays(today, 40) });
    expect(r.status).toBe(201);
    expect(r.body.employments[0].end_date).toBe(addDays(today, 39));
    expect((await rows(p.employmentId))[0].to).toBe(addDays(today, 40));
    const end = (await events(p.employmentId)).find((e) => e.eventType === "end")!;
    expect([fromDbDate(end.previousEndDate), end.closedAssignmentId, fromDbDate(end.closedAssignmentPreviousEffectiveTo)]).toEqual([planned, row.id, addDays(planned, 1)]);
    const audit = await db().auditEvent.findFirstOrThrow({ where: { entityId: p.employmentId, action: "employment.relationship_change" }, include: { fieldChanges: true } });
    expect(values(audit)).toEqual({ "employment.end_date": [planned, addDays(today, 39)] });
  });

  it("an already-ended period: exact next day allowed (HR_ADMIN), a gap is a Rehire, an earlier start is a correction case", async () => {
    const p = await hired("2022-01-03");
    await plannedEnd(p.employmentId, "2023-06-30");
    const gap = await rc(p, { start_date: "2023-08-01" }, "admin");
    expect(gap.body.details[0].code).toBe("GAP_USE_REHIRE");
    const earlier = await rc(p, { start_date: "2023-06-15" }, "admin");
    expect(earlier.body.details[0].code).toBe("HISTORICAL_END_MISMATCH");
    const before = await rows(p.employmentId);
    const ok = await rc(p, { start_date: "2023-07-01" }, "admin");
    expect(ok.status).toBe(201);
    expect(ok.body.employments[0].end_date).toBe("2023-06-30");
    expect(await rows(p.employmentId)).toEqual(before); // already ended at the boundary: no assignment change
    const end = (await events(p.employmentId)).find((e) => e.eventType === "end")!;
    expect([fromDbDate(end.previousEndDate), end.closedAssignmentId]).toEqual(["2023-06-30", null]);
  });

  it("an Active End Event blocks the action and is never replaced", async () => {
    const p = await hired("2024-01-08");
    const e = await call(endRoute, {
      path: "/x",
      method: "POST",
      user: "editor",
      params: { id: p.employmentId },
      body: { expected_revision: await revision(p.personId), end_date: addDays(today, 20), end_reason_code: "PLANNED_TERM_COMPLETED" },
      headers: { "idempotency-key": key("end") },
    });
    expect(e.status).toBe(201);
    const r = await rc(p, { start_date: addDays(today, 21) });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("ACTIVE_END_EVENT_EXISTS");
    // C-79: continuous transition → reverse the wrong End first, then Relationship Change.
    expect(r.body.details[0].message).toContain("Reverse End Employment first, then Relationship Change");
    // UX-1: a genuine gap after the recorded End guides to Rehire, not to Reverse End.
    const gap = await rc(p, { start_date: addDays(today, 40) });
    expect(gap.body.details[0].code).toBe("ACTIVE_END_EVENT_EXISTS");
    expect(gap.body.details[0].message).toContain("use Rehire");
    expect(gap.body.details[0].message).not.toContain("Reverse End");
    const ends = (await events(p.employmentId)).filter((x) => x.eventType === "end");
    expect(ends.map((x) => x.endReasonCode)).toEqual(["PLANNED_TERM_COMPLETED"]);
    expect(await periods(p.personId)).toHaveLength(1);
  });

  it("assignments starting on or after the transition date block it untouched", async () => {
    const p = await hired("2024-01-08");
    const move = await call(changeRoute, {
      path: "/x",
      method: "POST",
      user: "editor",
      params: { id: p.employmentId },
      body: { expected_revision: await revision(p.personId), effective_date: addDays(today, 20), reason: "Planned move", department_id: ids.d.QA },
      headers: { "idempotency-key": key("mv") },
    });
    expect(move.status).toBe(201);
    const before = await rows(p.employmentId);
    for (const start of [addDays(today, 10), addDays(today, 20)]) {
      const r = await rc(p, { start_date: start });
      expect(r.status).toBe(422);
      expect(r.body.details[0].code).toBe("FUTURE_ASSIGNMENT_OUTSIDE_END");
    }
    expect(await rows(p.employmentId)).toEqual(before);
  });
});

describe("New period data", () => {
  it("creates an explicitly submitted Initial Assignment from the new start date (custom values allowed)", async () => {
    const p = await hired("2024-01-08");
    const r = await rc(p, {
      start_date: addDays(today, 7),
      end_date: addDays(today, 372),
      initial_assignment: { department_id: ids.d.QA, job_title_id: ids.j.QAE, job_level_id: ids.l.L3, manager_person_id: manager },
    });
    expect(r.status).toBe(201);
    const fresh = r.body.employments[1];
    expect(fresh.end_date).toBe(addDays(today, 372));
    expect(fresh.assignments).toHaveLength(1);
    expect(fresh.assignments[0]).toMatchObject({
      effective_from: addDays(today, 7),
      effective_to: addDays(today, 373),
      department: { id: ids.d.QA },
      job_title: { id: ids.j.QAE },
      job_level: { id: ids.l.L3 },
      manager: { person_id: manager },
    });
    expect(fresh.events.map((e: { event_type: string }) => e.event_type)).toEqual(["start"]); // planned end: no End event
    const audit = await db().auditEvent.findFirstOrThrow({ where: { entityId: fresh.assignments[0].id }, include: { fieldChanges: true } });
    expect(audit.action).toBe("assignment.initial");
    const managerEmployment = (await db().employment.findFirstOrThrow({ where: { personId: manager } })).id;
    const raw = JSON.stringify(audit, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    expect(raw).not.toContain(manager);
    expect(raw).not.toContain(managerEmployment); // manager recorded by field name only
    const bad = await rc(await hired("2024-01-08"), { start_date: addDays(today, 7), end_date: addDays(today, 6) });
    expect(bad.body.details[0].code).toBe("END_BEFORE_START");
  });

  it("Work Email: not copied by default; explicit keep and a different address are accepted", async () => {
    const keep = await hired("2024-01-08", { email: "keep.me@example.test" });
    const k = await rc(keep, { start_date: today, work_email: "keep.me@example.test" });
    expect(k.status).toBe(201);
    expect(k.body.employments[1].work_email).toBe("keep.me@example.test");
    const other = await hired("2024-01-08", { email: "old.box@example.test" });
    const o = await rc(other, { start_date: today, work_email: "new.box@example.test" });
    expect(o.body.employments.map((e: { work_email: string | null }) => e.work_email)).toEqual(["old.box@example.test", "new.box@example.test"]);
  });

  it("a conflicting Work Email rolls the whole change back (old end, assignment, events, revision)", async () => {
    await hired("2024-01-08", { email: "someone.else@example.test" });
    const p = await hired("2024-02-05");
    const before = { rows: await rows(p.employmentId), events: await events(p.employmentId), rev: await revision(p.personId) };
    const r = await rc(p, { start_date: addDays(today, 3), work_email: "someone.else@example.test" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("WORK_EMAIL_IN_USE");
    expect(await periods(p.personId)).toHaveLength(1);
    expect((await periods(p.personId))[0].endDate).toBeNull();
    expect(await rows(p.employmentId)).toEqual(before.rows);
    expect(await events(p.employmentId)).toEqual(before.events);
    expect(await revision(p.personId)).toBe(before.rev);
  });
});

describe("History, reversal and concurrency", () => {
  it("the old End cannot be reversed while the new period exists; no Reverse Relationship Change; corrections cannot collapse the periods", async () => {
    const p = await hired("2024-01-08");
    const r = await rc(p, { start_date: addDays(today, 5) });
    expect(r.status).toBe(201);
    const rev = r.body.revision;
    const reverse = await call(reverseRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: p.employmentId },
      body: { expected_revision: rev, reason: "Mistake" },
      headers: { "idempotency-key": key("rv") },
    });
    expect(reverse.status).toBe(409);
    expect(reverse.body.error).toBe("LATER_PERIOD_EXISTS");
    expect(existsSync(path.join(process.cwd(), "src/app/api/v1/core-hr/employments/[id]/reverse-relationship-change"))).toBe(false);
    const correct = (body: Record<string, unknown>) =>
      call(periodCorrectionRoute, { path: "/x", method: "POST", user: "admin", params: { id: p.employmentId }, body: { expected_revision: rev, reason: "Merge", ...body }, headers: { "idempotency-key": key("pc") } });
    expect((await correct({ end_date: null })).body.details[0].code).toBe("USE_REVERSE_END_EMPLOYMENT");
    const extend = await correct({ end_date: addDays(today, 30) });
    expect(extend.status).toBe(409);
    expect(extend.body.error).toBe("PERIOD_OVERLAP");
    expect(await periods(p.personId)).toHaveLength(2);
  });

  it("same key replays once; a different payload is rejected; different keys conflict on revision", async () => {
    const p = await hired("2024-01-08");
    const rev = await revision(p.personId);
    const k = key("rc-same");
    const body = { start_date: addDays(today, 3) };
    const both = await Promise.all([rc(p, body, "editor", k), rc(p, body, "editor", k)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect(both.map((r) => r.body.revision)).toEqual([rev + 1, rev + 1]);
    expect(await periods(p.personId)).toHaveLength(2);
    const reused = await call(rcRoute, {
      path: "/x",
      method: "POST",
      user: "editor",
      params: { id: p.employmentId },
      body: { expected_revision: rev, employee_type_id: ids.et.EMPLOYEE, reason: "Converted to a permanent contract", start_date: addDays(today, 4) },
      headers: { "idempotency-key": k },
    });
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");

    const q = await hired("2024-01-08");
    const qrev = await revision(q.personId);
    const send = (start: string, idem: string) =>
      call(rcRoute, {
        path: "/x",
        method: "POST",
        user: "editor",
        params: { id: q.employmentId },
        body: { expected_revision: qrev, employee_type_id: ids.et.EMPLOYEE, reason: "Change", start_date: start },
        headers: { "idempotency-key": idem },
      });
    const race = await Promise.all([send(addDays(today, 3), key("a")), send(addDays(today, 4), key("b"))]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(race.find((r) => r.status === 409)!.body.error).toBe("REVISION_CONFLICT");
    expect(await periods(q.personId)).toHaveLength(2);
  });
});
