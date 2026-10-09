"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";

// Work Email belongs to one Employment Period (C-30). Ended periods are historical corrections that need a reason.
export function WorkEmailEditor<T>({
  employmentId,
  periodLabel,
  current,
  ended,
  revision,
  onSaved,
}: {
  employmentId: string;
  periodLabel: string;
  current: string | null;
  ended: boolean;
  revision: number;
  onSaved: (updated: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ marginTop: 8 }}>
        {ended ? t("workEmail.correct") : t("workEmail.edit")}
      </button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { expected_revision: revision, work_email: email.trim() };
      if (reason.trim()) body.reason = reason.trim();
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/work-email`, { method: "PATCH", body: JSON.stringify(body) });
      setOpen(false);
      onSaved(r.data);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }

  const unchanged = email.trim().toLowerCase() === (current ?? "").toLowerCase();
  return (
    <form onSubmit={save} style={{ marginTop: 8, display: "grid", gap: 8 }}>
      <p className="muted small" style={{ margin: 0 }}>
        {t("workEmail.owner", { period: periodLabel })}
        {ended && <> {t("workEmail.endedNote")}</>}
      </p>
      <label>
        {t("detail.workEmail")} *
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
      </label>
      {ended && (
        <label>
          {t("profileEdit.reason")} *
          <textarea
            required
            rows={2}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ font: "inherit", padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}
          />
        </label>
      )}
      <ErrorBox error={error} />
      <div className="row">
        <button className="primary" type="submit" disabled={busy || unchanged || (ended && !reason.trim())}>
          {busy ? t("form.saving") : t("workEmail.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
