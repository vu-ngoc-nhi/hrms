"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";

type Option = { id: string; label: string };
type Options = { departments: Option[]; jobTitles: Option[]; employeeTypes: Option[]; levels: Option[]; managers: Option[] };

const empty = {
  require_operational_completeness: false,
  full_name: "",
  employee_code: "",
  gender: "",
  date_of_birth: "",
  personal_email: "",
  mobile_phone: "",
  start_date: "",
  work_email: "",
  department_id: "",
  job_title_id: "",
  employee_type_id: "",
  job_level_id: "",
  manager_person_id: "",
};
type Form = typeof empty;

function buildPayload(f: Form, canSetCode: boolean) {
  const payload: Record<string, unknown> = { full_name: f.full_name };
  if (f.require_operational_completeness) payload.require_operational_completeness = true;
  if (canSetCode && f.employee_code.trim()) payload.employee_code = f.employee_code.trim();
  const personal: Record<string, string> = {};
  if (f.gender) personal.gender = f.gender;
  if (f.date_of_birth) personal.date_of_birth = f.date_of_birth;
  if (f.personal_email.trim()) personal.personal_email = f.personal_email.trim();
  if (f.mobile_phone.trim()) personal.mobile_phone = f.mobile_phone.trim();
  if (Object.keys(personal).length) payload.personal = personal;
  if (f.start_date) {
    const employment: Record<string, unknown> = { start_date: f.start_date };
    if (f.employee_type_id) employment.employee_type_id = f.employee_type_id;
    if (f.work_email.trim()) employment.work_email = f.work_email.trim();
    if (f.department_id || f.job_title_id) {
      const a: Record<string, string> = { department_id: f.department_id, job_title_id: f.job_title_id };
      for (const k of ["job_level_id", "manager_person_id"] as const) if (f[k]) a[k] = f[k];
      employment.assignment = a;
    }
    payload.employment = employment;
  }
  return payload;
}

type Catalog = { id: string; code: string; name?: string; name_en?: string };
const toOptions = (rows: Catalog[]) => rows.map((x) => ({ id: x.id, label: `${x.name ?? x.name_en} (${x.code})` }));

export default function NewEmployeePage() {
  const session = useSession();
  const router = useRouter();
  const [form, setForm] = useState(empty);
  const [opts, setOpts] = useState<Options>({ departments: [], jobTitles: [], employeeTypes: [], levels: [], managers: [] });
  const [error, setError] = useState<ApiCallError | null>(null);
  const [busy, setBusy] = useState(false);
  // Reuse the same Idempotency-Key when resubmitting identical content (e.g. after a lost response); new content gets a new key.
  const attempt = useRef<{ key: string; payload: string } | null>(null);

  const canSetCode = Boolean(session?.can("employees.set_code"));
  const canWritePersonal = Boolean(session?.can("employees.write_personal"));

  useEffect(() => {
    const list = (path: string) => api<{ data: Catalog[] }>(`/api/v1/core-hr/${path}?page_size=100`).then((r) => toOptions(r.data.data));
    Promise.all([
      list("departments"),
      list("job-titles"),
      list("employee-types"),
      list("job-levels"),
      api<{ data: { id: string; employee_code: string; full_name: string }[] }>(
        "/api/v1/core-hr/employees?employment_status=active&page_size=100",
      ).then((r) => r.data.data.map((x) => ({ id: x.id, label: `${x.full_name} (${x.employee_code})` }))),
    ])
      .then(([departments, jobTitles, employeeTypes, levels, managers]) => setOpts({ departments, jobTitles, employeeTypes, levels, managers }))
      .catch((e) => setError(e));
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payloadText = JSON.stringify(buildPayload(form, canSetCode));
    if (!attempt.current || attempt.current.payload !== payloadText) {
      attempt.current = { key: crypto.randomUUID(), payload: payloadText };
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/v1/core-hr/employees", {
        method: "POST",
        body: payloadText,
        headers: { "Idempotency-Key": attempt.current.key },
      });
      router.push(`/employees/${r.data.id}`);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }

  if (session && !session.can("employees.create")) return <p className="alert error">{t("form.noPermission")}</p>;

  const select = (k: keyof Form, label: string, options: Option[], disabled = false) => (
    <label>
      {label}
      <select value={form[k] as string} onChange={set(k)} disabled={disabled}>
        <option value="">{t("form.none")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const noStart = !form.start_date;

  return (
    <>
      <p>
        <Link href="/employees">{t("detail.back")}</Link>
      </p>
      <h1>{t("form.title")}</h1>
      <form onSubmit={submit}>
        <fieldset>
          <legend>{t("form.identity")}</legend>
          <div className="grid2">
            <label>
              {t("form.fullName")} *
              <input required value={form.full_name} onChange={set("full_name")} maxLength={200} />
            </label>
            {canSetCode && (
              <label>
                {t("form.legacyCode")}
                <input value={form.employee_code} onChange={set("employee_code")} maxLength={20} />
              </label>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>{t("form.employment")}</legend>
          <p className="muted small">{t("form.employmentHelp")}</p>
          <div className="grid2">
            <label>
              {t("form.startDate")}
              <input type="date" value={form.start_date} onChange={set("start_date")} />
            </label>
            {select("employee_type_id", t("form.employeeType"), opts.employeeTypes, noStart)}
            <label>
              {t("form.workEmail")}
              <input type="email" value={form.work_email} onChange={set("work_email")} disabled={noStart} />
            </label>
            {select("department_id", t("form.department"), opts.departments, noStart)}
            {select("job_title_id", t("form.jobTitle"), opts.jobTitles, noStart)}
            {select("job_level_id", t("form.jobLevel"), opts.levels, noStart)}
            {select("manager_person_id", t("form.manager"), opts.managers, noStart)}
          </div>
        </fieldset>

        {canWritePersonal && (
          <fieldset>
            <legend>{t("form.personal")}</legend>
            <div className="grid2">
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
            </div>
          </fieldset>
        )}

        <fieldset>
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
            <input
              type="checkbox"
              checked={form.require_operational_completeness}
              onChange={set("require_operational_completeness")}
            />
            {t("form.requireOperational")}
          </label>
          <p className="muted small">{t("form.requireOperationalHelp")}</p>
        </fieldset>

        <ErrorBox error={error} />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t("form.saving") : t("form.save")}
        </button>
      </form>
    </>
  );
}
