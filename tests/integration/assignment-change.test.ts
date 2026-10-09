import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, type TestUser } from "../helpers";

// S4.5: normal Assignment Change = new effective-dated assignment row; history is never rewritten.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let managerId: string;
let manager2Id: string;
const today = todayInVietnam();
let n = 0;

async function person(start = "2024-03-04", extra: Record<string, unknown> = {}) {
  n += 1;
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("ac") },
    body: {
      full_name: `Mạc Đình Phong ${String.fromCharCode(64 + (n % 26) + 1)}${n}`.replace(/\d+$/, ""),
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L1, ...extra },
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string, revision: r.body.revision as number };
}

const change = (employmentId: string, body: Record<string, unknown>, user: TestUser = "editor", idem = key("chg")) =>
  call(changeRoute, { path: "/x", method: "POST", user, params: { id: employmentId }, body, headers: { "idempotency-key": idem } });

const timeline = async (employmentId: string) =>
  (await db().jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } })).map((a) => ({
    from: fromDbDate(a.effectiveFrom),
    to: fromDbDate(a.effectiveTo),
    dept: a.departmentId,
    title: a.jobTitleId,
    level: a.jobLevelId,
    mgr: a.managerEmploymentId,
  }));

const lastAudit = async (employmentId: string) =>
  db().auditEvent.findFirst({ where: { entityId: employmentId, action: "assignment.change" }, include: { fieldChanges: true }, orderBy: { id: "desc" } });

beforeAll(async () => {
  ids = await catalogIds();
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  managerId = (await person("2018-01-08")).personId;
  manager2Id = (await person("2018-01-08")).personId;
});
afterAll(async () => {
  await app.end();
});

describe("Assignment Change", () => {
  it("Department-only change today by HR_EDITOR closes the previous row and opens a new one", async () => {
    const p = await person();
    const r = await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "Team move", department_id: ids.d.QA });
    expect(r.status).toBe(201);
    EmployeeDetailSchema.parse(r.body);
    expect(r.body.revision).toBe(p.revision + 1);
    const tl = await timeline(p.employmentId);
    expect(tl).toEqual([
      { from: "2024-03-04", to: today, dept: ids.d.ENG, title: ids.j.SE, level: ids.l.L1, mgr: null },
      { from: today, to: null, dept: ids.d.QA, title: ids.j.SE, level: ids.l.L1, mgr: null },
    ]);
    // Employee Type untouched; current department reflects the change.
    expect(r.body.employments[0].employee_type.code).toBe("EMPLOYEE");
    const ev = await lastAudit(p.employmentId);
    expect(ev!.reason).toBe("Team move");
    expect(ev!.changedFields).toEqual(["assignment.department_id"]);
    expect(ev!.fieldChanges.map((c) => [c.field, c.oldValue, c.newValue]).sort()).toEqual(
      [
        ["assignment.effective_from", null, today],
        ["assignment.effective_to", null, today],
        ["department_id", ids.d.ENG, ids.d.QA],
      ].sort(),
    );
  });

  it("Job Title-only, Job Level-only and combined changes (future dates allowed for HR_EDITOR)", async () => {
    const p = await person();
    const d1 = addDays(today, 10);
    const r1 = await change(p.employmentId, { expected_revision: p.revision, effective_date: d1, reason: "Role change", job_title_id: ids.j.QAE });
    expect(r1.status).toBe(201);
    const p2 = await person();
    const r2 = await change(p2.employmentId, { expected_revision: p2.revision, effective_date: today, reason: "Promotion", job_level_id: ids.l.L2 });
    expect(r2.status).toBe(201);
    expect((await timeline(p2.employmentId)).at(-1)).toMatchObject({ level: ids.l.L2, dept: ids.d.ENG, title: ids.j.SE });
    const p3 = await person();
    const r3 = await change(p3.employmentId, {
      expected_revision: p3.revision,
      effective_date: today,
      reason: "Reorg",
      department_id: ids.d.HRA,
      job_title_id: ids.j.HRX,
      job_level_id: null,
    });
    expect(r3.status).toBe(201);
    expect((await timeline(p3.employmentId)).at(-1)).toMatchObject({ dept: ids.d.HRA, title: ids.j.HRX, level: null });
    expect((await lastAudit(p3.employmentId))!.changedFields.sort()).toEqual(
      ["assignment.department_id", "assignment.job_level_id", "assignment.job_title_id"].sort(),
    );
  });

  it("Manager-only change records the field name but never manager ids in audit", async () => {
    const p = await person("2024-03-04", { manager_person_id: managerId });
    const r = await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "New lead", manager_person_id: manager2Id });
    expect(r.status).toBe(201);
    expect(r.body.employments[0].assignments.at(-1).manager.person_id).toBe(manager2Id);
    const ev = await lastAudit(p.employmentId);
    expect(ev!.changedFields).toEqual(["assignment.manager"]);
    const managerEmployments = await db().employment.findMany({ where: { personId: { in: [managerId, manager2Id] } } });
    const stored = JSON.stringify(ev!.fieldChanges.map((c) => ({ ...c, id: String(c.id), auditEventId: String(c.auditEventId) })));
    for (const m of [managerId, manager2Id, ...managerEmployments.map((e) => e.id)]) expect(stored).not.toContain(m);
  });

  it("enforces the effective-date policy: HR_EDITOR past date denied, HR_ADMIN past date allowed", async () => {
    const p = await person("2023-01-02");
    const past = addDays(today, -30);
    const denied = await change(p.employmentId, { expected_revision: p.revision, effective_date: past, reason: "Late entry", department_id: ids.d.QA });
    expect(denied.status).toBe(403);
    const ok = await change(p.employmentId, { expected_revision: p.revision, effective_date: past, reason: "Late entry", department_id: ids.d.QA }, "admin");
    expect(ok.status).toBe(201);
    expect((await timeline(p.employmentId)).map((a) => a.from)).toEqual(["2023-01-02", past]);
  });

  it("requires a reason and an actual change", async () => {
    const p = await person();
    expect((await change(p.employmentId, { expected_revision: p.revision, effective_date: today, department_id: ids.d.QA })).status).toBe(400);
    expect((await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "   ", department_id: ids.d.QA })).status).toBe(422);
    const same = await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "x", department_id: ids.d.ENG });
    expect(same.status).toBe(422);
    expect(same.body.details[0].code).toBe("NO_CHANGE");
  });

  it("rejects cancelled and ended periods", async () => {
    const c = await person(addDays(today, 30));
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [c.employmentId]);
    const rc = await change(c.employmentId, { expected_revision: c.revision, effective_date: addDays(today, 31), reason: "x", department_id: ids.d.QA }, "admin");
    expect(rc.status).toBe(409);
    expect(rc.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");
    const e = await person("2020-01-06");
    await db().$transaction([
      db().employment.update({ where: { id: e.employmentId }, data: { endDate: toDbDate("2022-12-31") } }),
      db().jobAssignment.updateMany({ where: { employmentId: e.employmentId }, data: { effectiveTo: toDbDate("2023-01-01") } }),
    ]);
    const re = await change(e.employmentId, { expected_revision: e.revision, effective_date: "2022-06-01", reason: "x", department_id: ids.d.QA }, "admin");
    expect(re.status).toBe(422);
    expect(re.body.details[0].code).toBe("PERIOD_ENDED");
  });

  it("rejects an effective date outside the period", async () => {
    const p = await person(addDays(today, 5));
    const r = await change(p.employmentId, { expected_revision: p.revision, effective_date: addDays(today, 1), reason: "x", department_id: ids.d.QA });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("OUTSIDE_EMPLOYMENT_PERIOD");
  });

  it("blocks when an assignment already starts on or after the effective date, without touching it", async () => {
    const p = await person();
    const future = addDays(today, 20);
    expect((await change(p.employmentId, { expected_revision: p.revision, effective_date: future, reason: "Planned move", department_id: ids.d.QA })).status).toBe(201);
    const before = await timeline(p.employmentId);
    const r = await change(p.employmentId, { expected_revision: p.revision + 1, effective_date: today, reason: "Earlier move", job_level_id: ids.l.L3 });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("FUTURE_ASSIGNMENT_EXISTS");
    const same = await change(p.employmentId, { expected_revision: p.revision + 1, effective_date: future, reason: "Same day", job_level_id: ids.l.L3 });
    expect(same.status).toBe(422);
    expect(await timeline(p.employmentId)).toEqual(before);
  });

  it("never creates overlapping assignments", async () => {
    const p = await person();
    await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "a", department_id: ids.d.QA });
    const tl = await timeline(p.employmentId);
    for (let i = 1; i < tl.length; i++) expect(tl[i - 1].to).toBe(tl[i].from);
    expect(tl.at(-1)!.to).toBeNull();
  });

  it("rejects a stale revision, and concurrent changes leave exactly one consistent result (rollback)", async () => {
    const p = await person();
    const results = await Promise.all([
      change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "A", department_id: ids.d.QA }),
      change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "B", department_id: ids.d.HRA }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const tl = await timeline(p.employmentId);
    expect(tl).toHaveLength(2);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId, action: "assignment.change" } })).toBe(1);
    expect((await db().person.findUniqueOrThrow({ where: { id: p.personId } })).revision).toBe(p.revision + 1);
  });

  it("replays the same Idempotency-Key without a second row; a different payload is 409", async () => {
    const p = await person();
    const k = key("replay");
    const body = { expected_revision: p.revision, effective_date: today, reason: "Move", department_id: ids.d.QA };
    expect((await change(p.employmentId, body, "editor", k)).status).toBe(201);
    const again = await change(p.employmentId, body, "editor", k);
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await timeline(p.employmentId)).toHaveLength(2);
    expect((await change(p.employmentId, { ...body, reason: "Other" }, "editor", k)).status).toBe(409);
  });

  it("validates manager and catalogs; requires permission", async () => {
    const p = await person();
    const self = await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "x", manager_person_id: p.personId });
    expect(self.body.details[0].code).toBe("SELF_MANAGER");
    const inactive = await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "x", department_id: ids.d.OLD });
    expect(inactive.status).toBe(422);
    expect((await change(p.employmentId, { expected_revision: p.revision, effective_date: today, reason: "x", department_id: ids.d.QA }, "docs")).status).toBe(403);
    expect(await timeline(p.employmentId)).toHaveLength(1);
  });
});
