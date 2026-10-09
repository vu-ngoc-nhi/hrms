import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as initialRoute } from "@/app/api/v1/core-hr/employments/[id]/initial-assignment/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, type TestUser } from "../helpers";

// S4.5A (C-41): Add Initial Assignment is separate from Assignment Change.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let inactiveDept: string;
const today = todayInVietnam();
let n = 0;

async function period(start: string, withAssignment = false) {
  n += 1;
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("ia") },
    body: {
      full_name: `Lã Thị Hồng ${String.fromCharCode(64 + n)}`,
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        ...(withAssignment ? { assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE } } : {}),
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string, revision: r.body.revision as number };
}

const add = (employmentId: string, body: Record<string, unknown>, user: TestUser = "editor", idem = key("init")) =>
  call(initialRoute, { path: "/x", method: "POST", user, params: { id: employmentId }, body, headers: { "idempotency-key": idem } });

const rows = (employmentId: string) => db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } });
const audits = (employmentId: string) =>
  db().auditEvent.findMany({ where: { entityId: employmentId }, include: { fieldChanges: true }, orderBy: { id: "asc" } });

beforeAll(async () => {
  ids = await catalogIds();
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  inactiveDept = (await db().department.create({ data: { code: "IA_RETIRED", name: "Retired Unit", isActive: false } })).id;
});
afterAll(async () => {
  await app.end();
});

describe("Add Initial Assignment", () => {
  it("HR_EDITOR adds the first assignment to a pre-start period without a reason; no lifecycle event is created", async () => {
    const p = await period(addDays(today, 10));
    const eventsBefore = await db().employmentEvent.count({ where: { employmentId: p.employmentId } });
    const r = await add(p.employmentId, {
      expected_revision: p.revision,
      effective_date: addDays(today, 10),
      department_id: ids.d.ENG,
      job_title_id: ids.j.SE,
      job_level_id: ids.l.L1,
    });
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.revision).toBe(p.revision + 1);
    const [row] = await rows(p.employmentId);
    expect({ from: fromDbDate(row.effectiveFrom), to: row.effectiveTo, reason: row.changeReason }).toEqual({
      from: addDays(today, 10),
      to: null,
      reason: "initial_assignment",
    });
    expect(await db().employmentEvent.count({ where: { employmentId: p.employmentId } })).toBe(eventsBefore);
    const [ev] = await audits(p.employmentId);
    expect(ev).toMatchObject({ action: "assignment.initial", reason: null });
    expect(ev.fieldChanges.map((c) => c.field).sort()).toEqual(["assignment.effective_from", "department_id", "job_level_id", "job_title_id"]);
  });

  it("is only eligible while the period has zero assignment rows", async () => {
    const p = await period(today);
    const ok = await add(p.employmentId, { expected_revision: p.revision, effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE });
    expect(ok.status).toBe(201);
    const again = await add(p.employmentId, { expected_revision: ok.body.revision, effective_date: today, department_id: ids.d.QA, job_title_id: ids.j.SE });
    expect(again.status).toBe(422);
    expect(again.body.details[0].code).toBe("ASSIGNMENT_ALREADY_EXISTS");
    const withRow = await period("2024-02-05", true);
    const r = await add(withRow.employmentId, { expected_revision: withRow.revision, effective_date: today, department_id: ids.d.QA, job_title_id: ids.j.SE }, "admin");
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("ASSIGNMENT_ALREADY_EXISTS");
    expect(await rows(withRow.employmentId)).toHaveLength(1);
  });

  it("Assignment Change returns NO_ASSIGNMENT_YET on a period without assignments and writes nothing", async () => {
    const p = await period("2024-05-06");
    const r = await call(changeRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: p.employmentId },
      body: { expected_revision: p.revision, effective_date: today, reason: "Transfer", department_id: ids.d.QA, job_title_id: ids.j.SE },
      headers: { "idempotency-key": key("nochg") },
    });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("NO_ASSIGNMENT_YET");
    expect(await rows(p.employmentId)).toEqual([]);
    expect((await db().person.findUniqueOrThrow({ where: { id: p.personId } })).revision).toBe(p.revision);
  });

  it("HR_EDITOR may record a backdated initial assignment as Initial Data Capture, with a mandatory reason", async () => {
    const p = await period("2022-03-01");
    const noReason = await add(p.employmentId, { expected_revision: p.revision, effective_date: "2022-06-01", department_id: ids.d.ENG, job_title_id: ids.j.SE });
    expect(noReason.status).toBe(422);
    expect(noReason.body.details[0].code).toBe("REASON_REQUIRED");
    const r = await add(p.employmentId, {
      expected_revision: p.revision,
      effective_date: "2022-06-01",
      reason: "Assignment history before June 2022 was never recorded",
      department_id: ids.d.ENG,
      job_title_id: ids.j.SE,
    });
    expect(r.status).toBe(201);
    // Not moved to the period start: earlier history is not invented.
    const [row] = await rows(p.employmentId);
    expect(fromDbDate(row.effectiveFrom)).toBe("2022-06-01");
    const [ev] = await audits(p.employmentId);
    expect(ev).toMatchObject({ action: "assignment.initial_data_capture", reason: "Assignment history before June 2022 was never recorded" });
  });

  it("closes the row at end date + 1 on an ended period and rejects dates outside the period", async () => {
    const p = await period("2021-01-04");
    await db().employment.update({ where: { id: p.employmentId }, data: { endDate: toDbDate("2021-12-31") } });
    const outside = await add(p.employmentId, { expected_revision: p.revision, effective_date: "2022-01-03", reason: "Missing", department_id: ids.d.ENG, job_title_id: ids.j.SE });
    expect(outside.status).toBe(422);
    expect(outside.body.details[0].code).toBe("OUTSIDE_EMPLOYMENT_PERIOD");
    const before = await add(p.employmentId, { expected_revision: p.revision, effective_date: "2020-12-31", reason: "Missing", department_id: ids.d.ENG, job_title_id: ids.j.SE });
    expect(before.status).toBe(422);
    const ok = await add(p.employmentId, { expected_revision: p.revision, effective_date: "2021-01-04", reason: "Missing", department_id: ids.d.ENG, job_title_id: ids.j.SE });
    expect(ok.status).toBe(201);
    expect(fromDbDate((await rows(p.employmentId))[0].effectiveTo)).toBe("2022-01-01");
  });

  it("blocks cancelled periods, requires employment.manage and active catalog values", async () => {
    const c = await period(addDays(today, 30));
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [c.employmentId]);
    const cancelled = await add(c.employmentId, { expected_revision: c.revision, effective_date: addDays(today, 30), department_id: ids.d.ENG, job_title_id: ids.j.SE }, "admin");
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");

    const p = await period(today);
    expect((await add(p.employmentId, { expected_revision: p.revision, effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE }, "docs")).status).toBe(403);
    const inactive = await add(p.employmentId, { expected_revision: p.revision, effective_date: today, department_id: inactiveDept, job_title_id: ids.j.SE });
    expect(inactive.status).toBe(422);
    expect(inactive.body.details[0].code).toBe("NOT_ACTIVE");
    const stale = await add(p.employmentId, { expected_revision: p.revision + 5, effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
    expect(await rows(p.employmentId)).toEqual([]);
    expect((await add(p.employmentId, { expected_revision: p.revision, effective_date: today, job_title_id: ids.j.SE })).status).toBe(400);
  });

  it("replays the same Idempotency-Key once (also concurrently); a different payload is IDEMPOTENCY_KEY_REUSED", async () => {
    const p = await period(today);
    const k = key("init-same");
    const body = { expected_revision: p.revision, effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE };
    const results = await Promise.all([add(p.employmentId, body, "editor", k), add(p.employmentId, body, "editor", k)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect(results.map((r) => r.body.revision)).toEqual([p.revision + 1, p.revision + 1]);
    expect(await rows(p.employmentId)).toHaveLength(1);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId, action: "assignment.initial" } })).toBe(1);
    const reused = await add(p.employmentId, { ...body, department_id: ids.d.QA }, "editor", k);
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");

    const q = await period(today);
    const race = await Promise.all([
      add(q.employmentId, { expected_revision: q.revision, effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE }, "editor", key("a")),
      add(q.employmentId, { expected_revision: q.revision, effective_date: today, department_id: ids.d.QA, job_title_id: ids.j.SE }, "editor", key("b")),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rows(q.employmentId)).toHaveLength(1);
  });
});
