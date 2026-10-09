import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { addDays, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { runIntegrityChecks } from "../../scripts/integrity-checks";
import { call, catalogIds, key, userId } from "../helpers";

// H4: the read-only integrity scan detects inconsistencies that the database itself allows (or that only arise from
// direct data writes) and never mutates data. Violations are written directly here on purpose.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
let admin: string;
const today = todayInVietnam();

async function hired(name: string, start: string) {
  const r = await call(createRoute, {
    path: "/x",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("is") },
    body: { full_name: name, employment: { start_date: start, employee_type_id: ids.et.EMPLOYEE, assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE } } },
  });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}
const scan = async (personIds: string[]) => {
  await app.query("BEGIN READ ONLY"); // proves the checks are pure reads
  try {
    return await runIntegrityChecks(app, today, personIds);
  } finally {
    await app.query("ROLLBACK");
  }
};

beforeAll(async () => {
  ids = await catalogIds();
  admin = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("Integrity scan (H4)", () => {
  it("reports nothing for a consistent person", async () => {
    const p = await hired("Test Integrity Clean", "2024-01-08");
    expect(await scan([p.personId])).toEqual([]);
  });

  it("detects gaps, misaligned last rows, event/period mismatches, cancellation inconsistencies and invalid manager references", async () => {
    const gap = await hired("Test Integrity Gap", "2022-01-03");
    await db().$transaction([
      db().jobAssignment.updateMany({ where: { employmentId: gap.employmentId }, data: { effectiveTo: toDbDate("2022-06-01") } }),
      db().jobAssignment.create({
        data: { employmentId: gap.employmentId, effectiveFrom: toDbDate("2022-07-01"), departmentId: ids.d.QA, jobTitleId: ids.j.QAE, changeReason: "assignment_change", createdBy: admin },
      }),
    ]);

    const misaligned = await hired("Test Integrity Misaligned", "2022-01-03");
    await db().$transaction([
      db().employment.update({ where: { id: misaligned.employmentId }, data: { endDate: toDbDate("2023-12-31") } }),
      db().jobAssignment.updateMany({ where: { employmentId: misaligned.employmentId }, data: { effectiveTo: toDbDate("2023-06-01") } }),
    ]);

    const endMismatch = await hired("Test Integrity End Mismatch", "2022-01-03");
    await db().$transaction([
      db().employment.update({ where: { id: endMismatch.employmentId }, data: { endDate: toDbDate(addDays(today, 30)) } }),
      db().jobAssignment.updateMany({ where: { employmentId: endMismatch.employmentId }, data: { effectiveTo: toDbDate(addDays(today, 31)) } }),
      db().employmentEvent.create({ data: { employmentId: endMismatch.employmentId, eventType: "end", effectiveDate: toDbDate(addDays(today, 20)), endReasonCode: "MUTUAL_AGREEMENT", recordedBy: admin } }),
    ]);

    const startMismatch = await hired("Test Integrity Start Mismatch", "2022-01-03");
    await db().$transaction([
      db().employment.update({ where: { id: startMismatch.employmentId }, data: { startDate: toDbDate("2021-12-27") } }),
      db().jobAssignment.updateMany({ where: { employmentId: startMismatch.employmentId }, data: { effectiveFrom: toDbDate("2021-12-27") } }),
    ]);

    const cancelledNoEvent = await hired("Test Integrity Cancelled Without Event", addDays(today, 50));
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [cancelledNoEvent.employmentId]);

    const cancelEventOnly = await hired("Test Integrity Cancel Event Only", addDays(today, 60));
    await db().employmentEvent.create({ data: { employmentId: cancelEventOnly.employmentId, eventType: "cancel_planned_start", effectiveDate: toDbDate(addDays(today, 60)), reason: "x", recordedBy: admin } });

    const manager = await hired("Test Integrity Manager", addDays(today, 10));
    const report = await hired("Test Integrity Report", "2023-01-02");
    await db().jobAssignment.updateMany({ where: { employmentId: report.employmentId }, data: { managerEmploymentId: manager.employmentId } });
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [manager.employmentId]); // C-73: history kept

    const people = [gap, misaligned, endMismatch, startMismatch, cancelledNoEvent, cancelEventOnly, report].map((p) => p.personId);
    const counts = await db().jobAssignment.count();
    const findings = await scan(people);
    expect(await db().jobAssignment.count()).toBe(counts);
    const by = (check: string) => findings.filter((f) => f.check === check).map((f) => f.ids.person_id);
    expect(by("assignment_gap_after_first")).toEqual([gap.personId]);
    expect(by("last_assignment_not_aligned_with_period_end")).toEqual([misaligned.personId]);
    expect(by("active_end_event_date_differs_from_period_end")).toEqual([endMismatch.personId]);
    expect(by("start_event_date_differs_from_period_start")).toEqual([startMismatch.personId]);
    expect(by("cancelled_period_without_cancel_event")).toEqual([cancelledNoEvent.personId]);
    expect(by("cancel_event_on_non_cancelled_period")).toEqual([cancelEventOnly.personId]);
    expect(by("manager_not_employed_on_date")).toEqual([report.personId]);
    expect(findings.every((f) => !JSON.stringify(f).includes("Test Integrity"))).toBe(true); // ids only, no names
  });
});
