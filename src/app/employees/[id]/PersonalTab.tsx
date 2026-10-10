"use client";

import { useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Field, InfoBox } from "@/components/ui";
import { formatDate, t, tMaybe } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import {
  correctionChanges,
  correctionInitial,
  correctionPayload,
  dateOfBirthEditable,
  editInitial,
  editPayload,
  fieldErrors,
  GENDERS,
  personalCapabilities,
  type CorrectionValues,
  type EditValues,
  type ProfileSource,
} from "./personalModel";

// UI-4 Personal tab: minimal, read-only by default. Normal updates (no reason) open in the workflow drawer (UI-9); corrections of
// Full Name / a recorded Date of Birth (reason required, C-23) are a separate action under More actions → Correct
// record. Optional values that are absent read "—" and are never styled as errors (Record Health owns completeness).

type Profile = ProfileSource & { id: string };

const genderLabel = (g: string | null) => (g ? tMaybe(`gender.${g}`) ?? g : "—");

function useSave<T>(onSaved: (updated: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const save = async (id: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved(r.data);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

const EDIT_FIELDS: Record<string, keyof EditValues> = {
  "personal.gender": "gender",
  "personal.date_of_birth": "date_of_birth",
  "personal.mobile_phone": "mobile_phone",
  "personal.personal_email": "personal_email",
};

export function PersonalEditForm<T>({ profile, onSaved, onCancel }: { profile: Profile; onSaved: (updated: T) => void; onCancel: () => void }) {
  const [form, setForm] = useState<EditValues>(() => editInitial(profile));
  const { busy, error, save } = useSave(onSaved);
  const body = editPayload(profile, form);
  const { byField, rest } = fieldErrors(error?.body?.details, EDIT_FIELDS);
  const set = (k: keyof EditValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dobEditable = dateOfBirthEditable(profile);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body) void save(profile.id, body);
      }}
    >
      <p className="muted small">{t("personal.editHelp")}</p>
      <div className="form-grid">
        <Field label={t("personal.fullName")} hint={t("personal.fullNameHint")}>
          {(c) => <input {...c} value={profile.full_name} readOnly />}
        </Field>
        <Field label={t("personal.dateOfBirth")} hint={dobEditable ? undefined : t("personal.dateOfBirthRecordedHint")} error={byField.date_of_birth}>
          {(c) =>
            dobEditable ? (
              <input {...c} type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
            ) : (
              <input {...c} value={formatDate(profile.personal?.date_of_birth ?? null)} readOnly />
            )
          }
        </Field>
        <Field label={t("personal.gender")} error={byField.gender}>
          {(c) => (
            <select {...c} value={form.gender} onChange={set("gender")}>
              <option value="">{t("form.none")}</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {t(`gender.${g}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("personal.mobile")} hint={t("personal.mobileHint")} error={byField.mobile_phone}>
          {(c) => <input {...c} value={form.mobile_phone} onChange={set("mobile_phone")} inputMode="tel" autoComplete="off" maxLength={20} />}
        </Field>
        <Field label={t("personal.personalEmail")} error={byField.personal_email}>
          {(c) => <input {...c} type="email" value={form.personal_email} onChange={set("personal_email")} autoComplete="off" maxLength={254} />}
        </Field>
      </div>
      <ErrorBox error={error ? { ...error, body: { ...error.body, details: rest } } : null} />
      <div className="form-actions">
        <Button variant="primary" type="submit" disabled={busy || !body}>
          {busy ? t("form.saving") : t("personal.save")}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t("profileEdit.cancel")}
        </Button>
        {!body && <span className="muted small">{t("profileEdit.noChanges")}</span>}
      </div>
    </form>
  );
}

const CORRECTION_FIELDS: Record<string, keyof CorrectionValues> = { full_name: "full_name", "personal.date_of_birth": "date_of_birth" };

/** Correction of Full Name and/or a recorded Date of Birth — always with a reason (C-23). Opened from More actions. */
export function PersonalCorrectionForm<T>({
  profile,
  can,
  onSaved,
  onCancel,
}: {
  profile: Profile;
  can: (permission: string) => boolean;
  onSaved: (updated: T) => void;
  onCancel: () => void;
}) {
  const caps = personalCapabilities(can, profile);
  const start = correctionInitial(profile);
  const [form, setForm] = useState<CorrectionValues>(start);
  const [reason, setReason] = useState("");
  const { busy, error, save } = useSave(onSaved);
  const changed = correctionChanges(profile, form, caps.correctDateOfBirth);
  const body = correctionPayload(profile, form, reason, caps.correctDateOfBirth);
  const { byField, rest } = fieldErrors(error?.body?.details, CORRECTION_FIELDS);
  const set = (k: keyof CorrectionValues) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const shown = (k: keyof CorrectionValues, v: string) => (k === "date_of_birth" ? formatDate(v || null) : v || "—");
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (body && reason.trim()) void save(profile.id, body);
      }}
    >
      <h2>{t("personal.correctTitle")}</h2>
      <InfoBox>{t("personal.correctIntro")}</InfoBox>
      <div className="form-grid">
        <Field label={t("personal.fullName")} required error={byField.full_name}>
          {(c) => <input {...c} required value={form.full_name} onChange={set("full_name")} maxLength={200} />}
        </Field>
        {caps.correctDateOfBirth && (
          <Field label={t("personal.dateOfBirth")} hint={t("personal.dateOfBirthRemoveHint")} error={byField.date_of_birth}>
            {(c) => <input {...c} type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />}
          </Field>
        )}
      </div>
      {changed.length > 0 && (
        <div className="review">
          <h3>{t("profileEdit.reviewTitle")}</h3>
          <ul className="small">
            {changed.map((k) => (
              <li key={k}>
                {t(k === "full_name" ? "personal.fullName" : "personal.dateOfBirth")}: <span className="muted">{shown(k, start[k])}</span> →{" "}
                <strong>{shown(k, form[k].trim())}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Field label={t("profileEdit.reason")} required hint={t("personal.reasonHelp")} error={byField.reason}>
        {(c) => <textarea {...c} required rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <ErrorBox error={error ? { ...error, body: { ...error.body, details: rest } } : null} />
      <div className="form-actions">
        <Button variant="primary" type="submit" disabled={busy || !body || !reason.trim()}>
          {busy ? t("form.saving") : t("personal.saveCorrection")}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t("profileEdit.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function PersonalTab({ profile, can, onEdit }: { profile: Profile; can: (permission: string) => boolean; onEdit: () => void }) {
  const caps = personalCapabilities(can, profile);
  const p = profile.personal;
  return (
    <section className="card personal-card" aria-labelledby="personal-title">
      <div className="card-header">
        <h2 id="personal-title">{t("personal.title")}</h2>
        {caps.edit && <Button onClick={onEdit}>{t("personal.edit")}</Button>}
      </div>
      <dl className="info-grid">
        <div>
          <dt>{t("personal.fullName")}</dt>
          <dd>{profile.full_name}</dd>
        </div>
        {p && (
          <>
            <div>
              <dt>{t("personal.dateOfBirth")}</dt>
              <dd>{formatDate(p.date_of_birth)}</dd>
            </div>
            <div>
              <dt>{t("personal.gender")}</dt>
              <dd>{genderLabel(p.gender)}</dd>
            </div>
            <div>
              <dt>{t("personal.mobile")}</dt>
              <dd>{p.mobile_phone ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("personal.personalEmail")}</dt>
              <dd>{p.personal_email ?? "—"}</dd>
            </div>
          </>
        )}
      </dl>
      {!caps.visible && <p className="muted">{t("detail.personalHidden")}</p>}
      {caps.correct && <p className="muted small">{t("personal.correctionHint")}</p>}
    </section>
  );
}
