"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, EmptyState } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { AssignmentCorrectionForm } from "./AssignmentCorrectionForm";
import { PeriodWorkflow, actionLabel } from "./PeriodWorkflow";
import type { TabContext } from "./tabContext";
import { assignmentSections, type AssignmentView, type DateWording, type EmptyPeriod } from "./assignmentModel";
import { periodEligibility, type Detail, type Period } from "./detailModel";

// UI-6 Assignment tab: Current → Upcoming → Assignment History (+ records of cancelled/voided periods, never
// operational). Business date wording only: "Effective since", "Takes effect on", "Effective from … / Replaced on …"
// — an exclusive end boundary is never shown next to the next row's start. Change Assignment for the representative
// period stays the red header action (D-UI-13); row corrections stay on their row; nothing here is primary red.

type Workflow = { kind: "correct" | "change" | "initial"; n: number };

function useInlineWorkflow() {
  const [open, setOpen] = useState<Workflow | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const field = ref.current.querySelector<HTMLElement>("input, select, textarea");
    (field ?? ref.current).focus({ preventScroll: true });
  }, [open]);
  const launch = (kind: Workflow["kind"]) => setOpen((o) => ({ kind, n: (o?.n ?? 0) + 1 }));
  return { open, ref, launch, close: () => setOpen(null) };
}

const periodContext = (d: Detail, p: Period, n: number) =>
  t("assignmentTab.periodContext", { n, type: p.employee_type?.name ?? "—", start: formatDate(p.start_date) }) +
  (p.cancelled_at ? ` · ${t("employment.label.cancelled")}` : p.voided_at ? ` · ${t("employment.label.voided")}` : "");

function DateRows({ w }: { w: DateWording }) {
  switch (w.kind) {
    case "since":
      return (
        <div>
          <dt>{t("assignmentTab.effectiveSince")}</dt>
          <dd>{formatDate(w.date)}</dd>
        </div>
      );
    case "takes_effect":
      return (
        <div>
          <dt>{t("assignmentTab.takesEffectOn")}</dt>
          <dd>{formatDate(w.date)}</dd>
        </div>
      );
    case "replaced":
      return (
        <>
          <div>
            <dt>{t("assignmentTab.effectiveFrom")}</dt>
            <dd>{formatDate(w.from)}</dd>
          </div>
          <div>
            <dt>{t("assignmentTab.replacedOn")}</dt>
            <dd>{formatDate(w.on)}</dd>
          </div>
        </>
      );
    case "through":
      return (
        <>
          <div>
            <dt>{t("assignmentTab.effectiveFrom")}</dt>
            <dd>{formatDate(w.from)}</dd>
          </div>
          <div>
            <dt>{t("assignmentTab.effectiveThrough")}</dt>
            <dd>{formatDate(w.through)}</dd>
          </div>
        </>
      );
    default:
      return (
        <div>
          <dt>{t("assignmentTab.effectiveFrom")}</dt>
          <dd>{formatDate(w.from)}</dd>
        </div>
      );
  }
}

function AssignmentCard({ v, ctx, showPeriod }: { v: AssignmentView; ctx: TabContext; showPeriod: boolean }) {
  const { d, can, targetId, onSaved } = ctx;
  const { open: wfOpen, ref: wfRef, launch, close } = useInlineWorkflow();
  const a = v.values;
  const el = periodEligibility(d, v.period, can);
  // D-UI-14: rows of cancelled / voided periods never get mutation actions (eligibility is already false for them).
  const canCorrect = v.disposition === null && el.correctAssignmentRows;
  // D-UI-13: the representative period's Change Assignment is the header's primary action; other operational
  // periods offer it (secondary) on their latest row, the row a change follows.
  const canChange = v.disposition === null && v.latestOfPeriod && el.changeAssignment && v.period.id !== targetId;
  const rows = [...v.period.assignments].sort((x, y) => (x.effective_from < y.effective_from ? -1 : 1));
  const previous = rows[rows.findIndex((r) => r.id === v.assignment.id) - 1] ?? null;
  const fromDate = formatDate(v.assignment.effective_from);
  const notes: ReactNode[] = [];
  if (v.label === "upcoming") notes.push(t("assignmentTab.notInEffectYet"));
  if (v.changesOn) notes.push(t("assignmentTab.changesOnNote", { date: formatDate(v.changesOn) }));
  if (v.label === "last") notes.push(t("assignmentTab.lastNote"));
  if (v.disposition) notes.push(t(v.disposition === "voided" ? "assignmentTab.voidedNote" : "assignmentTab.cancelledNote"));

  return (
    <article className={`card assignment-card ${v.disposition ?? v.label}`} aria-labelledby={`asg-${v.assignment.id}`}>
      <header className="period-head">
        <h3 id={`asg-${v.assignment.id}`}>
          {a.jobTitle}
          <span className="period-type"> · {a.department}</span>
        </h3>
        <span className={`badge period-label ${v.disposition ?? v.label}`}>{v.label === "not_operational" ? t(`employment.label.${v.disposition ?? "voided"}`) : t(`assignmentTab.label.${v.label}`)}</span>
      </header>
      {showPeriod && <p className="period-note lead">{periodContext(d, v.period, v.periodNumber)}</p>}
      <dl className="info-grid">
        <div>
          <dt>{t("overview.department")}</dt>
          <dd>{a.department}</dd>
        </div>
        <div>
          <dt>{t("overview.jobTitle")}</dt>
          <dd>{a.jobTitle}</dd>
        </div>
        <div>
          <dt>{t("overview.level")}</dt>
          <dd>{a.level ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("overview.manager")}</dt>
          <dd>
            {a.manager ? (
              <Link href={`/employees/${a.manager.personId}`}>
                {a.manager.name} ({a.manager.code})
              </Link>
            ) : (
              <span aria-label={t("assignmentTab.noManager")}>—</span>
            )}
          </dd>
        </div>
        <DateRows w={v.wording} />
      </dl>
      {notes.map((n, i) => (
        <p key={i} className="period-note">
          {n}
        </p>
      ))}
      {v.changes.length > 0 && (
        <p className="period-note change-summary">
          <span>{t("assignmentTab.changedFromPrevious")}</span>{" "}
          {v.changes.map((c, i) => (
            <span key={c.field}>
              {i > 0 && " · "}
              {t(`overview.field.${c.field}`)}: {c.from} → <strong>{c.to}</strong>
            </span>
          ))}
        </p>
      )}
      {showPeriod && v.firstOfPeriod && !v.disposition && v.label !== "current" && <p className="period-note">{t("assignmentTab.firstOfPeriod", { n: v.periodNumber })}</p>}

      {(canCorrect || canChange) && (
        <div className="period-actions">
          {canChange && (
            <Button size="small" onClick={() => launch("change")}>
              {actionLabel("change_assignment")}
            </Button>
          )}
          {canCorrect && (
            <Button size="small" variant="ghost" onClick={() => launch("correct")} aria-label={t("assignmentTab.correctFor", { date: fromDate })}>
              {t("assignmentTab.correct")}
            </Button>
          )}
        </div>
      )}
      {wfOpen && (
        <div ref={wfRef} className="period-workflow" tabIndex={-1} role="region" aria-label={wfOpen.kind === "correct" ? t("assignmentTab.correctFor", { date: fromDate }) : actionLabel("change_assignment")}>
          {wfOpen.kind === "correct" ? (
            <AssignmentCorrectionForm<Detail>
              key={wfOpen.n}
              row={v.assignment}
              previous={previous}
              personId={d.id}
              revision={d.revision}
              onSaved={(u) => {
                close();
                onSaved(u);
              }}
              onClose={close}
            />
          ) : (
            <PeriodWorkflow key={wfOpen.n} action="change_assignment" period={v.period} d={d} can={can} onSaved={(u, m) => {
                close();
                onSaved(u, m);
              }} onClose={close} />
          )}
        </div>
      )}
    </article>
  );
}

function EmptyPeriodCard({ e, ctx, showPeriod }: { e: EmptyPeriod; ctx: TabContext; showPeriod: boolean }) {
  const { d, can, onSaved } = ctx;
  const { open: wfOpen, ref: wfRef, launch, close } = useInlineWorkflow();
  const el = periodEligibility(d, e.period, can);
  return (
    <article className="card assignment-card empty" aria-label={t("assignmentTab.emptyTitle", { n: e.periodNumber })}>
      {showPeriod && <p className="period-note lead">{periodContext(d, e.period, e.periodNumber)}</p>}
      <p className="assignment-empty">{t("assignmentTab.emptyBody", { n: e.periodNumber })}</p>
      {el.initialAssignment && (
        <div className="period-actions">
          <Button size="small" onClick={() => launch("initial")}>
            {actionLabel("initial_assignment")}
          </Button>
        </div>
      )}
      {wfOpen && (
        <div ref={wfRef} className="period-workflow" tabIndex={-1} role="region" aria-label={actionLabel("initial_assignment")}>
          <PeriodWorkflow key={wfOpen.n} action="initial_assignment" period={e.period} d={d} can={can} onSaved={(u, m) => {
                close();
                onSaved(u, m);
              }} onClose={close} />
        </div>
      )}
    </article>
  );
}

function Section({ title, children, note }: { title: string; children: ReactNode[]; note?: string }) {
  if (!children.some(Boolean)) return null;
  return (
    <section className="employment-section" aria-label={title}>
      <h2>{title}</h2>
      {note && <p className="muted small">{note}</p>}
      <div className="period-list">{children}</div>
    </section>
  );
}

export function AssignmentTab({ ctx }: { ctx: TabContext }) {
  const s = assignmentSections(ctx.d);
  const show = s.multiplePeriods;
  const card = (v: AssignmentView) => <AssignmentCard key={v.assignment.id} v={v} ctx={ctx} showPeriod={show} />;
  const empty = (section: EmptyPeriod["section"]) =>
    s.emptyPeriods.filter((e) => e.section === section).map((e) => <EmptyPeriodCard key={e.period.id} e={e} ctx={ctx} showPeriod={show} />);
  const nothing = !s.current.length && !s.upcoming.length && !s.history.length && !s.emptyPeriods.length;
  return (
    <div className="employment-tab">
      {nothing && (
        <EmptyState title={t("employmentStatus.no_employment")}>{t(ctx.d.employments.length ? "detail.onlyDisposedRecords" : "detail.noEmploymentRecorded")}</EmptyState>
      )}
      <Section title={t("assignmentTab.currentTitle")}>{[...s.current.map(card), ...empty("current")]}</Section>
      <Section title={s.upcoming.length > 1 ? t("assignmentTab.upcomingTitlePlural") : t("assignmentTab.upcomingTitle")}>
        {[...s.upcoming.map(card), ...empty("upcoming")]}
      </Section>
      <Section title={t("assignmentTab.historyTitle")}>{[...s.history.map(card), ...empty("history")]}</Section>
      <Section title={t("assignmentTab.notOperationalTitle")} note={t("assignmentTab.notOperationalNote")}>
        {s.notOperational.map(card)}
      </Section>
    </div>
  );
}
