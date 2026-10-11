"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { SELECTABLE_END_REASON_CODES } from "@/contracts/core-hr/end-reasons";
import { addDays } from "@/lib/dates";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { useFormOpen, type Launched } from "./launch";

type Row = { id: string; effective_from: string; effective_to: string | null; department: { name: string }; job_title: { name_en: string } };

// S4.7 End Employment (C-50): ends an open period, or shortens / confirms an existing future end date (never later).
export function EndEmploymentForm<T>({
  employmentId,
  employeeType,
  startDate,
  currentEnd,
  assignments,
  today,
  canBackdate,
  revision,
  onSaved,
  launched,
}: {
  employmentId: string;
  employeeType: string | null;
  startDate: string;
  currentEnd: string | null;
  assignments: Row[];
  today: string;
  /** HR_ADMIN (employment.correct) may choose a past end date (C-25). */
  canBackdate: boolean;
  revision: number;
  onSaved: (updated: T) => void;
  /** UI-3: opened from the Employee header instead of its own button. */
  launched?: Launched;
}) {
  const [open, setOpen] = useFormOpen(launched);
  const [form, setForm] = useState({ end_date: currentEnd ?? today, end_reason_code: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 8, marginLeft: 8 }}>
        {t("endEmployment.open")}
      </button>
    );
  }

  const end = form.end_date;
  const noteRequired = form.end_reason_code === "OTHER";
  const blocking = end ? assignments.filter((a) => a.effective_from > end) : [];
  // The assignment in effect on the end date closes at end + 1 when it extends past it (mirrors the server rule).
  const closing = end ? assignments.find((a) => a.effective_from <= end && (a.effective_to === null || a.effective_to > addDays(end, 1))) : undefined;
  const shortens = currentEnd !== null && end !== "" && end < currentEnd;
  const later = currentEnd !== null && end > currentEnd;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { expected_revision: revision, end_date: form.end_date, end_reason_code: form.end_reason_code };
    if (form.note.trim()) body.note = form.note.trim();
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/end`, {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": attempt.current.key },
      });
      setOpen(false);
      onSaved(r.data);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const minDate = canBackdate ? startDate : startDate > today ? startDate : today;

  return (
    <form onSubmit={save} className="card" style={{ marginTop: 12 }}>
      <h2>{t("endEmployment.title")}</h2>
      <p className="muted small">{t("endEmployment.help")}</p>
      {startDate > today && <p className="alert small">{t("endEmployment.preStartGuidance")}</p>}
      <dl className="kv">
        <dt>{t("detail.employeeType")}</dt>
        <dd>{employeeType ?? "—"}</dd>
        <dt>{t("endEmployment.currentEnd")}</dt>
        <dd>{currentEnd ? formatDate(currentEnd) : t("detail.notDetermined")}</dd>
      </dl>
      <div className="grid2">
        <label>
          {t("endEmployment.endDate")} *
          <input type="date" required min={minDate} max={currentEnd ?? undefined} value={form.end_date} onChange={set("end_date")} />
        </label>
        <label>
          {t("endEmployment.reason")} *
          <select required value={form.end_reason_code} onChange={set("end_reason_code")}>
            <option value="">{t("form.none")}</option>
            {SELECTABLE_END_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`endReason.${code}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t("endEmployment.note")}
        {noteRequired ? " *" : ""}
        <textarea
          required={noteRequired}
          rows={2}
          maxLength={1000}
          value={form.note}
          onChange={set("note")}
        />
      </label>
      <p className="muted small">{t("endEmployment.noteHelp")}</p>
      <h2>{t("assignmentChange.impact")}</h2>
      <ul className="small">
        {end && <li>{t("endEmployment.impactPeriod", { date: formatDate(end) })}</li>}
        {shortens && (
          <li>
            <strong>{t("endEmployment.impactShortens", { from: formatDate(currentEnd), to: formatDate(end) })}</strong>
          </li>
        )}
        {currentEnd !== null && end === currentEnd && <li>{t("endEmployment.impactSameDate")}</li>}
        {closing && <li>{t("endEmployment.impactAssignment", { from: formatDate(closing.effective_from), to: formatDate(end) })}</li>}
        {!closing && blocking.length === 0 && end && <li>{t("endEmployment.impactNoAssignment")}</li>}
      </ul>
      {later && <p className="alert small">{t("endEmployment.laterNotAllowed")}</p>}
      {blocking.length > 0 && (
        <p className="alert small">
          {t(
            // PV-29 / BD-9: a still-planned assignment is cancelled with Cancel Planned Assignment, never auto-changed.
            blocking.every((a) => a.effective_from > today) ? "endEmployment.blockedPlanned" : "endEmployment.blocked",
            { list: blocking.map((a) => `${formatDate(a.effective_from)} ${a.department.name}`).join(", ") },
          )}
        </p>
      )}
      <ErrorBox error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="primary"
          type="submit"
          disabled={busy || !end || !form.end_reason_code || (noteRequired && !form.note.trim()) || later || blocking.length > 0}
        >
          {busy ? t("form.saving") : t("endEmployment.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
