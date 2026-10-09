"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t, tMaybe } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { ProfileEditForm } from "./ProfileEditForm";
import { AssignmentChangeForm } from "./AssignmentChangeForm";
import { AssignmentCorrectionForm } from "./AssignmentCorrectionForm";
import { EndEmploymentForm } from "./EndEmploymentForm";
import { InitialAssignmentForm } from "./InitialAssignmentForm";
import { PeriodCorrectionForm } from "./PeriodCorrectionForm";
import { WorkEmailEditor } from "./WorkEmailEditor";

type Ref = { id: string; code: string; name: string } | null;
type Assignment = {
  id: string;
  effective_from: string;
  effective_to: string | null;
  department: { id: string; name: string };
  job_title: { id: string; name_en: string };
  job_level: Ref;
  manager: { person_id: string; employee_code: string; full_name: string } | null;
};
type Detail = {
  id: string;
  revision: number;
  employee_code: string;
  full_name: string;
  employment_status: string;
  status_as_of: string;
  completeness: {
    operational: { status: "complete" | "incomplete"; rule_version: string; items: { code: string; satisfied: boolean }[] };
  };
  personal?: { gender: string | null; date_of_birth: string | null; personal_email: string | null; mobile_phone: string | null };
  employments: {
    id: string;
    start_date: string;
    end_date: string | null;
    period_lifecycle: string | null;
    events: { event_type: string; effective_date: string; recorded_at: string; end_reason: { code: string; label: string } | null }[];
    has_active_end_event: boolean;
    cancelled_at: string | null;
    employee_type: Ref;
    work_email: string | null;
    assignments: Assignment[];
  }[];
};

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [correctingRow, setCorrectingRow] = useState<string | null>(null);
  const session = useSession();

  useEffect(() => {
    api<Detail>(`/api/v1/core-hr/employees/${id}`)
      .then((r) => setD(r.data))
      .catch((e) => setError(e));
  }, [id]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <p className="muted">{t("app.loading")}</p>;
  const op = d.completeness.operational;
  // Historical corrections: HR_ADMIN only (employment.correct), never on cancelled periods.
  const canCorrect = (e: Detail["employments"][number]) => !e.cancelled_at && Boolean(session?.can("employment.correct"));

  return (
    <>
      <p>
        <Link href="/employees">{t("detail.back")}</Link>
      </p>
      <div className="spread">
        <h1>
          {d.full_name} <span className="muted">· {d.employee_code}</span>
        </h1>
        <div className="row">
          <span className={`badge ${d.employment_status === "active" ? "ok" : ""}`}>
            {tMaybe(`employmentStatus.${d.employment_status}`) ?? d.employment_status}
          </span>
          <span className={`badge ${op.status === "complete" ? "ok" : "warn"}`}>
            {t("completeness.operationalTitle")}: {t(`completeness.${op.status}`)}
          </span>
        </div>
      </div>
      <p className="muted small">{t("detail.statusNote", { date: formatDate(d.status_as_of) })}</p>
      {notice && <p className="alert ok-note small">{notice}</p>}
      {session?.can("employees.update") &&
        (editing ? (
          <ProfileEditForm
            profile={d}
            canEditPersonal={Boolean(session.can("employees.write_personal") && d.personal)}
            onSaved={(updated) => {
              setD(updated as unknown as Detail);
              setEditing(false);
              setNotice(t("profileEdit.saved"));
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <p>
            <button
              onClick={() => {
                setNotice(null);
                setEditing(true);
              }}
            >
              {t("profileEdit.edit")}
            </button>
          </p>
        ))}

      <div className="grid2">
        <section className="card">
          <h2>{t("completeness.operationalTitle")}</h2>
          <ul>
            {op.items.map((i) => (
              <li key={i.code}>
                {i.satisfied ? "✓" : "✗"} {tMaybe(`completeness.items.${i.code}`) ?? i.code}
              </li>
            ))}
          </ul>
          <p className="muted small">{t("completeness.ruleNote", { version: op.rule_version })}</p>
          <p className="muted small">
            {t("completeness.hrTitle")}: {t("completeness.hrNotDefined")} · {t("completeness.legalTitle")}: {t("completeness.legalPending")}
          </p>
        </section>
        <section className="card">
          <h2>{t("detail.personalTitle")}</h2>
          {d.personal ? (
            <dl className="kv">
              <dt>{t("detail.gender")}</dt>
              <dd>{d.personal.gender ? tMaybe(`gender.${d.personal.gender}`) ?? d.personal.gender : "—"}</dd>
              <dt>{t("detail.dateOfBirth")}</dt>
              <dd>{formatDate(d.personal.date_of_birth)}</dd>
              <dt>{t("detail.mobilePhone")}</dt>
              <dd>{d.personal.mobile_phone ?? "—"}</dd>
              <dt>{t("detail.personalEmail")}</dt>
              <dd>{d.personal.personal_email ?? "—"}</dd>
            </dl>
          ) : (
            <p className="muted">{t("detail.personalHidden")}</p>
          )}
          <p className="muted small">{t("detail.sensitiveNotice")}</p>
        </section>
      </div>

      <h2>{t("detail.employmentTitle")}</h2>
      <p className="muted small">{t("detail.historyNote")}</p>
      {d.employments.length === 0 && <p className="muted">{t("detail.noEmployment")}</p>}
      {d.employments.map((e, index) => (
        <section key={e.id} className="card" style={{ marginBottom: 12, opacity: e.cancelled_at ? 0.7 : 1 }}>
          <div className="spread" style={{ marginBottom: 8 }}>
            <strong>
              {t("detail.periodHeading", {
                n: index + 1,
                from: formatDate(e.start_date),
                to: e.end_date ? formatDate(e.end_date) : t("detail.periodOpenEnd"),
              })}
            </strong>
            {e.cancelled_at ? (
              <span className="badge">{t("detail.cancelledBadge")}</span>
            ) : (
              e.period_lifecycle && (
                <span className={`badge ${e.period_lifecycle === "active" ? "ok" : ""}`}>
                  {tMaybe(`employmentStatus.${e.period_lifecycle}`) ?? e.period_lifecycle}
                </span>
              )
            )}
          </div>
          {e.cancelled_at && <p className="muted small">{t("detail.cancelledNote")}</p>}
          <dl className="kv">
            <dt>{t("detail.startDate")}</dt>
            <dd>{formatDate(e.start_date)}</dd>
            <dt>{t("detail.endDate")}</dt>
            <dd>{e.end_date ? formatDate(e.end_date) : t("detail.notDetermined")}</dd>
            <dt>{t("detail.employeeType")}</dt>
            <dd>{e.employee_type?.name ?? "—"}</dd>
            <dt>{t("detail.workEmail")}</dt>
            <dd>{e.work_email ?? "—"}</dd>
          </dl>
          {!e.cancelled_at &&
            (session?.can("employment.correct") || (e.period_lifecycle !== "ended" && session?.can("employment.manage"))) && (
              <WorkEmailEditor<Detail>
                key={`${e.id}-${d.revision}-email`}
                employmentId={e.id}
                periodLabel={t("detail.periodHeading", {
                  n: index + 1,
                  from: formatDate(e.start_date),
                  to: e.end_date ? formatDate(e.end_date) : t("detail.periodOpenEnd"),
                })}
                current={e.work_email}
                ended={e.period_lifecycle === "ended"}
                canEdit={Boolean(e.period_lifecycle === "ended" ? session?.can("employment.correct") : session?.can("employment.manage"))}
                canClear={Boolean(session?.can("employment.correct"))}
                revision={d.revision}
                onSaved={(updated) => {
                  setD(updated);
                  setNotice(t("profileEdit.saved"));
                }}
              />
            )}
          {!e.cancelled_at && session?.can("employment.correct") && (
            <PeriodCorrectionForm<Detail>
              key={`${e.id}-${d.revision}-period`}
              employmentId={e.id}
              current={{ start_date: e.start_date, end_date: e.end_date, employee_type: e.employee_type }}
              hasActiveEndEvent={e.has_active_end_event}
              revision={d.revision}
              onSaved={(updated) => {
                setD(updated);
                setNotice(t("profileEdit.saved"));
              }}
            />
          )}
          {!e.cancelled_at && e.period_lifecycle !== "ended" && !e.has_active_end_event && session?.can("employment.manage") && (
            <EndEmploymentForm<Detail>
              key={`${e.id}-${d.revision}-end`}
              employmentId={e.id}
              employeeType={e.employee_type?.name ?? null}
              startDate={e.start_date}
              currentEnd={e.end_date}
              assignments={e.assignments}
              today={d.status_as_of}
              canBackdate={Boolean(session.can("employment.correct"))}
              revision={d.revision}
              onSaved={(updated) => {
                setD(updated);
                setNotice(t("profileEdit.saved"));
              }}
            />
          )}
          {!e.cancelled_at && e.assignments.length === 0 && session?.can("employment.manage") && (
            <InitialAssignmentForm<Detail>
              key={`${e.id}-${d.revision}-initial`}
              employmentId={e.id}
              personId={d.id}
              periodStart={e.start_date}
              periodEnd={e.end_date}
              today={d.status_as_of}
              revision={d.revision}
              onSaved={(updated) => {
                setD(updated);
                setNotice(t("profileEdit.saved"));
              }}
            />
          )}
          {!e.cancelled_at && e.period_lifecycle !== "ended" && e.assignments.length > 0 && session?.can("employment.manage") && (
            <AssignmentChangeForm<Detail>
              key={`${e.id}-${d.revision}`}
              employmentId={e.id}
              personId={d.id}
              current={e.assignments.at(-1) ?? null}
              revision={d.revision}
              minDate={session.can("employment.correct") ? undefined : d.status_as_of}
              onSaved={(updated) => {
                setD(updated);
                setNotice(t("profileEdit.saved"));
              }}
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
                  {canCorrect(e) && <th>{t("detail.actions")}</th>}
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
                    {canCorrect(e) && (
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
          {canCorrect(e) &&
            e.assignments.map(
              (a, i) =>
                correctingRow === a.id && (
                  <AssignmentCorrectionForm<Detail>
                    key={`${a.id}-${d.revision}`}
                    row={a}
                    previous={i > 0 ? e.assignments[i - 1] : null}
                    personId={d.id}
                    revision={d.revision}
                    onSaved={(updated) => {
                      setD(updated);
                      setCorrectingRow(null);
                      setNotice(t("profileEdit.saved"));
                    }}
                    onClose={() => setCorrectingRow(null)}
                  />
                ),
            )}
          <p className="small" style={{ marginTop: 12, marginBottom: 4 }}>
            <strong>{t("detail.events")}</strong>
          </p>
          {e.events.length === 0 ? (
            <p className="muted small">{t("detail.noEvents")}</p>
          ) : (
            <ul className="small" style={{ margin: 0 }}>
              {e.events.map((ev, i) => (
                <li key={i}>
                  {tMaybe(`detail.eventType.${ev.event_type}`) ?? ev.event_type} — {formatDate(ev.effective_date)}
                  {ev.end_reason && <> · {tMaybe(`endReason.${ev.end_reason.code}`) ?? ev.end_reason.label}</>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
