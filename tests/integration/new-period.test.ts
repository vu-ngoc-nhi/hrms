import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as reverseRoute } from "@/app/api/v1/core-hr/employments/[id]/reverse-end/route";
import { POST as initialRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// S4.8 Add Initial Employment Period (C-60) and Rehire (C-61, C-62): two distinct actions.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let admin: string;
let inactiveType: string;
const today = todayInVietnam();
let n = 0;

const nextName = () => {
  n += 1;
  return `Lò Văn Quang ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
};

async function bare() {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("np") },
    body: { full_name: nextName() },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, code: r.body.employee_code as string };
}

async function hired(start: string, workEmail?: string) {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("nh") },
    body: {
      full_name: nextName(),
      employment: {
        start_date: start,
        employee_type_id: ids.et.EMPLOYEE,
        ...(workEmail ? { work_email: workEmail } : {}),
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L2 },
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string, code: r.body.employee_code as string };
}

/** Legacy-style period written directly (no lifecycle events). */
async function legacyPeriod(personId: string, start: string, end: string | null, email?: string) {
  return (
    await db().employment.create({
      data: { personId, startDate: toDbDate(start), endDate: end ? toDbDate(end) : null, employeeTypeId: ids.et.EMPLOYEE, workEmail: email ?? null, createdBy: admin },
    })
  ).id;
}

const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
const periods = (personId: string) => db().employment.findMany({ where: { personId }, orderBy: { startDate: "asc" } });

const initial = (personId: string, body: Record<string, unknown>, user: TestUser = "editor", idem = key("ini")) =>
  call(initialRoute, { path: "/x", method: "POST", user, params: { id: personId }, body, headers: { "idempotency-key": idem } });
const rehire = (personId: string, body: Record<string, unknown>, user: TestUser = "editor", idem = key("reh")) =>
  call(rehireRoute, { path: "/x", method: "POST", user, params: { id: personId }, body, headers: { "idempotency-key": idem } });
const endIt = async (p: { personId: string; employmentId: string }, end: string, user: TestUser = "admin") => {
  const r = await call(endRoute, {
    path: "/x",
    method: "POST",
    user,
    params: { id: p.employmentId },
    body: { expected_revision: await revision(p.personId), end_date: end, end_reason_code: "VOLUNTARY_RESIGNATION" },
    headers: { "idempotency-key": key("end") },
  });
  expect(r.status).toBe(201);
};
const auditsFor = (entityId: string) => db().auditEvent.findMany({ where: { entityId }, include: { fieldChanges: true }, orderBy: { id: "asc" } });
const values = (ev: { fieldChanges: { field: string; oldValue: string | null; newValue: string | null }[] }) =>
  Object.fromEntries(ev.fieldChanges.map((c) => [c.field, [c.oldValue, c.newValue]]));

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  inactiveType = (await db().employeeType.create({ data: { code: "NP_RETIRED_TYPE", name: "Retired Type", isActive: false } })).id;
});
afterAll(async () => {
  await app.end();
});

describe("Add Initial Employment Period", () => {
  it("HR_EDITOR adds a period today to a profile-only person: start event, no assignment, no reason, audit employment.initial", async () => {
    const p = await bare();
    const rev = await revision(p.personId);
    const r = await initial(p.personId, { expected_revision: rev, start_date: today, employee_type_id: ids.et.EMPLOYEE });
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d).toMatchObject({ id: p.personId, employee_code: p.code, revision: rev + 1, employment_status: "active" });
    expect(d.employments).toHaveLength(1);
    expect(d.employments[0]).toMatchObject({ start_date: today, end_date: null, work_email: null, assignments: [], has_active_end_event: false });
    expect(d.employments[0].events.map((e) => [e.event_type, e.effective_date])).toEqual([["start", today]]);
    expect(d.completeness.operational.status).toBe("incomplete"); // no assignment / work email yet: shown, not blocked
    const [ev] = await auditsFor(d.employments[0].id);
    expect(ev).toMatchObject({ action: "employment.initial", reason: null });
    expect(values(ev)).toEqual({ "employment.start_date": [null, today], employee_type_id: [null, ids.et.EMPLOYEE] });
  });

  it("future start needs no reason; a past start is Initial Data Capture that HR_EDITOR may do with a mandatory reason", async () => {
    const f = await bare();
    expect((await initial(f.personId, { expected_revision: await revision(f.personId), start_date: addDays(today, 20) })).status).toBe(201);

    const b = await bare();
    const rev = await revision(b.personId);
    const noReason = await initial(b.personId, { expected_revision: rev, start_date: "2021-04-05" });
    expect(noReason.status).toBe(422);
    expect(noReason.body.details[0].code).toBe("REASON_REQUIRED");
    const ok = await initial(b.personId, { expected_revision: rev, start_date: "2021-04-05", reason: "Employment history was not migrated" });
    expect(ok.status).toBe(201);
    const [ev] = await auditsFor(ok.body.employments[0].id);
    expect(ev).toMatchObject({ action: "employment.initial_data_capture", reason: "Employment history was not migrated" });
  });

  it("a person with only cancelled periods is eligible (not a rehire); nothing is copied from the cancelled record", async () => {
    const p = await hired(addDays(today, 30), "cancelled.holder@example.test");
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [p.employmentId]);
    const r = await initial(p.personId, { expected_revision: await revision(p.personId), start_date: addDays(today, 30), employee_type_id: ids.et.INTERN });
    expect(r.status).toBe(201);
    const fresh = r.body.employments.find((e: { id: string }) => e.id !== p.employmentId);
    expect(fresh).toMatchObject({ work_email: null, assignments: [], employee_type: { id: ids.et.INTERN } });
    // Cannot add a second initial period once a real one exists.
    const again = await initial(p.personId, { expected_revision: r.body.revision, start_date: addDays(today, 400) });
    expect(again.status).toBe(422);
    expect(again.body.details[0].code).toBe("EMPLOYMENT_ALREADY_EXISTS");
  });

  it("rejects a person who already has a non-cancelled period", async () => {
    const p = await hired("2024-01-08");
    const r = await initial(p.personId, { expected_revision: await revision(p.personId), start_date: addDays(today, 10) }, "admin");
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("EMPLOYMENT_ALREADY_EXISTS");
    expect(await periods(p.personId)).toHaveLength(1);
  });

  it("an optional planned end date is validated and never creates an End event", async () => {
    const p = await bare();
    const rev = await revision(p.personId);
    const bad = await initial(p.personId, { expected_revision: rev, start_date: addDays(today, 5), end_date: addDays(today, 4) });
    expect(bad.status).toBe(422);
    expect(bad.body.details[0].code).toBe("END_BEFORE_START");
    const ok = await initial(p.personId, { expected_revision: rev, start_date: addDays(today, 5), end_date: addDays(today, 200) });
    expect(ok.status).toBe(201);
    expect(ok.body.employments[0]).toMatchObject({ end_date: addDays(today, 200), has_active_end_event: false });
    expect(ok.body.employments[0].events.map((e: { event_type: string }) => e.event_type)).toEqual(["start"]);
  });

  it("enforces Work Email range uniqueness, active Employee Types and permissions; nothing is written on failure", async () => {
    await hired("2023-01-02", "taken.initial@example.test");
    const p = await bare();
    const rev = await revision(p.personId);
    const email = await initial(p.personId, { expected_revision: rev, start_date: today, work_email: "taken.initial@example.test" });
    expect(email.status).toBe(409);
    expect(email.body.error).toBe("WORK_EMAIL_IN_USE");
    const inactive = await initial(p.personId, { expected_revision: rev, start_date: today, employee_type_id: inactiveType });
    expect(inactive.status).toBe(422);
    expect(inactive.body.details[0].code).toBe("NOT_ACTIVE");
    expect((await initial(p.personId, { expected_revision: rev, start_date: today }, "docs")).status).toBe(403);
    expect((await initial("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { expected_revision: 1, start_date: today })).status).toBe(404);
    expect(await periods(p.personId)).toEqual([]);
    expect(await revision(p.personId)).toBe(rev);
  });

  it("idempotency: same key replays once, a different payload is rejected, different keys conflict on revision", async () => {
    const p = await bare();
    const rev = await revision(p.personId);
    const k = key("ini-same");
    const body = { expected_revision: rev, start_date: today };
    const both = await Promise.all([initial(p.personId, body, "editor", k), initial(p.personId, body, "editor", k)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect(await periods(p.personId)).toHaveLength(1);
    const reused = await initial(p.personId, { ...body, start_date: addDays(today, 1) }, "editor", k);
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");

    const q = await bare();
    const qrev = await revision(q.personId);
    const race = await Promise.all([
      initial(q.personId, { expected_revision: qrev, start_date: today }, "editor", key("a")),
      initial(q.personId, { expected_revision: qrev, start_date: addDays(today, 3) }, "editor", key("b")),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(race.find((r) => r.status === 409)!.body.error).toBe("REVISION_CONFLICT");
    expect(await periods(q.personId)).toHaveLength(1);
  });
});

describe("Rehire", () => {
  it("after an ended latest period: new period for the same person and code; nothing copied; start event; audit employment.rehire", async () => {
    const p = await hired("2023-01-02", "old.address.rehire@example.test");
    await endIt(p, addDays(today, -40));
    const oldRows = await db().jobAssignment.findMany({ where: { employmentId: p.employmentId } });
    const persons = await db().person.count();
    const rev = await revision(p.personId);
    const r = await rehire(p.personId, { expected_revision: rev, start_date: today, reason: "Returned after a break", employee_type_id: ids.et.EMPLOYEE });
    expect(r.status).toBe(201);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d).toMatchObject({ id: p.personId, employee_code: p.code, revision: rev + 1, employment_status: "active" });
    expect(await db().person.count()).toBe(persons);
    expect(d.employments).toHaveLength(2);
    const fresh = d.employments[1];
    expect(fresh).toMatchObject({ start_date: today, end_date: null, work_email: null, assignments: [], employee_type: { id: ids.et.EMPLOYEE } });
    expect(fresh.events.map((e) => [e.event_type, e.effective_date])).toEqual([["start", today]]);
    expect(await db().jobAssignment.findMany({ where: { employmentId: p.employmentId } })).toEqual(oldRows);
    const [ev] = await auditsFor(fresh.id);
    expect(ev).toMatchObject({ action: "employment.rehire", reason: "Returned after a break" });
    expect(values(ev)).toEqual({ "employment.start_date": [null, today], employee_type_id: [null, ids.et.EMPLOYEE] });
  });

  it("a legacy ended period without an End event qualifies; no End event is synthesized; a different Employee Type is allowed", async () => {
    const p = await bare();
    const old = await legacyPeriod(p.personId, "2019-03-04", "2021-06-30");
    const r = await rehire(p.personId, { expected_revision: await revision(p.personId), start_date: addDays(today, 7), reason: "Returning as an intern", employee_type_id: ids.et.INTERN });
    expect(r.status).toBe(201);
    expect(await db().employmentEvent.count({ where: { employmentId: old } })).toBe(0);
    expect(r.body.employments[1].employee_type.id).toBe(ids.et.INTERN);
  });

  it("is rejected without a previous period, when only cancelled periods exist, or when the latest period has no end date", async () => {
    const none = await bare();
    const a = await rehire(none.personId, { expected_revision: await revision(none.personId), start_date: today, reason: "Back" });
    expect(a.body.details[0].code).toBe("NO_PREVIOUS_EMPLOYMENT");
    const c = await hired(addDays(today, 30));
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [c.employmentId]);
    const b = await rehire(c.personId, { expected_revision: await revision(c.personId), start_date: addDays(today, 60), reason: "Back" });
    expect(b.body.details[0].code).toBe("NO_PREVIOUS_EMPLOYMENT");
    const open = await hired("2024-01-08");
    const o = await rehire(open.personId, { expected_revision: await revision(open.personId), start_date: addDays(today, 60), reason: "Back" });
    expect(o.body.details[0].code).toBe("LATEST_PERIOD_HAS_NO_END");
    for (const r of [a, b, o]) expect(r.status).toBe(422);
  });

  it("planned Rehire before the previous end date is reached; next calendar day allowed; same day rejected; warning data and Reverse End stays blocked", async () => {
    const p = await hired("2024-01-08");
    const end = addDays(today, 30);
    await endIt(p, end, "editor");
    const rev = await revision(p.personId);
    const sameDay = await rehire(p.personId, { expected_revision: rev, start_date: end, reason: "Back" });
    expect(sameDay.status).toBe(422);
    expect(sameDay.body.details[0]).toMatchObject({ code: "REHIRE_START_NOT_AFTER_PREVIOUS_END", message: `The earliest possible start date is ${addDays(end, 1)}.` });
    const r = await rehire(p.personId, { expected_revision: rev, start_date: addDays(end, 1), reason: "Agreed return after the contract ends" });
    expect(r.status).toBe(201);
    expect(r.body.employments[0]).toMatchObject({ period_lifecycle: "active", has_active_end_event: true }); // UI warning data
    const reverse = await call(reverseRoute, {
      path: "/x",
      method: "POST",
      user: "admin",
      params: { id: p.employmentId },
      body: { expected_revision: r.body.revision, reason: "Mistake" },
      headers: { "idempotency-key": key("rv") },
    });
    expect(reverse.status).toBe(409);
    expect(reverse.body.error).toBe("LATER_PERIOD_EXISTS");
  });

  it("a later gap is allowed; a planned end date on the new period creates no End event", async () => {
    const p = await bare();
    await legacyPeriod(p.personId, "2020-01-06", "2022-12-30");
    const bad = await rehire(p.personId, { expected_revision: await revision(p.personId), start_date: addDays(today, 100), end_date: addDays(today, 99), reason: "Back" });
    expect(bad.body.details[0].code).toBe("END_BEFORE_START");
    const r = await rehire(p.personId, { expected_revision: await revision(p.personId), start_date: addDays(today, 100), end_date: addDays(today, 465), reason: "Fixed term" });
    expect(r.status).toBe(201);
    expect(r.body.employments[1]).toMatchObject({ end_date: addDays(today, 465), has_active_end_event: false });
    expect(r.body.employments[1].events.map((e: { event_type: string }) => e.event_type)).toEqual(["start"]);
  });

  it("C-25: HR_EDITOR cannot backdate a Rehire; HR_ADMIN can; a reason is always required", async () => {
    const p = await bare();
    await legacyPeriod(p.personId, "2018-01-08", "2020-12-31");
    const rev = await revision(p.personId);
    expect((await rehire(p.personId, { expected_revision: rev, start_date: "2021-03-01", reason: "Back" })).status).toBe(403);
    expect((await rehire(p.personId, { expected_revision: rev, start_date: "2021-03-01" }, "admin")).status).toBe(400);
    const blank = await rehire(p.personId, { expected_revision: rev, start_date: "2021-03-01", reason: "  " }, "admin");
    expect(blank.body.details[0].code).toBe("REASON_REQUIRED");
    const ok = await rehire(p.personId, { expected_revision: rev, start_date: "2021-03-01", reason: "Return was never recorded" }, "admin");
    expect(ok.status).toBe(201);
  });

  it("never fills a gap between existing periods (latest-period rule)", async () => {
    const p = await bare();
    await legacyPeriod(p.personId, "2016-01-04", "2017-12-29");
    await legacyPeriod(p.personId, "2019-01-07", "2020-12-31");
    const r = await rehire(p.personId, { expected_revision: await revision(p.personId), start_date: "2018-03-01", reason: "Missing period" }, "admin");
    expect(r.status).toBe(422);
    expect(r.body.details[0].code).toBe("REHIRE_START_NOT_AFTER_PREVIOUS_END");
    expect(await periods(p.personId)).toHaveLength(2);
  });

  it("Work Email is never copied, may be reused explicitly when the ranges allow it, and a conflict rolls everything back", async () => {
    const p = await hired("2022-01-03", "returning.person@example.test");
    await endIt(p, addDays(today, -100));
    const reuse = await rehire(p.personId, { expected_revision: await revision(p.personId), start_date: today, reason: "Back", work_email: "returning.person@example.test" });
    expect(reuse.status).toBe(201);
    expect(reuse.body.employments[1].work_email).toBe("returning.person@example.test");

    await hired(addDays(today, -10), "held.elsewhere@example.test");
    const q = await bare();
    await legacyPeriod(q.personId, "2020-01-06", "2021-01-29");
    const rev = await revision(q.personId);
    const events = await db().employmentEvent.count();
    const rehireAudits = await db().auditEvent.count({ where: { action: "employment.rehire" } });
    const conflict = await rehire(q.personId, { expected_revision: rev, start_date: today, reason: "Back", work_email: "held.elsewhere@example.test" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("WORK_EMAIL_IN_USE");
    expect(await periods(q.personId)).toHaveLength(1);
    expect(await db().employmentEvent.count()).toBe(events);
    expect(await revision(q.personId)).toBe(rev);
    expect(await db().auditEvent.count({ where: { action: "employment.rehire" } })).toBe(rehireAudits);
  });

  it("idempotency: same key replays once, a different payload is rejected, different keys conflict on revision", async () => {
    const p = await bare();
    await legacyPeriod(p.personId, "2019-01-07", "2020-06-30");
    const rev = await revision(p.personId);
    const k = key("reh-same");
    const body = { expected_revision: rev, start_date: today, reason: "Back" };
    const both = await Promise.all([rehire(p.personId, body, "editor", k), rehire(p.personId, body, "editor", k)]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(both.filter((r) => r.headers.get("idempotent-replayed") === "true")).toHaveLength(1);
    expect(await periods(p.personId)).toHaveLength(2);
    const reused = await rehire(p.personId, { ...body, reason: "Different" }, "editor", k);
    expect(reused.body.error).toBe("IDEMPOTENCY_KEY_REUSED");
    const stale = await rehire(p.personId, { ...body, start_date: addDays(today, 400) }, "editor", key("stale"));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
    expect(fromDbDate((await periods(p.personId))[1].startDate)).toBe(today);
  });
});
