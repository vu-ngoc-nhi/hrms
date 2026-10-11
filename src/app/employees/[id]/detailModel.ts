// Employee Detail view model (UI-3). Pure derivations from the existing Employee Detail response only — no new
// business rule, no API call. Representative period / assignment use the same shared functions as the Employee List
// and completeness (C-76, C-78); dispositions (Cancelled, Voided) are never operational (PV-25, C-86); completeness is
// taken from the API as is (never re-computed here).
import { representativeAssignment, representativeEmployment } from "@/modules/core-hr/employments/status";
import { upcomingEvents } from "@/modules/core-hr/employments/upcoming";

export type Ref = { id: string; code: string; name: string } | null;
export type Assignment = {
  id: string;
  effective_from: string;
  effective_to: string | null;
  department: { id: string; name: string };
  job_title: { id: string; name_en: string };
  job_level: Ref;
  manager: { person_id: string; employee_code: string; full_name: string } | null;
  /** PV-29: set when this planned assignment was cancelled before it took effect (history only, never operational). */
  cancelled_at?: string | null;
};
export type HistoryEvent = {
  id: string;
  event_type: string;
  effective_date: string;
  recorded_at: string;
  end_reason: { code: string; label: string } | null;
  reverses_event_id: string | null;
};
export type Period = {
  id: string;
  start_date: string;
  end_date: string | null;
  period_lifecycle: string | null;
  events: HistoryEvent[];
  has_active_end_event: boolean;
  active_end_event: {
    effective_date: string;
    end_reason: { code: string; label: string } | null;
    previous_end_date: string | null;
    closed_assignment: { id: string; previous_effective_to: string | null } | null;
  } | null;
  cancelled_at: string | null;
  voided_at: string | null;
  employee_type: Ref;
  work_email: string | null;
  assignments: Assignment[];
};
export type Detail = {
  id: string;
  revision: number;
  employee_code: string;
  full_name: string;
  employment_status: string;
  status_as_of: string;
  completeness: {
    operational: { status: "complete" | "incomplete"; rule_version: string; items: { code: string; satisfied: boolean }[] };
  };
  personal?: { gender: string | null; date_of_birth: string | null; personal_email: string | null; mobile_phone: string | null };
  employments: Period[];
};

// Record dispositions (C-29 Cancelled, PV-25 Voided): history only, never operational, read-only.
export const isDisposed = (p: Period) => Boolean(p.cancelled_at || p.voided_at);
export const operationalPeriods = (d: Detail) => d.employments.filter((p) => !isDisposed(p));
// PV-29: a cancelled planned assignment is history only — never current, upcoming, representative or a timeline row.
export const isCancelledAssignment = (a: Assignment) => Boolean(a.cancelled_at);
export const liveAssignments = (p: Period) => p.assignments.filter((a) => !isCancelledAssignment(a));

/** Latest operational period by start date (decides Rehire vs Add Initial Employment Period, S4.8). */
export function latestPeriod(d: Detail): Period | null {
  return operationalPeriods(d).reduce<Period | null>((a, p) => (a === null || p.start_date >= a.start_date ? p : a), null);
}

/** The representative operational period: active, else nearest upcoming, else most recently ended (shared rule). */
export function representativePeriod(d: Detail): Period | null {
  const wrapped = operationalPeriods(d).map((p) => ({ startDate: p.start_date, endDate: p.end_date, p }));
  return representativeEmployment(wrapped, d.status_as_of)?.p ?? null;
}

function repAssignment(p: Period, today: string): Assignment | null {
  const wrapped = liveAssignments(p).map((a) => ({ effectiveFrom: a.effective_from, effectiveTo: a.effective_to, a }));
  return representativeAssignment({ startDate: p.start_date, endDate: p.end_date }, wrapped, today)?.a ?? null;
}

export type PeriodState = "active" | "pre_start" | "ended";
export function periodState(p: Period, today: string): PeriodState {
  if (p.start_date > today) return "pre_start";
  if (p.end_date !== null && p.end_date < today) return "ended";
  return "active";
}

export type AssignmentSummary = {
  id: string;
  effectiveFrom: string;
  department: string;
  jobTitle: string;
  level: string | null;
  manager: { personId: string; name: string; code: string } | null;
};
export const summary = (a: Assignment): AssignmentSummary => ({
  id: a.id,
  effectiveFrom: a.effective_from,
  department: a.department.name,
  jobTitle: a.job_title.name_en,
  level: a.job_level?.name ?? null,
  manager: a.manager ? { personId: a.manager.person_id, name: a.manager.full_name, code: a.manager.employee_code } : null,
});

export type EmploymentView =
  | { kind: "none"; hasDisposedRecords: boolean }
  | {
      kind: PeriodState;
      periodId: string;
      employeeType: string | null;
      startDate: string;
      endDate: string | null;
      /** The end date lies today or later: shown as "Planned End", never as a past end. */
      plannedEnd: boolean;
      endReason: { code: string; label: string } | null;
      /** Pre-start only: end of the most recent earlier (ended) period, so a Rehire is never merged with it. */
      previousEnd: string | null;
    };

export type AssignmentView =
  | { kind: "none"; reason: "no_employment" | "no_assignment" | "none_in_effect" }
  /** current = in effect today (active period); upcoming = first assignment of a pre-start period; last = ended period. */
  | { kind: "current" | "upcoming" | "last"; assignment: AssignmentSummary; periodEnd: string | null };

export type ChangedField = "department" | "job_title" | "level" | "manager";
export type UpcomingChange =
  | { kind: "assignment_change"; date: string; periodId: string; from: AssignmentSummary | null; to: AssignmentSummary; changed: ChangedField[] }
  | { kind: "planned_end"; date: string; periodId: string; endReason: { code: string; label: string } | null }
  | { kind: "period_start"; date: string; periodId: string; first: boolean; employeeType: string | null; assignment: AssignmentSummary | null }
  | {
      kind: "relationship_change";
      date: string;
      periodId: string;
      fromType: string | null;
      toType: string | null;
      previousEnd: string;
      assignment: AssignmentSummary | null;
    };

export type Overview = {
  identity: { fullName: string; employeeCode: string; workEmail: string | null };
  header: { jobTitle: string | null; department: string | null; employeeType: string | null };
  employment: EmploymentView;
  assignment: AssignmentView;
  upcoming: UpcomingChange[];
  health: { status: "complete" | "incomplete"; missing: string[]; ruleVersion: string };
};

export function changedFields(from: Assignment | null, to: Assignment): ChangedField[] {
  if (!from) return ["department", "job_title", "level", "manager"];
  const out: ChangedField[] = [];
  if (from.department.id !== to.department.id) out.push("department");
  if (from.job_title.id !== to.job_title.id) out.push("job_title");
  if ((from.job_level?.id ?? null) !== (to.job_level?.id ?? null)) out.push("level");
  if ((from.manager?.person_id ?? null) !== (to.manager?.person_id ?? null)) out.push("manager");
  return out;
}

/**
 * True future-effective changes only (date after today; a planned end counts from today, its last day). The semantics
 * live in the shared pure module `employments/upcoming.ts` (also used by the Home dashboard, PV-30); this maps its
 * events onto the Overview presentation. Operational periods and operational (non-cancelled) assignments only.
 */
export function upcomingChanges(d: Detail): UpcomingChange[] {
  const periods = operationalPeriods(d).map((p) => ({
    id: p.id,
    startDate: p.start_date,
    endDate: p.end_date,
    employeeType: p.employee_type?.name ?? null,
    activeEndReason: p.active_end_event?.end_reason ?? null,
    assignments: liveAssignments(p).map((a) => ({ effectiveFrom: a.effective_from, a })),
  }));
  return upcomingEvents(periods, d.status_as_of).map((e): UpcomingChange => {
    switch (e.kind) {
      case "assignment_change":
        return { kind: e.kind, date: e.date, periodId: e.periodId, from: e.from ? summary(e.from) : null, to: summary(e.to), changed: changedFields(e.from, e.to) };
      case "period_start":
        return { ...e, assignment: e.assignment ? summary(e.assignment) : null };
      case "relationship_change":
        return { ...e, assignment: e.assignment ? summary(e.assignment) : null };
      default:
        return e;
    }
  });
}

export function overview(d: Detail): Overview {
  const today = d.status_as_of;
  const rep = representativePeriod(d);
  const op = d.completeness.operational;
  const health = { status: op.status, missing: op.items.filter((i) => !i.satisfied).map((i) => i.code), ruleVersion: op.rule_version };
  const identity = { fullName: d.full_name, employeeCode: d.employee_code, workEmail: rep?.work_email ?? null };
  if (!rep) {
    return {
      identity,
      header: { jobTitle: null, department: null, employeeType: null },
      employment: { kind: "none", hasDisposedRecords: d.employments.length > 0 },
      assignment: { kind: "none", reason: "no_employment" },
      upcoming: upcomingChanges(d),
      health,
    };
  }
  const state = periodState(rep, today);
  const previousEnd =
    state === "pre_start"
      ? (operationalPeriods(d)
          .filter((p) => p.start_date < rep.start_date && p.end_date !== null && p.end_date < today)
          .map((p) => p.end_date!)
          .sort()
          .at(-1) ?? null)
      : null;
  const a = repAssignment(rep, today);
  const assignment: AssignmentView = a
    ? { kind: state === "active" ? "current" : state === "pre_start" ? "upcoming" : "last", assignment: summary(a), periodEnd: rep.end_date }
    : { kind: "none", reason: liveAssignments(rep).length === 0 ? "no_assignment" : "none_in_effect" };
  return {
    identity,
    header: { jobTitle: a?.job_title.name_en ?? null, department: a?.department.name ?? null, employeeType: rep.employee_type?.name ?? null },
    employment: {
      kind: state,
      periodId: rep.id,
      employeeType: rep.employee_type?.name ?? null,
      startDate: rep.start_date,
      endDate: rep.end_date,
      plannedEnd: rep.end_date !== null && rep.end_date >= today,
      endReason: rep.active_end_event?.end_reason ?? null,
      previousEnd,
    },
    assignment,
    upcoming: upcomingChanges(d),
    health,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Action eligibility. The conditions are exactly those the page used before UI-3 to render each workflow; they are
// gathered here so that the header (representative period) and the period cards (other periods) use one source.
// Capabilities come from the server session (`can`), never from role names (C-85).

export type PeriodEligibility = {
  workEmailEdit: boolean;
  workEmailClear: boolean;
  correctPeriod: boolean;
  endEmployment: boolean;
  relationshipChange: boolean;
  cancelPlanned: boolean;
  reverseEnd: boolean;
  voidPeriod: boolean;
  initialAssignment: boolean;
  changeAssignment: boolean;
  correctAssignmentRows: boolean;
};

export function periodEligibility(d: Detail, p: Period, can: (permission: string) => boolean): PeriodEligibility {
  const today = d.status_as_of;
  const live = !isDisposed(p);
  const manage = can("employment.manage");
  const correct = can("employment.correct");
  const ended = p.period_lifecycle === "ended";
  const latest = latestPeriod(d);
  return {
    workEmailEdit: live && (ended ? correct : manage),
    workEmailClear: live && correct && Boolean(p.work_email),
    correctPeriod: live && correct,
    endEmployment: live && !ended && !p.has_active_end_event && manage,
    relationshipChange: p.id === latest?.id && !p.has_active_end_event && Boolean(p.employee_type) && manage,
    cancelPlanned: live && p.start_date > today && manage,
    reverseEnd: live && Boolean(p.active_end_event) && correct,
    voidPeriod: p.id === latest?.id && p.start_date <= today && correct,
    initialAssignment: live && liveAssignments(p).length === 0 && manage,
    changeAssignment: live && !ended && liveAssignments(p).length > 0 && manage,
    correctAssignmentRows: live && correct,
  };
}

export type ActionId =
  | "change_assignment"
  | "initial_assignment"
  | "edit_work_email"
  | "end_employment"
  | "relationship_change"
  | "rehire"
  | "initial_employment"
  | "correct_personal"
  | "edit_personal"
  | "correct_assignment"
  | "cancel_planned_assignment"
  | "correct_period"
  | "correct_work_email"
  | "clear_work_email"
  | "cancel_planned"
  | "reverse_end"
  | "void_period";

export type HeaderActions = {
  /** The period the header actions act on (the representative period), or null. */
  target: Period | null;
  primary: ActionId | null;
  /** Normal day-to-day actions. */
  daily: ActionId[];
  /** Correct record: data corrections and recovery of planned changes. */
  correction: ActionId[];
  /** Advanced recovery (Void). */
  advanced: ActionId[];
};

export type PeriodActionId = Extract<
  ActionId,
  "edit_work_email" | "end_employment" | "relationship_change" | "correct_period" | "correct_work_email" | "clear_work_email" | "cancel_planned" | "reverse_end" | "void_period"
>;

/**
 * Actions of one period grouped by intent (UI-3 header, UI-5 period cards): daily business actions, Correct record
 * (corrections and recovery of planned changes) and Advanced (Void). Eligibility is `periodEligibility`.
 */
export function periodActions(d: Detail, p: Period, can: (permission: string) => boolean) {
  const e = periodEligibility(d, p, can);
  const ended = p.period_lifecycle === "ended";
  const daily: PeriodActionId[] = [];
  const correction: PeriodActionId[] = [];
  const advanced: PeriodActionId[] = [];
  if (e.workEmailEdit && !ended) daily.push("edit_work_email");
  if (e.endEmployment) daily.push("end_employment");
  if (e.relationshipChange) daily.push("relationship_change");
  if (e.correctPeriod) correction.push("correct_period");
  if (e.workEmailEdit && ended) correction.push("correct_work_email");
  if (e.workEmailClear) correction.push("clear_work_email");
  if (e.cancelPlanned) correction.push("cancel_planned");
  if (e.reverseEnd) correction.push("reverse_end");
  if (e.voidPeriod) advanced.push("void_period");
  return { daily, correction, advanced, initialAssignment: e.initialAssignment, changeAssignment: e.changeAssignment };
}

/**
 * Header actions (UI-9, D-UI-13/16): the primary assignment action of the representative period plus
 * person-level / lifecycle-level actions only. Period-specific actions live on their Employment Period card.
 */
export function headerActions(d: Detail, can: (permission: string) => boolean): HeaderActions {
  const target = representativePeriod(d);
  const latest = latestPeriod(d);
  const manage = can("employment.manage");
  const pa = target ? periodActions(d, target, can) : null;
  const primary: ActionId | null = pa?.changeAssignment ? "change_assignment" : pa?.initialAssignment ? "initial_assignment" : null;
  const daily: ActionId[] = [];
  if (manage && latest === null) daily.push("initial_employment");
  if (manage && latest?.end_date) daily.push("rehire");
  // Full Name / recorded Date of Birth correction (C-23); normal personal updates live in the Personal tab (UI-4).
  const correction: ActionId[] = can("employees.update") ? ["correct_personal"] : [];
  return { target, primary, daily, correction, advanced: [] };
}

/**
 * Actions shown on one Employment Period card. The representative period's assignment action belongs to the header
 * (primary), so it is not repeated here; another period (e.g. a future one) carries its own assignment action.
 */
export function periodCardActions(d: Detail, p: Period, can: (permission: string) => boolean, representativeId: string | null) {
  const pa = periodActions(d, p, can);
  const assignment: ActionId[] =
    p.id === representativeId ? [] : pa.changeAssignment ? ["change_assignment"] : pa.initialAssignment ? ["initial_assignment"] : [];
  return { daily: [...assignment, ...pa.daily] as ActionId[], correction: pa.correction as ActionId[], advanced: pa.advanced as ActionId[] };
}
