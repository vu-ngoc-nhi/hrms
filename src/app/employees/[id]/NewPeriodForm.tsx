"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t } from "@/i18n";
import { addDays } from "@/lib/dates";
import { api, ApiCallError } from "@/lib/client/api";

type Option = { id: string; label: string };
type Previous = { start_date: string; end_date: string; employee_type: { id: string; name: string } | null; has_active_end_event: boolean };

// S4.8: Add Initial Employment Period (C-60) and Rehire (C-61, C-62) are distinct actions sharing this form.
// Nothing is pre-filled from earlier periods: HR provides the new relationship's data explicitly.
export function NewPeriodForm<T>({
  mode,
  personId,
  previous,
  hasCancelledPeriods,
  today,
  canBackdate,
  revision,
  onSaved,
}: {
  mode: "initial" | "rehire";
  personId: string;
  /** Rehire only: the latest non-cancelled period. */
  previous?: Previous;
  hasCancelledPeriods?: boolean;
  today: string;
  /** Rehire: HR_ADMIN may backdate (C-25). Initial Data Capture always allows a past date. */
  canBackdate: boolean;
  revision: number;
  onSaved: (updated: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Option[]>([]);
  const earliestRehire = previous ? addDays(previous.end_date, 1) : undefined;
  const [form, setForm] = useState({
    start_date: mode === "rehire" ? (earliestRehire! > today ? earliestRehire! : today) : today,
    end_date: "",
    employee_type_id: "",
    work_email: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ data: { id: string; code: string; name: string }[] }>("/api/v1/core-hr/employee-types?page_size=100")
      .then((r) => {
        if (!cancelled) setTypes(r.data.data.map((x) => ({ id: x.id, label: `${x.name} (${x.code})` })));
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const prefix = mode === "initial" ? "initialEmployment" : "rehire";
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>
        {t(`${prefix}.open`)}
      </button>
    );
  }

  const backdated = form.start_date !== "" && form.start_date < today;
  const reasonRequired = mode === "rehire" || backdated;
  const minStart = mode === "rehire" ? [earliestRehire!, canBackdate ? "" : today].sort().at(-1) : undefined;
  const plannedRehire = mode === "rehire" && previous!.end_date >= today;
  const continuousTypeChange =
    mode === "rehire" && form.start_date === earliestRehire && form.employee_type_id !== "" && form.employee_type_id !== (previous!.employee_type?.id ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { expected_revision: revision, start_date: form.start_date };
    if (form.end_date) body.end_date = form.end_date;
    if (form.employee_type_id) body.employee_type_id = form.employee_type_id;
    if (form.work_email.trim()) body.work_email = form.work_email.trim();
    if (form.reason.trim()) body.reason = form.reason.trim();
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employees/${personId}/${mode === "initial" ? "initial-employment" : "rehire"}`, {
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
    <form onSubmit={save} className="card" style={{ marginBottom: 12 }}>
      <h2>{t(`${prefix}.title`)}</h2>
      <p className="muted small">{t(`${prefix}.help`)}</p>
      {mode === "initial" && hasCancelledPeriods && <p className="muted small">{t("initialEmployment.cancelledNote")}</p>}
      {mode === "rehire" && previous && (
        <dl className="kv">
          <dt>{t("rehire.previousPeriod")}</dt>
          <dd>
            {formatDate(previous.start_date)} – {formatDate(previous.end_date)}
            {previous.employee_type ? ` · ${previous.employee_type.name}` : ""}
          </dd>
          <dt>{t("rehire.previousEnd")}</dt>
          <dd>
            {formatDate(previous.end_date)} · {previous.has_active_end_event ? t("rehire.endRecorded") : t("rehire.endWithoutEvent")}
          </dd>
        </dl>
      )}
      {plannedRehire && <p className="alert small">{t("rehire.plannedNote", { date: formatDate(previous!.end_date) })}</p>}
      {mode === "rehire" && previous?.has_active_end_event && <p className="alert small">{t("rehire.reverseEndWarning")}</p>}
      <div className="grid2">
        <label>
          {t("detail.employeeType")}
          <select value={form.employee_type_id} onChange={set("employee_type_id")}>
            <option value="">{t("form.none")}</option>
            {types.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("detail.startDate")} *
          <input type="date" required min={minStart} value={form.start_date} onChange={set("start_date")} />
        </label>
        <label>
          {t("newPeriod.plannedEnd")}
          <input type="date" min={form.start_date} value={form.end_date} onChange={set("end_date")} />
        </label>
        <label>
          {t("detail.workEmail")}
          <input type="email" maxLength={254} value={form.work_email} onChange={set("work_email")} />
        </label>
      </div>
      <p className="muted small">{t("newPeriod.notCopied")}</p>
      {continuousTypeChange && <p className="alert small">{t("rehire.relationshipChangeReminder")}</p>}
      {mode === "initial" && backdated && <p className="alert small">{t("initialEmployment.backdatedNote")}</p>}
      <label>
        {t("profileEdit.reason")}
        {reasonRequired ? " *" : ""}
        <textarea
          required={reasonRequired}
          rows={2}
          maxLength={1000}
          value={form.reason}
          onChange={set("reason")}
          style={{ font: "inherit", padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}
        />
      </label>
      <ErrorBox error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" type="submit" disabled={busy || !form.start_date || (reasonRequired && !form.reason.trim())}>
          {busy ? t("form.saving") : t(`${prefix}.save`)}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
