"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { formatDate, t, tMaybe } from "@/i18n";
import type { AssignmentSummary, Overview, UpcomingChange } from "./detailModel";

// UI-3 Overview: the HR snapshot of one person. Everything shown comes from the pure view model (detailModel.ts);
// current and upcoming information are visually distinct (upcoming cards carry the INFO accent, D-UI-12, and say so in words).

const endReasonLabel = (r: { code: string; label: string } | null) => (r ? tMaybe(`endReason.${r.code}`) ?? r.label : null);
const assignmentLine = (a: AssignmentSummary) => `${a.department} / ${a.jobTitle}`;

function ManagerValue({ manager }: { manager: AssignmentSummary["manager"] }) {
  // Manager is optional (M-04): absence is neutral, never an error.
  if (!manager) return <>—</>;
  return (
    <Link href={`/employees/${manager.personId}`}>
      {manager.name} ({manager.code})
    </Link>
  );
}

/** One label-above-value pair (same field styling as the Personal, Employment and Assignment tabs). */
function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EmploymentCard({ o, status }: { o: Overview; status: string }) {
  const e = o.employment;
  const title = t(`overview.employmentTitle.${e.kind}`);
  if (e.kind === "none") {
    return (
      <section className="card" aria-labelledby="ov-employment">
        <h2 id="ov-employment">{title}</h2>
        <dl className="info-grid">
          <Info label={t("overview.employmentStatus")}>
            <StatusBadge kind="employment" code="no_employment" />
          </Info>
        </dl>
        <p className="muted small">{t(e.hasDisposedRecords ? "detail.onlyDisposedRecords" : "detail.noEmploymentRecorded")}</p>
      </section>
    );
  }
  const reason = endReasonLabel(e.endReason);
  return (
    <section className={e.kind === "pre_start" ? "card upcoming" : "card"} aria-labelledby="ov-employment">
      <h2 id="ov-employment">{title}</h2>
      <dl className="info-grid">
        <Info label={t("overview.employmentStatus")}>
          <StatusBadge kind="employment" code={status} />
        </Info>
        <Info label={t("overview.employeeType")}>{e.employeeType ?? "—"}</Info>
        <Info label={t("overview.startDate")}>{formatDate(e.startDate)}</Info>
        {e.endDate && <Info label={e.plannedEnd ? t("overview.plannedEnd") : t("overview.endDate")}>{formatDate(e.endDate)}</Info>}
        {e.endDate && reason && <Info label={t("overview.endReason")}>{reason}</Info>}
      </dl>
      {e.kind === "pre_start" && <p className="muted small">{t("overview.preStartNote", { date: formatDate(e.startDate) })}</p>}
      {e.previousEnd && <p className="muted small">{t("overview.previousEnd", { date: formatDate(e.previousEnd) })}</p>}
      {e.kind === "ended" && e.endDate && <p className="muted small">{t("overview.endedNote", { date: formatDate(e.endDate) })}</p>}
    </section>
  );
}

function AssignmentCard({ o }: { o: Overview }) {
  const v = o.assignment;
  const title = t(`overview.assignmentTitle.${v.kind}`);
  if (v.kind === "none") {
    const body = v.reason === "no_employment" ? "overview.noEmploymentAssignment" : v.reason === "no_assignment" ? "detail.noAssignmentYet" : "overview.noneInEffect";
    return (
      <section className="card" aria-labelledby="ov-assignment">
        <h2 id="ov-assignment">{title}</h2>
        <p className="muted">{t(body)}</p>
      </section>
    );
  }
  const a = v.assignment;
  // Same date wording as the Assignment tab: Effective since (current) / Takes effect on (upcoming) / Effective from (last).
  const dateLabel = v.kind === "current" ? "assignmentTab.effectiveSince" : v.kind === "upcoming" ? "assignmentTab.takesEffectOn" : "assignmentTab.effectiveFrom";
  return (
    <section className={v.kind === "upcoming" ? "card upcoming" : "card"} aria-labelledby="ov-assignment">
      <h2 id="ov-assignment">{title}</h2>
      <dl className="info-grid">
        <Info label={t("overview.department")}>{a.department}</Info>
        <Info label={t("overview.jobTitle")}>{a.jobTitle}</Info>
        <Info label={t("overview.level")}>{a.level ?? "—"}</Info>
        <Info label={t("overview.manager")}>
          <ManagerValue manager={a.manager} />
        </Info>
        <Info label={t(dateLabel)}>{formatDate(a.effectiveFrom)}</Info>
      </dl>
      {v.kind === "upcoming" && <p className="muted small">{t("assignmentTab.notInEffectYet")}</p>}
      {v.kind === "last" && v.periodEnd && <p className="muted small">{t("overview.lastAssignmentNote", { date: formatDate(v.periodEnd) })}</p>}
    </section>
  );
}

function fieldValue(a: AssignmentSummary | null, field: "department" | "job_title" | "level" | "manager"): string {
  if (!a) return "—";
  if (field === "department") return a.department;
  if (field === "job_title") return a.jobTitle;
  if (field === "level") return a.level ?? "—";
  return a.manager ? a.manager.name : "—";
}

function ChangeItem({ c }: { c: UpcomingChange }) {
  let title: string;
  let body: React.ReactNode = null;
  if (c.kind === "assignment_change") {
    title = c.from ? t("overview.change.assignment") : t("overview.change.assignmentFirst");
    const both = c.changed.includes("department") || c.changed.includes("job_title");
    body = (
      <>
        {c.from && both && (
          <div>
            {assignmentLine(c.from)} → <strong>{assignmentLine(c.to)}</strong>
          </div>
        )}
        {!c.from && (
          <div>
            <strong>{assignmentLine(c.to)}</strong>
          </div>
        )}
        {c.from &&
          c.changed
            .filter((f) => f === "level" || f === "manager")
            .map((f) => (
              <div key={f}>
                {t(`overview.field.${f}`)}: {fieldValue(c.from, f)} → <strong>{fieldValue(c.to, f)}</strong>
              </div>
            ))}
        <div className="muted">{t("overview.change.assignmentEffective", { date: formatDate(c.date) })}</div>
      </>
    );
  } else if (c.kind === "planned_end") {
    title = t("overview.change.plannedEnd");
    const reason = endReasonLabel(c.endReason);
    body = (
      <div className="muted">
        {t("overview.change.plannedEndNote")}
        {reason && <> · {reason}</>}
      </div>
    );
  } else if (c.kind === "relationship_change") {
    title = t("overview.change.relationshipChange");
    body = (
      <>
        <div>
          {c.fromType ?? "—"} → <strong>{c.toType ?? "—"}</strong>
        </div>
        {c.assignment && (
          <div>
            {t("overview.change.withAssignment", { assignment: assignmentLine(c.assignment) })}
            {c.assignment.effectiveFrom !== c.date && <> ({t("overview.change.assignmentFrom", { date: formatDate(c.assignment.effectiveFrom) })})</>}
          </div>
        )}
        <div className="muted">{t("overview.change.relationshipChangeNote", { date: formatDate(c.previousEnd) })}</div>
      </>
    );
  } else {
    title = c.first ? t("overview.change.periodStartFirst") : t("overview.change.periodStart");
    body = (
      <>
        {c.employeeType && <div>{c.employeeType}</div>}
        {c.assignment && (
          <div>
            {t("overview.change.withAssignment", { assignment: assignmentLine(c.assignment) })}
            {c.assignment.effectiveFrom !== c.date && <> ({t("overview.change.assignmentFrom", { date: formatDate(c.assignment.effectiveFrom) })})</>}
          </div>
        )}
      </>
    );
  }
  return (
    <li className="change-item">
      <div className="change-date">{formatDate(c.date)}</div>
      <div className="change-body">
        <div className="change-title">{title}</div>
        {body}
      </div>
    </li>
  );
}

export function OverviewTab({ o, status, statusAsOf }: { o: Overview; status: string; statusAsOf: string }) {
  return (
    <div className="overview-grid">
      <EmploymentCard o={o} status={status} />
      <AssignmentCard o={o} />

      <section className={o.upcoming.length ? "card upcoming span-2" : "card span-2"} aria-labelledby="ov-upcoming">
        <div className="card-header">
          <h2 id="ov-upcoming">{t("overview.upcomingTitle")}</h2>
          {o.upcoming.length > 0 && <span className="badge info">{t("overview.upcomingBadge")}</span>}
        </div>
        {o.upcoming.length === 0 ? (
          <p className="muted">{t("overview.noUpcoming")}</p>
        ) : (
          <ol className="change-list">
            {o.upcoming.map((c) => (
              <ChangeItem key={`${c.kind}-${c.periodId}-${c.date}`} c={c} />
            ))}
          </ol>
        )}
      </section>

      <section className="card" aria-labelledby="ov-identity">
        <h2 id="ov-identity">{t("overview.identityTitle")}</h2>
        <dl className="info-grid">
          <Info label={t("overview.fullName")}>{o.identity.fullName}</Info>
          <Info label={t("overview.employeeCode")}>{o.identity.employeeCode}</Info>
          <Info label={t("overview.workEmail")}>{o.identity.workEmail ?? "—"}</Info>
        </dl>
      </section>

      <section className="card" aria-labelledby="ov-health">
        <div className="card-header">
          <h2 id="ov-health">{t("overview.healthTitle")}</h2>
          <StatusBadge
            kind="completeness"
            code={o.health.status}
            label={o.health.status === "complete" ? t("completeness.complete") : t("employees.completenessOption.incomplete")}
          />
        </div>
        {o.health.status === "complete" && o.health.missing.length === 0 ? (
          <p className="muted">{t("overview.healthCompleteBody")}</p>
        ) : (
          o.health.missing.length > 0 && (
            <div>
              <span>{t("overview.healthMissing")}</span>
              <ul className="health-missing">
                {o.health.missing.map((code) => (
                  <li key={code}>{tMaybe(`completeness.items.${code}`) ?? code}</li>
                ))}
              </ul>
            </div>
          )
        )}
        <p className="muted small" title={o.health.ruleVersion}>
          {t("overview.ruleNote")}
        </p>
        <p className="muted small">{t("overview.statusAsOf", { date: formatDate(statusAsOf) })}</p>
      </section>
    </div>
  );
}
