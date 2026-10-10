// UI-7 History view model: a business-readable timeline built only from facts already in the Employee Detail
// response — recorded employment events (start, end, end_reversed, cancel_planned_start, employment_voided, with the
// structured End Reason) and the effective-dated assignment rows. Nothing is invented: there is no audit-read API, so
// corrections, Work Email changes and personal-data edits are not shown (D-UI-7), and no actor or recording time is.
// Free-text reasons are never part of the response (C-24) and personal / Work Email values are never used here.
import { addDays } from "@/lib/dates";
import { summary, type AssignmentSummary, type Detail, type Period } from "./detailModel";
import { assignmentSections, type FieldChange } from "./assignmentModel";

export type HistoryKind =
  | "employment_started"
  | "employee_rehired"
  | "relationship_changed"
  | "employment_ended"
  | "end_reversed"
  | "period_cancelled"
  | "period_voided"
  | "assignment_added"
  | "assignment_changed"
  | "other";

/** Decoration shown as a text badge next to the entry. */
export type HistoryStatus = "planned" | "reversed" | "cancelled" | "voided" | null;

export type HistoryEntry = {
  key: string;
  /** Effective (business) date — the only date shown (D-UI-7). */
  date: string;
  kind: HistoryKind;
  status: HistoryStatus;
  /** The effective date has not been reached (an End counts from its last day) — wording uses the future tense. */
  future: boolean;
  periodNumber: number;
  periodType: string | null;
  endReason?: { code: string; label: string } | null;
  /** relationship_changed: previous / new Employee Type and the previous period's last day. */
  fromType?: string | null;
  toType?: string | null;
  previousEnd?: string | null;
  /** end_reversed: the End that was reversed. */
  reversedEndDate?: string;
  /** period_cancelled: the planned end, if one was recorded. */
  plannedEnd?: string | null;
  assignment?: AssignmentSummary;
  changes?: FieldChange[];
  /** unknown future event types keep their stable code for a catalogue lookup (never shown raw). */
  eventType?: string;
};

// Lifecycle order for entries on the same effective date within one period: the period begins, assignments take
// effect, the period ends, an End is reversed; dispositions are listed last (as the API lists the void event last).
const RANK: Record<HistoryKind, number> = {
  employment_started: 0,
  employee_rehired: 0,
  relationship_changed: 0,
  assignment_added: 1,
  assignment_changed: 2,
  other: 3,
  employment_ended: 4,
  end_reversed: 5,
  period_cancelled: 6,
  period_voided: 7,
};

const RC = "RELATIONSHIP_CHANGE";

export function historyEntries(d: Detail): HistoryEntry[] {
  const today = d.status_as_of;
  const operational = d.employments.filter((p) => !p.cancelled_at && !p.voided_at);
  const firstOperational = operational[0];
  const out: { e: HistoryEntry; seq: number }[] = [];
  const push = (e: Omit<HistoryEntry, "future">) =>
    out.push({ e: { ...e, future: e.kind === "employment_ended" ? e.date >= today : e.date > today }, seq: out.length });
  const number = (p: Period) => d.employments.indexOf(p) + 1;

  // Relationship Change (S4.10): the predecessor's active End carries reason RELATIONSHIP_CHANGE and an operational
  // successor starts the next day. Only then are its End and the successor's start shown as one entry.
  const rcSuccessorOf = new Map<string, Period>();
  const rcPredecessorOf = new Map<string, Period>();
  for (const p of operational) {
    if (!p.end_date || p.active_end_event?.end_reason?.code !== RC) continue;
    const next = operational.find((o) => o.start_date === addDays(p.end_date!, 1));
    if (next) {
      rcSuccessorOf.set(p.id, next);
      rcPredecessorOf.set(next.id, p);
    }
  }

  for (const p of d.employments) {
    const n = number(p);
    const type = p.employee_type?.name ?? null;
    const voided = Boolean(p.voided_at);
    const cancelled = Boolean(p.cancelled_at);
    const reversedIds = new Set(p.events.filter((e) => e.event_type === "end_reversed" && e.reverses_event_id).map((e) => e.reverses_event_id!));
    const base = { periodNumber: n, periodType: type };

    if (cancelled) {
      // One entry: the planned period was cancelled before it began (its start and cancel events share the planned start).
      push({ ...base, key: `${p.id}-cancelled`, date: p.start_date, kind: "period_cancelled", status: null, plannedEnd: p.end_date });
    }

    for (const ev of p.events) {
      const key = `${p.id}-${ev.id}`;
      switch (ev.event_type) {
        case "start": {
          if (cancelled) break; // shown in the cancelled entry
          const pred = rcPredecessorOf.get(p.id);
          if (pred) {
            push({
              ...base,
              key,
              date: ev.effective_date,
              kind: "relationship_changed",
              status: ev.effective_date > today ? "planned" : null,
              fromType: pred.employee_type?.name ?? null,
              toType: type,
              previousEnd: pred.end_date,
            });
          } else {
            // A later operational period that is not a Relationship Change can only come from Rehire (S4.8).
            const rehire = !voided && firstOperational !== undefined && p.id !== firstOperational.id;
            const previousEnd = rehire
              ? (operational
                  .filter((o) => o.start_date < p.start_date && o.end_date)
                  .map((o) => o.end_date!)
                  .sort()
                  .at(-1) ?? null)
              : null;
            push({
              ...base,
              key,
              date: ev.effective_date,
              kind: rehire ? "employee_rehired" : "employment_started",
              status: voided ? "voided" : ev.effective_date > today ? "planned" : null,
              previousEnd,
            });
          }
          break;
        }
        case "end": {
          if (cancelled) break;
          const reversed = reversedIds.has(ev.id);
          if (!reversed && !voided && rcSuccessorOf.has(p.id) && p.active_end_event?.effective_date === ev.effective_date) break; // in the relationship entry
          push({
            ...base,
            key,
            date: ev.effective_date,
            kind: "employment_ended",
            status: voided ? "voided" : reversed ? "reversed" : ev.effective_date >= today ? "planned" : null,
            endReason: ev.end_reason,
          });
          break;
        }
        case "end_reversed":
          push({ ...base, key, date: ev.effective_date, kind: "end_reversed", status: voided ? "voided" : null, reversedEndDate: ev.effective_date });
          break;
        case "cancel_planned_start":
          break; // shown in the cancelled entry
        case "employment_voided":
          push({ ...base, key, date: ev.effective_date, kind: "period_voided", status: null });
          break;
        default:
          if (cancelled) break;
          push({ ...base, key, date: ev.effective_date, kind: "other", status: voided ? "voided" : null, eventType: ev.event_type });
      }
    }
  }

  // Assignments: added (first row of a period) or changed (later rows, compared within the same period only). Rows of
  // cancelled / voided periods stay visible as evidence, decorated, never as operational changes (D-UI-15).
  const s = assignmentSections(d);
  for (const v of [...s.current, ...s.upcoming, ...s.history, ...s.notOperational]) {
    push({
      key: `asg-${v.assignment.id}`,
      date: v.assignment.effective_from,
      kind: v.firstOfPeriod ? "assignment_added" : "assignment_changed",
      status: v.disposition ?? (v.assignment.effective_from > today ? "planned" : null),
      periodNumber: v.periodNumber,
      periodType: v.period.employee_type?.name ?? null,
      assignment: summary(v.assignment),
      changes: v.changes,
    });
  }

  // Deterministic: effective date, then period order, then lifecycle step, then the API's own event order.
  return out
    .sort(({ e: a, seq: sa }, { e: b, seq: sb }) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.periodNumber !== b.periodNumber ? a.periodNumber - b.periodNumber : RANK[a.kind] !== RANK[b.kind] ? RANK[a.kind] - RANK[b.kind] : sa - sb,
    )
    .map(({ e }) => e);
}

/** Display groups: most recent effective date first; within a date the lifecycle order above (oldest step first). */
export function historyGroups(entries: HistoryEntry[]): { date: string; entries: HistoryEntry[] }[] {
  const groups: { date: string; entries: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (last && last.date === e.date) last.entries.push(e);
    else groups.push({ date: e.date, entries: [e] });
  }
  return groups.reverse();
}
