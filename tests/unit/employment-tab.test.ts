import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { periodActions, type Assignment, type Detail, type HistoryEvent, type Period } from "@/app/employees/[id]/detailModel";
import { employmentSections, periodViews } from "@/app/employees/[id]/employmentModel";

// UI-5 Employment tab view model: presentation of server facts (period_lifecycle, dispositions, recorded events).
const TODAY = "2026-10-10";
const EMPLOYEE = { id: "t-emp", code: "EMPLOYEE", name: "Employee" };
const CONTRACTOR = { id: "t-sc", code: "SERVICE_CONTRACTOR", name: "Service Contractor" };
let seq = 0;
const asg = (from: string): Assignment => ({
  id: `a${++seq}`,
  effective_from: from,
  effective_to: null,
  department: { id: "d", name: "Engineering" },
  job_title: { id: "j", name_en: "Software Engineer" },
  job_level: null,
  manager: null,
});
const ev = (event_type: string, effective_date: string, o: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: `ev${++seq}`,
  event_type,
  effective_date,
  recorded_at: "2026-01-01T00:00:00Z",
  end_reason: null,
  reverses_event_id: null,
  ...o,
});
const reason = (code: string) => ({ code, label: code });
function period(start: string, end: string | null, o: Partial<Period> = {}): Period {
  const lifecycle = start > TODAY ? "not_started" : end !== null && end < TODAY ? "ended" : "active";
  return {
    id: `e${++seq}`,
    start_date: start,
    end_date: end,
    period_lifecycle: o.cancelled_at || o.voided_at ? null : lifecycle,
    events: [ev("start", start)],
    has_active_end_event: false,
    active_end_event: null,
    cancelled_at: null,
    voided_at: null,
    employee_type: EMPLOYEE,
    work_email: `p${seq}@example.test`,
    assignments: [asg(start)],
    ...o,
  };
}
const ended = (start: string, end: string, code: string, o: Partial<Period> = {}) => {
  const endEv = ev("end", end, { end_reason: reason(code) });
  return period(start, end, {
    has_active_end_event: true,
    active_end_event: { effective_date: end, end_reason: reason(code), previous_end_date: null, closed_assignment: null },
    events: [ev("start", start), endEv],
    ...o,
  });
};
const detail = (employments: Period[]): Detail => ({
  id: "p1",
  revision: 1,
  employee_code: "DEMO001",
  full_name: "Phan Minh Khoa",
  employment_status: "active",
  status_as_of: TODAY,
  completeness: { operational: { status: "complete", rule_version: "r", items: [] } },
  employments,
});
const can = (set: string[]) => (p: string) => set.includes(p);
const HR_ADMIN = can(["employees.read", "employees.update", "employment.manage", "employment.correct"]);
const HR_EDITOR = can(["employees.read", "employees.update", "employment.manage"]);

describe("Current / Upcoming / History", () => {
  it("Active: Current section, server status, open end, Work Email of the period", () => {
    const [v] = periodViews(detail([period("2026-01-05", null)]));
    expect(v).toMatchObject({ label: "current", status: "active", disposition: null, endKind: "none", number: 1, workEmail: expect.stringContaining("@example.test") });
    expect(v.lifecycle).toEqual([{ kind: "started", date: "2026-01-05", afterRelationshipChange: false }]);
  });

  it("Pre-start: Upcoming (never Current), 'Starts' wording", () => {
    const s = employmentSections(detail([period("2026-11-02", null)]));
    expect(s.current).toEqual([]);
    expect(s.upcoming[0]).toMatchObject({ label: "upcoming", status: "not_started" });
    expect(s.upcoming[0].lifecycle[0]).toMatchObject({ kind: "starts", date: "2026-11-02" });
  });

  it("Ended: History, End Date and End Reason", () => {
    const s = employmentSections(detail([ended("2022-02-07", "2025-12-31", "VOLUNTARY_RESIGNATION")]));
    expect(s.history[0]).toMatchObject({ label: "historical", status: "ended", endKind: "ended", endReason: { code: "VOLUNTARY_RESIGNATION" } });
    expect(s.history[0].lifecycle.at(-1)).toMatchObject({ kind: "ended", date: "2025-12-31", relationshipChange: false });
  });

  it("planned End: still Current, read as Planned End / Scheduled to end", () => {
    const [v] = periodViews(detail([ended("2024-01-08", "2026-11-30", "VOLUNTARY_RESIGNATION")]));
    expect(v).toMatchObject({ label: "current", endKind: "planned", endDate: "2026-11-30" });
    expect(v.lifecycle.at(-1)).toMatchObject({ kind: "scheduled_end", date: "2026-11-30" });
  });

  it("reversed End: one 'End … reversed' line; no current end", () => {
    const end = ev("end", "2026-12-31", { end_reason: reason("OTHER") });
    const p = period("2025-01-06", null, { events: [ev("start", "2025-01-06"), end, ev("end_reversed", "2026-12-31", { reverses_event_id: end.id })] });
    const [v] = periodViews(detail([p]));
    expect(v.lifecycle.map((l) => l.kind)).toEqual(["started", "end_reversed"]);
    expect(v).toMatchObject({ endKind: "none", endReason: null });
  });
});

describe("Rehire and Relationship Change keep separate periods", () => {
  it("Rehire: old period in History, new period Upcoming, numbered chronologically", () => {
    const s = employmentSections(detail([ended("2021-03-01", "2024-06-30", "VOLUNTARY_RESIGNATION"), period("2026-11-02", null, { assignments: [] })]));
    expect(s.history.map((v) => v.number)).toEqual([1]);
    expect(s.upcoming.map((v) => v.number)).toEqual([2]);
    expect(s.upcoming[0]).toMatchObject({ hasAssignment: false, createdByRelationshipChange: null });
  });

  it("Relationship Change: predecessor ends for Relationship Change; successor says it was created by it", () => {
    const pred = ended("2026-03-02", "2026-11-01", "RELATIONSHIP_CHANGE", { employee_type: CONTRACTOR });
    const succ = period("2026-11-02", null);
    const [a, b] = periodViews(detail([pred, succ]));
    expect(a).toMatchObject({ label: "current", endsForRelationshipChange: true, successorStart: "2026-11-02", endKind: "planned" });
    expect(a.lifecycle.at(-1)).toMatchObject({ kind: "scheduled_end", relationshipChange: true });
    expect(b).toMatchObject({ label: "upcoming", createdByRelationshipChange: { fromType: "Service Contractor" } });
    expect(b.lifecycle[0]).toMatchObject({ kind: "starts", afterRelationshipChange: true });
  });
});

describe("Cancelled and Voided are dispositions, not Employment Status", () => {
  it("Cancelled: no status, label Cancelled, in History, recorded dates kept", () => {
    const c = period("2026-12-01", "2027-06-30", { cancelled_at: "2026-10-01T00:00:00Z", events: [ev("start", "2026-12-01"), ev("cancel_planned_start", "2026-12-01")] });
    const s = employmentSections(detail([period("2026-01-05", null), c]));
    const v = s.history.find((x) => x.period.id === c.id)!;
    expect(v).toMatchObject({ label: "cancelled", disposition: "cancelled", status: null, endKind: "recorded", startDate: "2026-12-01", endDate: "2027-06-30" });
    expect(s.upcoming).toEqual([]);
    expect(v.lifecycle).toEqual([{ kind: "planned_start", date: "2026-12-01" }, { kind: "cancelled" }]);
  });

  it("Voided: no status even if a lifecycle value were present; never Current", () => {
    const voided = period("2026-03-02", null, { voided_at: "2026-10-05T00:00:00Z", events: [ev("start", "2026-03-02"), ev("employment_voided", "2026-03-02")] });
    voided.period_lifecycle = "active"; // defensive: a disposition always wins
    const s = employmentSections(detail([voided]));
    expect(s.current).toEqual([]);
    expect(s.history[0]).toMatchObject({ label: "voided", status: null, disposition: "voided", endReason: null });
    expect(s.history[0].lifecycle).toEqual([{ kind: "recorded_start", date: "2026-03-02" }, { kind: "voided" }]);
  });

  it("no operational period: no Current or Upcoming section", () => {
    expect(employmentSections(detail([]))).toEqual({ current: [], upcoming: [], history: [] });
    const s = employmentSections(detail([period("2026-03-02", null, { voided_at: "2026-10-05T00:00:00Z" })]));
    expect(s.current.length + s.upcoming.length).toBe(0);
    expect(s.history.every((v) => v.disposition !== null)).toBe(true);
  });

  it("History is most recent first and mixes ended periods with disposed records", () => {
    const s = employmentSections(
      detail([ended("2020-01-06", "2021-12-31", "OTHER"), period("2023-05-01", null, { voided_at: "2026-01-01T00:00:00Z" }), period("2026-01-05", null)]),
    );
    expect(s.history.map((v) => v.number)).toEqual([2, 1]);
  });
});

describe("Period actions by capability (no role names)", () => {
  it("HR_ADMIN on an active period: daily buttons, Correct record, Advanced Void", () => {
    const d = detail([period("2026-01-05", null)]);
    expect(periodActions(d, d.employments[0], HR_ADMIN)).toMatchObject({
      daily: ["edit_work_email", "end_employment", "relationship_change"],
      correction: ["correct_period", "clear_work_email"],
      advanced: ["void_period"],
    });
  });
  it("HR_EDITOR: no corrections and no Void", () => {
    const d = detail([period("2026-01-05", null)]);
    expect(periodActions(d, d.employments[0], HR_EDITOR)).toMatchObject({ correction: [], advanced: [] });
  });
  it("read-only: nothing", () => {
    const d = detail([period("2026-01-05", null)]);
    expect(periodActions(d, d.employments[0], can(["employees.read"]))).toMatchObject({ daily: [], correction: [], advanced: [], initialAssignment: false });
  });
  it("Pre-start without assignment: Add Initial Assignment; Cancel Planned Period under Correct record", () => {
    const d = detail([period("2026-11-02", null, { assignments: [] })]);
    expect(periodActions(d, d.employments[0], HR_EDITOR)).toMatchObject({ initialAssignment: true, correction: ["cancel_planned"] });
  });
  it("Ended period: email change is a correction; disposed records have no actions", () => {
    const d = detail([ended("2022-02-07", "2025-12-31", "OTHER"), period("2026-03-02", null, { voided_at: "2026-10-05T00:00:00Z" })]);
    expect(periodActions(d, d.employments[0], HR_ADMIN).correction).toContain("correct_work_email");
    expect(periodActions(d, d.employments[1], HR_ADMIN)).toMatchObject({ daily: [], correction: [], advanced: [], initialAssignment: false });
  });
  it("Employment tab code never checks role names", () => {
    for (const f of ["src/app/employees/[id]/EmploymentTab.tsx", "src/app/employees/[id]/employmentModel.ts", "src/app/employees/[id]/PeriodWorkflow.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});
