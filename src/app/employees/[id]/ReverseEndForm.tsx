"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t, tMaybe } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { addDays } from "@/lib/dates";
import { useFormOpen, type Launched } from "./launch";

type ActiveEnd = {
  effective_date: string;
  end_reason: { code: string; label: string } | null;
  previous_end_date: string | null;
  closed_assignment: { id: string; previous_effective_to: string | null } | null;
};

// S4.7R Reverse End Employment (HR_ADMIN, C-54 to C-57): exact reversal of the Active End Event or no reversal.
export function ReverseEndForm<T>({
  employmentId,
  activeEnd,
  currentEnd,
  assignments,
  today,
  revision,
  onSaved,
  launched,
}: {
  employmentId: string;
  activeEnd: ActiveEnd;
  currentEnd: string | null;
  assignments: { id: string; effective_from: string; effective_to: string | null }[];
  today: string;
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
        {t("reverseEnd.open")}
      </button>
    );
  }

  const restored = activeEnd.previous_end_date;
  const sameDate = restored !== null && restored === currentEnd;
  const closed = activeEnd.closed_assignment ? assignments.find((a) => a.id === activeEnd.closed_assignment!.id) : undefined;
  const restoredStillEnded = restored !== null && restored < today;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = JSON.stringify({ expected_revision: revision, reason: reason.trim() });
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/reverse-end`, {
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
      <h2>{t("reverseEnd.title")}</h2>
      <p className="muted small">{t("reverseEnd.help")}</p>
      <dl className="kv">
        <dt>{t("reverseEnd.originalEnd")}</dt>
        <dd>{formatDate(activeEnd.effective_date)}</dd>
        <dt>{t("endEmployment.reason")}</dt>
        <dd>{activeEnd.end_reason ? (tMaybe(`endReason.${activeEnd.end_reason.code}`) ?? activeEnd.end_reason.label) : "—"}</dd>
        <dt>{t("reverseEnd.restoredEnd")}</dt>
        <dd>{restored ? formatDate(restored) : t("reverseEnd.restoredOpen")}</dd>
      </dl>
      <h2>{t("reverseEnd.restoreTitle")}</h2>
      <ul className="small">
        {sameDate ? (
          <li>
            <strong>{t("reverseEnd.sameDate")}</strong>
          </li>
        ) : (
          <li>{restored ? t("reverseEnd.impactPlanned", { date: formatDate(restored) }) : t("reverseEnd.impactOpen")}</li>
        )}
        {restoredStillEnded && <li>{t("reverseEnd.stillEnded")}</li>}
        {activeEnd.closed_assignment ? (
          <li>
            {activeEnd.closed_assignment.previous_effective_to
              ? t("reverseEnd.impactAssignment", {
                  from: closed ? formatDate(closed.effective_from) : "—",
                  // The stored end is exclusive; HR sees the last day the assignment is in effect.
                  to: formatDate(addDays(activeEnd.closed_assignment.previous_effective_to, -1)),
                })
              : t("reverseEnd.impactAssignmentOpen", { from: closed ? formatDate(closed.effective_from) : "—" })}
          </li>
        ) : (
          <li>{t("endEmployment.impactNoAssignment")}</li>
        )}
      </ul>
      <p className="muted small">{t("reverseEnd.blockedNote")}</p>
      <label>
        {t("reverseEnd.reason")} *
        <textarea
          required
          rows={2}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <ErrorBox error={error} />
      <div className="form-actions">
        <button className="primary" type="submit" disabled={busy || !reason.trim()}>
          {busy ? t("form.saving") : t("reverseEnd.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
