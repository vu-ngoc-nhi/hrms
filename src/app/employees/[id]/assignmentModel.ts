// UI-6 Assignment tab view model. Pure presentation of the existing Employee Detail facts: the server's period
// lifecycle and dispositions, and each period's assignment rows (effective_from inclusive, effective_to exclusive).
// It never validates or changes assignment rules; it only decides which section a row belongs to and how to word its
// dates so that an exclusive end boundary never looks like an overlap with the next assignment.
// PV-29: a cancelled planned assignment is history only — kept in its own muted section, never Current / Upcoming,
// never the "previous" or "next" row of the live timeline; only the latest upcoming row of a period can be cancelled.
import { addDays } from "@/lib/dates";
import { changedFields, isCancelledAssignment, isDisposed, summary, type Assignment, type AssignmentSummary, type ChangedField, type Detail, type Period } from "./detailModel";

export type AssignmentLabel = "current" | "upcoming" | "historical" | "last" | "not_operational" | "cancelled";

/** Business date wording (no interval notation). */
export type DateWording =
  | { kind: "since"; date: string } // current: "Effective since"
  | { kind: "takes_effect"; date: string } // upcoming: "Takes effect on"
  | { kind: "replaced"; from: string; on: string } // historical: "Effective from … · Replaced on …" (the next row's start)
  | { kind: "through"; from: string; through: string } // historical: "Effective from … · Effective through …" (last day)
  | { kind: "from"; from: string } // historical without a recorded end
  | { kind: "planned_for"; date: string }; // cancelled planned assignment: "Was planned for …"

export type FieldChange = { field: ChangedField; from: string; to: string };

export type AssignmentView = {
  assignment: Assignment;
  values: AssignmentSummary;
  period: Period;
  periodNumber: number;
  label: AssignmentLabel;
  wording: DateWording;
  /** Current row already replaced by a planned row: the date the next one takes effect. */
  changesOn: string | null;
  /** Changes compared with the previous row of the same period (none for the first row of a period). */
  changes: FieldChange[];
  firstOfPeriod: boolean;
  latestOfPeriod: boolean;
  disposition: "cancelled" | "voided" | null;
  /** Upcoming and the latest live row of its period: the only row Cancel Planned Assignment may target (BD-3). */
  cancellable: boolean;
};

/** An operational period without any assignment row (shown as an intentional empty state). */
export type EmptyPeriod = { period: Period; periodNumber: number; section: "current" | "upcoming" | "history" };

export type AssignmentSections = {
  current: AssignmentView[];
  upcoming: AssignmentView[];
  history: AssignmentView[];
  notOperational: AssignmentView[];
  /** PV-29: planned assignments cancelled before they began (operational periods only). */
  cancelledPlans: AssignmentView[];
  emptyPeriods: EmptyPeriod[];
  /** More than one recorded period: cards name their Employment Period to avoid ambiguity. */
  multiplePeriods: boolean;
};

const value = (s: AssignmentSummary, f: ChangedField) =>
  f === "department" ? s.department : f === "job_title" ? s.jobTitle : f === "level" ? (s.level ?? "—") : s.manager ? s.manager.name : "—";

function fieldChanges(prev: Assignment | null, a: Assignment): FieldChange[] {
  if (!prev) return [];
  const before = summary(prev);
  const after = summary(a);
  return changedFields(prev, a).map((field) => ({ field, from: value(before, field), to: value(after, field) }));
}

function historicalWording(a: Assignment, next: Assignment | undefined, p: Period): DateWording {
  // Replaced by the next row of the same period on the day it takes effect (effective_to is exclusive).
  if (next && a.effective_to === next.effective_from) return { kind: "replaced", from: a.effective_from, on: next.effective_from };
  // Closed without a successor (e.g. End Employment): the last effective day is the day before the exclusive end.
  if (a.effective_to) return { kind: "through", from: a.effective_from, through: addDays(a.effective_to, -1) };
  if (p.end_date) return { kind: "through", from: a.effective_from, through: p.end_date };
  return { kind: "from", from: a.effective_from };
}

export function assignmentSections(d: Detail): AssignmentSections {
  const today = d.status_as_of;
  const out: AssignmentSections = {
    current: [],
    upcoming: [],
    history: [],
    notOperational: [],
    cancelledPlans: [],
    emptyPeriods: [],
    multiplePeriods: d.employments.length > 1,
  };
  d.employments.forEach((p, i) => {
    const periodNumber = i + 1;
    const all = [...p.assignments].sort((x, y) => (x.effective_from < y.effective_from ? -1 : x.effective_from > y.effective_from ? 1 : 0));
    const disposition: AssignmentView["disposition"] = p.voided_at ? "voided" : p.cancelled_at ? "cancelled" : null;
    // Records of a cancelled / voided period are all evidence; otherwise only live rows form the timeline.
    const rows = disposition ? all : all.filter((a) => !isCancelledAssignment(a));
    if (!disposition) {
      for (const a of all.filter(isCancelledAssignment)) {
        const prev = rows.filter((r) => r.effective_from < a.effective_from).at(-1) ?? null;
        out.cancelledPlans.push({
          assignment: a,
          values: summary(a),
          period: p,
          periodNumber,
          changes: fieldChanges(prev, a),
          firstOfPeriod: prev === null,
          latestOfPeriod: false,
          disposition: null,
          changesOn: null,
          cancellable: false,
          label: "cancelled",
          wording: { kind: "planned_for", date: a.effective_from },
        });
      }
    }
    if (!disposition && rows.length === 0) {
      const lifecycle = p.period_lifecycle;
      out.emptyPeriods.push({ period: p, periodNumber, section: lifecycle === "active" ? "current" : lifecycle === "not_started" ? "upcoming" : "history" });
      return;
    }
    rows.forEach((a, j) => {
      const prev = j > 0 ? rows[j - 1] : null;
      const next = rows[j + 1];
      const base = {
        assignment: a,
        values: summary(a),
        period: p,
        periodNumber,
        changes: fieldChanges(prev, a),
        firstOfPeriod: j === 0,
        latestOfPeriod: j === rows.length - 1,
        disposition,
        changesOn: null as string | null,
        cancellable: false,
      };
      if (isDisposed(p)) {
        // Records of cancelled / voided periods: kept as evidence, never current or upcoming (PV-25, C-86).
        out.notOperational.push({ ...base, label: "not_operational", wording: { kind: "from", from: a.effective_from } });
        return;
      }
      const inEffect = a.effective_from <= today && (a.effective_to === null || a.effective_to > today);
      if (a.effective_from > today) {
        out.upcoming.push({ ...base, label: "upcoming", wording: { kind: "takes_effect", date: a.effective_from }, cancellable: j === rows.length - 1 });
      } else if (inEffect && p.period_lifecycle === "active") {
        out.current.push({ ...base, label: "current", wording: { kind: "since", date: a.effective_from }, changesOn: a.effective_to && next ? next.effective_from : null });
      } else {
        const last = p.period_lifecycle === "ended" && j === rows.length - 1;
        out.history.push({ ...base, label: last ? "last" : "historical", wording: historicalWording(a, next, p) });
      }
    });
  });
  out.upcoming.sort((x, y) => (x.assignment.effective_from < y.assignment.effective_from ? -1 : x.assignment.effective_from > y.assignment.effective_from ? 1 : 0));
  out.history.sort((x, y) => (x.assignment.effective_from > y.assignment.effective_from ? -1 : x.assignment.effective_from < y.assignment.effective_from ? 1 : 0));
  out.cancelledPlans.sort((x, y) => (x.assignment.effective_from > y.assignment.effective_from ? -1 : x.assignment.effective_from < y.assignment.effective_from ? 1 : 0));
  return out;
}
