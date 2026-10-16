"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Field, Modal } from "@/components/ui";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { contractTitle, findingText, finalizeBody, finalizeOutcome, signedDateIssue, type ContractDetail, type Finding } from "../contractModel";

// Slice 2A-3 lifecycle dialogs over the 2A-2 API. Each submit uses a fresh Idempotency-Key and the contract revision
// the page last read; the server re-checks everything. No dialog decides whether an action is allowed — the page only
// opens it for actions the server marked allowed.
const post = (contract: ContractDetail, action: string, body: unknown) =>
  api<ContractDetail>(`/api/v1/core-hr/contracts/${contract.id}/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });

/** First Finalize click: no fingerprint. Returns the outcome the page acts on (finalized / review dialog / error). */
export async function requestFinalize(contract: ContractDetail, fingerprint: string | null) {
  try {
    await post(contract, "finalize", finalizeBody(contract.revision, fingerprint));
    return { outcome: finalizeOutcome({ ok: true }, fingerprint), error: null };
  } catch (err) {
    const e = err as ApiCallError;
    const outcome = finalizeOutcome({ ok: false, status: e.status, body: e.body }, fingerprint);
    return { outcome, error: outcome.kind === "error" ? e : null };
  }
}

/**
 * M-19 "Review before finalizing": the current warnings from the server, Review Contract / Finalize Anyway. Finalize
 * Anyway sends the fingerprint the server issued; if the warning set changed meanwhile the server answers with the new
 * set and the dialog shows it again — Finalize is never retried silently. No reason, no per-warning checkbox.
 */
export function FinalizeReviewDialog({
  contract,
  warnings,
  fingerprint,
  changed,
  onReviewed,
  onFinalized,
  onClose,
}: {
  contract: ContractDetail;
  warnings: Finding[];
  fingerprint: string;
  changed: boolean;
  onReviewed: (next: { warnings: Finding[]; fingerprint: string }) => void;
  onFinalized: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await requestFinalize(contract, fingerprint);
    setBusy(false);
    if (r.outcome.kind === "finalized") onFinalized();
    else if (r.outcome.kind === "confirm") onReviewed({ warnings: r.outcome.warnings, fingerprint: r.outcome.fingerprint });
    else setError(r.error);
  }
  return (
    <Modal
      title={t("contracts.finalizeDialog.title")}
      description={contractTitle(contract)}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("contracts.finalizeDialog.review")}
          </Button>
          <Button variant="primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("contracts.form.saving") : t("contracts.finalizeDialog.confirm")}
          </Button>
        </>
      }
    >
      {changed && (
        <p className="alert warn small" role="status">
          {t("contracts.finalizeDialog.changed")}
        </p>
      )}
      <p>{t("contracts.finalizeDialog.intro")}</p>
      <ul className="finding-list">
        {warnings.map((w) => (
          <li key={`${w.code}-${w.related_contract_id ?? ""}`}>{findingText(w)}</li>
        ))}
      </ul>
      <p className="muted small">{t("contracts.finalizeDialog.note")}</p>
      <ErrorBox error={error} />
    </Modal>
  );
}

export function ReturnToDraftDialog({ contract, onDone, onClose }: { contract: ContractDetail; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setFieldError(t("contracts.returnDialog.reasonRequired"));
    setBusy(true);
    setError(null);
    try {
      await post(contract, "return-to-draft", { expected_revision: contract.revision, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("contracts.returnDialog.title")} description={contractTitle(contract)} onClose={onClose} busy={busy}>
      <form onSubmit={confirm} noValidate>
        <p>{t("contracts.returnDialog.body")}</p>
        <Field label={t("contracts.returnDialog.reason")} required hint={t("contracts.returnDialog.reasonHint")} error={fieldError}>
          {(c) => <textarea {...c} rows={3} value={reason} maxLength={1000} onChange={(e) => (setReason(e.target.value), setFieldError(null))} />}
        </Field>
        <ErrorBox error={error} />
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t("contracts.form.saving") : t("contracts.returnDialog.confirm")}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {t("contracts.form.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmSignedDialog({ contract, onDone, onClose }: { contract: ContractDetail; onDone: () => void; onClose: () => void }) {
  // `as_of` is the server's Asia/Ho_Chi_Minh business date: the date input stops obvious future dates; the server decides.
  const today = contract.as_of;
  const [date, setDate] = useState(today);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    const issue = signedDateIssue(date, today);
    if (issue) return setFieldError(t(issue === "future" ? "contracts.signedDialog.future" : "contracts.signedDialog.required"));
    setBusy(true);
    setError(null);
    try {
      await post(contract, "confirm-signed", { expected_revision: contract.revision, signed_at: date });
      onDone();
    } catch (err) {
      const e2 = err as ApiCallError;
      if (e2.body?.error === "SIGNED_AT_IN_FUTURE") setFieldError(t("contracts.signedDialog.future"));
      else setError(e2);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("contracts.signedDialog.title")} description={contractTitle(contract)} onClose={onClose} busy={busy}>
      <form onSubmit={confirm} noValidate>
        <p>{t("contracts.signedDialog.body")}</p>
        <Field label={t("contracts.signedDialog.date")} required hint={t("contracts.signedDialog.dateHint")} error={fieldError}>
          {(c) => <input {...c} type="date" value={date} max={today} onChange={(e) => (setDate(e.target.value), setFieldError(null))} />}
        </Field>
        <ErrorBox error={error} />
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t("contracts.form.saving") : t("contracts.signedDialog.confirm")}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {t("contracts.form.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DiscardDialog({ contract, onDone, onClose }: { contract: ContractDetail; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(contract, "discard", reason.trim() ? { expected_revision: contract.revision, reason: reason.trim() } : { expected_revision: contract.revision });
      onDone();
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("contracts.discardDialog.title")} description={contractTitle(contract)} onClose={onClose} busy={busy}>
      <form onSubmit={confirm} noValidate>
        <p>{t("contracts.discardDialog.body")}</p>
        <Field label={t("contracts.discardDialog.reason")} hint={t("contracts.discardDialog.reasonHint")}>
          {(c) => <textarea {...c} rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <ErrorBox error={error} />
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t("contracts.form.saving") : t("contracts.discardDialog.confirm")}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {t("contracts.form.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
