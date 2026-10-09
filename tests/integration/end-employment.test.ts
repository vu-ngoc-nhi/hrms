import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as periodCorrectionRoute } from "@/app/api/v1/core-hr/employments/[id]/period-corrections/route";
import { GET as detailRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema, END_REASON_CODES, SELECTABLE_END_REASON_CODES } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { activeEndEventOf, findActiveEndEvent } from "@/modules/core-hr/employments/lifecycle-events";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// S4.7 End Employment (C-21, C-28, C-49 to C-53).
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let admin: string;
const today = todayInVietnam();
let n = 0;

async function hired(start: string, withAssignment = true) {
  n += 1;
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("ee") },
    body: {
      full_name: `Tạ Văn Khải ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`,
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        ...(withAssignment ? { assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE } } : {}),
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}

/** A planned future end date entered as data (e.g. a fixed term), with the open assignment aligned to it. */
async function withPlannedEnd(p: { employmentId: string }, end: string) {
  await db().$transaction([
    db().employment.update({ where: { id: p.employmentId }, data: { endDate: toDbDate(end) } }),
    db().jobAssignment.updateMany({ where: { employmentId: p.employmentId, effectiveTo: null }, data: { effectiveTo: toDbDate(addDays(end, 1)) } }),
  ]);
}

const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;

const end = (employmentId: string, body: Record<string, unknown>, user: TestUser = "editor", idem = key("end")) =>
  call(endRoute, { path: "/x", method: "POST", user, params: { id: employmentId }, body, headers: { "idempotency-key": idem } });

const rows = async (employmentId: string) =>
  (await db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } })).map((a) => ({
    id: a.id,
    from: fromDbDate(a.effectiveFrom),
    to: fromDbDate(a.effectiveTo),
  }));

const endEvents = (employmentId: string) => db().employmentEvent.findMany({ where: { employmentId, eventType: "end" }, orderBy: { recordedAt: "asc" } });
const audits = (entityIds: string[]) =>
  db().auditEvent.findMany({ where: { entityId: { in: entityIds } }, include: { fieldChanges: true }, orderBy: { id: "asc" } });
const values = (ev: { fieldChanges: { field: string; oldValue: string | null; newValue: string | null }[] }) =>
  Object.fromEntries(ev.fieldChanges.map((c) => [c.field, [c.oldValue, c.newValue]]));

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("End Reason reference data", () => {
  it("matches the approved C-21 catalog; RELATIONSHIP_CHANGE is system-only and OTHER needs a note", async () => {
    const reasons = await db().endReason.findMany({ orderBy: { sortOrder: "asc" } });
    expect(reasons.map((r) => r.code)).toEqual([...END_REASON_CODES]);
    expect(reasons.filter((r) => r.selectable).map((r) => r.code)).toEqual([...SELECTABLE_END_REASON_CODES]);
    expect(reasons.filter((r) => r.noteRequired).map((r) => r.code)).toEqual(["OTHER"]);
    expect(reasons.find((r) => r.code === "EMPLOYER_INITIATED_END")!.label).toBe("Employer-initiated End");
  });
});

describe("End Employment", () => {
  it("open period (null end date): HR_EDITOR ends it today; the current assignment closes at end + 1; event metadata and audit", async () => {
    const p = await hired("2024-03-04");
    const [row] = await rows(p.employmentId);
    const rev = await revision(p.personId);
    const r = await end(p.employmentId, { expected_revision: rev, end_date: today, end_reason_code: "VOLUNTARY_RESIGNATION" });
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.revision).toBe(rev + 1);
    expect(d.employments[0]).toMatchObject({ end_date: today, period_lifecycle: "active", has_active_end_event: true });
    expect(d.employments[0].events.at(-1)).toMatchObject({
      event_type: "end",
      effective_date: today,
      end_reason: { code: "VOLUNTARY_RESIGNATION", label: "Voluntary Resignation" },
    });
    expect((await rows(p.employmentId))[0]).toEqual({ ...row, to: addDays(today, 1) });

    const [ev] = await endEvents(p.employmentId);
    expect({
      previous: ev.previousEndDate,
      closed: ev.closedAssignmentId,
      closedPrevTo: ev.closedAssignmentPreviousEffectiveTo,
      reverses: ev.reversesEventId,
      reason: ev.endReasonCode,
      note: ev.endNote,
    }).toEqual({ previous: null, closed: row.id, closedPrevTo: null, reverses: null, reason: "VOLUNTARY_RESIGNATION", note: null });

    const evs = await audits([p.employmentId, row.id]);
    expect(evs.map((e) => [e.action, e.entityType])).toEqual([
      ["employment.end", "employment"],
      ["assignment.close", "job_assignment"],
    ]);
    expect(new Set(evs.map((e) => e.requestId)).size).toBe(1);
    expect(evs[0].changedFields).toEqual(["employment.end_date", "employment_event.end"]);
    expect(values(evs[0])).toEqual({ "employment.end_date": [null, today] });
    expect(values(evs[1])).toEqual({ "assignment.effective_to": [null, addDays(today, 1)] });
    expect(evs[0].reason).toBe("End Reason: VOLUNTARY_RESIGNATION");
  });

  it("HR_EDITOR may end in the future (still Active); backdated needs HR_ADMIN", async () => {
    const p = await hired("2023-05-02");
    const future = addDays(today, 45);
    const r = await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: future, end_reason_code: "MUTUAL_AGREEMENT" });
    expect(r.status).toBe(201);
    expect(r.body.employment_status).toBe("active");

    const q = await hired("2022-01-03");
    const past = addDays(today, -10);
    const denied = await end(q.employmentId, { expected_revision: await revision(q.personId), end_date: past, end_reason_code: "OTHER", note: "Left earlier" });
    expect(denied.status).toBe(403);
    expect(await endEvents(q.employmentId)).toEqual([]);
    const ok = await end(q.employmentId, { expected_revision: await revision(q.personId), end_date: past, end_reason_code: "EMPLOYER_INITIATED_END" }, "admin");
    expect(ok.status).toBe(201);
    expect(ok.body.employments[0].period_lifecycle).toBe("ended");
    expect((await rows(q.employmentId))[0].to).toBe(addDays(past, 1));
  });

  it("shortens an existing future end date and captures the previous end date and assignment end exactly", async () => {
    const p = await hired("2024-01-08");
    const planned = addDays(today, 90);
    await withPlannedEnd(p, planned);
    const [row] = await rows(p.employmentId);
    const actual = addDays(today, 30);
    const r = await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: actual, end_reason_code: "PLANNED_TERM_COMPLETED" });
    expect(r.status).toBe(201);
    expect(r.body.employments[0].end_date).toBe(actual);
    expect((await rows(p.employmentId))[0].to).toBe(addDays(actual, 1));
    const [ev] = await endEvents(p.employmentId);
    expect(fromDbDate(ev.previousEndDate)).toBe(planned);
    expect(ev.closedAssignmentId).toBe(row.id);
    expect(fromDbDate(ev.closedAssignmentPreviousEffectiveTo)).toBe(addDays(planned, 1));
    const [period] = await audits([p.employmentId]);
    expect(values(period)).toEqual({ "employment.end_date": [planned, actual] });
  });

  it("confirms an existing future end date with the same date: event + audit only, no data change, no assignment effect", async () => {
    const p = await hired("2024-01-08");
    const planned = addDays(today, 60);
    await withPlannedEnd(p, planned);
    const before = await rows(p.employmentId);
    const r = await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: planned, end_reason_code: "PLANNED_TERM_COMPLETED" });
    expect(r.status).toBe(201);
    expect(await rows(p.employmentId)).toEqual(before);
    const [ev] = await endEvents(p.employmentId);
    expect({ previous: fromDbDate(ev.previousEndDate), closed: ev.closedAssignmentId, closedPrevTo: ev.closedAssignmentPreviousEffectiveTo }).toEqual({
      previous: planned,
      closed: null,
      closedPrevTo: null,
    });
    const evs = await audits([p.employmentId, before[0].id]);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ action: "employment.end", changedFields: ["employment_event.end"] });
    expect(evs[0].fieldChanges).toEqual([]);
  });

  it("rejects moving a planned end date later (historical correction instead)", async () => {
    const p = await hired("2024-01-08");
    const planned = addDays(today, 20);
    await withPlannedEnd(p, planned);
    const r = await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: addDays(planned, 1), end_reason_code: "MUTUAL_AGREEMENT" });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("END_DATE_LATER_THAN_PLANNED");
    expect(await endEvents(p.employmentId)).toEqual([]);
  });

  it("rejects a period that already ended; a legacy end date without an event stays supported", async () => {
    const p = await hired("2020-02-03");
    await withPlannedEnd(p, "2022-06-30"); // legacy-style ended period, no end event
    const rev = await revision(p.personId);
    const r = await end(p.employmentId, { expected_revision: rev, end_date: "2022-05-31", end_reason_code: "OTHER", note: "x" }, "admin");
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("PERIOD_ALREADY_ENDED");
    const detail = await call(detailRoute, { path: "/x", user: "editor", params: { id: p.personId } });
    expect(detail.body.employments[0]).toMatchObject({ period_lifecycle: "ended", has_active_end_event: false });
    // Historical correction still works and does not synthesize an End event.
    const fix = await call(periodCorrectionRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: p.employmentId },
      body: { expected_revision: rev, reason: "Last day was 31 May", end_date: "2022-05-31" },
      headers: { "idempotency-key": key("fix") },
    });
    expect(fix.status).toBe(200);
    expect(await endEvents(p.employmentId)).toEqual([]);
  });

  it("an Active End Event blocks a second End action, even with an earlier date", async () => {
    const p = await hired("2024-02-05");
    expect((await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: addDays(today, 40), end_reason_code: "VOLUNTARY_RESIGNATION" })).status).toBe(201);
    const again = await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: addDays(today, 10), end_reason_code: "MUTUAL_AGREEMENT" });
    expect(again.status).toBe(422);
    expect(again.body.details[0].code).toBe("END_ALREADY_RECORDED");
    expect(await endEvents(p.employmentId)).toHaveLength(1);
  });

  it("validates End Reasons: OTHER needs a note (never shown in history); RELATIONSHIP_CHANGE and unknown codes are rejected", async () => {
    const p = await hired("2024-02-05");
    const rev = await revision(p.personId);
    const noNote = await end(p.employmentId, { expected_revision: rev, end_date: today, end_reason_code: "OTHER" });
    expect(noNote.status).toBe(422);
    expect(noNote.body.details[0].code).toBe("NOTE_REQUIRED");
    const system = await end(p.employmentId, { expected_revision: rev, end_date: today, end_reason_code: "RELATIONSHIP_CHANGE" });
    expect(system.status).toBe(422);
    expect(system.body.details[0].code).toBe("END_REASON_NOT_SELECTABLE");
    expect((await end(p.employmentId, { expected_revision: rev, end_date: today, end_reason_code: "CANCELLED_PLAN" })).status).toBe(400);
    const ok = await end(p.employmentId, { expected_revision: rev, end_date: today, end_reason_code: "OTHER", note: "Relocated abroad for family reasons" });
    expect(ok.status).toBe(201);
    expect((await endEvents(p.employmentId))[0].endNote).toBe("Relocated abroad for family reasons");
    expect(JSON.stringify(ok.body)).not.toContain("Relocated abroad");
  });

  it("blocks when an assignment starts after the end date, without touching it (C-28)", async () => {
    const p = await hired("2024-02-05");
    const move = await call(changeRoute, {
      path: "/x",
      method: "POST",
      user: "editor",
      params: { id: p.employmentId },
      body: { expected_revision: await revision(p.personId), effective_date: addDays(today, 30), reason: "Planned transfer", department_id: ids.d.QA },
      headers: { "idempotency-key": key("mv") },
    });
    expect(move.status).toBe(201);
    const before = await rows(p.employmentId);
    const r = await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: addDays(today, 10), end_reason_code: "VOLUNTARY_RESIGNATION" });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("FUTURE_ASSIGNMENT_OUTSIDE_END");
    expect(r.body.details[0].message).toContain(before[1].id);
    expect(await rows(p.employmentId)).toEqual(before);
    expect(await endEvents(p.employmentId)).toEqual([]);
  });

  it("stores no assignment effect when no assignment needs to change", async () => {
    const p = await hired("2024-02-05", false);
    const r = await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: today, end_reason_code: "MUTUAL_AGREEMENT" });
    expect(r.status).toBe(201);
    const [ev] = await endEvents(p.employmentId);
    expect([ev.closedAssignmentId, ev.closedAssignmentPreviousEffectiveTo, ev.previousEndDate]).toEqual([null, null, null]);
  });

  it("rejects cancelled periods and dates before the start", async () => {
    const c = await hired(addDays(today, 30));
    const early = await end(c.employmentId, { expected_revision: await revision(c.personId), end_date: addDays(today, 29), end_reason_code: "MUTUAL_AGREEMENT" });
    expect(early.status).toBe(422);
    expect(early.body.details[0].code).toBe("END_BEFORE_START");
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [c.employmentId]);
    const r = await end(c.employmentId, { expected_revision: await revision(c.personId), end_date: addDays(today, 31), end_reason_code: "MUTUAL_AGREEMENT" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");
    expect((await end(c.employmentId, { expected_revision: 1, end_date: today, end_reason_code: "MUTUAL_AGREEMENT" }, "docs")).status).toBe(403);
  });
});

describe("Idempotency, concurrency and rollback", () => {
  it("same key + same payload executes once; same key + different payload is rejected; different keys conflict on revision", async () => {
    const p = await hired("2024-02-05");
    const rev = await revision(p.personId);
    const k = key("end-same");
    const body = { expected_revision: rev, end_date: addDays(today, 15), end_reason_code: "VOLUNTARY_RESIGNATION" };
    const results = await Promise.all([end(p.employmentId, body, "editor", k), end(p.employmentId, body, "editor", k)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect(results.map((r) => r.body.revision)).toEqual([rev + 1, rev + 1]);
    expect(await endEvents(p.employmentId)).toHaveLength(1);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId, action: "employment.end" } })).toBe(1);
    const reused = await end(p.employmentId, { ...body, end_reason_code: "MUTUAL_AGREEMENT" }, "editor", k);
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");

    const q = await hired("2024-02-05");
    const qrev = await revision(q.personId);
    const race = await Promise.all([
      end(q.employmentId, { expected_revision: qrev, end_date: addDays(today, 15), end_reason_code: "VOLUNTARY_RESIGNATION" }, "editor", key("r1")),
      end(q.employmentId, { expected_revision: qrev, end_date: addDays(today, 20), end_reason_code: "MUTUAL_AGREEMENT" }, "editor", key("r2")),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(race.find((r) => r.status === 409)!.body.error).toBe("REVISION_CONFLICT");
    expect(await endEvents(q.employmentId)).toHaveLength(1);
  });

  it("rolls back every write when the end event cannot be inserted (concurrent End event caught by the DB rule)", async () => {
    const p = await hired("2024-02-05");
    const before = await rows(p.employmentId);
    const rev = await revision(p.personId);
    // Another transaction records an End event without touching the person revision; it locks the period row.
    await app.query("BEGIN");
    try {
      await app.query(
        "INSERT INTO employment_event (employment_id, event_type, effective_date, end_reason_code, recorded_by) VALUES ($1, 'end', $2, 'MUTUAL_AGREEMENT', $3)",
        [p.employmentId, addDays(today, 50), admin],
      );
      const pending = end(p.employmentId, { expected_revision: rev, end_date: addDays(today, 5), end_reason_code: "VOLUNTARY_RESIGNATION" });
      const watcher = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await watcher.connect();
      let waiting = 0;
      for (let i = 0; i < 60 && waiting < 1; i += 1) {
        const { rows: w } = await watcher.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND wait_event_type = 'Lock' AND query ILIKE '%UPDATE%employment%'",
        );
        waiting = w[0].n;
        if (waiting < 1) await new Promise((r) => setTimeout(r, 50));
      }
      await watcher.end();
      expect(waiting).toBe(1); // the End Employment transaction has validated and is now writing
      await app.query("COMMIT");
      const r = await pending;
      expect(r.status).toBe(422);
      expect(r.body.details[0].code).toBe("END_ALREADY_RECORDED");
    } finally {
      await app.query("ROLLBACK").catch(() => undefined);
    }
    expect((await db().employment.findUniqueOrThrow({ where: { id: p.employmentId } })).endDate).toBeNull();
    expect(await rows(p.employmentId)).toEqual(before);
    expect(await revision(p.personId)).toBe(rev);
    expect(await audits([p.employmentId, before[0].id])).toEqual([]);
    expect(await endEvents(p.employmentId)).toHaveLength(1); // only the other transaction's event
  });
});

describe("Active End Event and lifecycle metadata rules", () => {
  it("a reversed End event is not active; one reversal per End event; at most one Active End Event", async () => {
    const p = await hired("2024-02-05");
    expect((await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: addDays(today, 30), end_reason_code: "MUTUAL_AGREEMENT" })).status).toBe(201);
    const [e1] = await endEvents(p.employmentId);
    expect((await findActiveEndEvent(db(), p.employmentId))?.id).toBe(e1.id);
    // Second active End event rejected by the DB as well.
    await expect(
      app.query("INSERT INTO employment_event (employment_id, event_type, effective_date, recorded_by) VALUES ($1, 'end', $2, $3)", [p.employmentId, today, admin]),
    ).rejects.toMatchObject({ code: "23505" });
    // Simulated reversal (S4.7R is not implemented): the End event is no longer active.
    await app.query("INSERT INTO employment_event (employment_id, event_type, effective_date, reverses_event_id, recorded_by) VALUES ($1, 'end_reversed', $2, $3, $4)", [
      p.employmentId,
      today,
      e1.id,
      admin,
    ]);
    expect(await findActiveEndEvent(db(), p.employmentId)).toBeNull();
    const all = await db().employmentEvent.findMany({ where: { employmentId: p.employmentId } });
    expect(activeEndEventOf(all)).toBeNull();
    await expect(
      app.query("INSERT INTO employment_event (employment_id, event_type, effective_date, reverses_event_id, recorded_by) VALUES ($1, 'end_reversed', $2, $3, $4)", [
        p.employmentId,
        today,
        e1.id,
        admin,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    const start = all.find((e) => e.eventType === "start")!;
    await expect(
      app.query("INSERT INTO employment_event (employment_id, event_type, effective_date, reverses_event_id, recorded_by) VALUES ($1, 'end_reversed', $2, $3, $4)", [
        p.employmentId,
        today,
        start.id,
        admin,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    // After the reversal a new End event may become the Active End Event.
    await app.query("INSERT INTO employment_event (employment_id, event_type, effective_date, end_reason_code, recorded_by) VALUES ($1, 'end', $2, 'MUTUAL_AGREEMENT', $3)", [
      p.employmentId,
      addDays(today, 20),
      admin,
    ]);
    const active = await findActiveEndEvent(db(), p.employmentId);
    expect(active?.id).not.toBe(e1.id);
    expect(activeEndEventOf(await db().employmentEvent.findMany({ where: { employmentId: p.employmentId } }))?.id).toBe(active?.id);
  });

  it("CHECK constraints keep End metadata on end events and reversal links on end_reversed events", async () => {
    const p = await hired("2024-02-05");
    const bad = [
      ["INSERT INTO employment_event (employment_id, event_type, effective_date, previous_end_date, recorded_by) VALUES ($1, 'start', $2, $2, $3)", "23514"],
      ["INSERT INTO employment_event (employment_id, event_type, effective_date, end_reason_code, recorded_by) VALUES ($1, 'end', $2, 'OTHER', $3)", "23514"],
      ["INSERT INTO employment_event (employment_id, event_type, effective_date, closed_assignment_previous_effective_to, recorded_by) VALUES ($1, 'end', $2, $2, $3)", "23514"],
      ["INSERT INTO employment_event (employment_id, event_type, effective_date, recorded_by) VALUES ($1, 'end_reversed', $2, $3)", "23514"],
    ] as const;
    for (const [sql, code] of bad) await expect(app.query(sql, [p.employmentId, today, admin])).rejects.toMatchObject({ code });
  });

  it("metadata is immutable: only effective_date is updatable by the app, and the trigger guards every metadata column", async () => {
    const p = await hired("2024-02-05");
    expect((await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: addDays(today, 30), end_reason_code: "MUTUAL_AGREEMENT" })).status).toBe(201);
    const [ev] = await endEvents(p.employmentId);
    for (const col of ["previous_end_date", "closed_assignment_previous_effective_to"]) {
      await expect(app.query(`UPDATE employment_event SET ${col} = '2030-01-01' WHERE id = $1`, [ev.id])).rejects.toMatchObject({ code: "42501" });
    }
    for (const col of ["end_reason_code", "end_note", "closed_assignment_id", "reverses_event_id"]) {
      await expect(app.query(`UPDATE employment_event SET ${col} = NULL WHERE id = $1`, [ev.id])).rejects.toMatchObject({ code: "42501" });
    }
    const { rows: fn } = await app.query("SELECT pg_get_functiondef('employment_event_date_correction_scope'::regproc) AS def");
    for (const col of ["end_reason_code", "end_note", "previous_end_date", "closed_assignment_id", "closed_assignment_previous_effective_to", "reverses_event_id"]) {
      expect(fn[0].def).toContain(`NEW.${col}`);
    }
  });

  it("an end-date correction syncs the Active End Event date only; its metadata stays as recorded", async () => {
    const p = await hired("2024-02-05");
    const planned = addDays(today, 30);
    expect((await end(p.employmentId, { expected_revision: await revision(p.personId), end_date: planned, end_reason_code: "MUTUAL_AGREEMENT" })).status).toBe(201);
    const [before] = await endEvents(p.employmentId);
    const fix = await call(periodCorrectionRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: p.employmentId },
      body: { expected_revision: await revision(p.personId), reason: "Agreed last day was later", end_date: addDays(planned, 7) },
      headers: { "idempotency-key": key("fix") },
    });
    expect(fix.status).toBe(200);
    const [after] = await endEvents(p.employmentId);
    expect(fromDbDate(after.effectiveDate)).toBe(addDays(planned, 7));
    expect({ ...after, effectiveDate: null }).toEqual({ ...before, effectiveDate: null });
    expect((await rows(p.employmentId))[0].to).toBe(addDays(planned, 8));
  });
});
