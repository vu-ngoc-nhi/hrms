import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_HREF,
  columnHeight,
  departmentChart,
  donutSegments,
  employeeTypeChart,
  greeting,
  greetingPart,
  homeCapabilities,
  NEEDS_ATTENTION_HREF,
  needsAttentionView,
  snapshotView,
  statusLinks,
  summaryCards,
  upcomingRow,
  upcomingView,
  type Dashboard,
} from "@/app/homeModel";
import { OPERATIONAL_ITEM_CODES } from "@/contracts/core-hr/completeness-codes";
import { UPCOMING_EVENT_TYPES } from "@/contracts/core-hr/schemas";
import { formatDayMonth } from "@/i18n";
import { en } from "@/i18n/messages/en";

// UI-1 Home / Action Center (PV-30): presentation of the dashboard's machine codes only.
const ENG = { department: { code: "ENG", name: "Engineering" }, job_title: { code: "SE", name_en: "Software Engineer" } };
const QA = { department: { code: "QA", name: "Quality Assurance" }, job_title: { code: "QAE", name_en: "QA Engineer" } };
const EMP = { code: "EMPLOYEE", name: "Employee" };
const SC = { code: "SERVICE_CONTRACTOR", name: "Service Contractor" };
const none = { employee_type: null, previous_employee_type: null, assignment: null, previous_assignment: null };
type Item = Dashboard["upcoming"]["items"][number];
const item = (o: Partial<Item> & Pick<Item, "type" | "effective_date">): Item => ({ person_id: "p1", employee_code: "ES0001", full_name: "Nguyễn Minh Anh", ...none, ...o });
const dashboard = (o: Partial<Dashboard> = {}): Dashboard => ({
  status_as_of: "2026-10-11",
  snapshot: { active: 61, not_started: 3, ended: 14 },
  needs_attention: { total: 0, rule_version: "operational-mvp-2026-10-08.2", by_requirement: [], records: [] },
  upcoming: { window_days: 30, from: "2026-10-11", to: "2026-11-10", total: 0, items: [] },
  workforce: {
    total: 61,
    by_department: [
      { department: { id: "d-eng", code: "ENG", name: "Engineering" }, count: 50 },
      { department: { id: "d-qa", code: "QA", name: "Quality Assurance" }, count: 9 },
      { department: null, count: 2 },
    ],
    by_employee_type: [
      { employee_type: { id: "t-emp", code: "EMPLOYEE", name: "Employee" }, count: 55 },
      { employee_type: { id: "t-sc", code: "SERVICE_CONTRACTOR", name: "Service Contractor" }, count: 6 },
    ],
    on_leave: null,
  },
  ...o,
});

describe("Workforce Snapshot", () => {
  it("three metrics with status labels (never Headcount) linking to the canonical list status filter", () => {
    expect(snapshotView(dashboard()).map((m) => [m.label, m.count, m.href])).toEqual([
      ["Active", 61, "/employees?employment_status=active"],
      ["Pre-start", 3, "/employees?employment_status=not_started"],
      ["Ended", 14, "/employees?employment_status=ended"],
    ]);
    expect(JSON.stringify(en.home)).not.toMatch(/headcount/i);
    expect(en.home.snapshotTitle).toBe("Workforce Snapshot");
  });
});

describe("Needs Attention", () => {
  it("healthy state is positive; no View all", () => {
    const v = needsAttentionView(dashboard());
    expect(v).toMatchObject({ healthy: true, viewAll: null, records: [], breakdown: [] });
    expect(en.home.needsHealthy).toBe("No records need attention.");
  });

  it("populated: requirement labels from the catalogue, records link to Employee Detail, View all = canonical list filter", () => {
    const v = needsAttentionView(
      dashboard({
        needs_attention: {
          total: 2,
          rule_version: "r",
          by_requirement: [
            { code: "work_email", count: 2 },
            { code: "department", count: 1 },
          ],
          records: [{ person_id: "p9", employee_code: "ES0035", full_name: "Trần Thu Hà", employment_status: "not_started", missing: ["department", "job_title"] }],
        },
      }),
    );
    expect(v.breakdown.map((b) => `${b.label} ${b.count}`)).toEqual(["Work Email 2", "Department 1"]);
    expect(v.records[0]).toMatchObject({ href: "/employees/p9", missing: "Department, Job Title", status: "not_started" });
    expect(v.viewAll).toBe("/employees?operational_completeness=incomplete");
    expect(NEEDS_ATTENTION_HREF).toBe("/employees?operational_completeness=incomplete");
  });

  it("every authoritative requirement code has a label (no raw code reaches the UI)", () => {
    for (const code of OPERATIONAL_ITEM_CODES) expect(en.completeness.items[code], code).toBeTruthy();
  });
});

describe("Upcoming", () => {
  it("keeps the server's order and dates; links to the relevant Employee Detail tab", () => {
    const v = upcomingView(
      dashboard({
        upcoming: {
          window_days: 30,
          from: "2026-10-11",
          to: "2026-11-10",
          total: 2,
          items: [
            item({ type: "employment_end", effective_date: "2026-10-31" }),
            item({ type: "assignment_change", effective_date: "2026-11-01", person_id: "p2", assignment: ENG, previous_assignment: QA }),
          ],
        },
      }),
    );
    expect(v.rows.map((r) => [r.date, r.title, r.detail, r.href])).toEqual([
      ["2026-10-31", "Employment scheduled to end", "Last day of employment", "/employees/p1?tab=employment"],
      ["2026-11-01", "Assignment change", "Quality Assurance / QA Engineer → Engineering / Software Engineer", "/employees/p2?tab=assignment"],
    ]);
    expect(v.overflow).toBeNull();
  });

  it("assignment change shows only what changes (QA → Engineering); a later first assignment says it takes effect", () => {
    const deptOnly = { department: ENG.department, job_title: QA.job_title };
    expect(upcomingRow(item({ type: "assignment_change", effective_date: "2026-11-01", assignment: deptOnly, previous_assignment: QA })).detail).toBe("Quality Assurance → Engineering");
    expect(upcomingRow(item({ type: "assignment_change", effective_date: "2026-11-01", assignment: QA, previous_assignment: null })).title).toBe("Assignment takes effect");
  });

  it("Relationship Change is one item with previous → new Employee Type; a later period is neutral (never Rehire)", () => {
    const rc = upcomingRow(item({ type: "relationship_change", effective_date: "2026-11-05", employee_type: SC, previous_employee_type: EMP }));
    expect([rc.title, rc.detail]).toEqual(["Employment relationship changes", "Employee → Service Contractor"]);
    const np = upcomingRow(item({ type: "new_employment_period_start", effective_date: "2026-11-07", employee_type: EMP, assignment: QA }));
    expect([np.title, np.detail]).toEqual(["New Employment Period starts", "Employee · Quality Assurance / QA Engineer"]);
    expect(JSON.stringify(en.home)).not.toMatch(/rehire/i);
  });

  it("every event type has a label; there is no cancelled-assignment event type", () => {
    for (const type of UPCOMING_EVENT_TYPES) expect(en.home.event[type], type).toBeTruthy();
    expect(UPCOMING_EVENT_TYPES.some((t) => /cancel/.test(t))).toBe(false);
  });

  it("more than 10: 'Showing 10 of 14 upcoming changes', no View all link; empty state", () => {
    const items = [...Array(10)].map((_, i) => item({ type: "employment_end", effective_date: `2026-10-${String(12 + i).padStart(2, "0")}`, person_id: `p${i}` }));
    const v = upcomingView(dashboard({ upcoming: { window_days: 30, from: "2026-10-11", to: "2026-11-10", total: 14, items } }));
    expect(v.overflow).toBe("Showing 10 of 14 upcoming changes");
    expect(upcomingView(dashboard()).empty).toBe(true);
    expect(en.home.upcoming.empty).toBe("No upcoming changes in the next 30 days.");
    expect(readFileSync("src/app/page.tsx", "utf8")).not.toMatch(/upcoming[^\n]*href=|\/upcoming/);
  });
});

describe("Shell, permissions and scope", () => {
  it("Home needs employees.read; the nav item is live (no 'Soon'); no role-name checks", () => {
    expect(homeCapabilities((p) => p === "employees.read").read).toBe(true);
    expect(homeCapabilities(() => false).read).toBe(false);
    const shell = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(shell).toMatch(/key: "home", href: "\/", label: t\("nav\.home"\), icon: <IconHome \/>, show: session\?\.can\("employees\.read"\)/);
    expect(shell).not.toMatch(/homeSoon|nav-soon/);
    for (const f of ["src/app/page.tsx", "src/app/homeModel.ts", "src/components/AppShell.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\.includes|hasRole/);
    }
  });

  it("no chart library, score or scanner; charts are drawn from server counts only", () => {
    const pkg = readFileSync("package.json", "utf8");
    expect(pkg).not.toMatch(/chart|recharts|d3|visx/i);
    for (const f of ["src/app/page.tsx", "src/app/WorkforceCharts.tsx"]) {
      const code = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\{\/\*)/.test(l))
        .join("\n");
      expect(code, f).not.toMatch(/integrity|score|percent|employmentStatus\(|representative/i);
    }
  });
});

describe("Visual refresh (owner-approved post-freeze refinement, 2026-10-12)", () => {
  it("greeting uses the signed-in display name and the viewer's local hour; neutral fallback before either is known", () => {
    expect([greetingPart(0), greetingPart(11), greetingPart(12), greetingPart(17), greetingPart(18), greetingPart(23)]).toEqual(["morning", "morning", "afternoon", "afternoon", "evening", "evening"]);
    expect(greeting("Lê Thị Nhung", 9)).toBe("Good morning, Lê Thị Nhung");
    expect(greeting("Lê Thị Nhung", null)).toBe("Welcome to Eme People");
    expect(greeting(undefined, 15)).toBe("Welcome to Eme People");
  });

  it("summary cards (owner-approved refresh): Total Employees = Active, Active, On Leave unavailable, Needs Attention", () => {
    const d = dashboard({ needs_attention: { total: 4, rule_version: "r", by_requirement: [], records: [] } });
    expect(summaryCards(d).map((c) => [c.label, c.count, c.href, c.hint])).toEqual([
      ["Total Employees", 61, "/employees?employment_status=active", "Active employees only"],
      ["Active", 61, "/employees?employment_status=active", "View in Employee List"],
      ["On Leave", null, null, "Not available yet"], // "—", not a link, never 0
      ["Needs Attention", 4, "/employees?operational_completeness=incomplete", "Review records"],
    ]);
    expect(ACTIVE_HREF).toBe("/employees?employment_status=active");
    expect(summaryCards(d).every((c) => c.trend === null)).toBe(true); // no trend data: no fake growth
    expect(summaryCards(dashboard()).at(-1)).toMatchObject({ count: 0, href: null });
  });

  it("Pre-start and Ended stay reachable as subdued links (no summary cards)", () => {
    expect(statusLinks(dashboard()).map((l) => [l.label, l.count, l.href])).toEqual([
      ["Pre-start", 3, "/employees?employment_status=not_started"],
      ["Ended", 14, "/employees?employment_status=ended"],
    ]);
  });

  it("timeline rows carry the server event type and a time-zone-free day / month block", () => {
    expect(upcomingRow(item({ type: "employment_end", effective_date: "2026-11-02" })).type).toBe("employment_end");
    expect(formatDayMonth("2026-11-02")).toEqual({ day: "02", month: "Nov" });
    expect(formatDayMonth("2026-09-30")).toEqual({ day: "30", month: "Sep" });
  });

  it("no unapproved Phase 2 content, fake trends or totals on Home", () => {
    // The only approved Phase 2 addition is the Contract Attention section (C-108, slice 2A-4 / C-113), mounted once
    // behind contracts.read; everything else stays as frozen in C-101 / C-102.
    const code = readFileSync("src/app/page.tsx", "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n")
      .replace('import { ContractAttention } from "./ContractAttention";', "")
      .replace('{session?.can("contracts.read") && <ContractAttention />}', "");
    // Owner-approved refresh: Total Employees (= Active) and an On Leave placeholder; still no payroll, recruitment,
    // performance or turnover content and no trend values (trend slots render "—" only).
    expect(code).not.toMatch(/payroll|contract|recruit|performance|turnover|headcount|wfh/i);
    expect(JSON.stringify(en.home)).not.toMatch(/turnover|this month|vs last month|growth/i);
    expect(en.home.card.total).toBe("Total Employees");
    expect(en.home.unavailableNote).toBe("— means the data is not available yet.");
    expect(en.home.needsNote).toContain("Record Health");
  });
});

describe("Workforce charts (owner-approved Home refresh)", () => {
  it("Employees by Department: server groups as-is, Not assigned kept (not a link), real values link to the Active list filter", () => {
    const c = departmentChart(dashboard());
    expect(c.total).toBe(61);
    expect(c.items.map((i) => [i.label, i.count, i.href, i.color])).toEqual([
      ["Engineering", 50, "/employees?employment_status=active&department_id=d-eng", "chart-1"],
      ["Quality Assurance", 9, "/employees?employment_status=active&department_id=d-qa", "chart-2"],
      ["Not assigned", 2, null, "chart-none"],
    ]);
    expect(c.items.reduce((a, i) => a + i.count, 0)).toBe(c.total);
  });
  it("Employee Type (not Employment Status): actual catalog values only", () => {
    const c = employeeTypeChart(dashboard());
    expect(c.items.map((i) => [i.label, i.count, i.href])).toEqual([
      ["Employee", 55, "/employees?employment_status=active&employee_type_id=t-emp"],
      ["Service Contractor", 6, "/employees?employment_status=active&employee_type_id=t-sc"],
    ]);
    expect(en.home.chart.typeTitle).toBe("Employee Type");
    expect(JSON.stringify(en.home.chart)).not.toMatch(/Official|Probation|Employment Status/);
  });
  it("geometry only: donut arcs cover the circle in server order; columns scale to the largest group; zero data draws nothing", () => {
    const c = departmentChart(dashboard());
    const segs = donutSegments(c.items, c.total);
    expect(segs.map((s) => Math.round(s.offset * 100) / 100)).toEqual([0, 81.97, 96.72]);
    expect(Math.round(segs.reduce((a, s) => a + s.length, 0))).toBe(100);
    expect(columnHeight(55, employeeTypeChart(dashboard()).items)).toBe(100);
    expect(donutSegments([], 0)).toEqual([]);
    expect(columnHeight(0, [])).toBe(0);
    expect(en.home.chart.empty).toBe("No active employees on this date.");
    expect(en.home.chart.asOf).toBe("Active employees as of {date}");
  });
  it("percentages are not shown: the legend shows the count and '(—)'", () => {
    const src = readFileSync("src/app/WorkforceCharts.tsx", "utf8");
    expect(src).toContain("(—)");
    expect(src).not.toMatch(/toFixed|%\)/);
  });
});
