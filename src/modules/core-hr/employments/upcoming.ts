// Upcoming business changes of one person (UI-3 Overview semantics, shared with the UI-1 Home dashboard, PV-30 T-2).
// Pure: the caller passes OPERATIONAL periods only (not cancelled, not voided) with their OPERATIONAL assignments only
// (PV-29: never a cancelled planned assignment) — this module never filters dispositions itself.
//   - a period start after today: the first valid period → employment start; a later one → new Employment Period
//     (neutral; never inferred as "Rehire");
//   - Relationship Change: a period starting after today whose previous valid period has an ACTIVE End Event with End
//     Reason RELATIONSHIP_CHANGE and ends the day before → ONE item (the predecessor's planned end and the successor's
//     start are not listed separately). Recorded facts only, no heuristics; a cancelled successor is simply absent, so
//     the predecessor's end stays a planned end;
//   - planned end: a valid period whose last day is today or later (today is still the last working day);
//   - assignment change: an assignment taking effect after today, except the first assignment of a period that starts
//     after today (described with that start).
import { addDays } from "@/lib/dates";

export const RELATIONSHIP_CHANGE_END_REASON = "RELATIONSHIP_CHANGE";

export type UpcomingPeriod<A, T, R extends { code: string }> = {
  id: string;
  startDate: string;
  endDate: string | null;
  employeeType: T | null;
  /** End Reason of the period's ACTIVE (non-reversed) End Event, if any. */
  activeEndReason: R | null;
  /** Operational assignments of this period, any order. */
  assignments: readonly { effectiveFrom: string; a: A }[];
};

export type UpcomingEvent<A, T, R> =
  | { kind: "planned_end"; date: string; periodId: string; endReason: R | null }
  | { kind: "relationship_change"; date: string; periodId: string; fromType: T | null; toType: T | null; previousEnd: string; assignment: A | null }
  | { kind: "period_start"; date: string; periodId: string; first: boolean; employeeType: T | null; assignment: A | null }
  | { kind: "assignment_change"; date: string; periodId: string; from: A | null; to: A };

/** Same-date lifecycle order: the old period ends, a relationship changes, a period starts, assignments change. */
export const UPCOMING_KIND_ORDER: Record<UpcomingEvent<unknown, unknown, unknown>["kind"], number> = {
  planned_end: 0,
  relationship_change: 1,
  period_start: 2,
  assignment_change: 3,
};

/** True future-effective changes of one person, nearest first (a planned end counts from today, its last day). */
export function upcomingEvents<A, T, R extends { code: string }>(periods: readonly UpcomingPeriod<A, T, R>[], today: string): UpcomingEvent<A, T, R>[] {
  const sorted = [...periods].sort((x, y) => (x.startDate < y.startDate ? -1 : x.startDate > y.startDate ? 1 : 0));
  const out: UpcomingEvent<A, T, R>[] = [];
  const mergedEnds = new Set<string>();
  for (const [i, p] of sorted.entries()) {
    const rows = [...p.assignments].sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? -1 : x.effectiveFrom > y.effectiveFrom ? 1 : 0));
    if (p.startDate > today) {
      const prev = i > 0 ? sorted[i - 1] : null;
      const first = rows[0]?.a ?? null;
      if (prev?.endDate && addDays(prev.endDate, 1) === p.startDate && prev.activeEndReason?.code === RELATIONSHIP_CHANGE_END_REASON) {
        mergedEnds.add(prev.id);
        out.push({ kind: "relationship_change", date: p.startDate, periodId: p.id, fromType: prev.employeeType, toType: p.employeeType, previousEnd: prev.endDate, assignment: first });
      } else {
        out.push({ kind: "period_start", date: p.startDate, periodId: p.id, first: i === 0, employeeType: p.employeeType, assignment: first });
      }
    }
    for (const [j, r] of rows.entries()) {
      if (r.effectiveFrom <= today) continue;
      if (p.startDate > today && j === 0) continue; // shown with the start of its period
      out.push({ kind: "assignment_change", date: r.effectiveFrom, periodId: p.id, from: j > 0 ? rows[j - 1].a : null, to: r.a });
    }
  }
  for (const p of sorted) {
    if (p.endDate && p.endDate >= today && !mergedEnds.has(p.id)) {
      out.push({ kind: "planned_end", date: p.endDate, periodId: p.id, endReason: p.activeEndReason });
    }
  }
  return out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : UPCOMING_KIND_ORDER[a.kind] - UPCOMING_KIND_ORDER[b.kind]));
}
