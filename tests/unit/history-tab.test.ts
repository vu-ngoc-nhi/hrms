import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { historyEntryTitle } from "@/app/employees/[id]/HistoryTab";
import { assignmentSections } from "@/app/employees/[id]/assignmentModel";
import { periodEligibility, type Assignment, type Detail, type HistoryEvent, type Period } from "@/app/employees/[id]/detailModel";
import { historyEntries, historyGroups, type HistoryKind } from "@/app/employees/[id]/historyModel";

// UI-7 History view model: business events from existing detail facts only, deterministic order, minimisation.
const TODAY = "2026-10-10";
const EMPLOYEE = { id: "t-emp", code: "EMPLOYEE", name: "Employee" };
const CONTRACTOR = { id: "t-sc", code: "SERVICE_CONTRACTOR", name: "Service Contractor" };
let seq = 0;
const asg = (from: string, to: string | null, o: Partial<Assignment> = {}): Assignment => ({
  id: `a${++seq}`,
  effective_from: from,
  effective_to: to,
  department: { id: "d-qa", name: "Quality Assurance" },
  job_title: { id: "j-qa", name_en: "QA Engineer" },
  job_level: null,
  manager: null,
  ...o,
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
    work_email: "secret.work@example.test",
    assignments: [asg(start, null)],
    ...o,
  };
}
function ended(start: string, end: string, code: string, o: Partial<Period> = {}): Period {
  return period(start, end, {
    events: [ev("start", start), ev("end", end, { end_reason: reason(code) })],
    has_active_end_event: true,
    active_end_event: { effective_date: end, end_reason: reason(code), previous_end_date: null, closed_assignment: null },
    ...o,
  });
}
const detail = (employments: Period[]): Detail => ({
  id: "p1",
  revision: 1,
  employee_code: "DEMO010",
  full_name: "Secret Full Name",
  employment_status: "active",
  status_as_of: TODAY,
  completeness: { operational: { status: "complete", rule_version: "r", items: [] } },
  personal: { gender: "female", date_of_birth: "1991-02-03", mobile_phone: "0909999999", personal_email: "secret.personal@example.test" },
  employments,
});
const kinds = (d: Detail) => historyEntries(d).map((e) => [e.date, e.kind, e.status] as const);

describe("Taxonomy and deterministic order", () => {
  it("simple start: Employment started then Assignment added on the same date (lifecycle order)", () => {
    expect(kinds(detail([period("2020-03-02", null)]))).toEqual([
      ["2020-03-02", "employment_started", null],
      ["2020-03-02", "assignment_added", null],
    ]);
  });

  it("groups are most recent first; within a date the lifecycle order is kept", () => {
    const p = period("2024-01-08", null, { assignments: [asg("2024-01-08", "2025-03-01"), asg("2025-03-01", null, { department: { id: "d-eng", name: "Engineering" } })] });
    const groups = historyGroups(historyEntries(detail([p])));
    expect(groups.map((g) => g.date)).toEqual(["2025-03-01", "2024-01-08"]);
    expect(groups[1].entries.map((e) => e.kind)).toEqual(["employment_started", "assignment_added"]);
  });

  it("assignment change lists only changed fields, compared within the period", () => {
    const p = period("2023-03-06", null, {
      assignments: [asg("2023-03-06", "2026-04-01"), asg("2026-04-01", null, { department: { id: "d-eng", name: "Engineering" }, job_title: { id: "j-se", name_en: "Software Engineer" } })],
    });
    const change = historyEntries(detail([p])).find((e) => e.kind === "assignment_changed")!;
    expect(change.changes).toEqual([
      { field: "department", from: "Quality Assurance", to: "Engineering" },
      { field: "job_title", from: "QA Engineer", to: "Software Engineer" },
    ]);
  });

  it("planned End and future assignment are marked Planned", () => {
    const p = ended("2024-01-08", "2026-11-30", "VOLUNTARY_RESIGNATION", { assignments: [asg("2024-01-08", "2026-11-01"), asg("2026-11-01", null, { job_level: { id: "l", code: "L2", name: "Middle" } })] });
    expect(kinds(detail([p])).filter(([, , s]) => s === "planned")).toEqual([
      ["2026-11-01", "assignment_changed", "planned"],
      ["2026-11-30", "employment_ended", "planned"],
    ]);
  });
});

describe("Recovery, Rehire and Relationship Change", () => {
  it("End + Reverse End: the old End stays, marked Reversed, followed by 'End reversed' on the same date", () => {
    const end = ev("end", "2026-12-31", { end_reason: reason("OTHER") });
    const p = period("2025-01-06", null, { events: [ev("start", "2025-01-06"), end, ev("end_reversed", "2026-12-31", { reverses_event_id: end.id })] });
    expect(kinds(detail([p])).filter(([d]) => d === "2026-12-31")).toEqual([
      ["2026-12-31", "employment_ended", "reversed"],
      ["2026-12-31", "end_reversed", null],
    ]);
    const reversedEnd = historyEntries(detail([p])).find((x) => x.kind === "employment_ended")!;
    expect(historyEntryTitle(reversedEnd)).toBe("Employment scheduled to end"); // tense follows the date, not the badge
  });

  it("a later period (e.g. after Rehire) is a neutral 'New Employment Period started' — Rehire is never inferred", () => {
    const e = historyEntries(detail([ended("2021-03-01", "2024-06-30", "VOLUNTARY_RESIGNATION"), period("2025-03-03", null)]));
    const later = e.find((x) => x.kind === "new_period_started")!;
    expect(later).toMatchObject({ date: "2025-03-03", periodNumber: 2, previousEnd: "2024-06-30" });
    expect(historyEntryTitle(later)).toBe("New Employment Period started");
    expect(e.map((x) => historyEntryTitle(x)).join(" ")).not.toMatch(/rehire/i);
    expect(e.find((x) => x.kind === "employment_ended")).toMatchObject({ periodNumber: 1, date: "2024-06-30" });
  });

  it("Relationship Change: one entry (no separate end/start); assignments not compared across periods", () => {
    const pred = ended("2025-02-03", "2026-01-04", "RELATIONSHIP_CHANGE", { employee_type: CONTRACTOR });
    const succ = period("2026-01-05", null);
    const e = historyEntries(detail([pred, succ]));
    expect(e.filter((x) => x.kind === "employment_ended" || x.kind === "employment_started" || x.kind === "new_period_started")).toEqual([
      expect.objectContaining({ kind: "employment_started", periodNumber: 1 }),
    ]);
    expect(e.find((x) => x.kind === "relationship_changed")).toMatchObject({ date: "2026-01-05", fromType: "Service Contractor", toType: "Employee", previousEnd: "2026-01-04", periodNumber: 2 });
    expect(e.filter((x) => x.kind === "assignment_added").map((x) => x.periodNumber)).toEqual([1, 2]);
  });

  it("a Relationship Change whose new period was cancelled stays an End plus a cancelled period (no guessing)", () => {
    const pred = ended("2026-10-05", "2026-10-29", "RELATIONSHIP_CHANGE");
    const cancelled = period("2026-10-30", null, { cancelled_at: "2026-10-08T00:00:00Z", events: [ev("start", "2026-10-30"), ev("cancel_planned_start", "2026-10-30")], assignments: [] });
    const e = historyEntries(detail([pred, cancelled]));
    expect(e.map((x) => x.kind)).not.toContain("relationship_changed");
    expect(e.find((x) => x.kind === "employment_ended")).toMatchObject({ status: "planned" });
    expect(e.filter((x) => x.kind === "period_cancelled")).toHaveLength(1);
  });
});

describe("Cancelled and Voided", () => {
  it("Cancelled: one 'Planned Employment Period cancelled' entry at the planned start, never 'ended'", () => {
    const c = period("2026-12-01", "2027-06-30", { cancelled_at: "2026-10-01T00:00:00Z", events: [ev("start", "2026-12-01"), ev("cancel_planned_start", "2026-12-01")] });
    const e = historyEntries(detail([period("2026-01-05", null), c])).filter((x) => x.periodNumber === 2);
    expect(e.map((x) => [x.kind, x.status])).toEqual([
      ["assignment_added", "cancelled"],
      ["period_cancelled", null],
    ]);
    expect(e.find((x) => x.kind === "period_cancelled")).toMatchObject({ date: "2026-12-01", plannedEnd: "2027-06-30" });
  });

  it("Voided: original evidence kept and decorated Voided, plus 'Employment Period voided'", () => {
    const v = period("2026-03-02", null, { voided_at: "2026-10-05T00:00:00Z", events: [ev("start", "2026-03-02"), ev("employment_voided", "2026-03-02")] });
    expect(kinds(detail([v]))).toEqual([
      ["2026-03-02", "employment_started", "voided"],
      ["2026-03-02", "assignment_added", "voided"],
      ["2026-03-02", "period_voided", null],
    ]);
  });

  it("D-UI-15: assignments of cancelled / voided periods stay visible but are never Current, Upcoming or mutation targets", () => {
    const can = (p: string) => ["employment.manage", "employment.correct"].includes(p);
    const c = period("2026-12-01", null, { cancelled_at: "2026-10-01T00:00:00Z" });
    const v = period("2025-01-01", null, { voided_at: "2026-10-01T00:00:00Z" });
    const d = detail([v, period("2026-01-05", null), c]);
    const s = assignmentSections(d);
    expect(s.notOperational.map((x) => x.disposition)).toEqual(["voided", "cancelled"]);
    expect([...s.current, ...s.upcoming].every((x) => x.disposition === null)).toBe(true);
    for (const p of [c, v]) expect(Object.values(periodEligibility(d, p, can)).some(Boolean)).toBe(false);
    expect(historyEntries(d).filter((e) => e.kind.startsWith("assignment") && e.status !== null).map((e) => e.status)).toEqual(["voided", "cancelled"]);
  });
});

describe("Privacy and wording", () => {
  it("never carries personal data, Work Email or full-name values (minimisation)", () => {
    const d = detail([ended("2021-03-01", "2024-06-30", "VOLUNTARY_RESIGNATION"), period("2025-03-03", null)]);
    const json = JSON.stringify(historyEntries(d));
    for (const secret of ["secret.work@example.test", "secret.personal@example.test", "0909999999", "1991-02-03", "Secret Full Name", "female"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("every title is business language from the catalogue (no technical codes)", () => {
    const all: HistoryKind[] = ["employment_started", "new_period_started", "relationship_changed", "employment_ended", "end_reversed", "period_cancelled", "period_voided", "assignment_added", "assignment_changed", "other"];
    for (const kind of all) {
      for (const status of [null, "planned"] as const) {
        const label = historyEntryTitle({ key: "k", date: TODAY, kind, status, future: status === "planned", periodNumber: 1, periodType: null, eventType: "suspend_unknown_code" });
        expect(label).not.toMatch(/_|^[a-z]+\.[a-z]/);
        expect(label.length).toBeGreaterThan(3);
      }
    }
  });

  it("History code never checks role names", () => {
    for (const f of ["src/app/employees/[id]/HistoryTab.tsx", "src/app/employees/[id]/historyModel.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});
