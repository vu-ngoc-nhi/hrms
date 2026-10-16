"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Field, Modal } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { contractTitle, createDraftBody, draftErrors, draftFromContract, draftFromRenewalDefaults, EMPTY_DRAFT, renewalBody, updateDraftBody, type ContractDetail, type DraftForm } from "./contractModel";

// Slice 2A-3: create or edit a Contract Draft (Phase 2A fields only — no salary, ID, address, templates or documents).
// Create: POST /contracts with an Idempotency-Key (the same content reuses the same key, so a lost response never
// creates a second draft). Edit: PATCH with expected_revision and only the changed fields. Renew (slice 2A-5): POST
// /contracts/{parent}/renewals, prefilled only from the server's renewal_defaults; the server decides everything else.
export type PeriodOption = { id: string; start_date: string; end_date: string | null; employee_type: string | null; is_default: boolean };
type TypeOption = { id: string; name: string; name_vi: string | null; is_active: boolean };

const periodLabel = (p: PeriodOption) =>
  [p.end_date ? `${formatDate(p.start_date)} – ${formatDate(p.end_date)}` : t("contracts.periodOpen", { from: formatDate(p.start_date) }), p.employee_type].filter(Boolean).join(" · ");

export function ContractDraftForm(
  props:
    | { mode: "create"; periods: PeriodOption[]; onClose: () => void; onDone: (contractId: string) => void }
    | { mode: "edit"; contract: ContractDetail; onClose: () => void; onDone: (contractId: string) => void }
    | { mode: "renew"; parent: ContractDetail; onClose: () => void; onDone: (contractId: string) => void },
) {
  const creating = props.mode !== "edit";
  const [form, setForm] = useState<DraftForm>(() =>
    props.mode === "edit"
      ? draftFromContract(props.contract)
      : props.mode === "renew"
        ? draftFromRenewalDefaults(props.parent)
        : { ...EMPTY_DRAFT, employment_id: (props.periods.find((p) => p.is_default) ?? props.periods[0])?.id ?? "" },
  );
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof DraftForm, string>>>({});
  const [error, setError] = useState<ApiCallError | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  useEffect(() => {
    api<{ data: TypeOption[] }>("/api/v1/core-hr/contract-types?page_size=100&include_inactive=true")
      .then((r) => setTypes(r.data.data))
      .catch(() => setTypes([]));
  }, []);

  // Active types are offered; an inactive type already on the draft stays visible (the server blocks Finalize on it).
  const currentType = props.mode === "edit" ? props.contract.contract_type?.id : undefined;
  const typeOptions = types.filter((o) => o.is_active || o.id === currentType);
  const body = props.mode === "create" ? createDraftBody(form) : props.mode === "renew" ? renewalBody(form) : updateDraftBody(props.contract, form);
  const set = (k: keyof DraftForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found = draftErrors(form);
    setErrors(Object.fromEntries(Object.entries(found).map(([k, key]) => [k, t(key as Parameters<typeof t>[0])])));
    if (Object.keys(found).length || !body) return;
    setBusy(true);
    setError(null);
    try {
      if (props.mode !== "edit") {
        const payload = JSON.stringify(body);
        if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
        const url = props.mode === "renew" ? `/api/v1/core-hr/contracts/${props.parent.id}/renewals` : "/api/v1/core-hr/contracts";
        const r = await api<{ id: string }>(url, { method: "POST", body: payload, headers: { "Idempotency-Key": attempt.current.key } });
        props.onDone(r.data.id);
      } else {
        await api(`/api/v1/core-hr/contracts/${props.contract.id}`, { method: "PATCH", body: JSON.stringify(body) });
        props.onDone(props.contract.id);
      }
    } catch (err) {
      const e2 = err as ApiCallError;
      if (e2.body?.error === "DUPLICATE_CONTRACT_NUMBER") setErrors({ contract_number: t("contracts.form.error.duplicateNumber") });
      else setError(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t(props.mode === "renew" ? "contracts.renewDialog.title" : creating ? "contracts.form.createTitle" : "contracts.form.editTitle")}
      description={props.mode === "renew" ? t("contracts.renewDialog.renews", { contract: contractTitle(props.parent) }) : undefined}
      onClose={props.onClose}
      busy={busy}
    >
      <form onSubmit={save} className="contract-form" noValidate>
        {props.mode === "renew" && <p className="muted small">{t("contracts.renewDialog.body")}</p>}
        {props.mode === "create" && props.periods.length > 1 && (
          <Field label={t("contracts.form.employmentPeriod")} required hint={t("contracts.form.employmentPeriodHint")}>
            {(c) => (
              <select {...c} value={form.employment_id} onChange={set("employment_id")}>
                {props.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {periodLabel(p)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label={t("contracts.fields.contractType")}>
          {(c) => (
            <select {...c} value={form.contract_type_id} onChange={set("contract_type_id")}>
              <option value="">{t("contracts.form.selectType")}</option>
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("contracts.fields.contractNumber")} hint={t("contracts.form.contractNumberHint")} error={errors.contract_number}>
          {(c) => <input {...c} value={form.contract_number} onChange={set("contract_number")} maxLength={100} autoComplete="off" />}
        </Field>
        <Field label={t("contracts.form.effectiveFrom")}>{(c) => <input {...c} type="date" value={form.effective_from} onChange={set("effective_from")} />}</Field>
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
          <Field label={t("contracts.form.effectiveTo")} error={errors.effective_to}>
            {(c) => <input {...c} type="date" value={form.effective_to} min={form.effective_from || undefined} onChange={set("effective_to")} />}
          </Field>
        )}
        <Field label={t("contracts.form.summary")} hint={t("contracts.form.summaryHint")}>
          {(c) => <textarea {...c} rows={3} value={form.summary} onChange={set("summary")} maxLength={1000} />}
        </Field>
        <ErrorBox error={error} />
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={busy || !body}>
            {busy ? t("contracts.form.saving") : t(props.mode === "renew" ? "contracts.renewDialog.confirm" : creating ? "contracts.form.create" : "contracts.form.save")}
          </Button>
          <Button onClick={props.onClose} disabled={busy}>
            {t("contracts.form.cancel")}
          </Button>
          {!creating && !body && <span className="muted small">{t("contracts.form.noChanges")}</span>}
        </div>
      </form>
    </Modal>
  );
}
