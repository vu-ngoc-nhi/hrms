"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { useAssignmentOptions, type Option } from "./useAssignmentOptions";

type Row = {
  id: string;
  effective_from: string;
  effective_to: string | null;
  department: { id: string; name: string };
  job_title: { id: string; name_en: string };
  job_level: { id: string; name: string } | null;
  manager: { person_id: string; full_name: string } | null;
};

// S4.6 Assignment row correction (HR_ADMIN): fixes the row in place. effective_to is never edited directly; for a
// non-first row the previous row's end moves with the corrected start (C-42).
export function AssignmentCorrectionForm<T>({
  row,
  previous,
  personId,
  revision,
  onSaved,
  onClose,
}: {
  row: Row;
  previous: Row | null;
  personId: string;
  revision: number;
  onSaved: (updated: T) => void;
  onClose: () => void;
}) {
  const initial = {
    effective_from: row.effective_from,
    department_id: row.department.id,
    job_title_id: row.job_title.id,
    job_level_id: row.job_level?.id ?? "",
    manager_person_id: row.manager?.person_id ?? "",
  };
  const [form, setForm] = useState({ ...initial, reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const opts = useAssignmentOptions(true, personId, setError, true);

  const label = (list: Option[], id: string) => list.find((o) => o.id === id)?.label ?? (id ? "…" : "—");
  const changes = [
    { name: t("assignmentChange.effectiveDate"), before: formatDate(initial.effective_from), after: formatDate(form.effective_from), changed: form.effective_from !== initial.effective_from },
    { name: t("employees.columns.department"), before: label(opts.departments, initial.department_id), after: label(opts.departments, form.department_id), changed: form.department_id !== initial.department_id },
    { name: t("employees.columns.jobTitle"), before: label(opts.jobTitles, initial.job_title_id), after: label(opts.jobTitles, form.job_title_id), changed: form.job_title_id !== initial.job_title_id },
    { name: t("detail.jobLevel"), before: label(opts.levels, initial.job_level_id), after: label(opts.levels, form.job_level_id), changed: form.job_level_id !== initial.job_level_id },
    { name: t("detail.manager"), before: row.manager?.full_name ?? "—", after: label(opts.managers, form.manager_person_id), changed: form.manager_person_id !== initial.manager_person_id },
  ].filter((c) => c.changed);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { expected_revision: revision, reason: form.reason.trim() };
    if (form.effective_from !== initial.effective_from) body.effective_from = form.effective_from;
    if (form.department_id !== initial.department_id) body.department_id = form.department_id;
    if (form.job_title_id !== initial.job_title_id) body.job_title_id = form.job_title_id;
    if (form.job_level_id !== initial.job_level_id) body.job_level_id = form.job_level_id || null;
    if (form.manager_person_id !== initial.manager_person_id) body.manager_person_id = form.manager_person_id || null;
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/assignments/${row.id}/corrections`, {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": attempt.current.key },
      });
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
        {optional && <option value="">{t("form.none")}</option>}
        {k === "manager_person_id" && row.manager && !list.some((o) => o.id === row.manager!.person_id) && (
          <option value={row.manager.person_id}>{row.manager.full_name}</option>
        )}
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
      <h2>{t("assignmentCorrection.title", { from: formatDate(row.effective_from) })}</h2>
      <p className="muted small">{t("assignmentCorrection.help")}</p>
      <div className="grid2">
        <label>
          {t("assignmentChange.effectiveDate")}
          <input type="date" required value={form.effective_from} onChange={set("effective_from")} />
        </label>
        {select("department_id", t("employees.columns.department"), opts.departments, false)}
        {select("job_title_id", t("employees.columns.jobTitle"), opts.jobTitles, false)}
        {select("job_level_id", t("detail.jobLevel"), opts.levels, true)}
        {select("manager_person_id", t("detail.manager"), opts.managers, true)}
      </div>
      <h2>{t("profileEdit.reviewTitle")}</h2>
      {changes.length === 0 ? (
        <p className="muted small">{t("profileEdit.noChanges")}</p>
      ) : (
        <ul className="small">
          {changes.map((c) => (
            <li key={c.name}>
              {c.name}: <span className="muted">{c.before}</span> → <strong>{c.after}</strong>
            </li>
          ))}
          {previous && form.effective_from !== initial.effective_from && (
            <li>{t("assignmentCorrection.previousMoves", { from: formatDate(previous.effective_from), to: formatDate(form.effective_from) })}</li>
          )}
        </ul>
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
          {busy ? t("form.saving") : t("assignmentCorrection.save")}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
