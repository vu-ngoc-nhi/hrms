import { describe, expect, it } from "vitest";
import { headerActions, overview, periodEligibility, upcomingChanges, type Assignment, type Detail, type Period } from "@/app/employees/[id]/detailModel";

// UI-3: Employee Overview view model — pure derivation from the existing Employee Detail response.
const TODAY = "2026-10-10";
const ENG = { id: "d-eng", name: "Engineering" };
const PRODUCT = { id: "d-prod", name: "Product" };
const SE = { id: "j-se", name_en: "Software Engineer" };
const SPE = { id: "j-spe", name_en: "Senior Product Engineer" };
const EMPLOYEE = { id: "t-emp", code: "EMPLOYEE", name: "Employee" };
const CONTRACTOR = { id: "t-sc", code: "SERVICE_CONTRACTOR", name: "Service Contractor" };
const MANAGER = { person_id: "p-mgr", employee_code: "DEMO002", full_name: "Vũ Hồng Nhung" };

let seq = 0;
function asg(from: string, to: string | null, o: Partial<Assignment> = {}): Assignment {
  return { id: `a${++seq}`, effective_from: from, effective_to: to, department: ENG, job_title: SE, job_level: null, manager: null, ...o };
}
function period(start: string, end: string | null, o: Partial<Period> = {}): Period {
  const lifecycle = start > TODAY ? "not_started" : end !== null && end < TODAY ? "ended" : "active";
  return {
    id: `e${++seq}`,
    start_date: start,
    end_date: end,
    period_lifecycle: o.cancelled_at || o.voided_at ? null : lifecycle,
    events: [],
    has_active_end_event: Boolean(o.active_end_event),
    active_end_event: null,
    cancelled_at: null,
    voided_at: null,
    employee_type: EMPLOYEE,
    work_email: "khoa.phan@example.test",
    assignments: [asg(start, null)],
    ...o,
  };
}
const endEvent = (date: string, code: string) => ({
  effective_date: date,
  end_reason: { code, label: code },
  previous_end_date: null,
  closed_assignment: null,
});
function detail(employments: Period[], completeness: { status: "complete" | "incomplete"; missing?: string[] } = { status: "complete" }): Detail {
  const codes = ["full_name", "contact_email", "start_date", "employment_status", "department", "job_title", "employee_type"];
  return {
    id: "p1",
    revision: 3,
    employee_code: "DEMO001",
    full_name: "Phan Minh Khoa",
    employment_status: "active",
    status_as_of: TODAY,
    completeness: {
      operational: {
        status: completeness.status,
        rule_version: "operational-mvp-2026-10-08.2",
        items: codes.map((code) => ({ code, satisfied: !(completeness.missing ?? []).includes(code) })),
      },
    },
    employments,
  };
}
const can = (set: string[]) => (p: string) => set.includes(p);
const HR_ADMIN = can(["employees.read", "employees.update", "employment.manage", "employment.correct"]);
const HR_EDITOR = can(["employees.read", "employees.update", "employment.manage"]);

describe("Overview — current employment and assignment", () => {
  it("Active: current period and the assignment in effect today", () => {
    const o = overview(detail([period("2026-01-05", null, { assignments: [asg("2026-01-05", null, { manager: MANAGER, job_level: { id: "l3", code: "L3", name: "L3" } })] })]));
    expect(o.employment).toMatchObject({ kind: "active", startDate: "2026-01-05", endDate: null, plannedEnd: false, employeeType: "Employee" });
    expect(o.assignment).toMatchObject({ kind: "current", assignment: { department: "Engineering", jobTitle: "Software Engineer", level: "L3", effectiveFrom: "2026-01-05" } });
    expect(o.header).toEqual({ jobTitle: "Software Engineer", department: "Engineering", employeeType: "Employee" });
    expect(o.identity.workEmail).toBe("khoa.phan@example.test");
    expect(o.upcoming).toEqual([]);
  });

  it("Pre-start: future start date and an upcoming (never current) assignment", () => {
    const o = overview(detail([period("2026-11-02", null)]));
    expect(o.employment).toMatchObject({ kind: "pre_start", startDate: "2026-11-02", previousEnd: null });
    expect(o.assignment.kind).toBe("upcoming");
    expect(o.upcoming).toEqual([expect.objectContaining({ kind: "period_start", date: "2026-11-02", first: true, employeeType: "Employee" })]);
  });

  it("Ended: end date (not planned) and the last assignment of the ended period", () => {
    const p = period("2025-01-06", "2026-06-30", {
      active_end_event: endEvent("2026-06-30", "RESIGNATION"),
      has_active_end_event: true,
      assignments: [asg("2025-01-06", "2025-07-01"), asg("2025-07-01", null, { department: PRODUCT, job_title: SPE })],
    });
    const o = overview(detail([p]));
    expect(o.employment).toMatchObject({ kind: "ended", endDate: "2026-06-30", plannedEnd: false, endReason: { code: "RESIGNATION" } });
    expect(o.assignment).toMatchObject({ kind: "last", assignment: { department: "Product", jobTitle: "Senior Product Engineer" }, periodEnd: "2026-06-30" });
    expect(o.upcoming).toEqual([]);
  });

  it("Active period without an assignment in effect today does not invent one", () => {
    const o = overview(detail([period("2026-10-01", null, { assignments: [asg("2026-10-15", null)] })]));
    expect(o.assignment).toEqual({ kind: "none", reason: "none_in_effect" });
    expect(o.upcoming).toEqual([expect.objectContaining({ kind: "assignment_change", date: "2026-10-15", from: null })]);
    expect(overview(detail([period("2026-10-01", null, { assignments: [] })])).assignment).toEqual({ kind: "none", reason: "no_assignment" });
  });

  it("Manager absent is a neutral absence, not an error; completeness comes from the API", () => {
    const o = overview(detail([period("2026-01-05", null)]));
    expect(o.assignment).toMatchObject({ kind: "current", assignment: { manager: null } });
    expect(o.health).toEqual({ status: "complete", missing: [], ruleVersion: "operational-mvp-2026-10-08.2" });
  });

  it("Record health mirrors the authoritative completeness items (no frontend reasons)", () => {
    const o = overview(detail([period("2026-01-05", null, { work_email: null })], { status: "incomplete", missing: ["contact_email", "job_title"] }));
    expect(o.health).toMatchObject({ status: "incomplete", missing: ["contact_email", "job_title"] });
  });
});

describe("Overview — upcoming changes (true future events only)", () => {
  it("future Assignment change within the current period", () => {
    const p = period("2026-01-05", null, { assignments: [asg("2026-01-05", "2026-11-01"), asg("2026-11-01", null, { department: PRODUCT, job_title: SPE })] });
    const o = overview(detail([p]));
    expect(o.assignment).toMatchObject({ kind: "current", assignment: { department: "Engineering" } });
    expect(o.upcoming).toEqual([
      expect.objectContaining({ kind: "assignment_change", date: "2026-11-01", from: expect.objectContaining({ department: "Engineering" }), to: expect.objectContaining({ department: "Product" }), changed: ["department", "job_title"] }),
    ]);
  });

  it("a change effective today is current, not upcoming; only changed fields are listed", () => {
    const p = period("2026-01-05", null, { assignments: [asg("2026-01-05", TODAY), asg(TODAY, "2026-12-01"), asg("2026-12-01", null, { manager: MANAGER })] });
    const changes = upcomingChanges(detail([p]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "assignment_change", date: "2026-12-01", changed: ["manager"] });
  });

  it("planned End (including an end on today, the last day)", () => {
    const o = overview(detail([period("2026-01-05", "2026-12-31")]));
    expect(o.employment).toMatchObject({ kind: "active", endDate: "2026-12-31", plannedEnd: true });
    expect(o.upcoming).toEqual([expect.objectContaining({ kind: "planned_end", date: "2026-12-31" })]);
    expect(upcomingChanges(detail([period("2026-01-05", TODAY)]))).toEqual([expect.objectContaining({ kind: "planned_end", date: TODAY })]);
  });

  it("Rehire after an ended period: the future period is not merged with the old one", () => {
    const old = period("2024-03-01", "2026-06-30");
    const next = period("2026-11-02", null, { work_email: null });
    const o = overview(detail([old, next]));
    expect(o.employment).toMatchObject({ kind: "pre_start", periodId: next.id, startDate: "2026-11-02", previousEnd: "2026-06-30" });
    expect(o.upcoming).toEqual([expect.objectContaining({ kind: "period_start", periodId: next.id, first: false })]);
  });

  it("planned Rehire while the current period is still active: planned end, then a new period", () => {
    const current = period("2025-01-06", "2026-10-31", { active_end_event: endEvent("2026-10-31", "RESIGNATION"), has_active_end_event: true });
    const next = period("2026-12-01", null);
    const o = overview(detail([current, next]));
    expect(o.employment).toMatchObject({ kind: "active", periodId: current.id, plannedEnd: true });
    expect(o.upcoming.map((c) => [c.kind, c.date])).toEqual([
      ["planned_end", "2026-10-31"],
      ["period_start", "2026-12-01"],
    ]);
  });

  it("Relationship Change: one 'new Employment Period' item, not an end plus a start", () => {
    const current = period("2025-01-06", "2026-10-31", {
      employee_type: CONTRACTOR,
      active_end_event: endEvent("2026-10-31", "RELATIONSHIP_CHANGE"),
      has_active_end_event: true,
    });
    const next = period("2026-11-01", null, { employee_type: EMPLOYEE, assignments: [asg("2026-11-01", null, { department: PRODUCT })] });
    const o = overview(detail([current, next]));
    expect(o.employment).toMatchObject({ kind: "active", periodId: current.id, employeeType: "Service Contractor" });
    expect(o.upcoming).toEqual([
      expect.objectContaining({ kind: "relationship_change", date: "2026-11-01", fromType: "Service Contractor", toType: "Employee", previousEnd: "2026-10-31", assignment: expect.objectContaining({ department: "Product" }) }),
    ]);
  });

  it("an RC-shaped gap that is not a Relationship Change stays an end plus a start", () => {
    const current = period("2025-01-06", "2026-10-31", { active_end_event: endEvent("2026-10-31", "RESIGNATION"), has_active_end_event: true });
    const next = period("2026-11-01", null);
    expect(upcomingChanges(detail([current, next])).map((c) => c.kind)).toEqual(["planned_end", "period_start"]);
  });
});

describe("Overview — dispositions and no employment record", () => {
  it("cancelled and voided periods are excluded from current and upcoming", () => {
    const active = period("2026-01-05", null);
    const cancelled = period("2026-12-01", null, { cancelled_at: "2026-10-01T03:00:00Z" });
    const o = overview(detail([active, cancelled]));
    expect(o.employment).toMatchObject({ kind: "active", periodId: active.id });
    expect(o.upcoming).toEqual([]);

    const earlier = period("2024-01-02", "2025-12-31");
    const voided = period("2026-02-01", null, { voided_at: "2026-10-05T03:00:00Z" });
    expect(overview(detail([earlier, voided])).employment).toMatchObject({ kind: "ended", periodId: earlier.id });
  });

  it("only a voided period → No Employment Record, nothing fabricated", () => {
    const o = overview(detail([period("2026-03-02", null, { voided_at: "2026-10-05T03:00:00Z" })], { status: "incomplete", missing: ["start_date", "employment_status"] }));
    expect(o.employment).toEqual({ kind: "none", hasDisposedRecords: true });
    expect(o.assignment).toEqual({ kind: "none", reason: "no_employment" });
    expect(o.header).toEqual({ jobTitle: null, department: null, employeeType: null });
    expect(o.identity.workEmail).toBeNull();
    expect(o.upcoming).toEqual([]);
  });

  it("no employment at all", () => {
    const o = overview(detail([], { status: "incomplete", missing: ["start_date"] }));
    expect(o.employment).toEqual({ kind: "none", hasDisposedRecords: false });
    expect(o.health.status).toBe("incomplete");
  });
});

describe("Header actions — same eligibility as before UI-3, by capability", () => {
  it("Active employee, HR_ADMIN: Change Assignment primary; daily, correction and advanced groups", () => {
    const a = headerActions(detail([period("2026-01-05", null)]), HR_ADMIN);
    expect(a.primary).toBe("change_assignment");
    expect(a.daily).toEqual(["edit_work_email", "end_employment", "relationship_change"]);
    expect(a.correction).toEqual(["correct_personal", "correct_period", "clear_work_email"]);
    expect(a.advanced).toEqual(["void_period"]);
  });

  it("HR_EDITOR (no employment.correct): no corrections of the period and no Void", () => {
    const a = headerActions(detail([period("2026-01-05", null)]), HR_EDITOR);
    expect(a.primary).toBe("change_assignment");
    expect(a.correction).toEqual(["correct_personal"]);
    expect(a.advanced).toEqual([]);
  });

  it("read-only capability: no actions", () => {
    const a = headerActions(detail([period("2026-01-05", null)]), can(["employees.read"]));
    expect(a).toMatchObject({ primary: null, daily: [], correction: [], advanced: [] });
  });

  it("Pre-start without assignment: Add Initial Assignment; Cancel Planned Period is a correction", () => {
    const a = headerActions(detail([period("2026-11-02", null, { assignments: [] })]), HR_ADMIN);
    expect(a.primary).toBe("initial_assignment");
    expect(a.correction).toContain("cancel_planned");
    expect(a.advanced).toEqual([]); // Void only for a started period
  });

  it("Ended employee: Rehire; email change is a correction; no Change Assignment", () => {
    const a = headerActions(detail([period("2025-01-06", "2026-06-30", { active_end_event: endEvent("2026-06-30", "RESIGNATION"), has_active_end_event: true })]), HR_ADMIN);
    expect(a.primary).toBeNull();
    expect(a.daily).toEqual(["rehire"]);
    expect(a.correction).toEqual(["correct_personal", "correct_period", "correct_work_email", "clear_work_email", "reverse_end"]);
  });

  it("No operational period: Add Initial Employment Period only", () => {
    const a = headerActions(detail([period("2026-03-02", null, { voided_at: "2026-10-05T03:00:00Z" })]), HR_ADMIN);
    expect(a).toMatchObject({ target: null, primary: null, daily: ["initial_employment"], correction: ["correct_personal"], advanced: [] });
  });

  it("planned Relationship Change: header acts on the current period; the planned period keeps its own actions", () => {
    const current = period("2025-01-06", "2026-10-31", { active_end_event: endEvent("2026-10-31", "RELATIONSHIP_CHANGE"), has_active_end_event: true });
    const next = period("2026-11-01", null);
    const d = detail([current, next]);
    const a = headerActions(d, HR_ADMIN);
    expect(a.target?.id).toBe(current.id);
    expect(a.daily).not.toContain("end_employment");
    expect(a.correction).toContain("reverse_end");
    expect(a.advanced).toEqual([]);
    expect(periodEligibility(d, next, HR_ADMIN)).toMatchObject({ cancelPlanned: true, relationshipChange: true, voidPeriod: false });
  });
});
