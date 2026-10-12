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

/** Summary cards: the three snapshot statuses plus Needs Attention, each linking only to an existing list filter. */
export function summaryCards(d: Dashboard) {
  const needs = d.needs_attention.total;
  return [
    ...snapshotView(d).map((m) => ({ key: m.status, tone: m.status, label: m.label, count: m.count, href: m.href, hint: t("home.cardHint.employees") })),
    { key: "needs_attention", tone: "attention", label: t("home.needsTitle"), count: needs, href: needs > 0 ? NEEDS_ATTENTION_HREF : null, hint: t("home.cardHint.review") },
  ];
}

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
