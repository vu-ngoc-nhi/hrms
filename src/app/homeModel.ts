// UI-1 Home / Action Center view model (PV-30). Pure presentation of `GET /api/v1/core-hr/dashboard`: the server decides
// every number, status, requirement and upcoming change; this only maps machine codes to catalogue labels and builds
// canonical Employee List / Employee Detail links. No business rule and no browser-local date logic lives here.
import type { OperationalItemCode } from "@/contracts/core-hr/completeness-codes";
import type { CoreHrDashboard } from "@/contracts/core-hr/schemas";
import { t } from "@/i18n";
import { EMPTY_FILTERS, queryFromFilters } from "./employees/listQuery";

export type Dashboard = CoreHrDashboard;
type UpcomingItem = Dashboard["upcoming"]["items"][number];
type AssignmentRef = NonNullable<UpcomingItem["assignment"]>;

/** Home is shown with employees.read (server-enforced as well); never by role name. */
export const homeCapabilities = (can: (permission: string) => boolean) => ({ read: can("employees.read"), addEmployee: can("employees.create") });

/** Canonical Employee List URLs (the list's own URL format; no Home-only filters). */
const listHref = (filters: Partial<typeof EMPTY_FILTERS>) => `/employees${queryFromFilters({ ...EMPTY_FILTERS, ...filters }, 1)}`;
export const NEEDS_ATTENTION_HREF = listHref({ operational_completeness: "incomplete" });

export const SNAPSHOT_METRICS = ["active", "not_started", "ended"] as const;
export type SnapshotMetric = (typeof SNAPSHOT_METRICS)[number];

export function snapshotView(d: Dashboard) {
  return SNAPSHOT_METRICS.map((status) => ({
    status,
    label: t(`employmentStatus.${status}`),
    count: d.snapshot[status],
    href: listHref({ employment_status: status }),
  }));
}

/** Greeting by the viewer's local hour — presentation only, never a business date. */
export type GreetingPart = "morning" | "afternoon" | "evening";
export const greetingPart = (hour: number): GreetingPart => (hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening");

export function greeting(name: string | null | undefined, hour: number | null): string {
  const display = name?.trim();
  if (!display || hour === null) return t("home.greetingNoName");
  return t(`home.greeting.${greetingPart(hour)}`, { name: display });
}

export const ACTIVE_HREF = listHref({ employment_status: "active" });

/**
 * Summary cards (owner-approved Home refresh): Total Employees, Active, On Leave, Needs Attention.
 * Total Employees IS Active (people whose current Employment Status is Active, each once) — the server's
 * workforce.total — so both cards open the Active Employee List. On Leave has no data yet: `count: null` renders "—",
 * the card is not a link and never shows 0. `trend` is a reserved slot; null = not available (rendered "—", no arrows).
 */
export type SummaryCard = { key: string; tone: string; label: string; count: number | null; href: string | null; hint: string; trend: null };
export function summaryCards(d: Dashboard): SummaryCard[] {
  const needs = d.needs_attention.total;
  return [
    { key: "total", tone: "total", label: t("home.card.total"), count: d.workforce.total, href: ACTIVE_HREF, hint: t("home.card.totalHint"), trend: null },
    { key: "active", tone: "active", label: t("employmentStatus.active"), count: d.snapshot.active, href: ACTIVE_HREF, hint: t("home.cardHint.employees"), trend: null },
    { key: "on_leave", tone: "unavailable", label: t("home.card.onLeave"), count: d.workforce.on_leave, href: null, hint: t("home.notAvailable"), trend: null },
    { key: "needs_attention", tone: "attention", label: t("home.needsTitle"), count: needs, href: needs > 0 ? NEEDS_ATTENTION_HREF : null, hint: t("home.cardHint.review"), trend: null },
  ];
}

/** Pre-start and Ended stay reachable (subdued links to the canonical list filters), without summary cards. */
export const statusLinks = (d: Dashboard) =>
  snapshotView(d)
    .filter((m) => m.status !== "active")
    .map((m) => ({ key: m.status, label: m.label, count: m.count, href: m.href }));

// ---- Workforce charts (Active people only; numbers from the server's workforce block) ----------------------------
export const CHART_COLORS = 8;
export type ChartItem = { key: string; label: string; count: number; href: string | null; color: string; unassigned: boolean };

function chartItems(groups: { ref: { id: string; name: string } | null; count: number }[], filter: "department_id" | "employee_type_id"): ChartItem[] {
  let palette = 0;
  return groups.map((g) => ({
    key: g.ref?.id ?? "not-assigned",
    label: g.ref?.name ?? t("home.chart.notAssigned"),
    count: g.count,
    // A real catalog value opens the matching Active Employee List filter (same rules, so the list shows this count);
    // "Not assigned" has no list filter, so it is not a link.
    href: g.ref ? listHref({ employment_status: "active", [filter]: g.ref.id }) : null,
    color: g.ref ? `chart-${(palette++ % CHART_COLORS) + 1}` : "chart-none",
    unassigned: g.ref === null,
  }));
}

export function departmentChart(d: Dashboard) {
  return { total: d.workforce.total, asOf: d.status_as_of, items: chartItems(d.workforce.by_department.map((g) => ({ ref: g.department, count: g.count })), "department_id") };
}
export function employeeTypeChart(d: Dashboard) {
  return { total: d.workforce.total, asOf: d.status_as_of, items: chartItems(d.workforce.by_employee_type.map((g) => ({ ref: g.employee_type, count: g.count })), "employee_type_id") };
}

/** Donut geometry only (arc lengths on a 100-unit circle); the counts are the server's. */
export function donutSegments(items: ChartItem[], total: number) {
  let offset = 0;
  return items.map((i) => {
    const length = total > 0 ? (i.count / total) * 100 : 0;
    const seg = { key: i.key, color: i.color, length, offset };
    offset += length;
    return seg;
  });
}

/** Column heights relative to the largest group (geometry only). */
export const columnHeight = (count: number, items: ChartItem[]) => {
  const max = Math.max(0, ...items.map((i) => i.count));
  return max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
};

export const requirementLabel = (code: OperationalItemCode) => t(`completeness.items.${code}`);

export function needsAttentionView(d: Dashboard) {
  const n = d.needs_attention;
  return {
    total: n.total,
    healthy: n.total === 0,
    breakdown: n.by_requirement.map((r) => ({ code: r.code, label: requirementLabel(r.code), count: r.count })),
    records: n.records.map((r) => ({
      personId: r.person_id,
      href: `/employees/${r.person_id}`,
      name: r.full_name,
      code: r.employee_code,
      status: r.employment_status,
      missing: r.missing.map(requirementLabel).join(", "),
    })),
    viewAll: n.total > 0 ? NEEDS_ATTENTION_HREF : null,
  };
}

const assignmentText = (a: AssignmentRef) => `${a.department.name} / ${a.job_title.name_en}`;

/** "QA → Engineering": only the parts that change (Department, Job Title); Level / Manager are not part of Home. */
function changeText(from: AssignmentRef | null, to: AssignmentRef): string {
  if (!from) return assignmentText(to);
  const dept = from.department.code !== to.department.code;
  const title = from.job_title.code !== to.job_title.code;
  if (dept && title) return `${assignmentText(from)} → ${assignmentText(to)}`;
  if (dept) return `${from.department.name} → ${to.department.name}`;
  if (title) return `${from.job_title.name_en} → ${to.job_title.name_en}`;
  return t("home.upcoming.otherChange");
}

export function upcomingRow(i: UpcomingItem) {
  const tab = i.type === "assignment_change" ? "assignment" : "employment";
  let title: string;
  let detail: string | null;
  switch (i.type) {
    case "employment_start":
    case "new_employment_period_start":
      title = t(i.type === "employment_start" ? "home.event.employment_start" : "home.event.new_employment_period_start");
      detail = [i.employee_type?.name, i.assignment ? assignmentText(i.assignment) : null].filter(Boolean).join(" · ") || null;
      break;
    case "relationship_change":
      title = t("home.event.relationship_change");
      detail = `${i.previous_employee_type?.name ?? "—"} → ${i.employee_type?.name ?? "—"}`;
      break;
    case "employment_end":
      title = t("home.event.employment_end");
      detail = t("home.upcoming.lastDay");
      break;
    case "assignment_change":
      title = t(i.previous_assignment ? "home.event.assignment_change" : "home.event.assignment_first");
      detail = changeText(i.previous_assignment, i.assignment!);
      break;
  }
  return { key: `${i.type}-${i.person_id}-${i.effective_date}`, type: i.type, date: i.effective_date, href: `/employees/${i.person_id}?tab=${tab}`, name: i.full_name, code: i.employee_code, title, detail };
}

export function upcomingView(d: Dashboard) {
  const u = d.upcoming;
  return {
    rows: u.items.map(upcomingRow),
    empty: u.total === 0,
    // No Upcoming module in Phase 1 (BD-H8): say how many exist, never link to a list that does not exist.
    overflow: u.total > u.items.length ? t("home.upcoming.showing", { shown: u.items.length, total: u.total }) : null,
  };
}
