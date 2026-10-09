"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import type { Option } from "./useAssignmentOptions";

// S4.6 Employment Period correction (HR_ADMIN): Employee Type, start date, end date (date → date only).
export function PeriodCorrectionForm<T>({
  employmentId,
  current,
  revision,
  onSaved,
}: {
  employmentId: string;
  current: { start_date: string; end_date: string | null; employee_type: { id: string; name: string } | null };
  revision: number;
  onSaved: (updated: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Option[]>([]);
  const [form, setForm] = useState({
    employee_type_id: current.employee_type?.id ?? "",
    start_date: current.start_date,
    end_date: current.end_date ?? "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Historical corrections may use an existing inactive Employee Type (C-44).
    api<{ data: { id: string; code: string; name: string; is_active: boolean }[] }>("/api/v1/core-hr/employee-types?page_size=100&include_inactive=true")
      .then((r) => {
        if (!cancelled) setTypes(r.data.data.map((x) => ({ id: x.id, label: `${x.name} (${x.code})${x.is_active ? "" : " ✕"}` })));
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 8, marginLeft: 8 }}>
        {t("periodCorrection.open")}
      </button>
    );
  }

  const changes = [
    form.employee_type_id !== (current.employee_type?.id ?? "")
      ? { name: t("detail.employeeType"), before: current.employee_type?.name ?? "—", after: types.find((o) => o.id === form.employee_type_id)?.label ?? "…" }
      : null,
    form.start_date !== current.start_date ? { name: t("detail.startDate"), before: formatDate(current.start_date), after: formatDate(form.start_date) } : null,
    current.end_date && form.end_date !== current.end_date
      ? { name: t("detail.endDate"), before: formatDate(current.end_date), after: formatDate(form.end_date) }
      : null,
  ].filter((c) => c !== null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { expected_revision: revision, reason: form.reason.trim() };
    if (form.employee_type_id !== (current.employee_type?.id ?? "")) body.employee_type_id = form.employee_type_id;
    if (form.start_date !== current.start_date) body.start_date = form.start_date;
    if (current.end_date && form.end_date !== current.end_date) body.end_date = form.end_date;
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/period-corrections`, {
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

  return (
    <form onSubmit={save} className="card" style={{ marginTop: 12 }}>
      <h2>{t("periodCorrection.title")}</h2>
      <p className="muted small">{t("periodCorrection.help")}</p>
      <div className="grid2">
        <label>
          {t("detail.employeeType")}
          <select value={form.employee_type_id} onChange={set("employee_type_id")}>
            {!current.employee_type && <option value="">{t("form.none")}</option>}
            {types.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("detail.startDate")}
          <input type="date" required value={form.start_date} onChange={set("start_date")} />
        </label>
        {current.end_date ? (
          <label>
            {t("detail.endDate")}
            <input type="date" required min={form.start_date} value={form.end_date} onChange={set("end_date")} />
          </label>
        ) : (
          <p className="muted small">{t("periodCorrection.openEndNote")}</p>
        )}
      </div>
      <p className="muted small">{t("periodCorrection.endDateNote")}</p>
      <h2>{t("profileEdit.reviewTitle")}</h2>
      {changes.length === 0 ? (
        <p className="muted small">{t("profileEdit.noChanges")}</p>
      ) : (
        <>
          <ul className="small">
            {changes.map((c) => (
              <li key={c.name}>
                {c.name}: <span className="muted">{c.before}</span> → <strong>{c.after}</strong>
              </li>
            ))}
          </ul>
          <p className="muted small">{t("periodCorrection.assignmentNote")}</p>
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
          style={{ font: "inherit", padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}
        />
      </label>
      <ErrorBox error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" type="submit" disabled={busy || changes.length === 0 || !form.reason.trim()}>
          {busy ? t("form.saving") : t("periodCorrection.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
