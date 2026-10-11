// UI-5 Employment tab view model. Pure presentation of the existing Employee Detail facts: the server's period
// lifecycle (`period_lifecycle`), dispositions (`cancelled_at`, `voided_at`) and recorded events. Nothing is recomputed
// or synthesized — a period without recorded events simply has no lifecycle lines (C-24).
import { addDays } from "@/lib/dates";
import { isDisposed, liveAssignments, type Detail, type HistoryEvent, type Period } from "./detailModel";

/** Visual label of a period card. Cancelled and Voided are record dispositions, never an Employment Status. */
export type PeriodLabel = "current" | "upcoming" | "historical" | "cancelled" | "voided";
export type PeriodStatus = "active" | "not_started" | "ended";

export type LifecycleLine =
  | { kind: "started" | "starts"; date: string; afterRelationshipChange: boolean }
  /** Start of a cancelled (planned, never took effect) or voided (entered in error) record. */
  | { kind: "planned_start" | "recorded_start"; date: string }
  | { kind: "scheduled_end" | "ended"; date: string; reason: { code: string; label: string } | null; relationshipChange: boolean }
  | { kind: "end_reversed"; date: string }
  | { kind: "cancelled" }
  | { kind: "voided" }
  | { kind: "other"; eventType: string; date: string };

export type PeriodView = {
  period: Period;
  /** Chronological number among all recorded periods (Employment Period 1, 2, …). */
  number: number;
  label: PeriodLabel;
  /** The server's period lifecycle; null for a cancelled or voided record. */
  status: PeriodStatus | null;
  disposition: "cancelled" | "voided" | null;
  employeeType: string | null;
  startDate: string;
  endDate: string | null;
  /** How to read the end date: none, planned (today or later, still employed), ended, or recorded on a disposed record. */
  endKind: "none" | "planned" | "ended" | "recorded";
  endReason: { code: string; label: string } | null;
  /** This period ends (or ended) for a Relationship Change. */
  endsForRelationshipChange: boolean;
  /** This period was created by a Relationship Change: the previous period's type. */
  createdByRelationshipChange: { fromType: string | null } | null;
  /** For a period ended by a Relationship Change: the start of the new period it created. */
  successorStart: string | null;
  workEmail: string | null;
  hasAssignment: boolean;
  lifecycle: LifecycleLine[];
};

export type EmploymentSections = { current: PeriodView[]; upcoming: PeriodView[]; history: PeriodView[] };

const RC = "RELATIONSHIP_CHANGE";

function lifecycleLines(p: Period, today: string, afterRelationshipChange: boolean): LifecycleLine[] {
  const reversedIds = new Set(p.events.filter((e) => e.event_type === "end_reversed" && e.reverses_event_id).map((e) => e.reverses_event_id!));
  const lines: LifecycleLine[] = [];
  for (const ev of p.events as HistoryEvent[]) {
    switch (ev.event_type) {
      case "start":
        if (p.cancelled_at || p.voided_at) lines.push({ kind: p.voided_at ? "recorded_start" : "planned_start", date: ev.effective_date });
        else lines.push({ kind: ev.effective_date > today ? "starts" : "started", date: ev.effective_date, afterRelationshipChange });
        break;
      case "end":
        // A reversed End is shown once, as "End … reversed", where its reversal is listed.
        if (reversedIds.has(ev.id)) break;
        lines.push({
          kind: ev.effective_date >= today && !p.voided_at ? "scheduled_end" : "ended",
          date: ev.effective_date,
          reason: ev.end_reason,
          relationshipChange: ev.end_reason?.code === RC,
        });
        break;
      case "end_reversed":
        lines.push({ kind: "end_reversed", date: ev.effective_date });
        break;
      case "cancel_planned_start":
        lines.push({ kind: "cancelled" });
        break;
      case "employment_voided":
        lines.push({ kind: "voided" }); // the void disposition has no business date of its own (PV-25)
        break;
      default:
        lines.push({ kind: "other", eventType: ev.event_type, date: ev.effective_date });
    }
  }
  return lines;
}

export function periodViews(d: Detail): PeriodView[] {
  const today = d.status_as_of;
  const operational = d.employments.filter((p) => !isDisposed(p));
  return d.employments.map((p, i) => {
    const disposition = p.voided_at ? "voided" : p.cancelled_at ? "cancelled" : null;
    const status = disposition ? null : ((p.period_lifecycle as PeriodStatus | null) ?? null);
    const label: PeriodLabel = disposition ?? (status === "active" ? "current" : status === "not_started" ? "upcoming" : "historical");
    // Relationship Change (S4.10): the predecessor's active End has reason RELATIONSHIP_CHANGE and the new period
    // starts the next day. Only operational periods are linked.
    const predecessor = disposition
      ? undefined
      : operational.find((o) => o.id !== p.id && o.end_date && o.active_end_event?.end_reason?.code === RC && addDays(o.end_date, 1) === p.start_date);
    const successor =
      !disposition && p.end_date && p.active_end_event?.end_reason?.code === RC
        ? operational.find((o) => o.id !== p.id && o.start_date === addDays(p.end_date!, 1))
        : undefined;
    return {
      period: p,
      number: i + 1,
      label,
      status,
      disposition,
      employeeType: p.employee_type?.name ?? null,
      startDate: p.start_date,
      endDate: p.end_date,
      endKind: p.end_date === null ? "none" : disposition ? "recorded" : status === "ended" ? "ended" : "planned",
      endReason: disposition ? null : (p.active_end_event?.end_reason ?? null),
      endsForRelationshipChange: !disposition && p.active_end_event?.end_reason?.code === RC,
      createdByRelationshipChange: predecessor ? { fromType: predecessor.employee_type?.name ?? null } : null,
      successorStart: successor?.start_date ?? null,
      workEmail: p.work_email,
      hasAssignment: liveAssignments(p).length > 0,
      lifecycle: lifecycleLines(p, today, Boolean(predecessor)),
    };
  });
}

/**
 * Current = the server says active; Upcoming = not started (nearest first); Employment History = ended periods and
 * cancelled / voided records (most recent first). Empty sections are not shown.
 */
export function employmentSections(d: Detail): EmploymentSections {
  const views = periodViews(d);
  const byStartDesc = (a: PeriodView, b: PeriodView) => (a.startDate > b.startDate ? -1 : a.startDate < b.startDate ? 1 : b.number - a.number);
  return {
    current: views.filter((v) => v.label === "current"),
    upcoming: views.filter((v) => v.label === "upcoming").sort((a, b) => (a.startDate < b.startDate ? -1 : 1)),
    history: views.filter((v) => v.label === "historical" || v.label === "cancelled" || v.label === "voided").sort(byStartDesc),
  };
}
