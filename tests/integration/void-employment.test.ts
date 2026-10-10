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
import { POST as voidRoute } from "@/app/api/v1/core-hr/employments/[id]/void/route";
import { GET as eligibilityRoute } from "@/app/api/v1/core-hr/employments/[id]/void-eligibility/route";
import { PATCH as workEmailRoute } from "@/app/api/v1/core-hr/employments/[id]/work-email/route";
import { POST as initialRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema, VoidEligibilitySchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { DEPENDENCY_CHECK_FAILED, evaluateVoidDependencies, VOID_DEPENDENCY_CHECKS } from "@/modules/core-hr/employments/void-dependencies";
import { voidBlockedError } from "@/modules/core-hr/employments/void-period";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// PV-25 Void Employment Period (design revision 2).
let ids: Awaited<ReturnType<typeof catalogIds>>;
let admin: string;
let app: pg.Client;
const today = todayInVietnam();
let n = 0;
const nextName = () => {
  n += 1;
  return `Lương Văn Hậu ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
};
type P = { personId: string; employmentId: string };

async function hired(start: string, o: { email?: string; manager?: string; type?: string } = {}): Promise<P> {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("vh") },
    body: {
      full_name: nextName(),
      employment: {
        start_date: start,
        employee_type_id: o.type ?? ids.et.EMPLOYEE,
        ...(o.email ? { work_email: o.email } : {}),
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L1, ...(o.manager ? { manager_person_id: o.manager } : {}) },
      },
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}
async function bare() {
  const r = await call(createRoute, { path: "/api/v1/core-hr/employees", method: "POST", user: "admin", headers: { "idempotency-key": key("vb") }, body: { full_name: nextName() } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
const events = (employmentId: string) => db().employmentEvent.findMany({ where: { employmentId }, orderBy: [{ effectiveDate: "asc" }, { recordedAt: "asc" }] });
const period = (employmentId: string) => db().employment.findUniqueOrThrow({ where: { id: employmentId }, include: { assignments: { orderBy: { effectiveFrom: "asc" } } } });
const preview = (employmentId: string, user: TestUser = "admin") => call(eligibilityRoute, { path: "/x", user, params: { id: employmentId } });
const voidIt = async (p: P, body: Record<string, unknown> = {}, user: TestUser = "admin", idem = key("void")) =>
  call(voidRoute, {
    path: "/x",
    method: "POST",
    user,
    params: { id: p.employmentId },
    body: { expected_revision: await revision(p.personId), reason: "Entered for the wrong person", ...body },
    headers: { "idempotency-key": idem },
  });
const post = async (route: typeof voidRoute, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "admin") =>
  call(route, { path: "/x", method: "POST", user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("op") } });
const endIt = (p: P, end: string, code = "VOLUNTARY_RESIGNATION") => post(endRoute, p.employmentId, p.personId, { end_date: end, end_reason_code: code });
const blockerCodes = (b: { blockers: { code: string }[] }) => b.blockers.map((x) => x.code);

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("Void — effective Initial Employment", () => {
  it("preview is eligible and read-only; Void keeps every internal record and only adds the disposition", async () => {
    const p = await hired(today, { email: "void.initial@example.test" });
    const rev0 = await revision(p.personId);
    const audits0 = await db().auditEvent.count({ where: { entityId: p.employmentId } });
    const pv = await preview(p.employmentId);
    expect(pv.status).toBe(200);
    const e = VoidEligibilitySchema.parse(pv.body);
    expect(e).toMatchObject({
      employment_id: p.employmentId,
      evaluated_revision: rev0,
      as_of: today,
      eligible: true,
      blockers: [],
      warnings: [],
      period: { start_date: today, end_date: null, employee_type: { code: "EMPLOYEE" }, period_lifecycle: "active" },
      affected_internal_records: { assignments: 1, lifecycle_events: [{ event_type: "start", effective_date: today }], has_active_end_event: false, work_email: "void.initial@example.test", planned_end_date: null },
      consequences: ["NO_OPERATIONAL_EFFECT", "WORK_EMAIL_RELEASED", "PERSON_HAS_NO_VALID_EMPLOYMENT", "VOID_IS_PERMANENT"],
    });
    // Read-only: no revision bump, no audit.
    expect(await revision(p.personId)).toBe(rev0);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId } })).toBe(audits0);

    const before = await period(p.employmentId);
    const [startEvent] = await events(p.employmentId);
    const r = await voidIt(p, { expected_revision: e.evaluated_revision });
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.employment_status).toBe("no_employment");
    expect(d.employments).toHaveLength(1);
    const v = d.employments[0];
    expect(v.voided_at).not.toBeNull();
    expect(v.cancelled_at).toBeNull();
    expect(v.period_lifecycle).toBeNull();
    expect(v).toMatchObject({ start_date: today, work_email: "void.initial@example.test", employee_type: { id: ids.et.EMPLOYEE } });
    expect(v.assignments).toHaveLength(1);
    expect(v.events.map((x) => [x.event_type, x.effective_date])).toEqual([
      ["start", today],
      ["employment_voided", today],
    ]);
    expect(JSON.stringify(r.body)).not.toContain("wrong person");

    const after = await period(p.employmentId);
    expect({ ...after, voidedAt: null }).toEqual({ ...before, voidedAt: null });
    const all = await events(p.employmentId);
    expect(all[0]).toEqual(startEvent);
    const voidEvents = all.filter((x) => x.eventType === "employment_voided");
    expect(voidEvents).toHaveLength(1);
    expect(voidEvents[0]).toMatchObject({ reason: "Entered for the wrong person", recordedBy: admin, endReasonCode: null, reversesEventId: null });
    expect(after.voidedAt?.getTime()).toBe(voidEvents[0].recordedAt.getTime());
    expect(await revision(p.personId)).toBe(rev0 + 1);

    const audit = await db().auditEvent.findFirstOrThrow({ where: { entityId: p.employmentId, action: "employment.void" }, include: { fieldChanges: true } });
    expect(audit).toMatchObject({ actorUserId: admin, outcome: "success", reason: "Entered for the wrong person", changedFields: ["employment.voided", "employment_event.employment_voided"] });
    expect(audit.fieldChanges).toEqual([]);
  });

  it("the person keeps the Employee Code, may get a correct Initial Employment, and the Work Email and dates are released", async () => {
    const p = await hired(today, { email: "void.release@example.test" });
    const code = (await db().person.findUniqueOrThrow({ where: { id: p.personId } })).employeeCode;
    expect((await voidIt(p)).status).toBe(201);
    // Same dates and same Work Email: the voided period no longer overlaps or reserves anything.
    const again = await post(initialRoute, p.personId, p.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, work_email: "void.release@example.test" });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const d = EmployeeDetailSchema.parse(again.body);
    expect(d.employee_code).toBe(code);
    expect(d.employment_status).toBe("active");
    expect(d.employments.map((x) => Boolean(x.voided_at))).toEqual([true, false]);
    expect(await db().employeeCodeRegistry.count({ where: { personId: p.personId } })).toBe(1);
    // Another person may also reuse a released Work Email.
    const q = await hired(today, { email: "void.release2@example.test" });
    expect((await voidIt(q)).status).toBe(201);
    await hired(today, { email: "void.release2@example.test" });
  });
});

describe("Void — eligibility matrix", () => {
  it("internal activity never blocks: Assignment Change, Work Email change, planned end, Active End Event, End + End Reversed", async () => {
    const p = await hired(addDays(today, -40), { email: "void.internal@example.test" });
    expect((await post(changeRoute, p.employmentId, p.personId, { effective_date: addDays(today, -10), job_level_id: ids.l.L2, reason: "Promotion" })).status).toBe(201);
    expect((await call(workEmailRoute, { path: "/x", method: "PATCH", user: "admin", params: { id: p.employmentId }, body: { expected_revision: await revision(p.personId), work_email: "void.internal2@example.test" } })).status).toBe(200);
    expect((await endIt(p, addDays(today, 30))).status).toBe(201);
    expect((await post(reverseRoute, p.employmentId, p.personId, { reason: "Wrong end" })).status).toBe(201);
    expect((await endIt(p, addDays(today, 20), "MUTUAL_AGREEMENT")).status).toBe(201);
    const pv = VoidEligibilitySchema.parse((await preview(p.employmentId)).body);
    expect(pv.eligible).toBe(true);
    expect(pv.affected_internal_records).toMatchObject({ assignments: 2, has_active_end_event: true, planned_end_date: addDays(today, 20) });
    // Existing history order (effective date, then recording time).
    expect(pv.affected_internal_records.lifecycle_events.map((x) => [x.event_type, x.effective_date])).toEqual([
      ["start", addDays(today, -40)],
      ["end", addDays(today, 20)],
      ["end", addDays(today, 30)],
      ["end_reversed", addDays(today, 30)],
    ]);

    const evBefore = await events(p.employmentId);
    const r = await voidIt(p);
    expect(r.status).toBe(201);
    const v = EmployeeDetailSchema.parse(r.body).employments[0];
    // Kept as history; the void disposition is listed after every other event.
    expect(v.events.map((x) => x.event_type)).toEqual(["start", "end", "end", "end_reversed", "employment_voided"]);
    expect(v.has_active_end_event).toBe(true);
    const evAfter = await events(p.employmentId);
    expect(evAfter.filter((x) => x.eventType !== "employment_voided")).toEqual(evBefore);
  });

  it("a future period is not effective (use Cancel Planned); cancelled and voided periods are read-only", async () => {
    const f = await hired(addDays(today, 5));
    const pv = VoidEligibilitySchema.parse((await preview(f.employmentId)).body);
    expect(blockerCodes(pv)).toEqual(["PERIOD_NOT_EFFECTIVE"]);
    const r = await voidIt(f);
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("PERIOD_NOT_EFFECTIVE");

    expect((await post(cancelRoute, f.employmentId, f.personId, { reason: "Offer declined" })).status).toBe(201);
    expect(blockerCodes(VoidEligibilitySchema.parse((await preview(f.employmentId)).body))).toEqual(["EMPLOYMENT_PERIOD_READ_ONLY"]);
    const c = await voidIt(f);
    expect(c.status).toBe(409);
    expect(c.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");

    const p = await hired(today);
    expect((await voidIt(p)).status).toBe(201);
    const pv2 = VoidEligibilitySchema.parse((await preview(p.employmentId)).body);
    expect(pv2).toMatchObject({ eligible: false, period: { period_lifecycle: null } });
    expect(blockerCodes(pv2)).toEqual(["EMPLOYMENT_PERIOD_READ_ONLY"]);
    const again = await voidIt(p);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "EMPLOYMENT_PERIOD_READ_ONLY", message: expect.stringContaining("voided") });
    expect((await events(p.employmentId)).filter((x) => x.eventType === "employment_voided")).toHaveLength(1);
    expect((await call(eligibilityRoute, { path: "/x", user: "admin", params: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } })).status).toBe(404);
  });

  it("a later valid period blocks (409 LATER_PERIOD_EXISTS); a later cancelled period does not (later voided: see Rehire)", async () => {
    const personId = await bare();
    const first = (await post(initialRoute, personId, personId, { start_date: addDays(today, -60), end_date: addDays(today, -31), employee_type_id: ids.et.EMPLOYEE, reason: "Legacy period" })).body.employments[0].id as string;
    const rehire = await post(rehireRoute, personId, personId, { start_date: addDays(today, 10), reason: "Second term", employee_type_id: ids.et.EMPLOYEE });
    expect(rehire.status).toBe(201);
    const secondId = rehire.body.employments[1].id as string;
    const pv = VoidEligibilitySchema.parse((await preview(first)).body);
    expect(pv.blockers).toEqual([
      { code: "LATER_PERIOD_EXISTS", message: expect.any(String), references: [{ employment_id: secondId, start_date: addDays(today, 10), end_date: null }] },
    ]);
    const r = await voidIt({ personId, employmentId: first });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("LATER_PERIOD_EXISTS");
    expect(r.body.details.map((d: { code: string }) => d.code)).toEqual(["LATER_PERIOD_EXISTS", "LATER_PERIOD_EXISTS"]);

    expect((await post(cancelRoute, secondId, personId, { reason: "Not coming back" })).status).toBe(201);
    const ok = VoidEligibilitySchema.parse((await preview(first)).body);
    expect(ok.eligible).toBe(true);
    expect(ok.consequences).toContain("PERSON_HAS_NO_VALID_EMPLOYMENT");
    expect((await voidIt({ personId, employmentId: first })).status).toBe(201);
  });

  it("Relationship Change: the successor is blocked (PV-24); the predecessor is blocked while the successor is valid", async () => {
    const p = await hired(addDays(today, -100), { type: ids.et.SERVICE_CONTRACTOR });
    const rc = await post(rcRoute, p.employmentId, p.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, reason: "Converted to employee" });
    expect(rc.status).toBe(201);
    const successor = { personId: p.personId, employmentId: rc.body.employments[1].id as string };
    const s = VoidEligibilitySchema.parse((await preview(successor.employmentId)).body);
    expect(blockerCodes(s)).toEqual(["RELATIONSHIP_CHANGE_SUCCESSOR"]);
    expect(s.blockers[0].references).toEqual([{ employment_id: p.employmentId, start_date: addDays(today, -100), end_date: addDays(today, -1) }]);
    const sr = await voidIt(successor);
    expect(sr.status).toBe(422);
    expect(sr.body.details[0].code).toBe("RELATIONSHIP_CHANGE_SUCCESSOR");
    expect(blockerCodes(VoidEligibilitySchema.parse((await preview(p.employmentId)).body))).toEqual(["LATER_PERIOD_EXISTS"]);
    expect((await voidIt(p)).status).toBe(409);
    expect((await db().employment.findUniqueOrThrow({ where: { id: successor.employmentId } })).voidedAt).toBeNull();
  });

  it("a predecessor whose Relationship Change successor was cancelled is not routine: eligible, but with an explicit warning", async () => {
    const p = await hired(addDays(today, -50), { type: ids.et.SERVICE_CONTRACTOR });
    const rc = await post(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 15), employee_type_id: ids.et.EMPLOYEE, reason: "Planned conversion" });
    expect(rc.status).toBe(201);
    const successorId = rc.body.employments[1].id as string;
    expect((await post(cancelRoute, successorId, p.personId, { reason: "Conversion withdrawn" })).status).toBe(201);
    const pv = VoidEligibilitySchema.parse((await preview(p.employmentId)).body);
    expect(pv.eligible).toBe(true);
    expect(pv.warnings.map((w) => w.code)).toEqual(["RELATIONSHIP_CHANGE_PREDECESSOR"]);
    expect(pv.warnings[0].message).toContain("Reverse End Employment");
    // The normal recovery for a genuine predecessor stays available: Reverse End.
    expect((await post(reverseRoute, p.employmentId, p.personId, { reason: "Conversion withdrawn" })).status).toBe(201);
    expect(VoidEligibilitySchema.parse((await preview(p.employmentId)).body).warnings).toEqual([]);
  });
});

describe("Void — manager dependency (design §4)", () => {
  it("an overlapping reference from another employee's valid period blocks and is listed; after HR corrects it Void is allowed", async () => {
    const m = await hired(addDays(today, -30));
    const b = await hired(addDays(today, -5), { manager: m.personId });
    const bCode = (await db().person.findUniqueOrThrow({ where: { id: b.personId } })).employeeCode;
    const [row] = (await period(b.employmentId)).assignments;
    expect(row.managerEmploymentId).toBe(m.employmentId);
    const pv = VoidEligibilitySchema.parse((await preview(m.employmentId)).body);
    expect(pv.blockers).toEqual([
      {
        code: "MANAGER_DEPENDENCY",
        message: expect.any(String),
        references: [{ person_id: b.personId, employee_code: bCode, full_name: expect.any(String), assignment_id: row.id, effective_from: addDays(today, -5), effective_to: null }],
      },
    ]);
    const r = await voidIt(m);
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("MANAGER_DEPENDENCY");
    expect(r.body.details[1]).toMatchObject({ field: "assignment_id", code: "MANAGER_DEPENDENCY", message: expect.stringContaining(bCode) });
    expect(JSON.stringify(r.body.details)).not.toContain(pv.blockers[0].references[0].full_name!);
    expect((await db().employment.findUniqueOrThrow({ where: { id: m.employmentId } })).voidedAt).toBeNull();

    // HR corrects the reference explicitly (nothing is changed automatically).
    const fix = await call(assignmentCorrectionRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: row.id },
      body: { expected_revision: await revision(b.personId), reason: "Manager was entered by mistake", manager_person_id: null },
      headers: { "idempotency-key": key("fix") },
    });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(VoidEligibilitySchema.parse((await preview(m.employmentId)).body).eligible).toBe(true);
    expect((await voidIt(m)).status).toBe(201);
  });

  it("references to another period of the same manager, from cancelled periods, and without overlap do not block", async () => {
    // Manager with a genuine earlier period P1 and an erroneous current period V (Rehire).
    const m = await hired(addDays(today, -400));
    const b = await hired(addDays(today, -300), { manager: m.personId }); // resolves to P1
    expect((await endIt(m, addDays(today, -200))).status).toBe(201);
    const rh = await post(rehireRoute, m.personId, m.personId, { start_date: addDays(today, -10), end_date: addDays(today, 60), reason: "Rehire", employee_type_id: ids.et.EMPLOYEE });
    expect(rh.status, JSON.stringify(rh.body)).toBe(201);
    const v = { personId: m.personId, employmentId: rh.body.employments[1].id as string };
    expect((await period(b.employmentId)).assignments[0].managerEmploymentId).toBe(m.employmentId);

    // A planned hire referencing V, then cancelled: ignored.
    const planned = await hired(addDays(today, 7), { manager: m.personId });
    expect((await period(planned.employmentId)).assignments[0].managerEmploymentId).toBe(v.employmentId);
    expect(blockerCodes(VoidEligibilitySchema.parse((await preview(v.employmentId)).body))).toEqual(["MANAGER_DEPENDENCY"]);
    expect((await post(cancelRoute, planned.employmentId, planned.personId, { reason: "Offer declined" })).status).toBe(201);

    // A reference without overlap (V was later shortened by a correction; C-73 leaves the reference as is): warning.
    const later = await hired(addDays(today, 5), { manager: m.personId });
    expect((await period(later.employmentId)).assignments[0].managerEmploymentId).toBe(v.employmentId);
    const shorten = await call(periodCorrectionRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: v.employmentId },
      body: { expected_revision: await revision(m.personId), reason: "Wrong planned end", end_date: addDays(today, 2) },
      headers: { "idempotency-key": key("pc") },
    });
    expect(shorten.status, JSON.stringify(shorten.body)).toBe(200);

    const pv = VoidEligibilitySchema.parse((await preview(v.employmentId)).body);
    expect(pv.eligible).toBe(true);
    expect(pv.consequences).toContain("PREVIOUS_PERIOD_UNCHANGED");
    expect(pv.warnings.map((w) => w.code)).toEqual(["MANAGER_REFERENCE_WITHOUT_OVERLAP"]);
    expect(pv.warnings[0].references.map((r) => r.person_id)).toEqual([later.personId]);
    expect((await voidIt(v)).status).toBe(201);
    // Nothing else was rewritten.
    expect((await period(b.employmentId)).assignments[0].managerEmploymentId).toBe(m.employmentId);
    expect((await period(later.employmentId)).assignments[0].managerEmploymentId).toBe(v.employmentId);
  });

  it("a blocker created after the preview is caught by the POST", async () => {
    const m = await hired(addDays(today, -3));
    const pv = VoidEligibilitySchema.parse((await preview(m.employmentId)).body);
    expect(pv.eligible).toBe(true);
    await hired(today, { manager: m.personId });
    const r = await voidIt(m, { expected_revision: pv.evaluated_revision });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("MANAGER_DEPENDENCY");
  });

  it("after Void the period is no longer resolvable as manager", async () => {
    const m = await hired(addDays(today, -3));
    expect((await voidIt(m)).status).toBe(201);
    const b = await hired(today);
    const r = await post(changeRoute, b.employmentId, b.personId, { effective_date: addDays(today, 1), manager_person_id: m.personId, reason: "New manager" });
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("MANAGER_NOT_EMPLOYED_ON_DATE");
  });
});

describe("Void — operational effect and Rehire", () => {
  it("status, list, department filter and current employment ignore the voided period; every write path is read-only", async () => {
    const p = await hired(addDays(today, -20), { email: "void.ops@example.test" });
    const name = (await db().person.findUniqueOrThrow({ where: { id: p.personId } })).fullName;
    expect((await voidIt(p)).status).toBe(201);
    const list = await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(name)}`, user: "admin" });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ employment_status: "no_employment", department: null, employee_type: null, work_email: null });
    const filtered = await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(name)}&department_id=${ids.d.ENG}`, user: "admin" });
    expect(filtered.body.data).toHaveLength(0);

    const [row] = (await period(p.employmentId)).assignments;
    const writes = [
      await post(changeRoute, p.employmentId, p.personId, { effective_date: today, job_level_id: ids.l.L2, reason: "x" }),
      await post(initialAssignmentRoute, p.employmentId, p.personId, { effective_date: today, department_id: ids.d.ENG, job_title_id: ids.j.SE }),
      await post(periodCorrectionRoute, p.employmentId, p.personId, { start_date: addDays(today, -19), reason: "x" }),
      await post(endRoute, p.employmentId, p.personId, { end_date: today, end_reason_code: "VOLUNTARY_RESIGNATION" }),
      await post(reverseRoute, p.employmentId, p.personId, { reason: "x" }),
      await post(rcRoute, p.employmentId, p.personId, { start_date: today, employee_type_id: ids.et.INTERN, reason: "x" }),
      await post(cancelRoute, p.employmentId, p.personId, { reason: "x" }),
      await call(workEmailRoute, { path: "/x", method: "PATCH", user: "admin", params: { id: p.employmentId }, body: { expected_revision: await revision(p.personId), work_email: "other@example.test" } }),
      await call(assignmentCorrectionRoute, { path: "/x", method: "POST", user: "admin", params: { id: row.id }, body: { expected_revision: await revision(p.personId), reason: "x", job_level_id: ids.l.L2 }, headers: { "idempotency-key": key("acx") } }),
    ];
    for (const w of writes) expect([w.status, w.body.error]).toEqual([409, "EMPLOYMENT_PERIOD_READ_ONLY"]);
  });

  it("voiding an erroneous Rehire leaves the previous period and its End unchanged; Reverse End then becomes possible", async () => {
    const p = await hired(addDays(today, -300));
    expect((await endIt(p, addDays(today, -30))).status).toBe(201);
    const rh = await post(rehireRoute, p.personId, p.personId, { start_date: today, reason: "Rehire", employee_type_id: ids.et.EMPLOYEE });
    expect(rh.status).toBe(201);
    const rehire = { personId: p.personId, employmentId: rh.body.employments[1].id as string };
    const blocked = await post(reverseRoute, p.employmentId, p.personId, { reason: "End was wrong" });
    expect(blocked.body.error).toBe("LATER_PERIOD_EXISTS");

    const pv = VoidEligibilitySchema.parse((await preview(rehire.employmentId)).body);
    expect(pv.consequences).toEqual(["NO_OPERATIONAL_EFFECT", "PREVIOUS_PERIOD_UNCHANGED", "VOID_IS_PERMANENT"]);
    const prevBefore = await period(p.employmentId);
    const prevEvents = await events(p.employmentId);
    const r = await voidIt(rehire);
    expect(r.status).toBe(201);
    expect(EmployeeDetailSchema.parse(r.body).employment_status).toBe("ended");
    expect(await period(p.employmentId)).toEqual(prevBefore);
    expect(await events(p.employmentId)).toEqual(prevEvents);

    const reversed = await post(reverseRoute, p.employmentId, p.personId, { reason: "End was also wrong" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect(EmployeeDetailSchema.parse(reversed.body).employment_status).toBe("active");
  });
});

describe("Void — authorization, reason, idempotency and concurrency", () => {
  it("employment.correct only: HR_EDITOR and API_DOCS_READER are denied for preview and Void; the reason is mandatory", async () => {
    const p = await hired(today);
    for (const user of ["editor", "docs", "noroles"] as TestUser[]) {
      expect((await preview(p.employmentId, user)).status).toBe(403);
      expect((await voidIt(p, {}, user)).status).toBe(403);
    }
    expect((await call(eligibilityRoute, { path: "/x", params: { id: p.employmentId } })).status).toBe(401);
    const blank = await voidIt(p, { reason: "   " });
    expect(blank.status).toBe(422);
    expect(blank.body.details[0].code).toBe("REASON_REQUIRED");
    const missing = await call(voidRoute, { path: "/x", method: "POST", user: "admin", params: { id: p.employmentId }, body: { expected_revision: await revision(p.personId) }, headers: { "idempotency-key": key("m") } });
    expect(missing.status).toBe(400);
    const noKey = await call(voidRoute, { path: "/x", method: "POST", user: "admin", params: { id: p.employmentId }, body: { expected_revision: await revision(p.personId), reason: "x" } });
    expect(noKey.status).toBe(400);
    expect((await db().employment.findUniqueOrThrow({ where: { id: p.employmentId } })).voidedAt).toBeNull();
  });

  it("same key replays once; a reused key with another payload and a stale revision are rejected", async () => {
    const p = await hired(today);
    const rev = await revision(p.personId);
    const idem = key("same");
    const first = await voidIt(p, { expected_revision: rev }, "admin", idem);
    expect(first.status).toBe(201);
    const replay = await voidIt(p, { expected_revision: rev }, "admin", idem);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.body.employments[0].voided_at).toBe(first.body.employments[0].voided_at);
    expect((await voidIt(p, { expected_revision: rev, reason: "Other reason" }, "admin", idem)).body.error).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await events(p.employmentId)).filter((x) => x.eventType === "employment_voided")).toHaveLength(1);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId, action: "employment.void" } })).toBe(1);

    const q = await hired(today);
    const evaluated = VoidEligibilitySchema.parse((await preview(q.employmentId)).body).evaluated_revision;
    expect((await call(workEmailRoute, { path: "/x", method: "PATCH", user: "admin", params: { id: q.employmentId }, body: { expected_revision: evaluated, work_email: "void.stale@example.test" } })).status).toBe(200);
    const stale = await voidIt(q, { expected_revision: evaluated });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
  });

  it("a rejected Void leaves nothing partial (no marker, event, audit or revision bump)", async () => {
    const m = await hired(addDays(today, -3));
    await hired(today, { manager: m.personId });
    const rev = await revision(m.personId);
    expect((await voidIt(m)).status).toBe(422);
    expect(await revision(m.personId)).toBe(rev);
    expect((await db().employment.findUniqueOrThrow({ where: { id: m.employmentId } })).voidedAt).toBeNull();
    expect((await events(m.employmentId)).map((x) => x.eventType)).toEqual(["start"]);
    expect(await db().auditEvent.count({ where: { entityId: m.employmentId, action: "employment.void" } })).toBe(0);
  });

  it("concurrent Void with the same key executes once", async () => {
    const p = await hired(today);
    const rev = await revision(p.personId);
    const idem = key("conc");
    const rs = await Promise.all([1, 2, 3].map(() => voidIt(p, { expected_revision: rev }, "admin", idem)));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
    expect((await events(p.employmentId)).filter((x) => x.eventType === "employment_voided")).toHaveLength(1);
  });

  it("concurrent Void vs End / Rehire / Relationship Change with the same revision: exactly one wins", async () => {
    for (const other of ["end", "rc"] as const) {
      for (let i = 0; i < 3; i += 1) {
        const p = await hired(addDays(today, -30), { type: ids.et.SERVICE_CONTRACTOR });
        const rev = await revision(p.personId);
        const competing =
          other === "end"
            ? call(endRoute, { path: "/x", method: "POST", user: "admin", params: { id: p.employmentId }, body: { expected_revision: rev, end_date: addDays(today, 3), end_reason_code: "MUTUAL_AGREEMENT" }, headers: { "idempotency-key": key("ce") } })
            : call(rcRoute, { path: "/x", method: "POST", user: "admin", params: { id: p.employmentId }, body: { expected_revision: rev, start_date: addDays(today, 3), employee_type_id: ids.et.EMPLOYEE, reason: "Conversion" }, headers: { "idempotency-key": key("cr") } });
        const [v, o] = await Promise.all([voidIt(p, { expected_revision: rev }), competing]);
        expect([v.status, o.status].sort()).toEqual([201, 409]);
        const loser = v.status === 409 ? v : o;
        expect(loser.body.error).toBe("REVISION_CONFLICT");
      }
    }
    // Rehire vs Void of an earlier ended period (latest valid): one wins.
    for (let i = 0; i < 3; i += 1) {
      const p = await hired(addDays(today, -90));
      expect((await endIt(p, addDays(today, -10))).status).toBe(201);
      const rev = await revision(p.personId);
      const [v, rh] = await Promise.all([
        voidIt(p, { expected_revision: rev }),
        call(rehireRoute, { path: "/x", method: "POST", user: "admin", params: { id: p.personId }, body: { expected_revision: rev, start_date: today, reason: "Rehire", employee_type_id: ids.et.EMPLOYEE }, headers: { "idempotency-key": key("crh") } }),
      ]);
      expect([v.status, rh.status].sort()).toEqual([201, 409]);
    }
  });

  it("concurrent Void vs another employee choosing this period as manager never leaves a dependency on a voided period", async () => {
    for (let i = 0; i < 6; i += 1) {
      const m = await hired(addDays(today, -5));
      const b = await hired(addDays(today, -2));
      const [v, c] = await Promise.all([
        voidIt(m),
        post(changeRoute, b.employmentId, b.personId, { effective_date: today, manager_person_id: m.personId, reason: "New manager" }),
      ]);
      const voided = (await db().employment.findUniqueOrThrow({ where: { id: m.employmentId } })).voidedAt !== null;
      const referencing = await db().jobAssignment.count({ where: { managerEmploymentId: m.employmentId } });
      expect(voided && referencing > 0, JSON.stringify([v.status, c.status, c.body?.details])).toBe(false);
      expect(v.status === 201 || c.status === 201).toBe(true);
      if (v.status === 201) expect(c.status).toBe(422);
      else expect(v.body.details[0].code).toBe("MANAGER_DEPENDENCY");
    }
  });
});

describe("Void — dependency-check extension point", () => {
  it("fails closed: a check that errors blocks Void; preview and POST evaluate the same ordered list", async () => {
    expect(VOID_DEPENDENCY_CHECKS.map((c) => c.key)).toEqual(["later_period", "relationship_change_successor", "manager_dependency"]);
    const p = await hired(today);
    const row = await db().employment.findUniqueOrThrow({ where: { id: p.employmentId } });
    const failing = { key: "payroll_results", run: async () => Promise.reject(new Error("module unavailable")) };
    const result = await db().$transaction((tx) => evaluateVoidDependencies({ tx, period: row, today }, [...VOID_DEPENDENCY_CHECKS, failing]));
    expect(result.blockers).toEqual([{ code: DEPENDENCY_CHECK_FAILED, message: expect.stringContaining("payroll_results"), references: [] }]);
    const err = voidBlockedError(result.blockers);
    expect([err.status, err.code]).toEqual([503, "SERVICE_UNAVAILABLE"]);
    const future = { key: "leave_balances", run: async () => ({ blockers: [{ code: "LEAVE_DEPENDENCY", message: "Leave records exist.", references: [] }] }) };
    const blocked = await db().$transaction((tx) => evaluateVoidDependencies({ tx, period: row, today }, [future]));
    expect(voidBlockedError(blocked.blockers)).toMatchObject({ status: 422, code: "BUSINESS_RULE_VIOLATION", details: [{ code: "LEAVE_DEPENDENCY" }] });
  });
});

describe("Void — database guarantees (application role)", () => {
  it("disposition CHECK, terminal trigger, one void event, event-insert rule and manager safety net", async () => {
    const p = await hired(addDays(today, -3));
    const live = await hired(today);
    // A void event without the marker is rejected.
    await expect(
      app.query("INSERT INTO employment_event (employment_id, event_type, effective_date, recorded_by) VALUES ($1, 'employment_voided', $2, $3)", [live.employmentId, today, admin]),
    ).rejects.toMatchObject({ constraint: "employment_event_void_requires_marker" });

    expect((await voidIt(p)).status).toBe(201);
    const fail = (sql: string, params: unknown[]) => app.query(sql, params);
    await expect(fail("UPDATE employment SET start_date = start_date - 1 WHERE id = $1", [p.employmentId])).rejects.toMatchObject({ constraint: "employment_voided_is_terminal" });
    await expect(fail("UPDATE employment SET voided_at = NULL WHERE id = $1", [p.employmentId])).rejects.toMatchObject({ constraint: "employment_voided_is_terminal" });
    await expect(fail("UPDATE employment SET work_email = 'x@example.test' WHERE id = $1", [p.employmentId])).rejects.toMatchObject({ constraint: "employment_voided_is_terminal" });
    await expect(fail("UPDATE employment SET cancelled_at = now() WHERE id = $1", [p.employmentId])).rejects.toMatchObject({ code: "23514" });
    await expect(
      fail("INSERT INTO employment_event (employment_id, event_type, effective_date, recorded_by) VALUES ($1, 'end', $2, $3)", [p.employmentId, today, admin]),
    ).rejects.toMatchObject({ constraint: "employment_event_after_void" });
    await expect(
      fail("INSERT INTO employment_event (employment_id, event_type, effective_date, recorded_by) VALUES ($1, 'employment_voided', $2, $3)", [p.employmentId, today, admin]),
    ).rejects.toMatchObject({ constraint: "employment_event_one_void_uq" });
    await expect(fail("UPDATE employment SET voided_at = now(), cancelled_at = now() WHERE id = $1", [live.employmentId])).rejects.toMatchObject({
      constraint: "employment_single_disposition_ck",
    });
    // An assignment may not reference the voided period as manager for overlapping dates.
    const [liveRow] = (await period(live.employmentId)).assignments;
    await expect(fail("UPDATE job_assignment SET manager_employment_id = $1 WHERE id = $2", [p.employmentId, liveRow.id])).rejects.toMatchObject({
      constraint: "job_assignment_manager_not_voided",
    });
    // Events cannot be deleted; the void event's date cannot be corrected.
    await expect(fail("DELETE FROM employment_event WHERE employment_id = $1", [p.employmentId])).rejects.toMatchObject({ code: "42501" });
    await expect(
      fail("UPDATE employment_event SET effective_date = effective_date - 1 WHERE employment_id = $1 AND event_type = 'employment_voided'", [p.employmentId]),
    ).rejects.toMatchObject({ constraint: "employment_event_date_correction_scope" });
  });
});
