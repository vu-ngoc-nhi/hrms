import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assignmentSections } from "@/app/employees/[id]/assignmentModel";
import { headerActions, overview, upcomingChanges, type Assignment, type Detail, type Period } from "@/app/employees/[id]/detailModel";
import { historyEntries } from "@/app/employees/[id]/historyModel";
import { isDataCorrection, successTab, surfaceFor } from "@/app/employees/[id]/workflowModel";
import { en } from "@/i18n/messages/en";

// PV-29 Cancel Planned Assignment — UI view models (presentation of the server's cancelled_at only).
const TODAY = "2026-10-11";
const ENG = { id: "d-eng", name: "Engineering" };
const QA = { id: "d-qa", name: "Quality Assurance" };
const SE = { id: "j-se", name_en: "Software Engineer" };
const QAE = { id: "j-qae", name_en: "QA Engineer" };
let seq = 0;
const asg = (from: string, to: string | null, o: Partial<Assignment> = {}): Assignment => ({
  id: `a${++seq}`,
  effective_from: from,
  effective_to: to,
  department: ENG,
  job_title: SE,
  job_level: null,
  manager: null,
  cancelled_at: null,
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
  revision: 3,
  employee_code: "DEMO010",
  full_name: "Phạm Văn Kế",
  employment_status: "active",
  status_as_of: TODAY,
  completeness: { operational: { status: "complete", rule_version: "r", items: [] } },
  employments,
});
const can = (set: string[]) => (p: string) => set.includes(p);
const HR_EDITOR = can(["employees.read", "employment.manage"]);
const CANCELLED = "2026-10-11T03:00:00.000Z";

describe("Assignment tab sections", () => {
  it("K: a cancelled planned assignment is never Current or Upcoming; it is in its own section; the predecessor is current again", () => {
    const a = asg("2025-01-06", null);
    const b = asg("2026-11-01", null, { department: QA, job_title: QAE, cancelled_at: CANCELLED });
    const s = assignmentSections(detail([period("2025-01-06", null, [a, b])]));
    expect(s.current.map((v) => v.assignment.id)).toEqual([a.id]);
    expect(s.current[0].changesOn).toBeNull();
    expect(s.upcoming).toEqual([]);
    expect(s.cancelledPlans.map((v) => [v.assignment.id, v.label, v.wording])).toEqual([[b.id, "cancelled", { kind: "planned_for", date: "2026-11-01" }]]);
    expect(s.cancelledPlans[0].changes.map((c) => c.field)).toEqual(["department", "job_title"]);
  });

  it("BD-3: only the latest upcoming row of a period is cancellable", () => {
    const a = asg("2025-01-06", "2026-11-01");
    const b = asg("2026-11-01", "2026-12-01");
    const c = asg("2026-12-01", null);
    const s = assignmentSections(detail([period("2025-01-06", null, [a, b, c])]));
    expect(s.upcoming.map((v) => [v.assignment.id, v.cancellable])).toEqual([
      [b.id, false],
      [c.id, true],
    ]);
    expect(s.current[0].cancellable).toBe(false);
  });

  it("rows of a cancelled / voided period stay in the not-operational section and are never cancellable", () => {
    const p = period("2026-12-01", null, [asg("2026-12-01", null)], { cancelled_at: CANCELLED });
    const s = assignmentSections(detail([p]));
    expect(s.notOperational).toHaveLength(1);
    expect(s.cancelledPlans).toEqual([]);
    expect(s.upcoming).toEqual([]);
  });

  it("BD-4: a cancelled initial assignment leaves an empty period (Add Initial Assignment is offered again in the header)", () => {
    const p = period("2026-11-02", null, [asg("2026-11-02", null, { cancelled_at: CANCELLED })]);
    const d = detail([p]);
    const s = assignmentSections(d);
    expect(s.emptyPeriods.map((e) => e.section)).toEqual(["upcoming"]);
    expect(s.cancelledPlans).toHaveLength(1);
    expect(headerActions(d, HR_EDITOR).primary).toBe("initial_assignment");
    expect(overview(d).assignment).toEqual({ kind: "none", reason: "no_assignment" });
  });
});

describe("Overview and History", () => {
  it("Upcoming Changes never lists a cancelled plan", () => {
    const d = detail([period("2025-01-06", null, [asg("2025-01-06", null), asg("2026-11-01", null, { cancelled_at: CANCELLED })])]);
    expect(upcomingChanges(d)).toEqual([]);
  });

  it("BD-7: History shows 'Planned Assignment cancelled' at the planned date, status Cancelled, no 'Assignment changed' entry for it", () => {
    const b = asg("2026-11-01", null, { department: QA, job_title: QAE, cancelled_at: CANCELLED });
    const entries = historyEntries(detail([period("2025-01-06", null, [asg("2025-01-06", null), b])]));
    const own = entries.filter((e) => e.key.includes(b.id));
    expect(own.map((e) => [e.kind, e.date, e.status])).toEqual([["assignment_plan_cancelled", "2026-11-01", "cancelled"]]);
    expect(en.history.title.assignmentPlanCancelled).toBe("Planned Assignment cancelled");
    expect(en.history.desc.assignmentPlanCancelled).toBe("This Assignment was planned to take effect on {date} but was cancelled before it began.");
  });
});

describe("Workflow surface and wording", () => {
  it("Modal, lands on the Assignment tab, not a data correction", () => {
    expect(surfaceFor("cancel_planned_assignment")).toBe("modal");
    expect(successTab("cancel_planned_assignment")).toBe("assignment");
    expect(isDataCorrection("cancel_planned_assignment")).toBe(false);
  });

  it("approved copy; no range language; never Delete / Correct wording", () => {
    const c = en.cancelPlannedAssignment;
    expect(c.open).toBe("Cancel Planned Assignment");
    expect(c.help).toBe("Use this when a future Assignment is no longer going to take effect.");
    const text = JSON.stringify(c);
    expect(text).not.toMatch(/exclusive|effective_to|range/i);
    for (const label of [c.open, c.save]) expect(label).not.toMatch(/delete|correct/i);
    expect(en.assignmentTab.label.cancelled).toBe("Cancelled");
    expect(en.endEmployment.blockedPlanned).toMatch(/Cancel Planned Assignment/);
    expect(en.relationshipChange.blockedPlanned).toMatch(/Cancel Planned Assignment/);
    expect(en.endEmployment.blockedPlanned).not.toMatch(/Correct/);
  });

  it("capability-based (employment.manage), no role-name checks; the action lives on the Assignment tab, not the header", () => {
    const tab = readFileSync("src/app/employees/[id]/AssignmentTab.tsx", "utf8");
    expect(tab).toContain('can("employment.manage")');
    expect(tab).toContain('ctx.launch("cancel_planned_assignment"');
    for (const f of ["src/app/employees/[id]/AssignmentTab.tsx", "src/app/employees/[id]/CancelPlannedAssignmentForm.tsx", "src/app/employees/[id]/assignmentModel.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
    const header = headerActions(detail([period("2025-01-06", null, [asg("2025-01-06", null), asg("2026-11-01", null)])]), HR_EDITOR);
    expect([header.primary, ...header.daily, ...header.correction, ...header.advanced]).not.toContain("cancel_planned_assignment");
  });

  it("read-only users get no action (the button needs employment.manage)", () => {
    const tab = readFileSync("src/app/employees/[id]/AssignmentTab.tsx", "utf8");
    expect(tab).toMatch(/const manage = v\.disposition === null && can\("employment\.manage"\);\n\s+const canCancel = manage && v\.cancellable;/);
  });
});
