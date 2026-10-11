"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t, tMaybe } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { useFormOpen, type Launched } from "./launch";

// PV-25 Void Employment Period. The confirmation screen is fed by the server's eligibility preview (blockers, warnings,
// internal records kept, consequences); the Void action re-evaluates everything server-side and never trusts it.
type Reference = {
  employment_id?: string;
  start_date?: string;
  end_date?: string | null;
  person_id?: string;
  employee_code?: string;
  full_name?: string;
  assignment_id?: string;
  effective_from?: string;
  effective_to?: string | null;
};
type Finding = { code: string; message: string; references: Reference[] };
type Eligibility = {
  evaluated_revision: number;
  as_of: string;
  eligible: boolean;
  period: { start_date: string; end_date: string | null; employee_type: { code: string; name: string } | null };
  blockers: Finding[];
  warnings: Finding[];
  affected_internal_records: {
    assignments: number;
    lifecycle_events: { event_type: string; effective_date: string }[];
    has_active_end_event: boolean;
    work_email: string | null;
    planned_end_date: string | null;
  };
  consequences: string[];
};

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <ul>
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`}>
          {tMaybe(`voidPeriod.findings.${f.code}`) ?? f.message}
          {f.references.length > 0 && (
            <ul>
              {f.references.map((r, j) => (
                <li key={j}>
                  {r.assignment_id
                    ? t("voidPeriod.refAssignment", { code: r.employee_code ?? "", name: r.full_name ?? "", from: formatDate(r.effective_from) })
                    : t("voidPeriod.refPeriod", { from: formatDate(r.start_date), to: r.end_date ? formatDate(r.end_date) : t("detail.periodOpenEnd") })}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function VoidPeriodForm<T>({
  employmentId,
  onSaved,
  launched,
}: {
  employmentId: string;
  onSaved: (updated: T) => void;
  /** UI-3: opened from the Employee header instead of its own button (the preview loads on open). */
  launched?: Launched;
}) {
  const [open, setOpen] = useFormOpen(launched);
  const [preview, setPreview] = useState<Eligibility | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setPreview((await api<Eligibility>(`/api/v1/core-hr/employments/${employmentId}/void-eligibility`)).data);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }

  // Opened from the header: fetch the eligibility preview once, as the inline button does on click.
  useEffect(() => {
    if (!launched) return;
    let cancelled = false;
    api<Eligibility>(`/api/v1/core-hr/employments/${employmentId}/void-eligibility`)
      .then((r) => !cancelled && setPreview(r.data))
      .catch((err) => !cancelled && setError(err as ApiCallError));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening; the form is remounted for each launch
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void load();
        }}
       
      >
        {t("voidPeriod.open")}
      </button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    const payload = JSON.stringify({ expected_revision: preview.evaluated_revision, reason: reason.trim() });
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/void`, {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": attempt.current.key },
      });
      setOpen(false);
      onSaved(r.data);
    } catch (err) {
      // A blocker that appeared after the preview (or a concurrent change) is shown together with a fresh preview.
      setError(err as ApiCallError);
      try {
        setPreview((await api<Eligibility>(`/api/v1/core-hr/employments/${employmentId}/void-eligibility`)).data);
      } catch {
        // keep the previous preview; the error above is shown
      }
    } finally {
      setBusy(false);
    }
  }

  const internal = preview?.affected_internal_records;
  return (
    <form onSubmit={save} className="card">
      <h2>{t("voidPeriod.title")}</h2>
      <p className="alert small">
        <strong>{t("voidPeriod.definition")}</strong>
      </p>
      <p className="muted small">{t("voidPeriod.notFor")}</p>
      {!preview && !error && <p className="muted small">{t("voidPeriod.loading")}</p>}
      {preview && internal && (
        <>
          <dl className="kv">
            <dt>{t("voidPeriod.period")}</dt>
            <dd>
              {formatDate(preview.period.start_date)} – {preview.period.end_date ? formatDate(preview.period.end_date) : t("detail.periodOpenEnd")}
              {preview.period.employee_type ? ` · ${preview.period.employee_type.name}` : ""}
            </dd>
          </dl>
          {preview.blockers.length > 0 && (
            <div className="alert error small" role="alert">
              <strong>{t("voidPeriod.blockersTitle")}</strong>
              <FindingList findings={preview.blockers} />
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div className="alert small">
              <strong>{t("voidPeriod.warningsTitle")}</strong>
              <FindingList findings={preview.warnings} />
            </div>
          )}
          <p className="small list-lead">
            <strong>{t("voidPeriod.internalTitle")}</strong>
          </p>
          <ul className="small">
            <li>{t("voidPeriod.internalAssignments", { n: internal.assignments })}</li>
            <li>
              {t("voidPeriod.internalEvents")}:{" "}
              {internal.lifecycle_events.length
                ? internal.lifecycle_events
                    .map((ev) => {
                      // Same wording as the history: a future-dated End reads "Planned end of employment" (C-80).
                      const key = ev.event_type === "end" && ev.effective_date > preview.as_of ? "end_planned" : ev.event_type;
                      return `${tMaybe(`detail.eventType.${key}`) ?? ev.event_type} (${formatDate(ev.effective_date)})`;
                    })
                    .join(", ")
                : "—"}
            </li>
            {internal.has_active_end_event && <li>{t("voidPeriod.internalActiveEnd")}</li>}
            {internal.work_email && <li>{t("voidPeriod.internalWorkEmail", { email: internal.work_email })}</li>}
            {internal.planned_end_date && <li>{t("voidPeriod.internalPlannedEnd", { date: formatDate(internal.planned_end_date) })}</li>}
          </ul>
          <p className="small list-lead">
            <strong>{t("voidPeriod.consequencesTitle")}</strong>
          </p>
          <ul className="small">
            {preview.consequences.map((c) => (
              <li key={c}>{tMaybe(`voidPeriod.consequences.${c}`) ?? c}</li>
            ))}
          </ul>
          <label>
            {t("voidPeriod.reason")} *
            <textarea
              required
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!preview.eligible}
            />
          </label>
        </>
      )}
      <ErrorBox error={error} />
      <div className="form-actions">
        {/* Destructive and exceptional: the danger style, never the ordinary primary action (UI-9). */}
        <button className="danger" type="submit" disabled={busy || !preview?.eligible || !reason.trim()}>
          {busy && preview ? t("form.saving") : t("voidPeriod.confirm")}
        </button>
        <button type="button" onClick={() => void load()} disabled={busy}>
          {t("voidPeriod.recheck")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
