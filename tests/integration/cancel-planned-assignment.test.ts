import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as cancelRoute } from "@/app/api/v1/core-hr/assignments/[id]/cancel-planned/route";
import { POST as correctionRoute } from "@/app/api/v1/core-hr/assignments/[id]/corrections/route";
import { GET as getRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as initialRoute } from "@/app/api/v1/core-hr/employments/[id]/initial-assignment/route";
import { POST as periodCorrectionRoute } from "@/app/api/v1/core-hr/employments/[id]/period-corrections/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as reverseRoute } from "@/app/api/v1/core-hr/employments/[id]/reverse-end/route";
import { POST as voidRoute } from "@/app/api/v1/core-hr/employments/[id]/void/route";
import { POST as cancelPeriodRoute } from "@/app/api/v1/core-hr/employments/[id]/cancel-planned/route";
import { AssignmentCancelledSchema, EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { runIntegrityChecks } from "../../scripts/integrity-checks";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// PV-29 Cancel Planned Assignment (BD-1 … BD-10). Test matrix A–V of docs/product/pv29-cancel-planned-assignment.md.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let admin: string;
let app: pg.Client;
const today = todayInVietnam();
const D1 = addDays(today, 20); // planned change B
const D2 = addDays(today, 40); // later planned change C
let n = 0;
const nextName = () => {
  n += 1;
  return `Phạm Văn Kế ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
};

type Hired = { personId: string; employmentId: string };
async function hire(start: string, o: { assignment?: boolean; managerId?: string } = {}): Promise<Hired> {
  const r = await call(createRoute, {
    path: "/x",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("pa") },
    body: {
      full_name: nextName(),
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        work_email: `pv29.${n}.${Date.now()}@example.test`,
        ...(o.assignment === false
          ? {}
          : { assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L1, ...(o.managerId ? { manager_person_id: o.managerId } : {}) } }),
      },
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
const rows = (employmentId: string) => db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } });
const detail = async (personId: string, user: TestUser = "admin") => (await call(getRoute, { path: "/x", user, params: { id: personId } })).body;
const post = async (route: typeof cancelRoute, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "editor") =>
  call(route, { path: "/x", method: "POST", user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("op") } });
const change = (p: Hired, date: string, values: Record<string, unknown> = { department_id: ids.d.QA, job_title_id: ids.j.QAE }, user: TestUser = "editor") =>
  post(changeRoute, p.employmentId, p.personId, { effective_date: date, reason: "Planned promotion", ...values }, user);
const cancel = async (assignmentId: string, p: Hired, body: Record<string, unknown> = {}, user: TestUser = "editor", idem = key("cpa")) =>
  call(cancelRoute, {
    path: "/x",
    method: "POST",
    user,
    params: { id: assignmentId },
    body: { expected_revision: await revision(p.personId), reason: "The promotion is no longer going ahead", ...body },
    headers: { "idempotency-key": idem },
  });
const end = (p: Hired, date: string, user: TestUser = "editor") => post(endRoute, p.employmentId, p.personId, { end_date: date, end_reason_code: "VOLUNTARY_RESIGNATION" }, user);
const scan = async (personIds: string[]) => {
  await app.query("BEGIN READ ONLY");
  try {
    return await runIntegrityChecks(app, today, personIds);
  } finally {
    await app.query("ROLLBACK");
  }
};
const code = (r: { body: { error?: string; details?: { code: string }[] } }) => r.body.details?.[0]?.code ?? r.body.error;

/** A → B: current assignment A since 2025-01-06 and a planned Assignment Change B on D1. */
async function withPlannedChange(): Promise<Hired & { a: string; b: string }> {
  const p = await hire("2025-01-06");
  expect((await change(p, D1)).status).toBe(201);
  const [a, b] = await rows(p.employmentId);
  return { ...p, a: a.id, b: b.id };
}

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("PV-29 — cancelling a planned Assignment Change", () => {
  it("A/B/L/U: HR_EDITOR cancels B; A takes back B's end (open period → open); B kept unchanged as evidence; audit; reason never returned", async () => {
    const p = await withPlannedChange();
    const before = await rows(p.employmentId);
    expect(fromDbDate(before[0].effectiveTo)).toBe(D1);
    const r = await cancel(p.b, p);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = AssignmentCancelledSchema.parse(r.body);
    expect(d.warnings).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain("no longer going ahead");

    const after = await rows(p.employmentId);
    expect(after.map((x) => [x.id, fromDbDate(x.effectiveFrom), fromDbDate(x.effectiveTo), x.cancelledAt !== null])).toEqual([
      [p.a, "2025-01-06", null, false],
      [p.b, D1, null, true],
    ]);
    // B's dates and values are untouched.
    expect({ ...after[1], cancelledAt: null }).toEqual({ ...before[1], cancelledAt: null });
    const apiRows = d.employments[0].assignments;
    expect(apiRows.find((x) => x.id === p.b)!.cancelled_at).not.toBeNull();
    expect(apiRows.find((x) => x.id === p.a)!.cancelled_at).toBeNull();

    const audits = await db().auditEvent.findMany({ where: { entityId: { in: [p.a, p.b] }, action: { in: ["assignment.cancel_planned", "assignment.restore_end"] } }, include: { fieldChanges: true } });
    const cancelAudit = audits.find((x) => x.action === "assignment.cancel_planned")!;
    const restoreAudit = audits.find((x) => x.action === "assignment.restore_end")!;
    expect(cancelAudit).toMatchObject({ entityId: p.b, entityType: "job_assignment", reason: "The promotion is no longer going ahead", actorUserId: await userId("editor"), changedFields: ["assignment.cancelled"] });
    expect(restoreAudit).toMatchObject({ entityId: p.a, reason: cancelAudit.reason, requestId: cancelAudit.requestId });
    expect(restoreAudit.fieldChanges.map((f) => [f.field, f.oldValue, f.newValue])).toEqual([["assignment.effective_to", D1, null]]);
  });

  it("B: with a planned period end, the predecessor takes back the boundary B carried (period end + 1)", async () => {
    const p = await hire("2025-02-03");
    const planned = addDays(today, 90);
    expect((await end(p, planned)).status).toBe(201); // A closed at planned + 1
    expect((await change(p, D1)).status).toBe(201); // B inherits planned + 1
    const [a, b] = await rows(p.employmentId);
    expect(fromDbDate(b.effectiveTo)).toBe(addDays(planned, 1));
    // The Active End closes A (not B): no blocker (BD-5 only for an End that truncates the planned row).
    const r = await cancel(b.id, p);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(fromDbDate((await db().jobAssignment.findUniqueOrThrow({ where: { id: a.id } })).effectiveTo)).toBe(addDays(planned, 1));
    // The End stays exactly reversible.
    const rev = await post(reverseRoute, p.employmentId, p.personId, { reason: "Resignation withdrawn" }, "admin");
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect((await db().jobAssignment.findUniqueOrThrow({ where: { id: a.id } })).effectiveTo).toBeNull();
    expect(await scan([p.personId])).toEqual([]);
  });

  it("K: a new Assignment Change may be planned on the cancelled date; the cancelled row is neither predecessor nor later row", async () => {
    const p = await withPlannedChange();
    expect((await cancel(p.b, p)).status).toBe(201);
    const again = await change(p, D1, { department_id: ids.d.HRA, job_title_id: ids.j.HRX });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const live = (await rows(p.employmentId)).filter((x) => x.cancelledAt === null);
    expect(live.map((x) => [x.id === p.a, fromDbDate(x.effectiveFrom), fromDbDate(x.effectiveTo)])).toEqual([
      [true, "2025-01-06", D1],
      [false, D1, null],
    ]);
    expect(await scan([p.personId])).toEqual([]);
  });
});

describe("PV-29 — planned Initial Assignment", () => {
  it("C/D/K: a Pre-start period's only assignment is cancelled; the period remains, Needs Attention, list shows no department; Add Initial Assignment is available again", async () => {
    const start = addDays(today, 15);
    const p = await hire(start);
    const [first] = await rows(p.employmentId);
    const r = await cancel(first.id, p);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.employment_status).toBe("not_started");
    expect(d.employments[0].cancelled_at).toBeNull();
    expect(d.completeness.operational.status).toBe("incomplete");
    expect(d.completeness.operational.items.filter((i) => !i.satisfied).map((i) => i.code).sort()).toEqual(["department", "job_title"]);
    const list = await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(d.employee_code)}`, user: "admin" });
    expect(list.body.data[0]).toMatchObject({ department: null, job_title: null, operational_completeness: "incomplete" });
    const filtered = await call(listRoute, { path: `/api/v1/core-hr/employees?department_id=${ids.d.ENG}&search=${encodeURIComponent(d.employee_code)}`, user: "admin" });
    expect(filtered.body.total).toBe(0);

    const add = await post(initialRoute, p.employmentId, p.personId, { effective_date: start, department_id: ids.d.QA, job_title_id: ids.j.QAE });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect((await detail(p.personId)).completeness.operational.status).toBe("complete");
    expect(await scan([p.personId])).toEqual([]);
  });

  it("C: an Active period whose first assignment starts later: cancelled, the period has no assignment; period correction ignores the cancelled row", async () => {
    const p = await hire("2025-03-03", { assignment: false });
    expect((await post(initialRoute, p.employmentId, p.personId, { effective_date: D1, department_id: ids.d.ENG, job_title_id: ids.j.SE })).status).toBe(201);
    const [first] = await rows(p.employmentId);
    expect((await cancel(first.id, p)).status).toBe(201);
    // A start-date correction moves only operational rows; the cancelled row keeps its recorded dates as evidence.
    const corr = await post(periodCorrectionRoute, p.employmentId, p.personId, { start_date: "2025-03-10", reason: "Start date typo" }, "admin");
    expect(corr.status, JSON.stringify(corr.body)).toBe(200);
    expect(fromDbDate((await db().jobAssignment.findUniqueOrThrow({ where: { id: first.id } })).effectiveFrom)).toBe(D1);
    expect(await scan([p.personId])).toEqual([]);
  });
});

describe("PV-29 — eligibility", () => {
  it("E/F: an assignment effective today or in the past cannot be cancelled", async () => {
    const p = await hire("2025-04-07");
    expect((await change(p, today)).status).toBe(201);
    const [past, current] = await rows(p.employmentId);
    const r1 = await cancel(current.id, p);
    expect(r1.status).toBe(422);
    expect(code(r1)).toBe("ASSIGNMENT_ALREADY_EFFECTIVE");
    // The past row is not the latest either; the "already effective" rule is decided first.
    const r2 = await cancel(past.id, p, {}, "admin");
    expect(code(r2)).toBe("ASSIGNMENT_ALREADY_EFFECTIVE");
    expect((await rows(p.employmentId)).every((x) => x.cancelledAt === null)).toBe(true);
  });

  it("G: an assignment of a cancelled or voided period cannot be cancelled", async () => {
    const planned = await hire(addDays(today, 30));
    expect((await post(cancelPeriodRoute, planned.employmentId, planned.personId, { reason: "Offer declined" })).status).toBe(201);
    const [r1] = await rows(planned.employmentId);
    const a = await cancel(r1.id, planned);
    expect(a.status).toBe(409);
    expect(a.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");

    const v = await withPlannedChange();
    expect((await post(voidRoute, v.employmentId, v.personId, { reason: "Entered in error" }, "admin")).status).toBe(201);
    const b = await cancel(v.b, v, {}, "admin");
    expect(b.status).toBe(409);
    expect(b.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");
  });

  it("H/I: A → B → C — B cannot be cancelled while C is valid (409); C, then B, can", async () => {
    const p = await withPlannedChange();
    expect((await change(p, D2, { department_id: ids.d.HRA, job_title_id: ids.j.HRX })).status).toBe(201);
    const c = (await rows(p.employmentId)).at(-1)!;
    const blocked = await cancel(p.b, p);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("LATER_ASSIGNMENT_EXISTS");
    expect((await rows(p.employmentId)).every((x) => x.cancelledAt === null)).toBe(true);

    expect((await cancel(c.id, p)).status).toBe(201);
    expect(fromDbDate((await db().jobAssignment.findUniqueOrThrow({ where: { id: p.b } })).effectiveTo)).toBeNull();
    expect((await cancel(p.b, p)).status).toBe(201);
    expect(fromDbDate((await db().jobAssignment.findUniqueOrThrow({ where: { id: p.a } })).effectiveTo)).toBeNull();
    expect(await scan([p.personId])).toEqual([]);
  });

  it("reason is mandatory; already cancelled → 409 ASSIGNMENT_CANCELLED; unknown id → 404", async () => {
    const p = await withPlannedChange();
    const noReason = await cancel(p.b, p, { reason: "   " });
    expect(noReason.status).toBe(422);
    expect(code(noReason)).toBe("REASON_REQUIRED");
    expect((await cancel(p.b, p)).status).toBe(201);
    const twice = await cancel(p.b, p);
    expect(twice.status).toBe(409);
    expect(twice.body.error).toBe("ASSIGNMENT_CANCELLED");
    expect((await cancel("00000000-0000-4000-8000-00000000dead", p)).status).toBe(404);
  });

  it("V: a predecessor that does not end where the plan starts fails closed (nothing repaired)", async () => {
    const p = await withPlannedChange();
    await db().jobAssignment.update({ where: { id: p.a }, data: { effectiveTo: toDbDate(addDays(D1, -5)) } }); // legacy gap
    const r = await cancel(p.b, p);
    expect(r.status).toBe(422);
    expect(code(r)).toBe("ASSIGNMENT_TIMELINE_GAP");
    const after = await rows(p.employmentId);
    expect(after.every((x) => x.cancelledAt === null)).toBe(true);
    expect(fromDbDate(after[0].effectiveTo)).toBe(addDays(D1, -5));
  });
});

describe("PV-29 — End Employment, Relationship Change and Reverse End", () => {
  it("J: End Employment before the plan is blocked with Cancel Planned Assignment guidance; after cancelling, it succeeds and closes A", async () => {
    const p = await withPlannedChange();
    const lastDay = addDays(D1, -2);
    const blocked = await end(p, lastDay);
    expect(blocked.status).toBe(422);
    expect(code(blocked)).toBe("FUTURE_ASSIGNMENT_OUTSIDE_END");
    expect(blocked.body.message).toMatch(/use Cancel Planned Assignment first/);
    expect((await cancel(p.b, p)).status).toBe(201);
    const ok = await end(p, lastDay);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(fromDbDate((await db().jobAssignment.findUniqueOrThrow({ where: { id: p.a } })).effectiveTo)).toBe(addDays(lastDay, 1));
    expect(await scan([p.personId])).toEqual([]);
  });

  it("J2: Relationship Change on or before the plan is blocked; after cancelling, it succeeds", async () => {
    const p = await withPlannedChange();
    const body = { start_date: D1, employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "Moves to a service contract" };
    const blocked = await post(rcRoute, p.employmentId, p.personId, body);
    expect(code(blocked)).toBe("FUTURE_ASSIGNMENT_OUTSIDE_END");
    expect(blocked.body.message).toMatch(/Cancel Planned Assignment/);
    expect((await cancel(p.b, p)).status).toBe(201);
    const ok = await post(rcRoute, p.employmentId, p.personId, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await scan([p.personId])).toEqual([]);
  });

  it("an assignment that already took effect keeps the correction guidance", async () => {
    const p = await hire("2024-06-03");
    expect((await change(p, "2025-06-02", { department_id: ids.d.QA, job_title_id: ids.j.QAE }, "admin")).status).toBe(201);
    const r = await end(p, "2025-05-30", "admin");
    expect(code(r)).toBe("FUTURE_ASSIGNMENT_OUTSIDE_END");
    expect(r.body.message).toMatch(/Correct that assignment first/);
  });

  it("Q/R: an Active End that truncates the plan blocks (Reverse End first); after Reverse End the cancellation succeeds", async () => {
    const p = await withPlannedChange();
    expect((await end(p, addDays(D1, 10))).status).toBe(201); // closes B at end + 1
    const blocked = await cancel(p.b, p);
    expect(blocked.status).toBe(422);
    expect(code(blocked)).toBe("ACTIVE_END_EVENT_EXISTS");
    expect((await db().jobAssignment.findUniqueOrThrow({ where: { id: p.b } })).cancelledAt).toBeNull();

    expect((await post(reverseRoute, p.employmentId, p.personId, { reason: "Resignation withdrawn" }, "admin")).status).toBe(201);
    // The reversed End is history and no longer blocks.
    const ok = await cancel(p.b, p);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(fromDbDate((await db().jobAssignment.findUniqueOrThrow({ where: { id: p.a } })).effectiveTo)).toBeNull();
    expect(await scan([p.personId])).toEqual([]);
  });

  it("R: a cancelled later row never blocks Reverse End", async () => {
    const p = await withPlannedChange();
    expect((await cancel(p.b, p)).status).toBe(201);
    expect((await end(p, addDays(D1, -3))).status).toBe(201); // closes A; the cancelled B lies after the end
    const rev = await post(reverseRoute, p.employmentId, p.personId, { reason: "Recorded by mistake" }, "admin");
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect((await db().jobAssignment.findUniqueOrThrow({ where: { id: p.a } })).effectiveTo).toBeNull();
    expect(await scan([p.personId])).toEqual([]);
  });

  it("the database refuses to cancel a row closed by an Active End even without the service check", async () => {
    const p = await withPlannedChange();
    expect((await end(p, addDays(D1, 10))).status).toBe(201);
    await expect(db().jobAssignment.update({ where: { id: p.b }, data: { cancelledAt: new Date() } })).rejects.toThrow(/job_assignment_cancel_closed_by_end/);
  });
});

describe("PV-29 — immutability, manager references and warnings", () => {
  it("S: a cancelled assignment is immutable (correction 409; direct updates and un-cancel refused by the database)", async () => {
    const p = await withPlannedChange();
    expect((await cancel(p.b, p)).status).toBe(201);
    const corr = await post(correctionRoute, p.b, p.personId, { reason: "Fix level", job_level_id: ids.l.L3 }, "admin");
    expect(corr.status).toBe(409);
    expect(corr.body.error).toBe("ASSIGNMENT_CANCELLED");
    await expect(db().jobAssignment.update({ where: { id: p.b }, data: { jobLevelId: ids.l.L3 } })).rejects.toThrow(/job_assignment_cancelled_is_terminal/);
    await expect(db().jobAssignment.update({ where: { id: p.b }, data: { cancelledAt: null } })).rejects.toThrow(/job_assignment_cancelled_is_terminal/);
    await expect(
      db().jobAssignment.create({
        data: { employmentId: p.employmentId, effectiveFrom: toDbDate(D2), departmentId: ids.d.ENG, jobTitleId: ids.j.SE, changeReason: "assignment_change", createdBy: admin, cancelledAt: new Date() },
      }),
    ).rejects.toThrow(/job_assignment_cancelled_is_terminal/);
  });

  it("T: a cancelled planned assignment referencing a manager no longer blocks Void of the manager's period", async () => {
    const manager = await hire("2025-05-05");
    const p = await withPlannedChange();
    const withManager = await change(p, D2, { manager_person_id: manager.personId });
    expect(withManager.status, JSON.stringify(withManager.body)).toBe(201);
    const c = (await rows(p.employmentId)).at(-1)!;
    const blocked = await post(voidRoute, manager.employmentId, manager.personId, { reason: "Entered in error" }, "admin");
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain("MANAGER_DEPENDENCY");
    expect((await cancel(c.id, p)).status).toBe(201);
    const ok = await post(voidRoute, manager.employmentId, manager.personId, { reason: "Entered in error" }, "admin");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await scan([p.personId, manager.personId])).toEqual([]);
  });

  it("BD-8: extending the predecessor beyond its manager's employment is a warning, never a blocker", async () => {
    const manager = await hire("2024-09-02");
    const p = await hire("2025-01-06", { managerId: manager.personId });
    expect((await change(p, D1, { manager_person_id: null })).status).toBe(201);
    const managerLastDay = addDays(D1, -5);
    expect((await end(manager, managerLastDay)).status).toBe(201); // allowed (C-73: references never block)
    const b = (await rows(p.employmentId)).at(-1)!;
    const r = await cancel(b.id, p);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.warnings).toEqual([expect.objectContaining({ code: "MANAGER_NOT_EMPLOYED_FOR_RESTORED_RANGE", field: "manager" })]);
    // The manager is never rewritten.
    const a = (await rows(p.employmentId))[0];
    expect(a.managerEmploymentId).toBe(manager.employmentId);
    // Not an integrity error: the scan reports at most the existing C-73 warning.
    expect((await scan([p.personId])).filter((f) => f.severity === "error")).toEqual([]);
  });
});

describe("PV-29 — permissions, concurrency, idempotency", () => {
  it("M: employment.manage — HR_EDITOR and HR_ADMIN allowed; no access without it; unauthenticated 401", async () => {
    const p = await withPlannedChange();
    expect((await cancel(p.b, p, {}, "docs")).status).toBe(403);
    expect((await cancel(p.b, p, {}, "noroles")).status).toBe(403);
    const anon = await call(cancelRoute, { path: "/x", method: "POST", params: { id: p.b }, body: { expected_revision: 1, reason: "x" }, headers: { "idempotency-key": key("an") } });
    expect(anon.status).toBe(401);
    expect((await cancel(p.b, p, {}, "admin")).status).toBe(201);
    const q = await withPlannedChange();
    expect((await cancel(q.b, q, {}, "editor")).status).toBe(201);
  });

  it("N: stale revision → 409; concurrent cancel vs cancel and cancel vs change leave one consistent result", async () => {
    const p = await withPlannedChange();
    const stale = await cancel(p.b, p, { expected_revision: (await revision(p.personId)) - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");

    const rev = await revision(p.personId);
    const [x, y] = await Promise.all([cancel(p.b, p, { expected_revision: rev }), cancel(p.b, p, { expected_revision: rev })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);

    const q = await withPlannedChange();
    const qrev = await revision(q.personId);
    const [c1, c2] = await Promise.all([
      cancel(q.b, q, { expected_revision: qrev }),
      call(changeRoute, {
        path: "/x",
        method: "POST",
        user: "editor",
        params: { id: q.employmentId },
        body: { expected_revision: qrev, effective_date: D2, reason: "Another plan", department_id: ids.d.HRA, job_title_id: ids.j.HRX },
        headers: { "idempotency-key": key("cc") },
      }),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([201, 409]);
    expect(await scan([p.personId, q.personId])).toEqual([]);
  });

  it("O: the same Idempotency-Key replays; the same key with a different body is refused", async () => {
    const p = await withPlannedChange();
    const idem = key("idem");
    const rev = await revision(p.personId);
    const first = await cancel(p.b, p, { expected_revision: rev }, "editor", idem);
    expect(first.status).toBe(201);
    const again = await cancel(p.b, p, { expected_revision: rev }, "editor", idem);
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body.employments).toEqual(first.body.employments);
    const other = await cancel(p.b, p, { expected_revision: rev, reason: "Different" }, "editor", idem);
    expect(other.status).toBe(409);
    expect(other.body.error).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db().auditEvent.count({ where: { entityId: p.b, action: "assignment.cancel_planned" } })).toBe(1);
  });
});

describe("PV-29 — integrity scan parity (P)", () => {
  it("cancelled rows are ignored by the operational checks; the two new checks detect hand-crafted violations", async () => {
    const p = await withPlannedChange();
    expect((await cancel(p.b, p)).status).toBe(201);
    // A now overlaps the cancelled B's recorded range: not an overlap, not a gap, not misaligned.
    expect(await scan([p.personId])).toEqual([]);

    // Violation 1 (written directly): a row that had already taken effect is marked cancelled.
    const q = await hire("2025-07-07");
    const [current] = await rows(q.employmentId);
    await db().jobAssignment.update({ where: { id: current.id }, data: { cancelledAt: new Date() } });
    expect((await scan([q.personId])).map((f) => f.check)).toContain("cancelled_assignment_was_effective");

    // Violation 2 (written directly): an Active End Event closes a cancelled assignment.
    const r = await withPlannedChange();
    expect((await cancel(r.b, r)).status).toBe(201);
    await db().employmentEvent.create({
      data: { employmentId: r.employmentId, eventType: "end", effectiveDate: toDbDate(addDays(D1, 10)), endReasonCode: "VOLUNTARY_RESIGNATION", closedAssignmentId: r.b, recordedBy: admin },
    });
    expect((await scan([r.personId])).map((f) => f.check)).toContain("active_end_event_closes_cancelled_assignment");
  });
});
