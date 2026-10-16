import { beforeAll, describe, expect, it } from "vitest";
import { POST as cancelAssignmentRoute } from "@/app/api/v1/core-hr/assignments/[id]/cancel-planned/route";
import { GET as dashboardRoute } from "@/app/api/v1/core-hr/dashboard/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { GET as getRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { POST as changeRoute } from "@/app/api/v1/core-hr/employments/[id]/assignment-changes/route";
import { POST as cancelPeriodRoute } from "@/app/api/v1/core-hr/employments/[id]/cancel-planned/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as voidRoute } from "@/app/api/v1/core-hr/employments/[id]/void/route";
import { upcomingChanges, type Detail } from "@/app/employees/[id]/detailModel";
import { CoreHrDashboardSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { assembleDashboard, getDashboard, loadDashboardPeople } from "@/modules/core-hr/dashboard/service";
import { call, catalogIds, key, principalWith, type TestUser } from "../helpers";

// UI-1 Home / Action Center (PV-30). hrms_test is shared by every test file, so scenario assertions run the real loader
// and the pure assembler on this file's own synthetic people; endpoint tests check contract, security and the
// consistency of the global totals with the Employee List.
let ids: Awaited<ReturnType<typeof catalogIds>>;
const T = todayInVietnam();
let n = 0;
const nextName = () => {
  n += 1;
  return `Hoàng Thị Lan ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
};
type P = { personId: string; employmentId: string };

async function hire(start: string, o: { type?: string | null; workEmail?: string | null; personalEmail?: string; assignment?: boolean; code?: string } = {}): Promise<P> {
  const r = await call(createRoute, {
    path: "/x",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("db") },
    body: {
      full_name: nextName(),
      ...(o.code ? { employee_code: o.code } : {}),
      ...(o.personalEmail ? { personal: { personal_email: o.personalEmail } } : {}),
      employment: {
        start_date: start,
        ...(o.type === null ? {} : { employee_type_id: o.type ?? ids.et.EMPLOYEE }),
        ...(o.workEmail === null ? {} : { work_email: o.workEmail ?? `dash.${n}.${Date.now()}@example.test` }),
        ...(o.assignment === false ? {} : { assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE } }),
      },
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string };
}
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
async function post(route: typeof endRoute, id: string, personId: string, body: Record<string, unknown>, user: TestUser = "admin") {
  const r = await call(route, { path: "/x", method: "POST", user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("dp") } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r;
}
const change = (p: P, date: string, values: Record<string, unknown> = { department_id: ids.d.QA, job_title_id: ids.j.QAE }) =>
  post(changeRoute, p.employmentId, p.personId, { effective_date: date, reason: "Planned change", ...values });
const end = (p: P, date: string) => post(endRoute, p.employmentId, p.personId, { end_date: date, end_reason_code: "VOLUNTARY_RESIGNATION" });
const dash = async (people: P[], today = T) => assembleDashboard(await loadDashboardPeople(db(), people.map((p) => p.personId)), today);
const latestAssignment = async (p: P) => (await db().jobAssignment.findMany({ where: { employmentId: p.employmentId }, orderBy: { effectiveFrom: "desc" } }))[0];

/** Employee Detail Overview's Upcoming Changes mapped onto the Home machine types (consistency check, PV-30 T-2). */
const detailOverviewUpcoming = (detail: Detail) =>
  upcomingChanges(detail).map((u) => ({
    type: u.kind === "planned_end" ? "employment_end" : u.kind === "period_start" ? (u.first ? "employment_start" : "new_employment_period_start") : u.kind,
    date: u.date,
  }));

beforeAll(async () => {
  ids = await catalogIds();
});

describe("Workforce Snapshot", () => {
  it("Active / Pre-start / Ended per person; no valid period (cancelled, voided) counts nowhere", async () => {
    const active = await hire("2025-01-06");
    const pre = await hire(addDays(T, 10));
    const ended = await hire("2024-01-08");
    await end(ended, "2025-06-30");
    const cancelled = await hire(addDays(T, 12));
    await post(cancelPeriodRoute, cancelled.employmentId, cancelled.personId, { reason: "Offer declined" });
    const voided = await hire("2025-02-03");
    await post(voidRoute, voided.employmentId, voided.personId, { reason: "Entered in error" });
    const withPlannedEnd = await hire("2025-03-03");
    await end(withPlannedEnd, addDays(T, 5)); // still Active until its last day

    const d = await dash([active, pre, ended, cancelled, voided, withPlannedEnd]);
    expect(d.snapshot).toEqual({ active: 2, not_started: 1, ended: 1 });
    const statuses = Object.fromEntries(d.needs_attention.records.map((r) => [r.person_id, r.employment_status]));
    expect(statuses[cancelled.personId]).toBe("no_employment");
    expect(statuses[voided.personId]).toBe("no_employment");
  });
});

describe("Needs Attention", () => {
  it("authoritative completeness: Work Email policy, missing assignment, optional fields ignored; one person once; per-item counts", async () => {
    const complete = await hire("2025-01-06"); // no Manager / Level / DOB / Gender / Mobile / personal email: complete
    const noWorkEmail = await hire("2025-01-06", { workEmail: null, personalEmail: "lan.private@example.test" });
    const contractor = await hire("2025-01-06", { type: ids.et.SERVICE_CONTRACTOR, workEmail: null, personalEmail: "sc.private@example.test" });
    const preNoEmail = await hire(addDays(T, 9), { workEmail: null });
    const noAssignment = await hire("2025-01-06", { workEmail: null, assignment: false }); // three items missing

    const d = await dash([complete, noWorkEmail, contractor, preNoEmail, noAssignment]);
    const missing = Object.fromEntries(d.needs_attention.records.map((r) => [r.person_id, r.missing]));
    expect(missing[complete.personId]).toBeUndefined();
    expect(missing[contractor.personId]).toBeUndefined(); // personal email is enough for a type without a company account
    expect(missing[noWorkEmail.personId]).toEqual(["work_email"]);
    expect(missing[preNoEmail.personId]).toEqual(["contact_email"]);
    expect(missing[noAssignment.personId]).toEqual(["work_email", "department", "job_title"]);
    expect(d.needs_attention.total).toBe(3); // people, not items
    expect(d.needs_attention.by_requirement).toEqual([
      { code: "work_email", count: 2 },
      { code: "contact_email", count: 1 },
      { code: "department", count: 1 },
      { code: "job_title", count: 1 },
    ]);
    expect(d.needs_attention.by_requirement.reduce((s, r) => s + r.count, 0)).toBeGreaterThan(d.needs_attention.total);
    expect(d.needs_attention.rule_version).toBe("operational-mvp-2026-10-08.2");
  });

  it("PV-29: cancelling a planned initial assignment makes the record incomplete through the same rule", async () => {
    const p = await hire(addDays(T, 14));
    expect((await dash([p])).needs_attention.total).toBe(0);
    const a = await latestAssignment(p);
    await post(cancelAssignmentRoute, a.id, p.personId, { reason: "Placement not decided" }, "editor");
    const d = await dash([p]);
    expect(d.needs_attention.records).toEqual([expect.objectContaining({ person_id: p.personId, employment_status: "not_started", missing: ["department", "job_title"] })]);
    expect(d.snapshot.not_started).toBe(1);
    expect(d.upcoming.items.map((i) => [i.type, i.assignment])).toEqual([["employment_start", null]]);
  });

  it("preview: at most 5; Active → Pre-start (nearest start) → no Employment Period → Ended; then employee code", async () => {
    const ended = await hire("2023-01-09", { workEmail: null, code: "ZZ-DASH-A" });
    await end(ended, "2024-12-31");
    const none = await hire(addDays(T, 20), { workEmail: null, code: "ZZ-DASH-B" });
    await post(cancelPeriodRoute, none.employmentId, none.personId, { reason: "Offer declined" });
    const preLater = await hire(addDays(T, 25), { workEmail: null, assignment: false, code: "ZZ-DASH-C" });
    const preSooner = await hire(addDays(T, 3), { workEmail: null, assignment: false, code: "ZZ-DASH-D" });
    const activeB = await hire("2025-01-06", { workEmail: null, code: "ZZ-DASH-F" });
    const activeA = await hire("2025-01-06", { workEmail: null, code: "ZZ-DASH-E" });
    const d = await dash([ended, none, preLater, preSooner, activeB, activeA]);
    expect(d.needs_attention.total).toBe(6);
    expect(d.needs_attention.records.map((r) => r.person_id)).toEqual([activeA, activeB, preSooner, preLater, none].map((p) => p.personId));
  });
});

describe("Upcoming — next 30 days", () => {
  it("window: starts / changes T+1 … T+30; planned ends T … T+30; T+31 and effective-today excluded", async () => {
    const changeToday = await hire("2025-01-06");
    await change(changeToday, T);
    const c1 = await hire("2025-01-06");
    await change(c1, addDays(T, 1));
    const c30 = await hire("2025-01-06");
    await change(c30, addDays(T, 30));
    const c31 = await hire("2025-01-06");
    await change(c31, addDays(T, 31));
    const endToday = await hire("2025-01-06");
    await end(endToday, T);
    const end30 = await hire("2025-01-06");
    await end(end30, addDays(T, 30));
    const end31 = await hire("2025-01-06");
    await end(end31, addDays(T, 31));
    const start1 = await hire(addDays(T, 1));
    const start31 = await hire(addDays(T, 31));
    const d = await dash([changeToday, c1, c30, c31, endToday, end30, end31, start1, start31]);
    expect(d.upcoming).toMatchObject({ window_days: 30, from: T, to: addDays(T, 30) });
    const got = d.upcoming.items.map((i) => [i.person_id, i.type, i.effective_date]);
    expect(got).toEqual([
      [endToday.personId, "employment_end", T],
      [start1.personId, "employment_start", addDays(T, 1)],
      [c1.personId, "assignment_change", addDays(T, 1)],
      ...[
        [end30.personId, "employment_end", addDays(T, 30)],
        [c30.personId, "assignment_change", addDays(T, 30)],
      ],
    ]);
    const c1Item = d.upcoming.items.find((i) => i.person_id === c1.personId)!;
    expect(c1Item.previous_assignment).toEqual({ department: { code: "ENG", name: "Engineering" }, job_title: { code: "SE", name_en: "Software Engineer" } });
    expect(c1Item.assignment?.department.code).toBe("QA");
  });

  it("Relationship Change is ONE item; a cancelled successor leaves only the planned end; a later period is a neutral new period", async () => {
    const rc = await hire("2025-01-06");
    await post(rcRoute, rc.employmentId, rc.personId, { start_date: addDays(T, 5), employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "Moves to a service contract" });
    const rcCancelled = await hire("2025-01-06");
    const res = await post(rcRoute, rcCancelled.employmentId, rcCancelled.personId, { start_date: addDays(T, 6), employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "Moves to a service contract" });
    const successor = (res.body.employments as { id: string; start_date: string }[]).find((e) => e.start_date === addDays(T, 6))!;
    await post(cancelPeriodRoute, successor.id, rcCancelled.personId, { reason: "Contract not signed" });
    const rehired = await hire("2023-02-06");
    await end(rehired, "2025-06-30");
    await post(rehireRoute, rehired.personId, rehired.personId, { start_date: addDays(T, 7), employee_type_id: ids.et.EMPLOYEE, reason: "Returns" });

    const d = await dash([rc, rcCancelled, rehired]);
    const items = d.upcoming.items.map((i) => ({ person: i.person_id, type: i.type, date: i.effective_date, from: i.previous_employee_type?.code, to: i.employee_type?.code }));
    expect(items.filter((i) => i.person === rc.personId)).toEqual([{ person: rc.personId, type: "relationship_change", date: addDays(T, 5), from: "EMPLOYEE", to: "SERVICE_CONTRACTOR" }]);
    expect(items.filter((i) => i.person === rcCancelled.personId).map((i) => [i.type, i.date])).toEqual([["employment_end", addDays(T, 5)]]);
    expect(items.filter((i) => i.person === rehired.personId).map((i) => [i.type, i.date, i.to])).toEqual([["new_employment_period_start", addDays(T, 7), "EMPLOYEE"]]);
    expect(JSON.stringify(d)).not.toContain("rehire");
  });

  it("cancelled period, voided period and cancelled planned assignment never appear", async () => {
    const cancelledStart = await hire(addDays(T, 11));
    await post(cancelPeriodRoute, cancelledStart.employmentId, cancelledStart.personId, { reason: "Offer declined" });
    const voided = await hire("2025-02-03");
    await change(voided, addDays(T, 9));
    await post(voidRoute, voided.employmentId, voided.personId, { reason: "Entered in error" });
    const cancelledChange = await hire("2025-01-06");
    await change(cancelledChange, addDays(T, 8));
    await post(cancelAssignmentRoute, (await latestAssignment(cancelledChange)).id, cancelledChange.personId, { reason: "Not going ahead" }, "editor");
    const d = await dash([cancelledStart, voided, cancelledChange]);
    expect(d.upcoming).toMatchObject({ total: 0, items: [] });
  });

  it("at most 10 items with the full total; deterministic same-date ordering (end, relationship change, start, assignment change, then code)", async () => {
    const chain = await hire("2025-01-06");
    for (let i = 1; i <= 11; i++) await change(chain, addDays(T, i), { department_id: i % 2 ? ids.d.QA : ids.d.ENG, job_title_id: i % 2 ? ids.j.QAE : ids.j.SE });
    const many = await dash([chain]);
    expect(many.upcoming.total).toBe(11);
    expect(many.upcoming.items).toHaveLength(10);
    expect(many.upcoming.items.map((i) => i.effective_date)).toEqual([...Array(10)].map((_, i) => addDays(T, i + 1)));

    const D = addDays(T, 13);
    const chB = await hire("2025-01-06", { code: "ZZ-ORD-B" });
    await change(chB, D);
    const chA = await hire("2025-01-06", { code: "ZZ-ORD-A" });
    await change(chA, D);
    const starts = await hire(D, { code: "ZZ-ORD-C" });
    const ends = await hire("2025-01-06", { code: "ZZ-ORD-D" });
    await end(ends, D);
    const rc = await hire("2025-01-06", { code: "ZZ-ORD-E" });
    await post(rcRoute, rc.employmentId, rc.personId, { start_date: D, employee_type_id: ids.et.INTERN, reason: "Becomes an intern" });
    const d = await dash([chB, chA, starts, ends, rc]);
    expect(d.upcoming.items.filter((i) => i.effective_date === D).map((i) => [i.type, i.employee_code])).toEqual([
      ["employment_end", "ZZ-ORD-D"],
      ["relationship_change", "ZZ-ORD-E"],
      ["employment_start", "ZZ-ORD-C"],
      ["assignment_change", "ZZ-ORD-A"],
      ["assignment_change", "ZZ-ORD-B"],
    ]);
  });
});

describe("Business date (Asia/Ho_Chi_Minh)", () => {
  it("16:59:59Z is still the previous Vietnam date; 17:00:00Z is the next — status, window and today/tomorrow move together", async () => {
    const p = await hire("2027-03-01");
    const before = todayInVietnam(new Date("2027-02-28T16:59:59Z"));
    const after = todayInVietnam(new Date("2027-02-28T17:00:00Z"));
    expect([before, after]).toEqual(["2027-02-28", "2027-03-01"]);
    const d1 = await dash([p], before);
    const d2 = await dash([p], after);
    expect(d1.snapshot).toEqual({ active: 0, not_started: 1, ended: 0 });
    expect(d1.upcoming.items.map((i) => [i.type, i.effective_date])).toEqual([["employment_start", "2027-03-01"]]);
    expect(d1.upcoming.to).toBe("2027-03-30");
    expect(d2.snapshot).toEqual({ active: 1, not_started: 0, ended: 0 });
    expect(d2.upcoming.items).toEqual([]); // effective today: no longer upcoming
    const principal = await principalWith("admin", ["employees.read"]);
    expect((await getDashboard(principal, new Date("2027-02-28T16:59:59Z"))).status_as_of).toBe("2027-02-28");
    expect((await getDashboard(principal, new Date("2027-02-28T17:00:00Z"))).status_as_of).toBe("2027-03-01");
  });
});

describe("Workforce breakdowns (owner-approved Home refresh)", () => {
  const byDept = (d: Awaited<ReturnType<typeof dash>>) => Object.fromEntries(d.workforce.by_department.map((g) => [g.department?.code ?? "NOT_ASSIGNED", g.count]));
  const byType = (d: Awaited<ReturnType<typeof dash>>) => Object.fromEntries(d.workforce.by_employee_type.map((g) => [g.employee_type?.code ?? "NOT_ASSIGNED", g.count]));
  const sum = (xs: { count: number }[]) => xs.reduce((a, x) => a + x.count, 0);

  it("Total Employees = Active: Pre-start, Ended, cancelled and voided periods and people without a period are excluded; each chart sums to Active", async () => {
    const active = await hire("2025-01-06");
    const contractor = await hire("2025-01-06", { type: ids.et.SERVICE_CONTRACTOR, workEmail: null });
    const pre = await hire(addDays(T, 10));
    const ended = await hire("2024-01-08");
    await end(ended, "2025-06-30");
    const cancelled = await hire(addDays(T, 12));
    await post(cancelPeriodRoute, cancelled.employmentId, cancelled.personId, { reason: "Offer declined" });
    const voided = await hire("2025-02-03");
    await post(voidRoute, voided.employmentId, voided.personId, { reason: "Entered in error" });

    const d = await dash([active, contractor, pre, ended, cancelled, voided]);
    expect(d.workforce.total).toBe(2);
    expect(d.workforce.total).toBe(d.snapshot.active);
    expect(byDept(d)).toEqual({ ENG: 2 });
    expect(byType(d)).toEqual({ EMPLOYEE: 1, SERVICE_CONTRACTOR: 1 });
    expect(sum(d.workforce.by_department)).toBe(d.workforce.total);
    expect(sum(d.workforce.by_employee_type)).toBe(d.workforce.total);
    expect(d.workforce.on_leave).toBeNull(); // unavailable, never 0
  });

  it("inclusive last working day: counted on the end date, excluded from the next day", async () => {
    const leaving = await hire("2025-01-06");
    await end(leaving, addDays(T, 5));
    expect((await dash([leaving], addDays(T, 5))).workforce).toMatchObject({ total: 1, by_department: [{ count: 1 }] });
    expect((await dash([leaving], addDays(T, 6))).workforce).toMatchObject({ total: 0, by_department: [], by_employee_type: [] });
  });

  it("Department comes from the assignment in effect on the business date — a future assignment is not counted until it starts", async () => {
    const moving = await hire("2025-01-06");
    await change(moving, addDays(T, 2)); // ENG → QA from T+2
    expect(byDept(await dash([moving]))).toEqual({ ENG: 1 });
    expect(byDept(await dash([moving], addDays(T, 2)))).toEqual({ QA: 1 });
  });

  it("missing values stay counted under Not assigned (last), so every Active person is in both charts", async () => {
    const noAssignment = await hire("2025-01-06", { assignment: false });
    const noType = await hire("2025-01-06", { type: null, workEmail: null });
    const normal = await hire("2025-01-06");
    const d = await dash([noAssignment, noType, normal]);
    expect(d.workforce.total).toBe(3);
    expect(d.workforce.by_department).toEqual([
      { department: { id: ids.d.ENG, code: "ENG", name: expect.any(String) }, count: 2 },
      { department: null, count: 1 },
    ]);
    expect(d.workforce.by_employee_type.at(-1)).toEqual({ employee_type: null, count: 1 });
    expect(sum(d.workforce.by_employee_type)).toBe(3);
  });

  it("covers ALL people (not the 5 / 10 previews): totals and every group equal the Active Employee List filters", async () => {
    const r = await call(dashboardRoute, { path: "/api/v1/core-hr/dashboard", user: "editor" });
    const d = CoreHrDashboardSchema.parse(r.body);
    const total = async (q: string) => (await call(listRoute, { path: `/api/v1/core-hr/employees?page_size=1&${q}`, user: "editor" })).body.total as number;
    expect(d.workforce.total).toBe(await total("employment_status=active"));
    expect(d.workforce.total).toBeGreaterThan(10); // more people than any preview holds
    expect(sum(d.workforce.by_department)).toBe(d.workforce.total);
    expect(sum(d.workforce.by_employee_type)).toBe(d.workforce.total);
    for (const g of d.workforce.by_department) if (g.department) expect(g.count, g.department.code).toBe(await total(`employment_status=active&department_id=${g.department.id}`));
    for (const g of d.workforce.by_employee_type) if (g.employee_type) expect(g.count, g.employee_type.code).toBe(await total(`employment_status=active&employee_type_id=${g.employee_type.id}`));
    expect(d.workforce.on_leave).toBeNull();
  });
});

describe("Consistency with the Employee List and Employee Detail", () => {
  it("snapshot equals the list status totals; needs_attention.total equals the list incomplete total", async () => {
    const r = await call(dashboardRoute, { path: "/api/v1/core-hr/dashboard", user: "editor" });
    expect(r.status).toBe(200);
    const d = CoreHrDashboardSchema.parse(r.body);
    const total = async (q: string) => (await call(listRoute, { path: `/api/v1/core-hr/employees?page_size=1&${q}`, user: "editor" })).body.total as number;
    expect(d.snapshot).toEqual({ active: await total("employment_status=active"), not_started: await total("employment_status=not_started"), ended: await total("employment_status=ended") });
    expect(d.needs_attention.total).toBe(await total("operational_completeness=incomplete"));
    expect(d.needs_attention.records.length).toBeLessThanOrEqual(5);
    expect(d.upcoming.items.length).toBeLessThanOrEqual(10);
    expect(d.upcoming.total).toBeGreaterThanOrEqual(d.upcoming.items.length);
  });

  it("per person: dashboard status equals the list row; dashboard upcoming equals the Overview Upcoming Changes inside the window", async () => {
    const people: P[] = [];
    const rc = await hire("2025-01-06");
    await post(rcRoute, rc.employmentId, rc.personId, { start_date: addDays(T, 4), employee_type_id: ids.et.SERVICE_CONTRACTOR, reason: "Moves to a service contract" });
    people.push(rc);
    const changed = await hire("2025-01-06");
    await change(changed, addDays(T, 2));
    await end(changed, addDays(T, 40)); // outside the window: on Overview, not on Home
    people.push(changed);
    people.push(await hire(addDays(T, 3)));
    const d = await dash(people);
    for (const p of people) {
      const detail = (await call(getRoute, { path: "/x", user: "admin", params: { id: p.personId } })).body;
      const listRow = (await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(detail.employee_code)}`, user: "admin" })).body.data[0];
      expect(listRow.employment_status).toBe(detail.employment_status);
      const fromOverview = detailOverviewUpcoming(detail).filter((u) => u.date <= d.upcoming.to);
      const fromHome = d.upcoming.items.filter((i) => i.person_id === p.personId).map((i) => ({ type: i.type, date: i.effective_date }));
      expect(fromHome).toEqual(fromOverview);
    }
  });
});

describe("Security, privacy and contract", () => {
  it("employees.read: HR roles 200; without it 403; unauthenticated 401", async () => {
    for (const user of ["admin", "editor"] as const) expect((await call(dashboardRoute, { path: "/api/v1/core-hr/dashboard", user })).status).toBe(200);
    for (const user of ["docs", "noroles", "disabled"] as const) expect((await call(dashboardRoute, { path: "/api/v1/core-hr/dashboard", user })).status).toBe(403);
    expect((await call(dashboardRoute, { path: "/api/v1/core-hr/dashboard" })).status).toBe(401);
  });

  it("no personal fields, Work Email, reasons or audit data; strict: any query parameter is rejected", async () => {
    const p = await hire("2025-01-06", { personalEmail: "never.on.home@example.test" });
    await end(p, addDays(T, 3));
    const r = await call(dashboardRoute, { path: "/api/v1/core-hr/dashboard", user: "admin" });
    const text = JSON.stringify(r.body);
    // Keys only: requirement CODES such as "work_email" are machine values, not the field itself.
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
    };
    walk(r.body);
    for (const k of ["date_of_birth", "gender", "mobile_phone", "personal_email", "work_email", "reason", "end_reason", "note", "actor", "recorded_at", "revision"]) expect(keys.has(k), k).toBe(false);
    expect(text).not.toContain("never.on.home");
    expect(text).not.toMatch(/@example\.test/); // no email address of any kind
    const bad = await call(dashboardRoute, { path: "/api/v1/core-hr/dashboard?days=7", user: "admin" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("VALIDATION_ERROR");
  });
});
