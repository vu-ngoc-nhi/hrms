import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH as workEmailRoute } from "@/app/api/v1/core-hr/employments/[id]/work-email/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, userId, type TestUser } from "../helpers";

// S4.4 (C-30): Work Email belongs to an Employment Period.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let admin: string;
const today = todayInVietnam();
let seq = 0;

async function person(o: { start: string; email?: string; personalEmail?: string }) {
  seq += 1;
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("we") },
    body: {
      full_name: `Kiều Văn Tùng ${String.fromCharCode(64 + seq)}`,
      ...(o.personalEmail ? { personal: { personal_email: o.personalEmail } } : {}),
      employment: {
        start_date: o.start,
        employee_type_id: ids.et.EMPLOYEE,
        ...(o.email ? { work_email: o.email } : {}),
        assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE },
      },
    },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string, revision: r.body.revision as number };
}

async function endedPeriod(email: string) {
  const p = await person({ start: "2020-01-06" });
  await db().$transaction([
    db().employment.update({ where: { id: p.employmentId }, data: { endDate: toDbDate("2022-12-31"), workEmail: email } }),
    db().jobAssignment.updateMany({ where: { employmentId: p.employmentId }, data: { effectiveTo: toDbDate("2023-01-01") } }),
  ]);
  return p;
}

const patch = (employmentId: string, body: unknown, user: TestUser = "editor") =>
  call(workEmailRoute, { path: "/x", method: "PATCH", user, params: { id: employmentId }, body });

const auditFor = (employmentId: string) =>
  db().auditEvent.findMany({ where: { entityId: employmentId }, include: { fieldChanges: true }, orderBy: { id: "asc" } });

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("Work Email management", () => {
  it("HR_EDITOR updates an active period without a reason; completeness recalculates; audit stores no email", async () => {
    const p = await person({ start: "2025-02-03", personalEmail: "tung.contact.a@example.test" });
    const before = await patch(p.employmentId, { expected_revision: p.revision, work_email: "x@example.test" }, "docs");
    expect(before.status).toBe(403);
    const r = await patch(p.employmentId, { expected_revision: p.revision, work_email: "Tung.Kieu.A@example.test" });
    expect(r.status).toBe(200);
    const d = EmployeeDetailSchema.parse(r.body);
    expect(d.employments[0].work_email).toBe("tung.kieu.a@example.test");
    expect(d.revision).toBe(p.revision + 1);
    expect(d.completeness.operational.items.find((i) => i.code === "work_email")?.satisfied).toBe(true);
    expect(d.completeness.operational.status).toBe("complete");
    const [ev] = await auditFor(p.employmentId);
    expect(ev).toMatchObject({ action: "employment.work_email.update", changedFields: ["employment.work_email"], reason: null });
    expect(ev.fieldChanges).toEqual([]);
    expect(JSON.stringify({ ...ev, id: String(ev.id) })).not.toContain("tung.kieu");
  });

  it("HR_EDITOR and HR_ADMIN update a pre-start period", async () => {
    const p = await person({ start: addDays(today, 20) });
    const r1 = await patch(p.employmentId, { expected_revision: p.revision, work_email: "prestart.one@example.test" });
    expect(r1.status).toBe(200);
    const r2 = await patch(p.employmentId, { expected_revision: r1.body.revision, work_email: "prestart.two@example.test" }, "admin");
    expect(r2.status).toBe(200);
    expect(r2.body.employments[0].work_email).toBe("prestart.two@example.test");
  });

  it("HR_ADMIN updates an active period", async () => {
    const p = await person({ start: "2024-04-01" });
    expect((await patch(p.employmentId, { expected_revision: p.revision, work_email: "admin.active@example.test" }, "admin")).status).toBe(200);
  });

  it("an ended period is a historical correction: HR_EDITOR denied, HR_ADMIN needs a reason", async () => {
    const p = await endedPeriod("old.ended@example.test");
    const rev = (await db().person.findUniqueOrThrow({ where: { id: p.personId } })).revision;
    expect((await patch(p.employmentId, { expected_revision: rev, work_email: "fixed.ended@example.test", reason: "Typo" })).status).toBe(403);
    const noReason = await patch(p.employmentId, { expected_revision: rev, work_email: "fixed.ended@example.test" }, "admin");
    expect(noReason.status).toBe(422);
    expect(noReason.body.details[0].code).toBe("REASON_REQUIRED");
    const ok = await patch(p.employmentId, { expected_revision: rev, work_email: "fixed.ended@example.test", reason: "Address mistyped at offboarding" }, "admin");
    expect(ok.status).toBe(200);
    const evs = await auditFor(p.employmentId);
    expect(evs.at(-1)).toMatchObject({ action: "employment.work_email.correct", reason: "Address mistyped at offboarding" });
    expect(evs.at(-1)!.fieldChanges).toEqual([]);
  });

  it("a cancelled period is read-only", async () => {
    const p = await person({ start: addDays(today, 30) });
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [p.employmentId]);
    const r = await patch(p.employmentId, { expected_revision: p.revision, work_email: "cancelled.try@example.test" }, "admin");
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("EMPLOYMENT_PERIOD_READ_ONLY");
  });

  it("rejects invalid emails, non-company domains and unknown fields", async () => {
    const p = await person({ start: "2025-03-03" });
    expect((await patch(p.employmentId, { expected_revision: p.revision, work_email: "not-an-email" })).status).toBe(400);
    const domain = await patch(p.employmentId, { expected_revision: p.revision, work_email: "someone@gmail.com" });
    expect(domain.status).toBe(422);
    expect(domain.body.details[0].code).toBe("DOMAIN_NOT_ALLOWED");
    expect((await patch(p.employmentId, { expected_revision: p.revision, work_email: "a@example.test", start_date: "2025-01-01" })).status).toBe(400);
  });

  it("rejects a Work Email already assigned to someone else for an overlapping period", async () => {
    await person({ start: "2024-01-08", email: "taken.address@example.test" });
    const p = await person({ start: "2025-05-05" });
    const r = await patch(p.employmentId, { expected_revision: p.revision, work_email: "TAKEN.address@example.test" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("WORK_EMAIL_IN_USE");
    expect((await db().person.findUniqueOrThrow({ where: { id: p.personId } })).revision).toBe(p.revision); // rolled back
    expect(await auditFor(p.employmentId)).toEqual([]);
  });

  it("allows an address that only a cancelled period holds", async () => {
    const holder = await person({ start: addDays(today, 40), email: "freed.address@example.test" });
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [holder.employmentId]);
    const p = await person({ start: addDays(today, 41) });
    expect((await patch(p.employmentId, { expected_revision: p.revision, work_email: "freed.address@example.test" })).status).toBe(200);
  });

  it("rejects a stale revision and leaves data unchanged; a same-value request is a no-op", async () => {
    const p = await person({ start: "2025-06-02", email: "same.value@example.test" });
    const same = await patch(p.employmentId, { expected_revision: p.revision, work_email: "Same.Value@example.test" });
    expect(same.status).toBe(200);
    expect(same.body.revision).toBe(p.revision);
    expect(await auditFor(p.employmentId)).toEqual([]);
    expect((await patch(p.employmentId, { expected_revision: p.revision, work_email: "new.value@example.test" })).status).toBe(200);
    const stale = await patch(p.employmentId, { expected_revision: p.revision, work_email: "other.value@example.test" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
    expect((await db().employment.findUniqueOrThrow({ where: { id: p.employmentId } })).workEmail).toBe("new.value@example.test");
  });

  it("returns 404 for an unknown period", async () => {
    expect((await patch("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { expected_revision: 1, work_email: "x@example.test" })).status).toBe(404);
    void admin;
  });
});
