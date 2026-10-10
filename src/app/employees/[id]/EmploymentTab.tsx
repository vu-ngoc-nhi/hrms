"use client";

import { ActionMenu, Button, EmptyState } from "@/components/ui";
import { formatDate, t, tMaybe } from "@/i18n";
import { addDays } from "@/lib/dates";
import { actionLabel, groupedMenu } from "./PeriodWorkflow";
import type { TabContext } from "./tabContext";
import { isDisposed, operationalPeriods, periodCardActions, type ActionId } from "./detailModel";
import { employmentSections, type LifecycleLine, type PeriodView } from "./employmentModel";

// UI-5 Employment tab: Current → Upcoming → Employment History, one card per Employment Period with explicit text
// labels (Current / Upcoming / Historical / Cancelled / Voided). Cancelled and Voided are record dispositions, shown
// muted with their recorded dates and never with an Employment Status. Each period carries its own actions (UI-9, D-UI-13):
// business actions as buttons, corrections under "Correct record", Void under Advanced; they open the single workflow
// surface. Business wording only.

const endReason = (r: { code: string; label: string } | null) => (r ? tMaybe(`endReason.${r.code}`) ?? r.label : null);

function lineText(l: LifecycleLine): string {
  switch (l.kind) {
    case "started":
    case "starts":
      return t(l.afterRelationshipChange ? `employment.line.${l.kind}AfterRc` : `employment.line.${l.kind}`, { date: formatDate(l.date) });
    case "scheduled_end":
    case "ended": {
      const base = t(l.relationshipChange ? `employment.line.${l.kind}Rc` : `employment.line.${l.kind}`, { date: formatDate(l.date) });
      const reason = l.relationshipChange ? null : endReason(l.reason);
      return reason ? `${base} · ${reason}` : base;
    }
    case "planned_start":
    case "recorded_start":
      return t(`employment.line.${l.kind}`, { date: formatDate(l.date) });
    case "end_reversed":
      return t("employment.line.endReversed", { date: formatDate(l.date) });
    case "cancelled":
      return t("employment.line.cancelled");
    case "voided":
      return t("employment.line.voided");
    default:
      return `${tMaybe(`detail.eventType.${l.eventType}`) ?? l.eventType} — ${formatDate(l.date)}`;
  }
}

function PeriodCard({ v, ctx }: { v: PeriodView; ctx: TabContext }) {
  const { d, can, targetId } = ctx;
  const p = v.period;
  // UI-9: this period's own actions (the representative period's assignment action stays in the header).
  const actions = periodCardActions(d, p, can, targetId);
  const launch = (action: ActionId) => ctx.launch(action, { periodId: p.id });

  // C-72: an End for Relationship Change whose successor was cancelled — guidance only (reversing the End stays an explicit employment.correct action).
  const realPeriods = operationalPeriods(d);
  const needsRelationshipChangeReview =
    !isDisposed(p) &&
    v.endsForRelationshipChange &&
    !realPeriods.some((o) => o.start_date > p.start_date) &&
    d.employments.some((o) => o.cancelled_at && p.active_end_event && o.start_date === addDays(p.active_end_event.effective_date, 1));

  const title = t("employment.periodTitle", { n: v.number });
  const correctionMenu = groupedMenu({ daily: [], correction: actions.correction, advanced: actions.advanced }, launch, undefined, false);
  const hasActions = actions.daily.length > 0 || correctionMenu.length > 0;
  const recorded = v.disposition !== null;

  return (
    <article className={`card period-card ${v.label}`} aria-labelledby={`period-${p.id}`}>
      <header className="period-head">
        <h3 id={`period-${p.id}`}>
          {title}
          {v.employeeType && <span className="period-type"> · {v.employeeType}</span>}
        </h3>
        <span className={`badge period-label ${v.label}`}>{t(`employment.label.${v.label}`)}</span>
      </header>

      {v.disposition === "cancelled" && <p className="period-note lead">{t("employment.cancelledNote")}</p>}
      {v.disposition === "voided" && <p className="period-note lead">{t("employment.voidedNote")}</p>}
      {v.createdByRelationshipChange && (
        <p className="period-note lead">{t("employment.rcCreatedNote", { type: v.createdByRelationshipChange.fromType ?? "—" })}</p>
      )}

      <dl className="info-grid">
        <div>
          <dt>{t("employment.employeeType")}</dt>
          <dd>{v.employeeType ?? "—"}</dd>
        </div>
        {v.status && (
          <div>
            <dt>{t("employment.employmentStatus")}</dt>
            <dd>{tMaybe(`employmentStatus.${v.status}`) ?? v.status}</dd>
          </div>
        )}
        <div>
          <dt>{recorded ? t("employment.recordedStart") : t("employment.startDate")}</dt>
          <dd>{formatDate(v.startDate)}</dd>
        </div>
        <div>
          <dt>{recorded ? t("employment.recordedEnd") : v.endKind === "planned" ? t("employment.plannedEnd") : t("employment.endDate")}</dt>
          <dd>{v.endDate ? formatDate(v.endDate) : t("employment.noEndDate")}</dd>
        </div>
        {(v.endKind === "ended" || v.endKind === "planned") && v.endReason && (
          <div>
            <dt>{t("employment.endReason")}</dt>
            <dd>{v.endsForRelationshipChange ? t("employment.endedForRc") : endReason(v.endReason)}</dd>
          </div>
        )}
        <div>
          <dt>{t("employment.workEmail")}</dt>
          <dd>{v.workEmail ?? "—"}</dd>
        </div>
      </dl>

      {v.label === "upcoming" && <p className="period-note">{t("employment.upcomingNote", { date: formatDate(v.startDate) })}</p>}
      {v.endKind === "planned" && v.endDate && !v.endsForRelationshipChange && (
        <p className="period-note">{t("employment.plannedEndNote", { date: formatDate(v.endDate) })}</p>
      )}
      {v.endsForRelationshipChange && v.successorStart && (
        <p className="period-note">
          {t(v.endKind === "planned" ? "employment.rcPlannedNote" : "employment.rcEndedNote", { date: formatDate(v.successorStart) })}
        </p>
      )}
      {needsRelationshipChangeReview && can("employment.correct") && <p className="alert warning small">{t("guidance.cancelledRelationshipChange")}</p>}
      {!recorded && !v.hasAssignment && <p className="period-note">{t("detail.noAssignmentYet")}</p>}

      <section className="period-lifecycle" aria-label={t("employment.lifecycleTitle", { n: v.number })}>
        <h4>{t("employment.lifecycleHeading")}</h4>
        {v.lifecycle.length === 0 ? (
          <p className="muted small">{t("employment.noLifecycle")}</p>
        ) : (
          <ul>
            {v.lifecycle.map((l, i) => (
              <li key={i} className={l.kind === "end_reversed" ? "reversed" : undefined}>
                {lineText(l)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {hasActions && (
        <div className="period-actions" role="group" aria-label={t("employment.actionsFor", { n: v.number })}>
          {actions.daily.map((a) => (
            <Button key={a} size="small" onClick={() => launch(a)}>
              {actionLabel(a)}
            </Button>
          ))}
          <ActionMenu label={t("detail.actionGroup.correct")} ariaLabel={t("employment.correctFor", { n: v.number })} entries={correctionMenu} size="small" />
        </div>
      )}

    </article>
  );
}

function Section({ title, views, ctx }: { title: string; views: PeriodView[]; ctx: TabContext }) {
  if (!views.length) return null;
  return (
    <section className="employment-section" aria-label={title}>
      <h2>{title}</h2>
      <div className="period-list">
        {views.map((v) => (
          <PeriodCard key={v.period.id} v={v} ctx={ctx} />
        ))}
      </div>
    </section>
  );
}

export function EmploymentTab({ ctx }: { ctx: TabContext }) {
  const s = employmentSections(ctx.d);
  const none = s.current.length === 0 && s.upcoming.length === 0;
  const onlyRecords = none && s.history.every((v: PeriodView) => v.disposition !== null);
  return (
    <div className="employment-tab">
      {none && onlyRecords && (
        <EmptyState title={t("employmentStatus.no_employment")}>
          {ctx.d.employments.length ? t("detail.onlyDisposedRecords") : t("detail.noEmploymentRecorded")}
        </EmptyState>
      )}
      <Section title={t("employment.currentTitle")} views={s.current} ctx={ctx} />
      <Section title={t("employment.upcomingTitle")} views={s.upcoming} ctx={ctx} />
      <Section title={t("employment.historyTitle")} views={s.history} ctx={ctx} />
      <p className="muted small">{t("employment.fullHistoryNote")}</p>
    </div>
  );
}

