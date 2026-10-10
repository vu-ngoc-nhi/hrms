"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { useAssignmentOptions, type Option } from "./useAssignmentOptions";

type Current = {
  effective_from: string;
  department: { id: string; name: string };
  job_title: { id: string; name_en: string };
  job_level: { id: string; name: string } | null;
  manager: { person_id: string; full_name: string } | null;
} | null;

// Assignment Change = a genuine organizational event creating a new effective-dated assignment (S4.5).
export function AssignmentChangeForm<T>({
  employmentId,
  personId,
  current,
  revision,
  minDate,
  onSaved,
}: {
  employmentId: string;
  personId: string;
  current: Current;
  revision: number;
  /** Earliest date the caller may choose (today for HR_EDITOR); undefined when past dates are allowed. */
  minDate?: string;
  onSaved: (updated: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    effective_date: minDate ?? new Date().toISOString().slice(0, 10),
    department_id: current?.department.id ?? "",
    job_title_id: current?.job_title.id ?? "",
    job_level_id: current?.job_level?.id ?? "",
    manager_person_id: current?.manager?.person_id ?? "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  const opts = useAssignmentOptions(open, personId, setError);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 8, marginLeft: 8 }}>
        {t("assignmentChange.open")}
      </button>
    );
  }

  const label = (list: Option[], id: string) => list.find((o) => o.id === id)?.label ?? (id ? "…" : "—");
  const changes = [
    { name: t("employees.columns.department"), before: current?.department.id ?? "", after: form.department_id, list: opts.departments },
    { name: t("employees.columns.jobTitle"), before: current?.job_title.id ?? "", after: form.job_title_id, list: opts.jobTitles },
    { name: t("detail.jobLevel"), before: current?.job_level?.id ?? "", after: form.job_level_id, list: opts.levels },
    { name: t("detail.manager"), before: current?.manager?.person_id ?? "", after: form.manager_person_id, list: opts.managers },
  ].filter((c) => c.before !== c.after);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { expected_revision: revision, effective_date: form.effective_date, reason: form.reason.trim() };
    if (form.department_id !== (current?.department.id ?? "")) body.department_id = form.department_id;
    if (form.job_title_id !== (current?.job_title.id ?? "")) body.job_title_id = form.job_title_id;
    if (form.job_level_id !== (current?.job_level?.id ?? "")) body.job_level_id = form.job_level_id || null;
    if (form.manager_person_id !== (current?.manager?.person_id ?? "")) body.manager_person_id = form.manager_person_id || null;
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/assignment-changes`, {
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
  const select = (k: "department_id" | "job_title_id" | "job_level_id" | "manager_person_id", text: string, list: Option[], optional: boolean) => (
    <label>
      {text}
      <select value={form[k]} onChange={set(k)} required={!optional}>
        <option value="">{t("form.none")}</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={save} className="card" style={{ marginTop: 12 }}>
      <h2>{t("assignmentChange.title")}</h2>
      <p className="muted small">{t("assignmentChange.help")}</p>
      <div className="grid2">
        <label>
          {t("assignmentChange.effectiveDate")} *
          <input type="date" required min={minDate} value={form.effective_date} onChange={set("effective_date")} />
        </label>
        {select("department_id", t("employees.columns.department"), opts.departments, false)}
        {select("job_title_id", t("employees.columns.jobTitle"), opts.jobTitles, false)}
        {select("job_level_id", t("detail.jobLevel"), opts.levels, true)}
        {select("manager_person_id", t("detail.manager"), opts.managers, true)}
      </div>
      <h2>{t("assignmentChange.impact")}</h2>
      {changes.length === 0 ? (
        <p className="muted small">{t("profileEdit.noChanges")}</p>
      ) : (
        <>
          <p className="small">
            {current
              ? t("assignmentChange.impactClose", { from: formatDate(current.effective_from), to: formatDate(form.effective_date) })
              : t("assignmentChange.impactNone")}{" "}
            {t("assignmentChange.impactOpen", { from: formatDate(form.effective_date) })}
          </p>
          <ul className="small">
            {changes.map((c) => (
              <li key={c.name}>
                {c.name}: <span className="muted">{label(c.list, c.before)}</span> → <strong>{label(c.list, c.after)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      <label>
        {t("profileEdit.reason")} *
        <textarea
          required
          rows={2}
          maxLength={1000}
          value={form.reason}
          onChange={set("reason")}
        />
      </label>
      <ErrorBox error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" type="submit" disabled={busy || changes.length === 0 || !form.reason.trim()}>
          {busy ? t("form.saving") : t("assignmentChange.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
