"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Field } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import type { Assignment } from "./detailModel";

// PV-29 Cancel Planned Assignment: a normal lifecycle action for a future assignment that will no longer take effect
// (not Correct, not Delete). The preview is worded from the facts on screen only — the server decides eligibility and
// returns any manager warning (BD-8, never blocking).
type Warning = { code: string; message: string };

export function CancelPlannedAssignmentForm<T>({
  row,
  predecessor,
  revision,
  onSaved,
  onClose,
}: {
  row: Assignment;
  /** The live assignment before it in the same period (continues after the planned date), or null for a first one. */
  predecessor: Assignment | null;
  revision: number;
  onSaved: (updated: T, warnings: Warning[]) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const saving = useRef(false);
  const date = formatDate(row.effective_from);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    const payload = JSON.stringify({ expected_revision: revision, reason: reason.trim() });
    // A retry of the same request reuses its Idempotency-Key; a changed request gets a new one.
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api<T & { warnings?: Warning[] }>(`/api/v1/core-hr/assignments/${row.id}/cancel-planned`, {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": attempt.current.key },
      });
      onSaved(r.data, r.data.warnings ?? []);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <p className="muted small">{t("cancelPlannedAssignment.help")}</p>
      <dl className="info-grid">
        <div>
          <dt>{t("cancelPlannedAssignment.planned")}</dt>
          <dd>
            {row.job_title.name_en} · {row.department.name}
          </dd>
        </div>
        <div>
          <dt>{t("cancelPlannedAssignment.takesEffectOn")}</dt>
          <dd>{date}</dd>
        </div>
      </dl>
      <div>
        <h3>{t("cancelPlannedAssignment.effectTitle")}</h3>
        <ul>
          <li>{t("cancelPlannedAssignment.effectNotTakeEffect")}</li>
          <li>
            {predecessor
              ? t("cancelPlannedAssignment.effectContinues", { assignment: `${predecessor.job_title.name_en} · ${predecessor.department.name}`, date })
              : t("cancelPlannedAssignment.effectNoAssignment")}
          </li>
          <li>{t("cancelPlannedAssignment.effectHistory")}</li>
        </ul>
      </div>
      <Field label={t("cancelPlannedAssignment.reason")} required hint={t("cancelPlannedAssignment.reasonHint")}>
        {(c) => <textarea {...c} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <ErrorBox error={error} />
      <div className="form-actions">
        <Button variant="danger" type="submit" disabled={busy || !reason.trim()}>
          {busy ? t("form.saving") : t("cancelPlannedAssignment.save")}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          {t("cancelPlannedAssignment.keep")}
        </Button>
      </div>
    </form>
  );
}
