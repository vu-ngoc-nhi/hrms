import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { headerActions, periodActions, periodCardActions, type Assignment, type Detail, type Period } from "@/app/employees/[id]/detailModel";
import { isDataCorrection, openWorkflow, shouldClose, successTab, surfaceFor } from "@/app/employees/[id]/workflowModel";
import { en } from "@/i18n/messages/en";

// UI-9: one home per action, one workflow surface at a time, business wording in workflow forms.
const TODAY = "2026-10-10";
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
function period(start: string, end: string | null, o: Partial<Period> = {}): Period {
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
    work_email: "a@example.test",
    assignments: [asg(start)],
    ...o,
  };
}
const detail = (employments: Period[]): Detail => ({
  id: "p1",
  revision: 1,
  employee_code: "DEMO010",
  full_name: "QA Person",
  employment_status: "active",
  status_as_of: TODAY,
  completeness: { operational: { status: "complete", rule_version: "r", items: [] } },
  employments,
});
const can = (set: string[]) => (p: string) => set.includes(p);
const HR_ADMIN = can(["employees.read", "employees.update", "employment.manage", "employment.correct"]);
const HR_EDITOR = can(["employees.read", "employees.update", "employment.manage"]);

describe("Action ownership", () => {
  it("representative Add Initial Assignment appears once: header primary, not on its period card", () => {
    const p = period("2026-11-02", null, { assignments: [] });
    const d = detail([p]);
    const header = headerActions(d, HR_ADMIN);
    expect(header.primary).toBe("initial_assignment");
    const card = periodCardActions(d, p, HR_ADMIN, header.target?.id ?? null);
    expect([...card.daily, ...card.correction, ...card.advanced]).not.toContain("initial_assignment");
  });

  it("period actions are not in the header; they are on the period card", () => {
    const p = period("2026-01-05", null);
    const d = detail([p]);
    const header = headerActions(d, HR_ADMIN);
    expect([...header.daily, ...header.correction, ...header.advanced]).toEqual(["correct_personal"]);
    const card = periodCardActions(d, p, HR_ADMIN, p.id);
    expect(card).toEqual({
      daily: ["edit_work_email", "end_employment", "relationship_change"],
      correction: ["correct_period", "clear_work_email"],
      advanced: ["void_period"],
    });
  });

  it("a future / non-representative period keeps its contextual assignment action when eligible", () => {
    const current = period("2025-01-06", "2026-10-31", {
      has_active_end_event: true,
      active_end_event: { effective_date: "2026-10-31", end_reason: { code: "RELATIONSHIP_CHANGE", label: "x" }, previous_end_date: null, closed_assignment: null },
    });
    const future = period("2026-11-01", null);
    const futureNoAssignment = { ...future, id: "future-2", assignments: [] };
    const d = detail([current, future]);
    expect(periodCardActions(d, future, HR_EDITOR, current.id).daily[0]).toBe("change_assignment");
    expect(periodCardActions(detail([current, futureNoAssignment]), futureNoAssignment, HR_EDITOR, current.id).daily[0]).toBe("initial_assignment");
  });

  it("grouping: business, Correct record, Advanced (Void only in Advanced)", () => {
    const p = period("2026-01-05", null);
    const d = detail([p]);
    const g = periodActions(d, p, HR_ADMIN);
    expect(g.advanced).toEqual(["void_period"]);
    expect([...g.daily, ...g.correction]).not.toContain("void_period");
  });

  it("capabilities decide visibility (HR_EDITOR: no corrections, no Void; read-only: nothing)", () => {
    const p = period("2026-01-05", null);
    const d = detail([p]);
    expect(periodCardActions(d, p, HR_EDITOR, p.id)).toMatchObject({ correction: [], advanced: [] });
    expect(periodCardActions(d, p, can(["employees.read"]), p.id)).toEqual({ daily: [], correction: [], advanced: [] });
  });

  it("cancelled / voided periods expose no operational mutation", () => {
    for (const o of [{ cancelled_at: "2026-10-01T00:00:00Z" }, { voided_at: "2026-10-01T00:00:00Z" }]) {
      const p = period("2026-12-01", null, { ...o, assignments: [] });
      expect(periodCardActions(detail([p]), p, HR_ADMIN, null)).toEqual({ daily: [], correction: [], advanced: [] });
    }
  });
});

describe("Workflow surface", () => {
  it("only one workflow is open at a time: opening replaces the previous one", () => {
    const first = openWorkflow(null, "end_employment", { periodId: "e1" });
    const second = openWorkflow(first, "correct_assignment", { periodId: "e1", assignmentId: "a1" });
    expect(second).toEqual({ action: "correct_assignment", target: { periodId: "e1", assignmentId: "a1" }, n: first.n + 1 });
  });

  it("Drawer for multi-field workflows and long previews; Modal for short ones", () => {
    for (const a of ["change_assignment", "initial_assignment", "relationship_change", "rehire", "initial_employment", "correct_period", "correct_assignment", "end_employment", "void_period", "edit_personal", "correct_personal"] as const)
      expect(surfaceFor(a)).toBe("drawer");
    for (const a of ["edit_work_email", "correct_work_email", "clear_work_email", "cancel_planned", "reverse_end"] as const) expect(surfaceFor(a)).toBe("modal");
  });

  it("success closes the workflow and lands on the relevant tab", () => {
    expect(successTab("change_assignment")).toBe("assignment");
    expect(successTab("correct_assignment")).toBe("assignment");
    expect(successTab("end_employment")).toBe("employment");
    expect(successTab("void_period")).toBe("employment");
    expect(successTab("correct_personal")).toBe("personal");
  });

  it("closing: unchanged closes at once; changed asks and respects the answer", () => {
    let asked = 0;
    expect(shouldClose(false, () => (asked++, false))).toBe(true);
    expect(asked).toBe(0);
    expect(shouldClose(true, () => (asked++, false))).toBe(false);
    expect(shouldClose(true, () => (asked++, true))).toBe(true);
    expect(asked).toBe(2);
  });

  it("the correction explanation appears only on data corrections, never on business changes", () => {
    expect(["correct_period", "correct_work_email", "clear_work_email", "correct_assignment"].every((a) => isDataCorrection(a as never))).toBe(true);
    expect(["change_assignment", "end_employment", "relationship_change", "edit_work_email"].some((a) => isDataCorrection(a as never))).toBe(false);
  });
});

describe("Business wording in workflow forms", () => {
  const text = (o: unknown) => JSON.stringify(o);
  it("Change Assignment has no exclusive-boundary language", () => {
    expect(text(en.assignmentChange)).not.toMatch(/exclusive/i);
    expect(en.assignmentChange.impactClose).toMatch(/replaced/);
  });
  it("End Employment has no 'inclusive' and states the final date", () => {
    expect(text(en.endEmployment)).not.toMatch(/inclusive/i);
    expect(en.detail.endDate).toBe("End Date");
    expect(en.endEmployment.impactPeriod).toMatch(/final date of the Employment Period/);
  });
  it("Relationship Change and Rehire explain their effect; Manager label is consistent", () => {
    expect(en.relationshipChange.help).toMatch(/^This ends the current Employment Period and creates a new Employment Period/);
    expect(en.rehire.help).toMatch(/^Create a new Employment Period for this employee/);
    expect(text(en)).not.toMatch(/Line Manager/);
  });
  it("UI-9 code has no role-name checks", () => {
    for (const f of ["src/app/employees/[id]/WorkflowHost.tsx", "src/app/employees/[id]/workflowModel.ts", "src/app/employees/[id]/page.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});
