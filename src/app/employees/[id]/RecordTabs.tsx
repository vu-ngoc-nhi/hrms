"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDate, t, tMaybe } from "@/i18n";
import { AssignmentChangeForm } from "./AssignmentChangeForm";
import { AssignmentCorrectionForm } from "./AssignmentCorrectionForm";
import { InitialAssignmentForm } from "./InitialAssignmentForm";
import { periodHeading } from "./PeriodWorkflow";
import { isDisposed, periodEligibility, type Detail, type HistoryEvent, type Period } from "./detailModel";

// UI-3: the pre-UI-3 Employee Detail content for the Assignment and History tabs (Personal: UI-4, Employment: UI-5). Layout
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

export function AssignmentTab({ ctx }: { ctx: TabContext }) {
  const { d, can, targetId, onSaved } = ctx;
  const [correctingRow, setCorrectingRow] = useState<string | null>(null);
  return (
    <>
      <h2>{t("detail.assignmentsTitle")}</h2>
      {d.employments.length === 0 && <p className="muted">{t("detail.noEmployment")}</p>}
      {d.employments.map((e) => {
        const el = periodEligibility(d, e, can);
        const inline = e.id !== targetId;
        return (
          <section key={e.id} className="card" style={{ marginBottom: 12, opacity: isDisposed(e) ? 0.7 : 1 }}>
            <PeriodHeader d={d} e={e} />
            {inline && el.initialAssignment && (
              <InitialAssignmentForm<Detail>
                key={`${e.id}-${d.revision}-initial`}
                employmentId={e.id}
                personId={d.id}
                periodStart={e.start_date}
                periodEnd={e.end_date}
                today={d.status_as_of}
                revision={d.revision}
                onSaved={(u) => onSaved(u)}
              />
            )}
            {inline && el.changeAssignment && (
              <AssignmentChangeForm<Detail>
                key={`${e.id}-${d.revision}`}
                employmentId={e.id}
                personId={d.id}
                current={e.assignments.at(-1) ?? null}
                revision={d.revision}
                minDate={can("employment.correct") ? undefined : d.status_as_of}
                onSaved={(u) => onSaved(u)}
              />
            )}
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t("detail.effectiveFrom")}</th>
                    <th>{t("detail.effectiveTo")}</th>
                    <th>{t("employees.columns.department")}</th>
                    <th>{t("employees.columns.jobTitle")}</th>
                    <th>{t("detail.jobLevel")}</th>
                    <th>{t("detail.manager")}</th>
                    {el.correctAssignmentRows && <th>{t("detail.actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {e.assignments.map((a) => (
                    <tr key={a.id}>
                      <td>{formatDate(a.effective_from)}</td>
                      <td>{a.effective_to ? formatDate(a.effective_to) : "—"}</td>
                      <td>{a.department.name}</td>
                      <td>{a.job_title.name_en}</td>
                      <td>{a.job_level?.name ?? "—"}</td>
                      <td>
                        {a.manager ? (
                          <Link href={`/employees/${a.manager.person_id}`}>
                            {a.manager.full_name} ({a.manager.employee_code})
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      {el.correctAssignmentRows && (
                        <td>
                          <button type="button" onClick={() => setCorrectingRow(a.id)} disabled={correctingRow === a.id}>
                            {t("assignmentCorrection.open")}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {e.assignments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        {t("detail.noAssignments")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {el.correctAssignmentRows &&
              e.assignments.map(
                (a, i) =>
                  correctingRow === a.id && (
                    <AssignmentCorrectionForm<Detail>
                      key={`${a.id}-${d.revision}`}
                      row={a}
                      previous={i > 0 ? e.assignments[i - 1] : null}
                      personId={d.id}
                      revision={d.revision}
                      onSaved={(u) => {
                        setCorrectingRow(null);
                        onSaved(u);
                      }}
                      onClose={() => setCorrectingRow(null)}
                    />
                  ),
              )}
          </section>
        );
      })}
    </>
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

