"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";

type Kind = "departments" | "job-titles" | "job-levels" | "employee-types";
type Row = {
  id: string;
  code: string;
  name?: string;
  name_en?: string;
  name_vi?: string | null;
  requires_work_email?: boolean;
  is_active: boolean;
};
const KINDS: Kind[] = ["departments", "job-titles", "job-levels", "employee-types"];

export default function CatalogsPage() {
  const session = useSession();
  const canManage = Boolean(session?.can("catalogs.manage"));
  const [kind, setKind] = useState<Kind>("departments");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<ApiCallError | null>(null);
  const blank = { code: "", name: "", name_vi: "", sort_order: "", requires_work_email: true };
  const [form, setForm] = useState(blank);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    api<{ data: Row[] }>(`/api/v1/core-hr/${kind}?page_size=100&include_inactive=true`)
      .then((r) => !cancelled && setRows(r.data.data))
      .catch((e) => !cancelled && setError(e as ApiCallError));
    return () => {
      cancelled = true;
    };
  }, [kind, version]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { code: form.code.trim() };
    if (kind === "job-titles") {
      body.name_en = form.name;
      if (form.name_vi.trim()) body.name_vi = form.name_vi;
    } else body.name = form.name;
    if (kind === "job-levels" && form.sort_order) body.sort_order = Number(form.sort_order);
    if (kind === "employee-types") body.requires_work_email = form.requires_work_email;
    try {
      await api(`/api/v1/core-hr/${kind}`, { method: "POST", body: JSON.stringify(body) });
      setForm(blank);
      setError(null);
      reload();
    } catch (err) {
      setError(err as ApiCallError);
    }
  }

  async function toggle(row: Row) {
    try {
      await api(`/api/v1/core-hr/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !row.is_active }) });
      reload();
    } catch (err) {
      setError(err as ApiCallError);
    }
  }

  return (
    <>
      <h1>{t("catalogs.title")}</h1>
      <div className="tabs">
        {KINDS.map((k) => (
          <button
            key={k}
            className={k === kind ? "active" : ""}
            onClick={() => {
              if (k === kind) return;
              setRows([]); // never show the previous catalog's rows under the new tab's columns
              setKind(k);
              setError(null);
            }}
          >
            {t(`catalogs.tabs.${k}`)}
          </button>
        ))}
      </div>
      {canManage && (
        <form className="card row" onSubmit={create} style={{ marginBottom: 12 }}>
          <label>
            {t("catalogs.code")}
            <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} maxLength={30} />
          </label>
          <label>
            {kind === "job-titles" ? t("catalogs.nameEn") : t("catalogs.name")}
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150} />
          </label>
          {kind === "job-titles" && (
            <label>
              {t("catalogs.nameVi")}
              <input value={form.name_vi} onChange={(e) => setForm({ ...form, name_vi: e.target.value })} maxLength={150} />
            </label>
          )}
          {kind === "job-levels" && (
            <label>
              {t("catalogs.sortOrder")}
              <input type="number" min={0} max={1000} value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </label>
          )}
          {kind === "employee-types" && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.requires_work_email}
                onChange={(e) => setForm({ ...form, requires_work_email: e.target.checked })}
              />
              {t("catalogs.requiresWorkEmail")}
            </label>
          )}
          <button className="primary" type="submit">
            {t("catalogs.add")}
          </button>
        </form>
      )}
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("catalogs.code")}</th>
              <th>{kind === "job-titles" ? t("catalogs.nameEn") : t("catalogs.name")}</th>
              {kind === "job-titles" && <th>{t("catalogs.nameVi")}</th>}
              {kind === "employee-types" && <th>{t("catalogs.requiresWorkEmail")}</th>}
              <th>{t("catalogs.status")}</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.code}</td>
                <td>{r.name ?? r.name_en}</td>
                {kind === "job-titles" && <td>{r.name_vi ?? "—"}</td>}
                {kind === "employee-types" && <td>{r.requires_work_email ? t("catalogs.yes") : t("catalogs.no")}</td>}
                <td>
                  <span className={`badge ${r.is_active ? "ok" : ""}`}>{r.is_active ? t("catalogs.active") : t("catalogs.inactive")}</span>
                </td>
                {canManage && (
                  <td>
                    <button onClick={() => toggle(r)}>{r.is_active ? t("catalogs.deactivate") : t("catalogs.reactivate")}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {kind === "employee-types" && <p className="muted small">{t("catalogs.employeeTypeNote")}</p>}
      <p className="muted small">{t("catalogs.note")}</p>
    </>
  );
}
