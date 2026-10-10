"use client";

import { formatDate, t, tMaybe } from "@/i18n";
import { periodHeading } from "./PeriodWorkflow";
import { isDisposed, type Detail, type HistoryEvent, type Period } from "./detailModel";

// UI-3: the pre-UI-3 Employee Detail content for the History tab (Personal: UI-4, Employment: UI-5, Assignment: UI-6). Layout
// and wording inside these tabs are unchanged (they are refactored in UI-4 … UI-7). Workflows of the representative
// period are opened from the header (Change Assignment / More actions); other periods keep their inline buttons.

export type TabContext = {
  d: Detail;
  can: (permission: string) => boolean;
  /** The representative period whose actions live in the header. */
  targetId: string | null;
  onSaved: (updated: Detail, notice?: string) => void;
};

function PeriodHeader({ d, e }: { d: Detail; e: Period }) {
  return (
    <div className="spread" style={{ marginBottom: 8 }}>
      <strong>{periodHeading(d, e)}</strong>
      {isDisposed(e) ? (
        <span className="badge">{t(e.voided_at ? "detail.voidedBadge" : "detail.cancelledBadge")}</span>
      ) : (
        e.period_lifecycle && (
          <span className={`badge ${e.period_lifecycle === "active" ? "ok" : ""}`}>{tMaybe(`employmentStatus.${e.period_lifecycle}`) ?? e.period_lifecycle}</span>
        )
      )}
    </div>
  );
}

// C-80 history readability (display only): reversed End events are marked and paired with their reversal; the current
// End is distinguishable; a future-dated End reads "Planned end of employment". Order and data are unchanged.
// PV-25: on a voided period no End is shown as "Current end"; the void disposition (listed last) has no date of its own.
function EventLine({ ev, all, today, voided }: { ev: HistoryEvent; all: HistoryEvent[]; today: string; voided: boolean }) {
  const reversed = ev.event_type === "end" && all.some((o) => o.reverses_event_id === ev.id);
  const label = ev.event_type === "end" && ev.effective_date > today ? t("detail.eventType.end_planned") : tMaybe(`detail.eventType.${ev.event_type}`) ?? ev.event_type;
  const target = ev.reverses_event_id ? all.find((o) => o.id === ev.reverses_event_id) : undefined;
  if (ev.event_type === "employment_voided") {
    return (
      <li>
        <strong>{label}</strong> <span className="badge">{t("detail.voidedBadge")}</span>
      </li>
    );
  }
  return (
    <li style={reversed ? { color: "var(--muted)" } : undefined}>
      <span style={reversed ? { textDecoration: "line-through" } : ev.event_type === "end" ? { fontWeight: 600 } : undefined}>
        {label} — {formatDate(ev.effective_date)}
        {ev.end_reason && <> · {tMaybe(`endReason.${ev.end_reason.code}`) ?? ev.end_reason.label}</>}
      </span>
      {ev.event_type === "end" && (reversed || !voided) && (
        <span className="badge" style={{ marginLeft: 6 }}>
          {reversed ? t("detail.reversedBadge") : t("detail.currentEndBadge")}
        </span>
      )}
      {target && <span className="muted"> ({t("detail.reversesEnd", { date: formatDate(target.effective_date) })})</span>}
    </li>
  );
}

export function HistoryTab({ d }: { d: Detail }) {
  return (
    <>
      <h2>{t("detail.historyTitle")}</h2>
      {d.employments.length === 0 && <p className="muted">{t("detail.noEmployment")}</p>}
      {d.employments.map((e) => (
        <section key={e.id} className="card" style={{ marginBottom: 12, opacity: isDisposed(e) ? 0.7 : 1 }}>
          <PeriodHeader d={d} e={e} />
          {e.events.length === 0 ? (
            <p className="muted small">{t("detail.noEvents")}</p>
          ) : (
            <ul className="small" style={{ margin: 0 }}>
              {e.events.map((ev) => (
                <EventLine key={ev.id} ev={ev} all={e.events} today={d.status_as_of} voided={Boolean(e.voided_at)} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}

