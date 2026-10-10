import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assignmentSections } from "@/app/employees/[id]/assignmentModel";
import { periodActions, periodEligibility, type Assignment, type Detail, type Period } from "@/app/employees/[id]/detailModel";

// UI-6 Assignment tab view model: sections, business date wording, period context; D-UI-14 dispositions.
const TODAY = "2026-10-10";
const ENG = { id: "d-eng", name: "Engineering" };
const QA = { id: "d-qa", name: "Quality Assurance" };
const SE = { id: "j-se", name_en: "Software Engineer" };
const SSE = { id: "j-sse", name_en: "Senior Software Engineer" };
const L2 = { id: "l2", code: "L2", name: "Middle" };
const L3 = { id: "l3", code: "L3", name: "Senior" };
const MGR = { person_id: "p-mgr", employee_code: "DEMO001", full_name: "Phan Minh Khoa" };
let seq = 0;
const asg = (from: string, to: string | null, o: Partial<Assignment> = {}): Assignment => ({
  id: `a${++seq}`,
  effective_from: from,
  effective_to: to,
  department: ENG,
  job_title: SE,
  job_level: L2,
  manager: MGR,
  ...o,
});
function period(start: string, end: string | null, assignments: Assignment[], o: Partial<Period> = {}): Period {
  const lifecycle = start > TODAY ? "not_started" : end !== null && end < TODAY ? "ended" : "active";
  return {
    id: `e${++seq}`,
    start_date: start,
    end_date: end,
    period_lifecycle: o.cancelled_at || o.voided_at ? null : lifecycle,
    events: [],
    has_active_end_event: false,
    active_end_event: null,
    cancelled_at: null,
    voided_at: null,
    employee_type: { id: "t", code: "EMPLOYEE", name: "Employee" },
    work_email: null,
    assignments,
    ...o,
  };
}
const detail = (employments: Period[]): Detail => ({
  id: "p1",
  revision: 1,
  employee_code: "DEMO002",
  full_name: "Vũ Hồng Nhung",
  employment_status: "active",
  status_as_of: TODAY,
  completeness: { operational: { status: "complete", rule_version: "r", items: [] } },
  employments,
});
const can = (set: string[]) => (p: string) => set.includes(p);
const HR_ADMIN = can(["employees.read", "employment.manage", "employment.correct"]);
const HR_EDITOR = can(["employees.read", "employment.manage"]);

describe("Current / Upcoming / History", () => {
  it("current assignment: 'Effective since', single period has no period context", () => {
    const s = assignmentSections(detail([period("2026-01-05", null, [asg("2026-01-05", null)])]));
    expect(s.current).toHaveLength(1);
    expect(s.current[0]).toMatchObject({ label: "current", wording: { kind: "since", date: "2026-01-05" }, changesOn: null });
    expect(s.multiplePeriods).toBe(false);
  });

  it("multiple historical rows: replaced rows read 'Replaced on' the next row's start (never an overlapping end date)", () => {
    const rows = [asg("2024-01-08", "2025-03-01", { department: QA }), asg("2025-03-01", "2026-06-01"), asg("2026-06-01", null, { job_title: SSE, job_level: L3 })];
    const s = assignmentSections(detail([period("2024-01-08", null, rows)]));
    expect(s.current[0].wording).toEqual({ kind: "since", date: "2026-06-01" });
    expect(s.history.map((h) => h.wording)).toEqual([
      { kind: "replaced", from: "2025-03-01", on: "2026-06-01" },
      { kind: "replaced", from: "2024-01-08", on: "2025-03-01" },
    ]);
    // Only changed fields are summarised.
    expect(s.current[0].changes).toEqual([
      { field: "job_title", from: "Software Engineer", to: "Senior Software Engineer" },
      { field: "level", from: "Middle", to: "Senior" },
    ]);
    expect(s.history[1]).toMatchObject({ firstOfPeriod: true, changes: [] });
  });

  it("future Assignment change: Upcoming with 'Takes effect'; current notes the change date", () => {
    const s = assignmentSections(detail([period("2025-09-01", null, [asg("2025-09-01", "2026-11-01", { department: QA }), asg("2026-11-01", null)])]));
    expect(s.current[0]).toMatchObject({ changesOn: "2026-11-01" });
    expect(s.upcoming).toHaveLength(1);
    expect(s.upcoming[0]).toMatchObject({ label: "upcoming", wording: { kind: "takes_effect", date: "2026-11-01" } });
    expect(s.upcoming[0].changes.map((c) => c.field)).toEqual(["department"]);
  });

  it("several upcoming rows are kept and ordered nearest first", () => {
    const s = assignmentSections(detail([period("2025-09-01", null, [asg("2025-09-01", "2026-11-01"), asg("2026-11-01", "2027-01-01", { department: QA }), asg("2027-01-01", null)])]));
    expect(s.upcoming.map((u) => u.assignment.effective_from)).toEqual(["2026-11-01", "2027-01-01"]);
  });

  it("Pre-start: the initial assignment is Upcoming, never Current", () => {
    const s = assignmentSections(detail([period("2026-11-02", null, [asg("2026-11-02", null)])]));
    expect(s.current).toEqual([]);
    expect(s.upcoming[0]).toMatchObject({ label: "upcoming", firstOfPeriod: true });
  });

  it("Ended: the final row is 'Last Assignment', effective through the end of employment", () => {
    const s = assignmentSections(detail([period("2022-02-07", "2025-12-31", [asg("2022-02-07", "2024-01-01"), asg("2024-01-01", "2026-01-01", { job_level: L3 })])]));
    expect(s.current).toEqual([]);
    expect(s.history[0]).toMatchObject({ label: "last", wording: { kind: "through", from: "2024-01-01", through: "2025-12-31" } });
    expect(s.history[1]).toMatchObject({ label: "historical", wording: { kind: "replaced", on: "2024-01-01" } });
  });

  it("an open row of an ended period reads 'Effective through' the period end", () => {
    const s = assignmentSections(detail([period("2022-02-07", "2025-12-31", [asg("2022-02-07", null)])]));
    expect(s.history[0].wording).toEqual({ kind: "through", from: "2022-02-07", through: "2025-12-31" });
  });

  it("missing Manager and Level stay neutral values", () => {
    const s = assignmentSections(detail([period("2026-01-05", null, [asg("2026-01-05", null, { manager: null, job_level: null })])]));
    expect(s.current[0].values).toMatchObject({ manager: null, level: null });
  });
});

describe("Rehire and Relationship Change keep assignments in their own period", () => {
  it("Rehire: old period's last assignment in History, new period's initial assignment Upcoming, with period context", () => {
    const s = assignmentSections(detail([period("2023-04-03", "2026-06-30", [asg("2023-04-03", null)]), period("2026-11-02", null, [asg("2026-11-02", null, { department: QA })])]));
    expect(s.multiplePeriods).toBe(true);
    expect(s.current).toEqual([]);
    expect(s.upcoming[0]).toMatchObject({ periodNumber: 2, label: "upcoming" });
    expect(s.history[0]).toMatchObject({ periodNumber: 1, label: "last" });
  });

  it("Relationship Change: the new period's assignment is Upcoming, the current period's row stays Current", () => {
    const s = assignmentSections(detail([period("2026-03-02", "2026-11-01", [asg("2026-03-02", null)]), period("2026-11-02", null, [asg("2026-11-02", null)])]));
    expect(s.current.map((c) => c.periodNumber)).toEqual([1]);
    expect(s.upcoming.map((u) => u.periodNumber)).toEqual([2]);
    expect(s.upcoming[0].changes).toEqual([]); // no cross-period comparison
  });

  it("an operational period without any assignment is an intentional empty state in its section", () => {
    const s = assignmentSections(detail([period("2023-04-03", "2026-06-30", [asg("2023-04-03", null)]), period("2026-11-02", null, [])]));
    expect(s.emptyPeriods).toEqual([expect.objectContaining({ periodNumber: 2, section: "upcoming" })]);
  });
});

describe("Cancelled / Voided periods (D-UI-14)", () => {
  it("their assignments are never Current or Upcoming", () => {
    const s = assignmentSections(
      detail([
        period("2026-01-05", null, [asg("2026-01-05", null)]),
        period("2026-12-01", null, [asg("2026-12-01", null)], { cancelled_at: "2026-10-01T00:00:00Z" }),
        period("2025-01-01", null, [asg("2025-01-01", null)], { voided_at: "2026-10-01T00:00:00Z" }),
      ]),
    );
    expect(s.current).toHaveLength(1);
    expect(s.upcoming).toEqual([]);
    expect(s.notOperational.map((v) => [v.label, v.disposition])).toEqual([
      ["not_operational", "cancelled"],
      ["not_operational", "voided"],
    ]);
    expect(s.emptyPeriods).toEqual([]);
  });

  it("no operational mutation action is eligible on a cancelled or voided period, for any capability", () => {
    for (const disposition of [{ cancelled_at: "2026-10-01T00:00:00Z" }, { voided_at: "2026-10-01T00:00:00Z" }]) {
      for (const assignments of [[], [asg("2026-12-01", null)]]) {
        const p = period("2026-12-01", null, assignments, disposition);
        const d = detail([p]);
        const e = periodEligibility(d, p, HR_ADMIN);
        expect(Object.values(e).every((v) => v === false)).toBe(true);
        expect(periodActions(d, p, HR_ADMIN)).toEqual({ daily: [], correction: [], advanced: [], initialAssignment: false, changeAssignment: false });
      }
    }
  });
});

describe("Assignment actions by capability", () => {
  it("Correct needs employment.correct; Change Assignment needs employment.manage", () => {
    const p = period("2026-01-05", null, [asg("2026-01-05", null)]);
    const d = detail([p]);
    expect(periodEligibility(d, p, HR_ADMIN)).toMatchObject({ correctAssignmentRows: true, changeAssignment: true });
    expect(periodEligibility(d, p, HR_EDITOR)).toMatchObject({ correctAssignmentRows: false, changeAssignment: true });
    expect(periodEligibility(d, p, can(["employees.read"]))).toMatchObject({ correctAssignmentRows: false, changeAssignment: false, initialAssignment: false });
  });
  it("Add Initial Assignment for a period without assignment needs employment.manage", () => {
    const p = period("2026-11-02", null, []);
    expect(periodEligibility(detail([p]), p, HR_EDITOR).initialAssignment).toBe(true);
    expect(periodEligibility(detail([p]), p, can(["employees.read"])).initialAssignment).toBe(false);
  });
  it("Assignment tab code never checks role names", () => {
    for (const f of ["src/app/employees/[id]/AssignmentTab.tsx", "src/app/employees/[id]/assignmentModel.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});
