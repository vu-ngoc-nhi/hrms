"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";

// Work Email belongs to one Employment Period (C-30). Ended periods are historical corrections that need a reason.
// Clearing a recorded address is a data correction for HR_ADMIN with a reason, never account deprovisioning (C-36).
export function WorkEmailEditor<T>({
  employmentId,
  periodLabel,
  current,
  ended,
  canEdit,
  canClear,
  revision,
  onSaved,
}: {
  employmentId: string;
  periodLabel: string;
  current: string | null;
  ended: boolean;
  /** Add/replace (employment.manage on a non-ended period, employment.correct on an ended one). */
  canEdit: boolean;
  /** Clear a recorded address (employment.correct). */
  canClear: boolean;
  revision: number;
  onSaved: (updated: T) => void;
}) {
  const [open, setOpen] = useState<null | "edit" | "clear">(null);
  const [email, setEmail] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);

  if (!open) {
    return (
      <div className="row" style={{ marginTop: 8 }}>
        {canEdit && (
          <button type="button" onClick={() => setOpen("edit")}>
            {ended ? t("workEmail.correct") : t("workEmail.edit")}
          </button>
        )}
        {canClear && current && (
          <button type="button" onClick={() => setOpen("clear")}>
            {t("workEmail.clear")}
          </button>
        )}
      </div>
    );
  }
  const clearing = open === "clear";
  const needsReason = ended || clearing;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { expected_revision: revision, work_email: clearing ? null : email.trim() };
      if (reason.trim()) body.reason = reason.trim();
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/work-email`, { method: "PATCH", body: JSON.stringify(body) });
      setOpen(null);
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
        {clearing && <> {t("workEmail.clearNote")}</>}
      </p>
      {!clearing && (
        <label>
          {t("detail.workEmail")} *
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </label>
      )}
      {needsReason && (
        <label>
          {t("profileEdit.reason")} *
          <textarea
            required
            rows={2}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <ErrorBox error={error} />
      <div className="row">
        <button className="primary" type="submit" disabled={busy || (!clearing && unchanged) || (needsReason && !reason.trim())}>
          {busy ? t("form.saving") : clearing ? t("workEmail.clearSave") : t("workEmail.save")}
        </button>
        <button type="button" onClick={() => setOpen(null)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
