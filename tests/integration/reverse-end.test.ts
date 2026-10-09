import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as periodCorrectionRoute } from "@/app/api/v1/core-hr/employments/[id]/period-corrections/route";
import { POST as reverseRoute } from "@/app/api/v1/core-hr/employments/[id]/reverse-end/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// S4.7R Reverse End Employment (C-38, C-54 to C-57): exact reversal or no reversal.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let admin: string;
const today = todayInVietnam();
let n = 0;

async function hired(start: string, o: { assignment?: boolean; email?: string } = {}) {
  n += 1;
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("rv") },
    body: {
      full_name: `Mai Thanh Sơn ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`,
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        ...(o.email ? { work_email: o.email } : {}),
        ...(o.assignment === false ? {} : { assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE } }),
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}

async function withPlannedEnd(employmentId: string, end: string) {
  await db().$transaction([
    db().employment.update({ where: { id: employmentId }, data: { endDate: toDbDate(end) } }),
    db().jobAssignment.updateMany({ where: { employmentId, effectiveTo: null }, data: { effectiveTo: toDbDate(addDays(end, 1)) } }),
  ]);
}

/** A later period of the same person, written directly (Rehire is S4.8). */
async function laterPeriod(personId: string, start: string, email?: string) {
  return (await db().employment.create({ data: { personId, startDate: toDbDate(start), employeeTypeId: ids.et.EMPLOYEE, workEmail: email ?? null, createdBy: admin } })).id;
}

const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;

const endIt = async (p: { personId: string; employmentId: string }, end: string, user: TestUser = "admin", code = "VOLUNTARY_RESIGNATION") => {
  const r = await call(endRoute, {
    path: "/x",
    method: "POST",
    user,
    params: { id: p.employmentId },
    body: { expected_revision: await revision(p.personId), end_date: end, end_reason_code: code },
    headers: { "idempotency-key": key("end") },
  });
  expect(r.status).toBe(201);
};

const reverse = (employmentId: string, body: Record<string, unknown>, user: TestUser = "admin", idem = key("rev")) =>
  call(reverseRoute, { path: "/x", method: "POST", user, params: { id: employmentId }, body, headers: { "idempotency-key": idem } });

const rows = async (employmentId: string) =>
  (await db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } })).map((a) => ({
    id: a.id,
    from: fromDbDate(a.effectiveFrom),
    to: fromDbDate(a.effectiveTo),
  }));
const endDate = async (employmentId: string) => fromDbDate((await db().employment.findUniqueOrThrow({ where: { id: employmentId } })).endDate);
const events = (employmentId: string) => db().employmentEvent.findMany({ where: { employmentId }, orderBy: { recordedAt: "asc" } });
const audits = (entityIds: string[]) =>
  db().auditEvent.findMany({ where: { entityId: { in: entityIds } }, include: { fieldChanges: true }, orderBy: { id: "asc" } });
const values = (ev: { fieldChanges: { field: string; oldValue: string | null; newValue: string | null }[] }) =>
  Object.fromEntries(ev.fieldChanges.map((c) => [c.field, [c.oldValue, c.newValue]]));
const reversalAudits = async (ids_: string[]) => (await audits(ids_)).filter((a) => a.action === "employment.end.reverse" || a.action === "assignment.restore");

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("Reverse End Employment", () => {
  it("is HR_ADMIN only and needs an Active End Event (legacy end dates use Correct Period)", async () => {
    const p = await hired("2024-03-04");
    await endIt(p, addDays(today, 30), "editor");
    const rev = await revision(p.personId);
    expect((await reverse(p.employmentId, { expected_revision: rev, reason: "Mistake" }, "editor")).status).toBe(403);
    expect((await reverse(p.employmentId, { expected_revision: rev, reason: "Mistake" }, "docs")).status).toBe(403);
    expect((await reverse(p.employmentId, { expected_revision: rev })).status).toBe(400);
    const blank = await reverse(p.employmentId, { expected_revision: rev, reason: "  " });
    expect(blank.status).toBe(422);
    expect(blank.body.details[0].code).toBe("REASON_REQUIRED");

    const legacy = await hired("2019-02-04");
    await withPlannedEnd(legacy.employmentId, "2021-06-30");
    const none = await reverse(legacy.employmentId, { expected_revision: await revision(legacy.personId), reason: "Never left" });
    expect(none.status).toBe(422);
    expect(none.body.details[0].code).toBe("NO_ACTIVE_END_EVENT");
    const open = await hired("2024-03-04");
    expect((await reverse(open.employmentId, { expected_revision: await revision(open.personId), reason: "x" })).body.details[0].code).toBe("NO_ACTIVE_END_EVENT");
  });

  it("previous_end_date null: reopens the period and the closed assignment exactly; original End event and End Reason preserved", async () => {
    const p = await hired("2024-03-04");
    const [row] = await rows(p.employmentId);
    await endIt(p, addDays(today, 30), "editor", "MUTUAL_AGREEMENT");
    const [, endEvent] = await events(p.employmentId);
    const rev = await revision(p.personId);
    const r = await reverse(p.employmentId, { expected_revision: rev, reason: "End was entered for the wrong employee" });
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.revision).toBe(rev + 1);
    expect(d.employments[0]).toMatchObject({ end_date: null, has_active_end_event: false, active_end_event: null, period_lifecycle: "active" });
    expect(d.employments[0].events.map((e) => [e.event_type, e.end_reason?.code ?? null])).toEqual([
      ["start", null],
      ["end", "MUTUAL_AGREEMENT"],
      ["end_reversed", null],
    ]);
    expect(JSON.stringify(r.body)).not.toContain("wrong employee"); // free-text reversal reason never in history
    expect(await rows(p.employmentId)).toEqual([{ ...row, to: null }]);

    const all = await events(p.employmentId);
    expect(all.find((e) => e.id === endEvent.id)).toEqual(endEvent); // original End event untouched
    const reversal = all.find((e) => e.eventType === "end_reversed")!;
    expect(reversal).toMatchObject({ reversesEventId: endEvent.id, reason: "End was entered for the wrong employee", recordedBy: admin, endReasonCode: null });
    expect(fromDbDate(reversal.effectiveDate)).toBe(addDays(today, 30));

    const [period, assignment] = await reversalAudits([p.employmentId, row.id]);
    expect(period).toMatchObject({ action: "employment.end.reverse", reason: "End was entered for the wrong employee" });
    expect(period.changedFields).toEqual(["employment.end_date", "employment_event.end_reversed"]);
    expect(values(period)).toEqual({ "employment.end_date": [addDays(today, 30), null] });
    expect(assignment).toMatchObject({ action: "assignment.restore", entityType: "job_assignment", requestId: period.requestId });
    expect(values(assignment)).toEqual({ "assignment.effective_to": [addDays(today, 31), null] });

    // Already reversed: no Active End Event remains; End Employment may be recorded again.
    const twice = await reverse(p.employmentId, { expected_revision: rev + 1, reason: "Again" });
    expect(twice.status).toBe(422);
    expect(twice.body.details[0].code).toBe("NO_ACTIVE_END_EVENT");
  });

  it("previous future end date: restores the planned date and the assignment's exact previous effective_to", async () => {
    const p = await hired("2024-03-04");
    const planned = addDays(today, 90);
    await withPlannedEnd(p.employmentId, planned);
    await endIt(p, addDays(today, 30), "editor");
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Resignation withdrawn" });
    expect(r.status).toBe(201);
    expect(await endDate(p.employmentId)).toBe(planned);
    expect((await rows(p.employmentId))[0].to).toBe(addDays(planned, 1));
  });

  it("C-56: a later correction of the End date is not kept; previous_end_date is the target", async () => {
    const p = await hired("2024-03-04");
    const planned = addDays(today, 90);
    await withPlannedEnd(p.employmentId, planned);
    await endIt(p, addDays(today, 30));
    const fix = await call(periodCorrectionRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: p.employmentId },
      body: { expected_revision: await revision(p.personId), reason: "Last day was later", end_date: addDays(today, 35) },
      headers: { "idempotency-key": key("fix") },
    });
    expect(fix.status).toBe(200);
    const endEvent = (await events(p.employmentId)).find((e) => e.eventType === "end")!;
    expect(fromDbDate(endEvent.previousEndDate)).toBe(planned); // the correction never touches previous_end_date
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Never left" });
    expect(r.status).toBe(201);
    expect(await endDate(p.employmentId)).toBe(planned);
    expect((await rows(p.employmentId))[0].to).toBe(addDays(planned, 1));
  });

  it("C-57: reversing a same-date confirmation keeps the planned end date and touches no assignment", async () => {
    const p = await hired("2024-03-04");
    const planned = addDays(today, 60);
    await withPlannedEnd(p.employmentId, planned);
    await endIt(p, planned, "editor", "PLANNED_TERM_COMPLETED");
    const before = await rows(p.employmentId);
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Recorded on the wrong period" });
    expect(r.status).toBe(201);
    expect(r.body.employments[0]).toMatchObject({ end_date: planned, has_active_end_event: false });
    expect(await rows(p.employmentId)).toEqual(before);
    const audit = await reversalAudits([p.employmentId, before[0].id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].changedFields).toEqual(["employment_event.end_reversed"]);
    expect(audit[0].fieldChanges).toEqual([]);
  });

  it("no assignment is modified when End had no assignment side effect", async () => {
    const p = await hired("2024-03-04", { assignment: false });
    await endIt(p, addDays(today, 10));
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Mistake" });
    expect(r.status).toBe(201);
    expect(await rows(p.employmentId)).toEqual([]);
    expect(await endDate(p.employmentId)).toBeNull();
  });

  it("a historical previous_end_date is restored and the period may stay Ended", async () => {
    // End event written directly with the C-52 metadata (End Employment itself cannot start on an ended period).
    const p = await hired("2020-01-06");
    await withPlannedEnd(p.employmentId, "2022-12-31");
    const [row] = await rows(p.employmentId);
    await db().$transaction([
      db().employment.update({ where: { id: p.employmentId }, data: { endDate: toDbDate("2022-11-30") } }),
      db().jobAssignment.update({ where: { id: row.id }, data: { effectiveTo: toDbDate("2022-12-01") } }),
      db().employmentEvent.create({
        data: {
          employmentId: p.employmentId,
          eventType: "end",
          effectiveDate: toDbDate("2022-11-30"),
          endReasonCode: "VOLUNTARY_RESIGNATION",
          previousEndDate: toDbDate("2022-12-31"),
          closedAssignmentId: row.id,
          closedAssignmentPreviousEffectiveTo: toDbDate("2023-01-01"),
          recordedBy: admin,
        },
      }),
    ]);
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Left on the planned date" });
    expect(r.status).toBe(201);
    expect(r.body.employments[0]).toMatchObject({ end_date: "2022-12-31", period_lifecycle: "ended", has_active_end_event: false });
    expect((await rows(p.employmentId))[0].to).toBe("2023-01-01");
  });
});

describe("Reversal is blocked instead of rewriting later history", () => {
  it("C-55: Assignment Change after a future End stays allowed but makes the End effect irreversible (END_EFFECT_CHANGED)", async () => {
    const p = await hired("2024-03-04");
    await endIt(p, addDays(today, 40), "editor");
    const move = await call(changeRoute, {
      path: "/x",
      method: "POST",
      user: "editor",
      params: { id: p.employmentId },
      body: { expected_revision: await revision(p.personId), effective_date: addDays(today, 20), reason: "Transfer before leaving", department_id: ids.d.QA },
      headers: { "idempotency-key": key("mv") },
    });
    expect(move.status).toBe(201);
    const before = await rows(p.employmentId);
    const rev = await revision(p.personId);
    const r = await reverse(p.employmentId, { expected_revision: rev, reason: "Mistake" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("END_EFFECT_CHANGED");
    expect(await rows(p.employmentId)).toEqual(before);
    expect(await endDate(p.employmentId)).toBe(addDays(today, 40));
    expect(await revision(p.personId)).toBe(rev);
  });

  it("a later period of the same person blocks the reversal (LATER_PERIOD_EXISTS)", async () => {
    const p = await hired("2023-01-02");
    await endIt(p, addDays(today, -60));
    await laterPeriod(p.personId, addDays(today, -10));
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Mistake" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("LATER_PERIOD_EXISTS");
    expect(await endDate(p.employmentId)).toBe(addDays(today, -60));
  });

  it("a Work Email range conflict blocks the reversal (WORK_EMAIL_IN_USE)", async () => {
    const x = await hired("2023-01-02", { email: "reused.after.end@example.test" });
    await endIt(x, addDays(today, -60));
    const y = await hired(addDays(today, -30), { email: "reused.after.end@example.test" });
    expect(y.personId).not.toBe(x.personId);
    const r = await reverse(x.employmentId, { expected_revision: await revision(x.personId), reason: "Mistake" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("WORK_EMAIL_IN_USE");
    expect(await endDate(x.employmentId)).toBe(addDays(today, -60));
    expect((await events(x.employmentId)).some((e) => e.eventType === "end_reversed")).toBe(false);
  });

  it("a later lifecycle event blocks the reversal (LATER_LIFECYCLE_EVENT)", async () => {
    const p = await hired("2023-01-02");
    await endIt(p, addDays(today, 30));
    await db().employmentEvent.create({ data: { employmentId: p.employmentId, eventType: "suspend", effectiveDate: toDbDate(addDays(today, 5)), recordedBy: admin } });
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Mistake" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("LATER_LIFECYCLE_EVENT");
  });

  it("an end date that no longer matches the End event is not guessed (END_STATE_INCONSISTENT)", async () => {
    const p = await hired("2023-01-02", { assignment: false });
    await endIt(p, addDays(today, 30));
    await db().employment.update({ where: { id: p.employmentId }, data: { endDate: toDbDate(addDays(today, 31)) } });
    const r = await reverse(p.employmentId, { expected_revision: await revision(p.personId), reason: "Mistake" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("END_STATE_INCONSISTENT");
  });
});

describe("Idempotency, concurrency and rollback", () => {
  it("same key replays once; different payload is rejected; different keys conflict on revision", async () => {
    const p = await hired("2024-03-04");
    await endIt(p, addDays(today, 30));
    const rev = await revision(p.personId);
    const k = key("rv-same");
    const body = { expected_revision: rev, reason: "Mistake" };
    const results = await Promise.all([reverse(p.employmentId, body, "admin", k), reverse(p.employmentId, body, "admin", k)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect((await events(p.employmentId)).filter((e) => e.eventType === "end_reversed")).toHaveLength(1);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId, action: "employment.end.reverse" } })).toBe(1);
    const reused = await reverse(p.employmentId, { ...body, reason: "Different" }, "admin", k);
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");

    const q = await hired("2024-03-04");
    await endIt(q, addDays(today, 30));
    const qrev = await revision(q.personId);
    const race = await Promise.all([
      reverse(q.employmentId, { expected_revision: qrev, reason: "A" }, "admin", key("a")),
      reverse(q.employmentId, { expected_revision: qrev, reason: "B" }, "admin", key("b")),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(race.find((r) => r.status === 409)!.body.error).toBe("REVISION_CONFLICT");
  });

  it("rollback: a committed competing reversal makes the request fail and leaves the original End fully intact", async () => {
    const p = await hired("2024-03-04");
    await endIt(p, addDays(today, 30));
    const before = { end: await endDate(p.employmentId), rows: await rows(p.employmentId), events: await events(p.employmentId), rev: await revision(p.personId) };
    const endEvent = before.events.find((e) => e.eventType === "end")!;
    await app.query("BEGIN");
    let r;
    try {
      await app.query("INSERT INTO employment_event (employment_id, event_type, effective_date, reverses_event_id, recorded_by) VALUES ($1, 'end_reversed', $2, $3, $4)", [
        p.employmentId,
        addDays(today, 30),
        endEvent.id,
        admin,
      ]);
      const pending = reverse(p.employmentId, { expected_revision: before.rev, reason: "Mistake" });
      const watcher = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await watcher.connect();
      let waiting = 0;
      for (let i = 0; i < 60 && waiting < 1; i += 1) {
        const { rows: w } = await watcher.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND wait_event_type = 'Lock' AND query ILIKE '%UPDATE%employment%'",
        );
        waiting = w[0].n;
        if (waiting < 1) await new Promise((res) => setTimeout(res, 50));
      }
      await watcher.end();
      expect(waiting).toBe(1); // validated and already writing the restored end date
      await app.query("COMMIT");
      r = await pending;
    } finally {
      await app.query("ROLLBACK").catch(() => undefined);
    }
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("END_ALREADY_REVERSED");
    expect(await endDate(p.employmentId)).toBe(before.end);
    expect(await rows(p.employmentId)).toEqual(before.rows);
    expect(await revision(p.personId)).toBe(before.rev);
    const after = await events(p.employmentId);
    expect(after.find((e) => e.id === endEvent.id)).toEqual(endEvent);
    expect(after.filter((e) => e.eventType === "end_reversed")).toHaveLength(1); // only the competitor's
    expect(await reversalAudits([p.employmentId, before.rows[0].id])).toEqual([]);
  });
});
