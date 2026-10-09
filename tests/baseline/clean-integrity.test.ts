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
import { PATCH as workEmailRoute } from "@/app/api/v1/core-hr/employments/[id]/work-email/route";
import { POST as initialEmploymentRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { runIntegrityChecks } from "../../scripts/integrity-checks";
import { seedDemoProfiles } from "../../scripts/seed-demo";
import { call, catalogIds, key, type TestUser } from "../helpers";

// Clean integrity baseline (Phase 1 quality gate). Runs ALONE on a freshly migrated hrms_test (own vitest config,
// guarded reset) with ONLY valid synthetic data: the demo seed plus every Phase 1 workflow driven through the API.
// The full, unfiltered scan must report 0 errors and 0 warnings — nothing is suppressed or ignored.
let ids: Awaited<ReturnType<typeof catalogIds>>;
let app: pg.Client;
const today = todayInVietnam();

type Route = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
async function ok(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "admin", method = "POST") {
  const r = await call(route, { path: "/x", method, user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("bl") } });
  expect([200, 201], JSON.stringify(r.body)).toContain(r.status);
  return r.body;
}
async function person(name: string) {
  const r = await call(createRoute, { path: "/x", method: "POST", user: "editor", headers: { "idempotency-key": key("blp") }, body: { full_name: name } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function hired(name: string, start: string, type: string, email?: string) {
  const personId = await person(name);
  const d = await ok(initialEmploymentRoute, personId, personId, { start_date: start, employee_type_id: type, ...(email ? { work_email: email } : {}), ...(start < today ? { reason: "Data capture" } : {}) });
  const employmentId = d.employments[0].id as string;
  await ok(initialAssignmentRoute, employmentId, personId, { effective_date: start, department_id: ids.d.ENG, job_title_id: ids.j.SE, ...(start < today ? { reason: "Data capture" } : {}) });
  return { personId, employmentId };
}

beforeAll(async () => {
  ids = await catalogIds();
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("Clean integrity baseline", () => {
  it("demo seed + every Phase 1 workflow with valid data → 0 errors, 0 warnings on the whole database", async () => {
    await seedDemoProfiles(db());

    // Lifecycle: assignment change, Work Email, End, End-date correction, Reverse End.
    const a = await hired("Baseline Lifecycle", "2023-01-02", ids.et.EMPLOYEE, "baseline.lifecycle@example.test");
    await ok(changeRoute, a.employmentId, a.personId, { effective_date: "2024-02-05", reason: "Transfer", department_id: ids.d.QA });
    const b = await hired("Baseline Work Email", "2024-01-08", ids.et.EMPLOYEE);
    await ok(workEmailRoute, b.employmentId, b.personId, { work_email: "baseline.work@example.test" }, "editor", "PATCH");
    await ok(endRoute, a.employmentId, a.personId, { end_date: addDays(today, 40), end_reason_code: "MUTUAL_AGREEMENT" }, "editor");
    await ok(periodCorrectionRoute, a.employmentId, a.personId, { end_date: addDays(today, 45), reason: "Agreed later" });
    await ok(reverseRoute, a.employmentId, a.personId, { reason: "End recorded by mistake" });

    // Historical assignment correction with an inactive catalog value.
    const rows = await db().jobAssignment.findMany({ where: { employmentId: a.employmentId }, orderBy: { effectiveFrom: "asc" } });
    await ok(assignmentCorrectionRoute, rows[1].id, a.personId, { effective_from: "2024-01-08", department_id: ids.d.OLD, reason: "Historical department" });

    // Ended → Rehire (with a new assignment); planned Rehire cancelled and planned again.
    const c = await hired("Baseline Rehire", "2021-03-01", ids.et.EMPLOYEE);
    await ok(endRoute, c.employmentId, c.personId, { end_date: addDays(today, -60), end_reason_code: "VOLUNTARY_RESIGNATION" });
    const rh = await ok(rehireRoute, c.personId, c.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, reason: "Returned" }, "editor");
    await ok(initialAssignmentRoute, rh.employments[1].id, c.personId, { effective_date: today, department_id: ids.d.QA, job_title_id: ids.j.QAE }, "editor");
    const d = await hired("Baseline Planned Rehire", "2022-05-02", ids.et.SERVICE_CONTRACTOR);
    await ok(endRoute, d.employmentId, d.personId, { end_date: addDays(today, 10), end_reason_code: "PLANNED_TERM_COMPLETED" }, "editor");
    const planned = await ok(rehireRoute, d.personId, d.personId, { start_date: addDays(today, 30), employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "Next project" }, "editor");
    await ok(cancelRoute, planned.employments[1].id, d.personId, { reason: "Postponed" }, "editor");
    await ok(rehireRoute, d.personId, d.personId, { start_date: addDays(today, 60), employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "New date" }, "editor");

    // Relationship Change (effective) and a planned one recovered (cancel successor, Reverse End).
    const e = await hired("Baseline Relationship Change", "2024-06-03", ids.et.INTERN, "baseline.rc@example.test");
    await ok(rcRoute, e.employmentId, e.personId, {
      start_date: addDays(today, 15),
      employee_type_id: ids.et.EMPLOYEE,
      reason: "Conversion",
      work_email: "baseline.rc@example.test",
      initial_assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE },
    }, "editor");
    const f = await hired("Baseline RC Recovery", "2024-06-03", ids.et.SERVICE_CONTRACTOR);
    const rc = await ok(rcRoute, f.employmentId, f.personId, { start_date: addDays(today, 20), employee_type_id: ids.et.EMPLOYEE, reason: "Conversion" }, "editor");
    await ok(cancelRoute, rc.employments[1].id, f.personId, { reason: "Withdrawn" }, "editor");
    await ok(reverseRoute, f.employmentId, f.personId, { reason: "Conversion withdrawn" });

    // Cancelled planned initial employment, then a new initial period.
    const g = await person("Baseline Cancelled Initial");
    const gi = await ok(initialEmploymentRoute, g, g, { start_date: addDays(today, 25), employee_type_id: ids.et.INTERN }, "editor");
    await ok(initialAssignmentRoute, gi.employments[0].id, g, { effective_date: addDays(today, 25), department_id: ids.d.QA, job_title_id: ids.j.QAE }, "editor");
    await ok(cancelRoute, gi.employments[0].id, g, { reason: "Offer withdrawn" }, "editor");
    await ok(initialEmploymentRoute, g, g, { start_date: addDays(today, 40), employee_type_id: ids.et.INTERN }, "editor");

    // Full scan of the whole database, inside a READ ONLY transaction, nothing filtered.
    await app.query("BEGIN READ ONLY");
    try {
      const findings = await runIntegrityChecks(app, today);
      expect(findings).toEqual([]);
    } finally {
      await app.query("ROLLBACK");
    }
    // The baseline really covers every lifecycle shape (otherwise a clean result would prove little).
    const types = (await db().employmentEvent.groupBy({ by: ["eventType"], _count: true })).map((g) => g.eventType).sort();
    expect(types).toEqual(["cancel_planned_start", "end", "end_reversed", "start"]);
    expect(await db().employmentEvent.count({ where: { endReasonCode: "RELATIONSHIP_CHANGE" } })).toBeGreaterThan(0);
    expect(await db().person.count()).toBe(19); // 12 demo profiles + 7 workflow profiles
  });
});
