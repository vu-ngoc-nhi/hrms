"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { useFormOpen, type Launched } from "./launch";

// S4.10 Cancel Planned Period (C-69 to C-71): the future period will not take effect but stays in history.
export function CancelPlannedForm<T>({
  employmentId,
  period,
  blockedBy,
  revision,
  onSaved,
  launched,
}: {
  employmentId: string;
  period: { start_date: string; end_date: string | null; employee_type: { name: string } | null; work_email: string | null; assignments: unknown[] };
  /** Why the period cannot be cancelled right now (shown instead of allowing Save). */
  blockedBy: "active_end" | "later_period" | null;
  revision: number;
  onSaved: (updated: T) => void;
  /** UI-3: opened from the Employee header instead of its own button. */
  launched?: Launched;
}) {
  const [open, setOpen] = useFormOpen(launched);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {t("cancelPlanned.open")}
      </button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = JSON.stringify({ expected_revision: revision, reason: reason.trim() });
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/cancel-planned`, {
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

  return (
    <form onSubmit={save} className="card">
      <h2>{t("cancelPlanned.title")}</h2>
      <p className="muted small">{t("cancelPlanned.help")}</p>
      <dl className="kv">
        <dt>{t("detail.employeeType")}</dt>
        <dd>{period.employee_type?.name ?? "—"}</dd>
        <dt>{t("cancelPlanned.plannedStart")}</dt>
        <dd>{formatDate(period.start_date)}</dd>
        <dt>{t("cancelPlanned.plannedEnd")}</dt>
        <dd>{period.end_date ? formatDate(period.end_date) : t("detail.notDetermined")}</dd>
        <dt>{t("detail.workEmail")}</dt>
        <dd>{period.work_email ?? "—"}</dd>
        <dt>{t("cancelPlanned.assignments")}</dt>
        <dd>{period.assignments.length}</dd>
      </dl>
      {blockedBy && <p className="alert small">{t(blockedBy === "active_end" ? "cancelPlanned.blockedActiveEnd" : "cancelPlanned.blockedLater")}</p>}
      <label>
        {t("cancelPlanned.reason")} *
        <textarea
          required
          rows={2}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={blockedBy !== null}
        />
      </label>
      <ErrorBox error={error} />
      <div className="form-actions">
        <button className="primary" type="submit" disabled={busy || blockedBy !== null || !reason.trim()}>
          {busy ? t("form.saving") : t("cancelPlanned.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
