"use client";

import { useEffect, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Field, Modal } from "@/components/ui";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import {
  contractTitle,
  contractTypeOptions,
  correctionBody,
  correctionFromContract,
  findingText,
  finalizeBody,
  finalizeOutcome,
  signedDateIssue,
  type ContractDetail,
  type ContractTypeRow,
  type CorrectionForm,
  type Finding,
} from "../contractModel";

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

// ---------------- Slice 2A-5: Cancel planned, Void, Correction ----------------
/**
 * Cancel planned (contract-wide, C-115) and Void (erroneous records only) share one shape: an explanation, a mandatory
 * reason, the contract revision the page last read. Both are final. The page opens them only when the server allows.
 */
export function ReasonActionDialog({
  contract,
  kind,
  onDone,
  onClose,
}: {
  contract: ContractDetail;
  kind: "cancelPlanned" | "void";
  onDone: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const k = kind === "void" ? "voidDialog" : "cancelPlannedDialog";
  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return setFieldError(t(`contracts.${k}.reasonRequired`));
    setBusy(true);
    setError(null);
    try {
      await post(contract, kind === "void" ? "void" : "cancel-planned", { expected_revision: contract.revision, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t(`contracts.${k}.title`)} description={contractTitle(contract)} onClose={onClose} busy={busy}>
      <form onSubmit={confirm} noValidate>
        <p>{t(`contracts.${k}.body`)}</p>
        {kind === "void" && <p className="alert warn small">{t("contracts.voidDialog.notTermination")}</p>}
        <Field label={t(`contracts.${k}.reason`)} required hint={t(`contracts.${k}.reasonHint`)} error={fieldError}>
          {(c) => <textarea {...c} rows={3} value={reason} maxLength={1000} onChange={(e) => (setReason(e.target.value), setFieldError(null))} />}
        </Field>
        <ErrorBox error={error} />
        <div className="form-actions">
          <Button variant={kind === "void" ? "danger" : "primary"} type="submit" disabled={busy}>
            {busy ? t("contracts.form.saving") : t(`contracts.${k}.confirm`)}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {t("contracts.form.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type TypeOption = ContractTypeRow;

/**
 * Correct a Signed contract's data-entry error (contracts.correct): only changed fields are sent, with a mandatory
 * reason; the server validates everything again (dates, period, lineage, signed date not in the future). Correction
 * keeps the contract's identity — it is not a new agreement and not an amendment.
 */
export function CorrectionDialog({ contract, onDone, onClose }: { contract: ContractDetail; onDone: () => void; onClose: () => void }) {
  const today = contract.as_of;
  const [form, setForm] = useState<CorrectionForm>(() => correctionFromContract(contract));
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  useEffect(() => {
    api<{ data: TypeOption[] }>("/api/v1/core-hr/contract-types?page_size=100&include_inactive=true")
      .then((r) => setTypes(r.data.data))
      .catch(() => setTypes([]));
  }, []);
  // Historical Correction (C-44): active AND inactive types are selectable; inactive ones are labelled.
  const typeOptions = contractTypeOptions(types, "correction");
  const body = correctionBody(contract, form);
  const set = (k: keyof CorrectionForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!body) return;
    if (!form.reason.trim()) return setFieldError(t("contracts.correctDialog.reasonRequired"));
    setBusy(true);
    setError(null);
    try {
      await post(contract, "corrections", body);
      onDone();
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("contracts.correctDialog.title")} description={contractTitle(contract)} onClose={onClose} busy={busy}>
      <form onSubmit={confirm} className="contract-form" noValidate>
        <p className="muted small">{t("contracts.correctDialog.body")}</p>
        <Field label={t("contracts.fields.contractType")}>
          {(c) => (
            <select {...c} value={form.contract_type_id} onChange={set("contract_type_id")}>
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("contracts.fields.contractNumber")} required>
          {(c) => <input {...c} value={form.contract_number} onChange={set("contract_number")} maxLength={100} autoComplete="off" />}
        </Field>
        <Field label={t("contracts.form.effectiveFrom")} required>
          {(c) => <input {...c} type="date" value={form.effective_from} onChange={set("effective_from")} />}
        </Field>
        <fieldset className="field contract-term">
          <legend className="field-label">{t("contracts.form.termLabel")}</legend>
          <label className="checkbox-field">
            <input type="radio" name="term" value="fixed" checked={form.term === "fixed"} onChange={() => setForm((f) => ({ ...f, term: "fixed" }))} />
            <span>{t("contracts.form.termFixed")}</span>
          </label>
          <label className="checkbox-field">
            <input type="radio" name="term" value="open" checked={form.term === "open"} onChange={() => setForm((f) => ({ ...f, term: "open" }))} />
            <span>{t("contracts.form.termOpen")}</span>
          </label>
        </fieldset>
        {form.term === "fixed" && (
          <Field label={t("contracts.form.effectiveTo")} required>
            {(c) => <input {...c} type="date" value={form.effective_to} min={form.effective_from || undefined} onChange={set("effective_to")} />}
          </Field>
        )}
        <Field label={t("contracts.fields.signedAt")} required hint={t("contracts.signedDialog.dateHint")}>
          {(c) => <input {...c} type="date" value={form.signed_at} max={today} onChange={set("signed_at")} />}
        </Field>
        <Field label={t("contracts.correctDialog.reason")} required hint={t("contracts.correctDialog.reasonHint")} error={fieldError}>
          {(c) => <textarea {...c} rows={3} value={form.reason} maxLength={1000} onChange={(e) => (setForm((f) => ({ ...f, reason: e.target.value })), setFieldError(null))} />}
        </Field>
        <ErrorBox error={error} />
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={busy || !body}>
            {busy ? t("contracts.form.saving") : t("contracts.correctDialog.confirm")}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {t("contracts.form.cancel")}
          </Button>
          {!body && <span className="muted small">{t("contracts.form.noChanges")}</span>}
        </div>
      </form>
    </Modal>
  );
}
