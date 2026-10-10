"use client";

import { useMemo, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { t, type MessageKey } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";

type Personal = { gender: string | null; date_of_birth: string | null; mobile_phone: string | null; personal_email: string | null };
export type EditableProfile = { id: string; revision: number; full_name: string; personal?: Personal };

type FormState = { full_name: string; gender: string; date_of_birth: string; mobile_phone: string; personal_email: string };

const LABELS: Record<keyof FormState, MessageKey> = {
  full_name: "form.fullName",
  gender: "detail.gender",
  date_of_birth: "detail.dateOfBirth",
  mobile_phone: "detail.mobilePhone",
  personal_email: "detail.personalEmail",
};
// Mirrors the server rule (C-23): Full Name change, or correcting/removing a recorded Date of Birth.
function needsReason(field: keyof FormState, before: string): boolean {
  return field === "full_name" || (field === "date_of_birth" && before.trim() !== "");
}

function initial(p: EditableProfile): FormState {
  return {
    full_name: p.full_name,
    gender: p.personal?.gender ?? "",
    date_of_birth: p.personal?.date_of_birth ?? "",
    mobile_phone: p.personal?.mobile_phone ?? "",
    personal_email: p.personal?.personal_email ?? "",
  };
}

export function ProfileEditForm({
  profile,
  canEditPersonal,
  onSaved,
  onCancel,
}: {
  profile: EditableProfile;
  canEditPersonal: boolean;
  onSaved: (updated: EditableProfile) => void;
  onCancel: () => void;
}) {
  const start = useMemo(() => initial(profile), [profile]);
  const [form, setForm] = useState<FormState>(start);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ApiCallError | null>(null);
  const [busy, setBusy] = useState(false);

  const fields: (keyof FormState)[] = canEditPersonal
    ? ["full_name", "gender", "date_of_birth", "mobile_phone", "personal_email"]
    : ["full_name"];
  const changed = fields.filter((f) => form[f].trim() !== start[f].trim());
  const reasonRequired = changed.some((f) => needsReason(f, start[f]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { expected_revision: profile.revision };
    const personal: Record<string, string | null> = {};
    for (const f of changed) {
      const v = form[f].trim();
      if (f === "full_name") body.full_name = v;
      else personal[f] = v === "" ? null : v;
    }
    if (Object.keys(personal).length) body.personal = personal;
    if (reason.trim()) body.reason = reason.trim();
    setBusy(true);
    setError(null);
    try {
      const r = await api<EditableProfile>(`/api/v1/core-hr/employees/${profile.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved(r.data);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className="card" onSubmit={save}>
      <h2>{t("profileEdit.title")}</h2>
      <div className="grid2">
        <label>
          {t("form.fullName")} *
          <input required value={form.full_name} onChange={set("full_name")} maxLength={200} />
        </label>
        {canEditPersonal && (
          <>
            <label>
              {t("detail.gender")}
              <select value={form.gender} onChange={set("gender")}>
                <option value="">{t("form.none")}</option>
                {(["female", "male", "other"] as const).map((g) => (
                  <option key={g} value={g}>
                    {t(`gender.${g}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("detail.dateOfBirth")}
              <input type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
            </label>
            <label>
              {t("detail.mobilePhone")}
              <input value={form.mobile_phone} onChange={set("mobile_phone")} placeholder="0xxxxxxxxx" inputMode="tel" />
            </label>
            <label>
              {t("detail.personalEmail")}
              <input type="email" value={form.personal_email} onChange={set("personal_email")} />
            </label>
          </>
        )}
      </div>

      <h2>{t("profileEdit.reviewTitle")}</h2>
      {changed.length === 0 ? (
        <p className="muted small">{t("profileEdit.noChanges")}</p>
      ) : (
        <ul className="small">
          {changed.map((f) => (
            <li key={f}>
              {t(LABELS[f])}: <span className="muted">{start[f] || "—"}</span> → <strong>{form[f].trim() || "—"}</strong>
            </li>
          ))}
        </ul>
      )}
      {reasonRequired && (
        <label>
          {t("profileEdit.reason")} *
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={2}
          />
          <span className="muted small">{t("profileEdit.reasonHelp")}</span>
        </label>
      )}
      <ErrorBox error={error} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" type="submit" disabled={busy || changed.length === 0 || (reasonRequired && !reason.trim())}>
          {busy ? t("form.saving") : t("profileEdit.save")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
