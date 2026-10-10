"use client";

import { EmptyState } from "@/components/ui";
import { formatDate, t, tMaybe } from "@/i18n";
import type { Detail } from "./detailModel";
import { historyEntries, historyGroups, type HistoryEntry } from "./historyModel";

// UI-7 History: one business-readable timeline (most recent effective date first). Effective dates only — no
// recorded-at or actor (D-UI-7); no raw codes, values or audit payloads.

const reasonLabel = (r: { code: string; label: string } | null | undefined) => (r ? tMaybe(`endReason.${r.code}`) ?? r.label : null);

export function historyEntryTitle(e: HistoryEntry): string {
  // Tense follows the effective date (a reversed or voided future End still reads "scheduled").
  const planned = e.future;
  switch (e.kind) {
    case "employment_started":
      return t(planned ? "history.title.employmentStarts" : "history.title.employmentStarted");
    case "employee_rehired":
      return t("history.title.rehired");
    case "relationship_changed":
      return t("history.title.relationshipChanged");
    case "employment_ended":
      return t(planned ? "history.title.endScheduled" : "history.title.ended");
    case "end_reversed":
      return t("history.title.endReversed");
    case "period_cancelled":
      return t("history.title.cancelled");
    case "period_voided":
      return t("history.title.voided");
    case "assignment_added":
      return t("history.title.assignmentAdded");
    case "assignment_changed":
      return t("history.title.assignmentChanged");
    default:
      return tMaybe(`detail.eventType.${e.eventType}`) ?? t("history.title.other");
  }
}

function Description({ e, showPeriod }: { e: HistoryEntry; showPeriod: boolean }) {
  const lines: React.ReactNode[] = [];
  switch (e.kind) {
    case "employment_started":
      if (e.periodType && !showPeriod) lines.push(e.periodType); // otherwise named by the period context line
      break;
    case "employee_rehired":
      lines.push(t("history.desc.rehired", { n: e.periodNumber, type: e.periodType ?? "—" }));
      if (e.previousEnd) lines.push(t("history.desc.previousEnded", { date: formatDate(e.previousEnd) }));
      break;
    case "relationship_changed":
      lines.push(
        <>
          {e.fromType ?? "—"} → <strong>{e.toType ?? "—"}</strong>
        </>,
      );
      lines.push(t(e.future ? "history.desc.relationshipChanges" : "history.desc.relationshipChanged", { end: formatDate(e.previousEnd ?? null), date: formatDate(e.date) }));
      break;
    case "employment_ended": {
      const reason = reasonLabel(e.endReason);
      lines.push(reason ? `${t("history.desc.lastDay")} · ${reason}` : t("history.desc.lastDay"));
      if (e.status === "reversed") lines.push(t("history.desc.endWasReversed"));
      break;
    }
    case "end_reversed":
      lines.push(t("history.desc.endReversed", { date: formatDate(e.reversedEndDate ?? null) }));
      break;
    case "period_cancelled":
      lines.push(t("history.desc.cancelled"));
      lines.push(
        e.plannedEnd
          ? t("history.desc.plannedDatesWithEnd", { start: formatDate(e.date), end: formatDate(e.plannedEnd) })
          : t("history.desc.plannedDates", { start: formatDate(e.date) }),
      );
      break;
    case "period_voided":
      lines.push(t("history.desc.voided"));
      break;
    case "assignment_added":
      if (e.assignment) {
        const a = e.assignment;
        lines.push(
          [`${a.department} / ${a.jobTitle}`, a.level, a.manager ? t("history.desc.manager", { name: a.manager.name }) : null].filter(Boolean).join(" · "),
        );
      }
      break;
    case "assignment_changed":
      for (const c of e.changes ?? [])
        lines.push(
          <>
            {t(`overview.field.${c.field}`)}: {c.from} → <strong>{c.to}</strong>
          </>,
        );
      if (!e.changes?.length) lines.push(t("history.desc.noFieldChange"));
      break;
  }
  if (e.status === "voided" && e.kind !== "period_voided") lines.push(t("history.desc.partOfVoided"));
  if (e.status === "cancelled") lines.push(t("history.desc.partOfCancelled"));
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className="timeline-line">
          {l}
        </div>
      ))}
    </>
  );
}

export function HistoryTab({ d }: { d: Detail }) {
  const groups = historyGroups(historyEntries(d));
  const showPeriod = d.employments.length > 1;
  if (!groups.length)
    return (
      <div className="employment-tab">
        <EmptyState title={t("history.emptyTitle")}>{t("history.emptyBody")}</EmptyState>
      </div>
    );
  return (
    <div className="employment-tab">
      <h2>{t("history.title.heading")}</h2>
      <p className="muted small">{t("history.scopeNote")}</p>
      <ol className="timeline">
        {groups.map((g) => (
          <li key={g.date} className="timeline-group">
            <div className="timeline-date">{formatDate(g.date)}</div>
            <ul className="timeline-items">
              {g.entries.map((e) => (
                <li key={e.key} className={`timeline-item ${e.kind} ${e.status ?? ""}`}>
                  <div className="timeline-head">
                    <span className="timeline-title">{historyEntryTitle(e)}</span>
                    {e.status && <span className={`badge period-label ${e.status === "planned" ? "upcoming" : e.status}`}>{t(`history.status.${e.status}`)}</span>}
                  </div>
                  <Description e={e} showPeriod={showPeriod} />
                  {showPeriod && e.kind !== "employee_rehired" && <div className="timeline-context">{t("history.periodContext", { n: e.periodNumber, type: e.periodType ?? "—" })}</div>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
