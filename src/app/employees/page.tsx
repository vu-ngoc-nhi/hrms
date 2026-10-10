"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t, tMaybe } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { filtersFromQuery, LIST_STATUSES, queryFromFilters } from "./listQuery";

type Ref = { id: string; code: string; name: string } | null;
type Item = {
  id: string;
  employee_code: string;
  full_name: string;
  employment_status: string;
  operational_completeness: "complete" | "incomplete";
  department: Ref;
  job_title: { name_en: string } | null;
  employee_type: Ref;
};
type Page = { data: Item[]; total: number; page: number; page_size: number; status_as_of: string };

const PAGE_SIZE = 20;
const STATUSES = LIST_STATUSES;

export default function EmployeesPage() {
  const session = useSession();
  // UX-3: initial state comes from the URL (this page renders client-side only, inside the signed-in AppShell).
  const [initial] = useState(() => filtersFromQuery(typeof window === "undefined" ? "" : window.location.search));
  const [filters, setFilters] = useState(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [result, setResult] = useState<Page | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<ApiCallError | null>(null);
  const canRead = Boolean(session?.can("employees.read"));

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    for (const [k, v] of Object.entries(filters)) if (v.trim()) qs.set(k, v.trim());
    // Keep the address bar in sync so a filtered list can be shared or reloaded (no navigation, no new history entry).
    const url = `${window.location.pathname}${queryFromFilters(filters, page)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
    api<Page>(`/api/v1/core-hr/employees?${qs}`)
      .then((r) => {
        if (cancelled) return;
        setResult(r.data);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e as ApiCallError));
    return () => {
      cancelled = true;
    };
  }, [filters, page, canRead]);

  useEffect(() => {
    if (!canRead) return;
    api<{ data: { id: string; name: string }[] }>("/api/v1/core-hr/departments?page_size=100")
      .then((r) => setDepartments(r.data.data))
      .catch(() => setDepartments([]));
  }, [canRead]);

  if (session && !canRead) return <p className="alert warn">{t("employees.noPermission")}</p>;

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };

  return (
    <>
      <div className="spread">
        <h1>{t("employees.title")}</h1>
        {session?.can("employees.create") && (
          <Link href="/employees/new" className="button primary">
            {t("employees.create")}
          </Link>
        )}
      </div>
      <div className="card row" style={{ marginBottom: 12 }}>
        <label>
          {t("employees.search")}
          <input value={filters.search} onChange={set("search")} placeholder={t("employees.searchPlaceholder")} />
        </label>
        <label>
          {t("employees.employmentStatus")}
          <select value={filters.employment_status} onChange={set("employment_status")}>
            <option value="">{t("employees.all")}</option>
            {STATUSES.map((v) => (
              <option key={v} value={v}>
                {t(`employmentStatus.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("employees.department")}
          <select value={filters.department_id} onChange={set("department_id")}>
            <option value="">{t("employees.all")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      {result && (
        <>
          <p className="muted small">{t("employees.count", { total: result.total, date: formatDate(result.status_as_of) })}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("employees.columns.code")}</th>
                  <th>{t("employees.columns.name")}</th>
                  <th>{t("employees.columns.status")}</th>
                  <th>{t("employees.columns.department")}</th>
                  <th>{t("employees.columns.jobTitle")}</th>
                  <th>{t("employees.columns.employeeType")}</th>
                  <th>{t("employees.columns.operationalProfile")}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/employees/${e.id}`}>{e.employee_code}</Link>
                    </td>
                    <td>
                      <Link href={`/employees/${e.id}`}>{e.full_name}</Link>
                    </td>
                    <td>
                      <span className={`badge ${e.employment_status === "active" ? "ok" : ""}`}>
                        {tMaybe(`employmentStatus.${e.employment_status}`) ?? e.employment_status}
                      </span>
                    </td>
                    <td>{e.department?.name ?? "—"}</td>
                    <td>{e.job_title?.name_en ?? "—"}</td>
                    <td>{e.employee_type?.name ?? "—"}</td>
                    <td>
                      <span className={`badge ${e.operational_completeness === "complete" ? "ok" : "warn"}`}>
                        {t(`completeness.${e.operational_completeness}`)}
                      </span>
                    </td>
                  </tr>
                ))}
                {result.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {t("employees.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t("employees.previous")}
            </button>
            <span className="muted">{t("employees.page", { page, pages: totalPages })}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t("employees.next")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
