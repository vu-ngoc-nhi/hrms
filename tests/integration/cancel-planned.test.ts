import { beforeAll, describe, expect, it } from "vitest";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as cancelRoute } from "@/app/api/v1/core-hr/employments/[id]/cancel-planned/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as reverseRoute } from "@/app/api/v1/core-hr/employments/[id]/reverse-end/route";
import { POST as initialRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// S4.10 Cancel Planned Period (C-29, C-69 to C-71).
let ids: Awaited<ReturnType<typeof catalogIds>>;
let admin: string;
const today = todayInVietnam();
let n = 0;
const nextName = () => {
  n += 1;
  return `Đinh Thị Mai ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
};

async function hired(start: string, o: { email?: string; type?: string; name?: string } = {}) {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("cp") },
    body: {
      full_name: o.name ?? nextName(),
      employment: {
        start_date: start,
        employee_type_id: o.type ?? ids.et.EMPLOYEE,
        ...(o.email ? { work_email: o.email } : {}),
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L1 },
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}
async function bare() {
  const r = await call(createRoute, { path: "/api/v1/core-hr/employees", method: "POST", user: "admin", headers: { "idempotency-key": key("cb") }, body: { full_name: nextName() } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
const events = (employmentId: string) => db().employmentEvent.findMany({ where: { employmentId }, orderBy: [{ effectiveDate: "asc" }, { recordedAt: "asc" }] });
const cancel = async (p: { personId: string; employmentId: string }, body: Record<string, unknown> = {}, user: TestUser = "editor", idem = key("cnl")) =>
  call(cancelRoute, {
    path: "/x",
    method: "POST",
    user,
    params: { id: p.employmentId },
    body: { expected_revision: await revision(p.personId), reason: "Candidate declined the offer", ...body },
    headers: { "idempotency-key": idem },
  });
const post = async (route: typeof cancelRoute, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "editor") =>
  call(route, { path: "/x", method: "POST", user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("op") } });
const period = (employmentId: string) => db().employment.findUniqueOrThrow({ where: { id: employmentId } });

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
});

describe("Cancel Planned Period — eligibility", () => {
  it("HR_EDITOR cancels a future period: nothing is deleted or cleared; one cancel event dated with the planned start", async () => {
    const start = addDays(today, 20);
    const p = await hired(start, { email: "planned.hire@example.test" });
    const before = await db().employment.findUniqueOrThrow({ where: { id: p.employmentId }, include: { assignments: true } });
    const [startEvent] = await events(p.employmentId);
    const t0 = new Date();
    const r = await cancel(p);
    const t1 = new Date();
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.employment_status).toBe("no_employment");
    expect(d.employments).toHaveLength(1);
    const period = d.employments[0];
    expect(period).toMatchObject({ start_date: start, period_lifecycle: null, work_email: "planned.hire@example.test", employee_type: { id: ids.et.EMPLOYEE } });
    expect(period.cancelled_at).not.toBeNull();
    expect(period.assignments).toHaveLength(1);
    expect(period.events.map((e) => [e.event_type, e.effective_date])).toEqual([
      ["start", start],
      ["cancel_planned_start", start],
    ]);
    expect(JSON.stringify(r.body)).not.toContain("declined the offer");

    const after = await db().employment.findUniqueOrThrow({ where: { id: p.employmentId }, include: { assignments: true } });
    expect({ ...after, cancelledAt: null }).toEqual({ ...before, cancelledAt: null });
    const all = await events(p.employmentId);
    expect(all[0]).toEqual(startEvent);
    const cancelEvents = all.filter((e) => e.eventType === "cancel_planned_start");
    expect(cancelEvents).toHaveLength(1);
    expect(cancelEvents[0]).toMatchObject({ reason: "Candidate declined the offer", recordedBy: await userId("editor") });
    expect(cancelEvents[0].recordedAt.getTime()).toBeGreaterThanOrEqual(t0.getTime() - 5);
    expect(cancelEvents[0].recordedAt.getTime()).toBeLessThanOrEqual(t1.getTime() + 5);
    expect(after.cancelledAt?.getTime()).toBe(cancelEvents[0].recordedAt.getTime());

    const audit = await db().auditEvent.findFirstOrThrow({ where: { entityId: p.employmentId, action: "employment.cancel_planned" }, include: { fieldChanges: true } });
    expect(audit).toMatchObject({ reason: "Candidate declined the offer", changedFields: ["employment.cancelled", "employment_event.cancel_planned_start"] });
    expect(audit.fieldChanges).toEqual([]);
  });

  it("HR_ADMIN may cancel too; today and past start dates, already cancelled periods and missing reasons are rejected", async () => {
    expect((await cancel(await hired(addDays(today, 5)), {}, "admin")).status).toBe(201);
    const t = await hired(today);
    const todayR = await cancel(t, {}, "admin");
    expect(todayR.status).toBe(422);
    expect(todayR.body.details[0].code).toBe("PERIOD_ALREADY_STARTED");
    const past = await cancel(await hired("2024-02-05"), {}, "admin");
    expect(past.body.details[0].code).toBe("PERIOD_ALREADY_STARTED");
    expect((await db().employment.findUniqueOrThrow({ where: { id: t.employmentId } })).endDate).toBeNull();

    const f = await hired(addDays(today, 9));
    expect((await cancel(f, { reason: "   " })).body.details[0].code).toBe("REASON_REQUIRED");
    expect((await call(cancelRoute, { path: "/x", method: "POST", user: "editor", params: { id: f.employmentId }, body: { expected_revision: await revision(f.personId) }, headers: { "idempotency-key": key("nr") } })).status).toBe(400);
    expect((await cancel(f, {}, "docs")).status).toBe(403);
    expect((await cancel(f)).status).toBe(201);
    const again = await cancel(f);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");
  });

  it("only the latest non-cancelled period; a later one blocks without cascading", async () => {
    const personId = await bare();
    const first = (
      await post(initialRoute, personId, personId, { start_date: addDays(today, 10), end_date: addDays(today, 40) })
    ).body.employments[0].id as string;
    const second = await post(rehireRoute, personId, personId, { start_date: addDays(today, 60), reason: "Second term" });
    expect(second.status).toBe(201);
    const secondId = second.body.employments[1].id as string;
    const blocked = await cancel({ personId, employmentId: first });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("LATER_PERIOD_EXISTS");
    expect((await db().employment.findUniqueOrThrow({ where: { id: secondId } })).endDate).toBeNull();
    expect((await cancel({ personId, employmentId: secondId })).status).toBe(201);
    expect((await cancel({ personId, employmentId: first })).status).toBe(201); // cancelled later periods do not count
  });
});

describe("Active End Event", () => {
  it("blocks cancellation until the End is reversed; a planned end date without an End event does not block", async () => {
    const p = await hired(addDays(today, 30));
    expect((await post(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 90), end_reason_code: "MUTUAL_AGREEMENT" })).status).toBe(201);
    const blocked = await cancel(p);
    expect(blocked.status).toBe(422);
    expect(blocked.body.details[0].code).toBe("ACTIVE_END_EVENT_EXISTS");
    expect((await post(reverseRoute, p.employmentId, p.personId, { reason: "Ended the wrong period" }, "admin")).status).toBe(201);
    const ok = await cancel(p);
    expect(ok.status).toBe(201);
    expect(ok.body.employments[0].end_date).toBe(null); // restored by the reversal, then kept as planned data

    const q = await bare();
    const planned = await post(initialRoute, q, q, { start_date: addDays(today, 15), end_date: addDays(today, 200) });
    const r = await cancel({ personId: q, employmentId: planned.body.employments[0].id });
    expect(r.status).toBe(201);
    expect(r.body.employments[0].end_date).toBe(addDays(today, 200));
  });
});

describe("Operational effect", () => {
  it("not Pre-start, no completeness, frees the Work Email and allows a replacement period with the same dates", async () => {
    const start = addDays(today, 25);
    const name = "Test Cancelled Prestart Person";
    const p = await hired(start, { email: "freed.by.cancel@example.test", name });
    const prestart = async () =>
      (await call(listRoute, { path: `/api/v1/core-hr/employees?employment_status=not_started&search=${encodeURIComponent(name)}`, user: "editor" })).body.data;
    expect(await prestart()).toHaveLength(1);
    const r = await cancel(p);
    expect(r.body.completeness.operational.items.find((i: { code: string }) => i.code === "start_date").satisfied).toBe(false);
    expect(await prestart()).toEqual([]);
    const other = await hired(addDays(today, 26), { email: "freed.by.cancel@example.test" });
    expect(other.personId).not.toBe(p.personId);
    const replacement = await post(initialRoute, p.personId, p.personId, { start_date: start, employee_type_id: ids.et.EMPLOYEE });
    expect(replacement.status).toBe(201);
    expect(replacement.body.employment_status).toBe("not_started");
  });

  it("a cancelled period no longer resolves as a manager on its dates", async () => {
    const mgr = await hired(addDays(today, 10));
    const report = await hired("2024-01-08");
    const withMgr = async () =>
      post(changeRoute, report.employmentId, report.personId, { effective_date: addDays(today, 15), reason: "New manager", manager_person_id: mgr.personId });
    expect((await cancel(mgr)).status).toBe(201);
    const r = await withMgr();
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("MANAGER_NOT_EMPLOYED_ON_DATE");
  });

  it("a legacy future period without a start event gets only the cancellation event", async () => {
    const personId = await bare();
    const legacy = await db().employment.create({ data: { personId, startDate: toDbDate(addDays(today, 40)), employeeTypeId: ids.et.EMPLOYEE, createdBy: admin } });
    expect((await cancel({ personId, employmentId: legacy.id })).status).toBe(201);
    expect((await events(legacy.id)).map((e) => e.eventType)).toEqual(["cancel_planned_start"]);
  });
});

describe("Initial Employment, Rehire and Relationship Change", () => {
  it("cancelling a planned Initial Employment keeps the Person; Add Initial Employment Period is allowed again", async () => {
    const personId = await bare();
    const ini = await post(initialRoute, personId, personId, { start_date: addDays(today, 12) });
    const r = await cancel({ personId, employmentId: ini.body.employments[0].id });
    expect(r.body).toMatchObject({ id: personId, employment_status: "no_employment" });
    expect((await post(initialRoute, personId, personId, { start_date: addDays(today, 14) })).status).toBe(201);
  });

  it("cancelling a planned Rehire leaves the previous period and its End event unchanged; a Rehire may be planned again", async () => {
    const p = await hired("2023-01-02");
    expect((await post(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 10), end_reason_code: "PLANNED_TERM_COMPLETED" })).status).toBe(201);
    const previous = await db().employment.findUniqueOrThrow({ where: { id: p.employmentId }, include: { assignments: true } });
    const previousEvents = await events(p.employmentId);
    const rh = await post(rehireRoute, p.personId, p.personId, { start_date: addDays(today, 30), reason: "Agreed return" });
    expect(rh.status).toBe(201);
    expect((await cancel({ personId: p.personId, employmentId: rh.body.employments[1].id })).status).toBe(201);
    expect(await db().employment.findUniqueOrThrow({ where: { id: p.employmentId }, include: { assignments: true } })).toEqual(previous);
    expect(await events(p.employmentId)).toEqual(previousEvents);
    expect((await post(rehireRoute, p.personId, p.personId, { start_date: addDays(today, 45), reason: "New return date" })).status).toBe(201);
  });

  it("Relationship Change recovery: cancel the new planned period, then Reverse End restores the old period exactly", async () => {
    const p = await hired("2024-01-08", { type: ids.et.SERVICE_CONTRACTOR, email: "rc.recovery@example.test" });
    const oldRow = (await db().jobAssignment.findMany({ where: { employmentId: p.employmentId } }))[0];
    const change = await post(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 20), employee_type_id: ids.et.EMPLOYEE, reason: "Conversion" });
    expect(change.status).toBe(201);
    const newId = change.body.employments[1].id as string;
    expect(change.body.employments[0].end_date).toBe(addDays(today, 19));

    const blocked = await post(reverseRoute, p.employmentId, p.personId, { reason: "Conversion was entered by mistake" }, "admin");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("LATER_PERIOD_EXISTS");
    expect((await cancel({ personId: p.personId, employmentId: newId })).status).toBe(201);
    const reversed = await post(reverseRoute, p.employmentId, p.personId, { reason: "Conversion was entered by mistake" }, "admin");
    expect(reversed.status).toBe(201);

    const d = EmployeeDetailSchema.parse(reversed.body);
    expect(d.employments[0]).toMatchObject({ id: p.employmentId, end_date: null, has_active_end_event: false, employee_type: { id: ids.et.SERVICE_CONTRACTOR } });
    expect(d.employments[1]).toMatchObject({ id: newId, period_lifecycle: null });
    expect(d.employments[1].cancelled_at).not.toBeNull();
    const restored = await db().jobAssignment.findUniqueOrThrow({ where: { id: oldRow.id } });
    expect(restored).toEqual(oldRow);
    expect(d.employment_status).toBe("active");
  });
});

describe("Concurrency and rollback", () => {
  it("same key replays once; different payload is rejected; different keys produce one cancel event and one REVISION_CONFLICT", async () => {
    const p = await hired(addDays(today, 30));
    const rev = await revision(p.personId);
    const k = key("cnl-same");
    const both = await Promise.all([cancel(p, { expected_revision: rev }, "editor", k), cancel(p, { expected_revision: rev }, "editor", k)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect((await events(p.employmentId)).filter((e) => e.eventType === "cancel_planned_start")).toHaveLength(1);
    const reused = await cancel(p, { expected_revision: rev, reason: "Different" }, "editor", k);
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");

    const q = await hired(addDays(today, 30));
    const qrev = await revision(q.personId);
    const race = await Promise.all([cancel(q, { expected_revision: qrev }, "editor", key("a")), cancel(q, { expected_revision: qrev, reason: "Other" }, "admin", key("b"))]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(race.find((r) => r.status === 409)!.body.error).toBe("REVISION_CONFLICT");
    expect((await events(q.employmentId)).filter((e) => e.eventType === "cancel_planned_start")).toHaveLength(1);
  });

  it("a failed request leaves the period uncancelled with no event or audit", async () => {
    const p = await hired(addDays(today, 30));
    const stale = await cancel(p, { expected_revision: (await revision(p.personId)) + 3 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
    expect((await period(p.employmentId)).cancelledAt).toBeNull();
    expect((await events(p.employmentId)).map((e) => e.eventType)).toEqual(["start"]);
    expect(await db().auditEvent.count({ where: { entityId: p.employmentId, action: "employment.cancel_planned" } })).toBe(0);
    expect(fromDbDate((await period(p.employmentId)).startDate)).toBe(addDays(today, 30));
  });
});
