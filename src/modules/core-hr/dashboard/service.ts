// UI-1 Home / Action Center (PV-30, BD-H1 … BD-H9): one read-only summary for HR, built ONLY from shared Core HR
// semantics — no dashboard-specific status, completeness or lifecycle rule:
//   snapshot         → personProjection (the Employee List's status: representativeEmployment + employmentStatus)
//   needs attention  → personProjection's completenessView (the Employee List's operational_completeness)
//   upcoming         → employments/upcoming.ts (the Employee Detail Overview's Upcoming Changes)
// Operational periods (`operationalEmploymentWhere`) and operational assignments (`operationalAssignmentWhere`, PV-29)
// are filtered at load time, so cancelled / voided periods and cancelled planned assignments never reach any section.
// One business date (Asia/Ho_Chi_Minh) per request; one read snapshot; the whole response succeeds or fails.
import { OPERATIONAL_ITEM_CODES, type OperationalItemCode } from "@/contracts/core-hr/completeness-codes";
import type { CoreHrDashboard } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, todayInVietnam } from "@/lib/dates";
import { db, type Db, type Tx } from "@/lib/db";
import { forbidden } from "@/lib/http/errors";
import type { Principal } from "@/modules/identity/authenticate";
import { activeEndEventOf } from "../employments/lifecycle-events";
import { operationalAssignmentWhere, operationalEmploymentWhere } from "../employments/queries";
import { UPCOMING_KIND_ORDER, upcomingEvents, type UpcomingEvent } from "../employments/upcoming";
import { OPERATIONAL_RULE_VERSION } from "../people/completeness";
import { personProjection } from "../people/service";

export const UPCOMING_WINDOW_DAYS = 30;
export const NEEDS_ATTENTION_PREVIEW = 5;
export const UPCOMING_PREVIEW = 10;

const include = {
  employments: {
    where: operationalEmploymentWhere(),
    include: {
      employeeType: true,
      // Only what the Active End Event needs (end events and their reversals); never reasons or notes in the output.
      events: { where: { eventType: { in: ["end", "end_reversed"] } } },
      assignments: { where: operationalAssignmentWhere(), include: { department: true, jobTitle: true, jobLevel: true } },
    },
  },
};

/** Loads every person with operational periods / assignments (MVP scale: one query tree, no N+1). */
export function loadDashboardPeople(client: Db | Tx, personIds?: readonly string[]) {
  return client.person.findMany({
    where: personIds ? { id: { in: [...personIds] } } : {},
    orderBy: [{ employeeCode: "asc" }, { id: "asc" }],
    include,
  });
}
export type DashboardPerson = Awaited<ReturnType<typeof loadDashboardPeople>>[number];
type Assignment = DashboardPerson["employments"][number]["assignments"][number];
type EmployeeType = NonNullable<DashboardPerson["employments"][number]["employeeType"]>;

// BD-H5: Active → Pre-start (nearest start first) → no Employment Period → Ended; then employee code. Not a severity.
const STATUS_RANK: Record<string, number> = { active: 0, not_started: 1, no_employment: 2, ended: 3 };
type UpcomingItem = CoreHrDashboard["upcoming"]["items"][number];
const TYPE_RANK = (t: UpcomingItem["type"]) =>
  t === "employment_end" ? UPCOMING_KIND_ORDER.planned_end : t === "relationship_change" ? UPCOMING_KIND_ORDER.relationship_change : t === "assignment_change" ? UPCOMING_KIND_ORDER.assignment_change : UPCOMING_KIND_ORDER.period_start;

const typeRef = (t: EmployeeType | null) => (t ? { code: t.code, name: t.name } : null);
const assignmentRef = (a: Assignment | null) =>
  a ? { department: { code: a.department.code, name: a.department.name }, job_title: { code: a.jobTitle.code, name_en: a.jobTitle.nameEn } } : null;

/** Pure assembly of the response for a given business date (exported for tests with a pinned date). */
export function assembleDashboard(people: readonly DashboardPerson[], today: string): CoreHrDashboard {
  const to = addDays(today, UPCOMING_WINDOW_DAYS);
  const snapshot = { active: 0, not_started: 0, ended: 0 };
  const byRequirement = new Map<OperationalItemCode, number>();
  const attention: { rank: number; start: string; record: CoreHrDashboard["needs_attention"]["records"][number] }[] = [];
  const upcoming: UpcomingItem[] = [];

  for (const p of people) {
    const projection = personProjection(p, today);
    if (projection.status !== "no_employment") snapshot[projection.status] += 1;

    const missing = projection.completeness.items.filter((i) => !i.satisfied).map((i) => i.code);
    if (projection.completeness.status === "incomplete") {
      for (const code of missing) byRequirement.set(code, (byRequirement.get(code) ?? 0) + 1);
      attention.push({
        rank: STATUS_RANK[projection.status],
        start: projection.status === "not_started" ? (projection.startDate ?? "") : "",
        record: { person_id: p.id, employee_code: p.employeeCode, full_name: p.fullName, employment_status: projection.status, missing },
      });
    }

    const periods = p.employments.map((e) => ({
      id: e.id,
      startDate: fromDbDate(e.startDate)!,
      endDate: fromDbDate(e.endDate),
      employeeType: e.employeeType,
      activeEndReason: (() => {
        const end = activeEndEventOf(e.events);
        return end?.endReasonCode ? { code: end.endReasonCode } : null;
      })(),
      assignments: e.assignments.map((a) => ({ effectiveFrom: fromDbDate(a.effectiveFrom)!, a })),
    }));
    for (const ev of upcomingEvents(periods, today)) {
      const inWindow = ev.kind === "planned_end" ? ev.date >= today && ev.date <= to : ev.date > today && ev.date <= to;
      if (inWindow) upcoming.push(toItem(p, ev));
    }
  }

  attention.sort((a, b) => a.rank - b.rank || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || cmp(a.record.employee_code, b.record.employee_code) || cmp(a.record.person_id, b.record.person_id));
  upcoming.sort(
    (a, b) =>
      cmp(a.effective_date, b.effective_date) || TYPE_RANK(a.type) - TYPE_RANK(b.type) || cmp(a.employee_code, b.employee_code) || cmp(a.person_id, b.person_id),
  );

  return {
    status_as_of: today,
    snapshot,
    needs_attention: {
      total: attention.length,
      rule_version: OPERATIONAL_RULE_VERSION,
      by_requirement: OPERATIONAL_ITEM_CODES.filter((c) => byRequirement.has(c)).map((code) => ({ code, count: byRequirement.get(code)! })),
      records: attention.slice(0, NEEDS_ATTENTION_PREVIEW).map((a) => a.record),
    },
    upcoming: { window_days: UPCOMING_WINDOW_DAYS, from: today, to, total: upcoming.length, items: upcoming.slice(0, UPCOMING_PREVIEW) },
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toItem(p: DashboardPerson, ev: UpcomingEvent<Assignment, EmployeeType | null, { code: string }>): UpcomingItem {
  const base = { effective_date: ev.date, person_id: p.id, employee_code: p.employeeCode, full_name: p.fullName };
  const none = { employee_type: null, previous_employee_type: null, assignment: null, previous_assignment: null };
  switch (ev.kind) {
    case "period_start":
      return { ...base, ...none, type: ev.first ? "employment_start" : "new_employment_period_start", employee_type: typeRef(ev.employeeType), assignment: assignmentRef(ev.assignment) };
    case "relationship_change":
      return { ...base, ...none, type: "relationship_change", employee_type: typeRef(ev.toType), previous_employee_type: typeRef(ev.fromType), assignment: assignmentRef(ev.assignment) };
    case "assignment_change":
      return { ...base, ...none, type: "assignment_change", assignment: assignmentRef(ev.to), previous_assignment: assignmentRef(ev.from) };
    case "planned_end":
      return { ...base, ...none, type: "employment_end" };
  }
}

/** GET /api/v1/core-hr/dashboard — employees.read; `now` is injectable for business-date boundary tests. */
export async function getDashboard(principal: Principal, now: Date = new Date()): Promise<CoreHrDashboard> {
  if (!principal.permissions.has("employees.read")) throw forbidden();
  const today = todayInVietnam(now);
  // One consistent read snapshot for all sections (the nested relations are separate queries).
  const people = await db().$transaction((tx) => loadDashboardPeople(tx), { isolationLevel: "RepeatableRead" });
  return assembleDashboard(people, today);
}
