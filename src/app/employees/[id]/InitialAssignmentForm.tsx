"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { useAssignmentOptions, type Option } from "./useAssignmentOptions";
import { useFormOpen, type Launched } from "./launch";

// Add Initial Assignment (S4.5A, C-41): only shown for a non-cancelled period without assignments.
// A past effective date is Initial Data Capture and needs a reason; earlier history is never invented.
export function InitialAssignmentForm<T>({
  employmentId,
  personId,
  periodStart,
  periodEnd,
  today,
  revision,
  onSaved,
  launched,
}: {
  employmentId: string;
  personId: string;
  periodStart: string;
  periodEnd: string | null;
  today: string;
  revision: number;
  onSaved: (updated: T) => void;
  /** UI-3: opened from the Employee header instead of its own button. */
  launched?: Launched;
}) {
  const [open, setOpen] = useFormOpen(launched);
  const [form, setForm] = useState({
    effective_date: periodStart,
    department_id: "",
    job_title_id: "",
    job_level_id: "",
    manager_person_id: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const opts = useAssignmentOptions(open, personId, setError);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {t("initialAssignment.open")}
      </button>
    );
  }

  const backdated = form.effective_date !== "" && form.effective_date < today;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      expected_revision: revision,
      effective_date: form.effective_date,
      department_id: form.department_id,
      job_title_id: form.job_title_id,
    };
    if (form.job_level_id) body.job_level_id = form.job_level_id;
    if (form.manager_person_id) body.manager_person_id = form.manager_person_id;
    if (form.reason.trim()) body.reason = form.reason.trim();
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/initial-assignment`, {
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
      {optional ? "" : " *"}
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
    <form onSubmit={save} className="card">
      <h2>{t("initialAssignment.title")}</h2>
      <p className="muted small">{t("initialAssignment.help")}</p>
      <div className="grid2">
        <label>
          {t("assignmentChange.effectiveDate")} *
          <input
            type="date"
            required
            min={periodStart}
            max={periodEnd ?? undefined}
            value={form.effective_date}
            onChange={set("effective_date")}
          />
        </label>
        {select("department_id", t("employees.columns.department"), opts.departments, false)}
        {select("job_title_id", t("employees.columns.jobTitle"), opts.jobTitles, false)}
        {select("job_level_id", t("detail.jobLevel"), opts.levels, true)}
        {select("manager_person_id", t("detail.manager"), opts.managers, true)}
      </div>
      {backdated && <p className="alert small">{t("initialAssignment.backdatedNote")}</p>}
      <label>
        {t("profileEdit.reason")}
        {backdated ? " *" : ""}
        <textarea
          required={backdated}
          rows={2}
          maxLength={1000}
          value={form.reason}
          onChange={set("reason")}
        />
      </label>
      <ErrorBox error={error} />
      <div className="form-actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || !form.department_id || !form.job_title_id || (backdated && !form.reason.trim())}
        >
          {busy ? t("form.saving") : t("initialAssignment.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
