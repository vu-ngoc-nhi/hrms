"use client";

import { Field } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import type { ContractTypeOption } from "@/app/contracts/contractModel";
import type { ContractField, ContractStepValues } from "./wizardModel";

// Slice 2A-6: the optional Contract Draft fields of Add Employee — Phase 2A Draft fields only. Used on the Contract
// step and again on the result screen when HR reviews the details before retrying.
export function ContractStepFields({
  startDate,
  c,
  onChange,
  errors,
  types,
  typesLoading,
  disabled = false,
}: {
  startDate: string;
  c: ContractStepValues;
  onChange: (patch: Partial<ContractStepValues>) => void;
  errors: Partial<Record<ContractField, string>>;
  types: ContractTypeOption[];
  typesLoading: boolean;
  disabled?: boolean;
}) {
  const from = c.effective_from ?? startDate;
  return (
    <div className="form-grid contract-step-fields">
      <Field label={t("contracts.fields.contractType")} hint={t("wizard.contract.typeHint")}>
        {(p) => (
          <select {...p} value={c.contract_type_id} onChange={(e) => onChange({ contract_type_id: e.target.value })} disabled={disabled || typesLoading}>
            <option value="">{typesLoading ? t("wizard.loadingOptions") : t("contracts.form.selectType")}</option>
            {types.map((o) => (
              <option key={o.id} value={o.id} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t("contracts.fields.contractNumber")} hint={t("wizard.contract.numberHint")}>
        {(p) => <input {...p} value={c.contract_number} onChange={(e) => onChange({ contract_number: e.target.value })} maxLength={100} autoComplete="off" disabled={disabled} />}
      </Field>
      <Field
        label={t("contracts.form.effectiveFrom")}
        required
        hint={c.effective_from === null && startDate ? t("wizard.contract.fromDefaultHint", { date: formatDate(startDate) }) : t("wizard.contract.fromHint")}
        error={errors.effective_from}
      >
        {(p) => <input {...p} type="date" value={from} min={startDate || undefined} onChange={(e) => onChange({ effective_from: e.target.value })} disabled={disabled} />}
      </Field>
      <fieldset className="field contract-term" aria-describedby="wizard-term-note">
        <legend className="field-label">
          {t("contracts.form.termLabel")}
          <span className="field-required" aria-label={t("ui.required")}>
            *
          </span>
        </legend>
        <label className="checkbox-field">
          <input type="radio" name="wizard-term" value="fixed" data-invalid={errors.term ? "true" : undefined} checked={c.term === "fixed"} onChange={() => onChange({ term: "fixed" })} disabled={disabled} />
          <span>{t("contracts.form.termFixed")}</span>
        </label>
        <label className="checkbox-field">
          <input type="radio" name="wizard-term" value="open" checked={c.term === "open"} onChange={() => onChange({ term: "open" })} disabled={disabled} />
          <span>{t("contracts.form.termOpen")}</span>
        </label>
        {errors.term ? (
          <span id="wizard-term-note" className="field-error">
            {errors.term}
          </span>
        ) : (
          <span id="wizard-term-note" className="field-hint">
            {t("wizard.contract.termHint")}
          </span>
        )}
      </fieldset>
      {c.term === "fixed" && (
        <Field label={t("contracts.form.effectiveTo")} required error={errors.effective_to}>
          {(p) => <input {...p} type="date" value={c.effective_to} min={from || undefined} onChange={(e) => onChange({ effective_to: e.target.value })} disabled={disabled} />}
        </Field>
      )}
      <Field label={t("contracts.form.summary")} hint={t("contracts.form.summaryHint")}>
        {(p) => <textarea {...p} rows={2} value={c.summary} onChange={(e) => onChange({ summary: e.target.value })} maxLength={1000} disabled={disabled} />}
      </Field>
    </div>
  );
}
