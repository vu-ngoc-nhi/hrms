"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { IconAttention } from "@/components/ui/icons";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { EMPTY_FILTERS, filtersFromQuery, hasActiveFilters, LIST_COMPLETENESS, LIST_STATUSES, listCapabilities, queryFromFilters, rememberListQuery, urlStateChange, type ListFilters } from "./listQuery";

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
  work_email: string | null;
  start_date: string | null;
};
type Page = { data: Item[]; total: number; page: number; page_size: number; status_as_of: string };
type Option = { id: string; name: string; is_active?: boolean };

const PAGE_SIZE = 20;

// Phase 1 post-freeze regression fix (2026-10-16): filters come from the router's search params, not window.location —
// during an in-app navigation (e.g. Home → /employees?operational_completeness=incomplete) window.location still
// holds the previous page when the list first renders, so the filter was lost. Same pattern as the Contracts page.
export default function EmployeesPage() {
  return (
    <Suspense fallback={<p className="muted">{t("employees.loading")}</p>}>
      <EmployeeList />
    </Suspense>
  );
}

function EmployeeList() {
  const session = useSession();
  const caps = listCapabilities((p) => Boolean(session?.can(p)));
  // UX-3: state comes from the URL, which stays the source of truth.
  const search = useSearchParams().toString();
  const [initial] = useState(() => filtersFromQuery(search));
  const [filters, setFilters] = useState<ListFilters>(initial.filters);
  const [page, setPage] = useState(initial.page);
  // The address changed while the list stayed mounted (Back / Forward, another in-app link): adopt the URL state.
  const [seenSearch, setSeenSearch] = useState(search);
  if (search !== seenSearch) {
    setSeenSearch(search);
    const next = urlStateChange({ filters, page }, search);
    if (next) {
      setFilters(next.filters);
      setPage(next.page);
    }
  }
  const [result, setResult] = useState<Page | null>(null);
  // The query whose response is currently shown; "loading" is derived (no state update inside the effect body).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const requestKey = queryFromFilters(filters, page);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [employeeTypes, setEmployeeTypes] = useState<Option[]>([]);
  const [error, setError] = useState<ApiCallError | null>(null);

  useEffect(() => {
    if (!caps.read) return;
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    for (const [k, v] of Object.entries(filters)) if (v.trim()) qs.set(k, v.trim());
    // Keep the address bar in sync so a filtered list can be shared or reloaded (no navigation, no new history entry).
    const url = `${window.location.pathname}${queryFromFilters(filters, page)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
    rememberListQuery(queryFromFilters(filters, page));
    api<Page>(`/api/v1/core-hr/employees?${qs}`)
      .then((r) => {
        if (cancelled) return;
        setResult(r.data);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e as ApiCallError))
      .finally(() => !cancelled && setLoadedFor(queryFromFilters(filters, page)));
    return () => {
      cancelled = true;
    };
  }, [filters, page, caps.read]);

  useEffect(() => {
    if (!caps.catalogFilters) return;
    // Inactive values stay selectable: ended or historical rows may still show them.
    const load = (path: string, set: (o: Option[]) => void) =>
      api<{ data: Option[] }>(`/api/v1/core-hr/${path}?page_size=100&include_inactive=true`)
        .then((r) => set(r.data.data))
        .catch(() => set([]));
    load("departments", setDepartments);
    load("employee-types", setEmployeeTypes);
  }, [caps.catalogFilters]);

  if (session && !caps.read) return <p className="alert warn">{t("employees.noPermission")}</p>;

  const loading = loadedFor !== requestKey;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const filtered = hasActiveFilters(filters);
  const set = (k: keyof ListFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };
  const clear = () => {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  };
  // The inactive marker is appended once, even when a catalog name already carries it.
  const optionLabel = (o: Option) => {
    const suffix = t("employees.inactiveSuffix");
    return o.is_active === false && !o.name.endsWith(suffix) ? `${o.name} ${suffix}` : o.name;
  };
  const from = result && result.total ? (result.page - 1) * result.page_size + 1 : 0;
  const to = result ? Math.min(result.page * result.page_size, result.total) : 0;

  return (
    <>
      <PageHeader
        title={t("employees.title")}
        subtitle={t("employees.subtitle")}
        actions={
          caps.addEmployee && (
            <Link href="/employees/new" className="button primary">
              + {t("employees.create")}
            </Link>
          )
        }
      />

      <div className="filter-bar" role="search">
        <div className="filter-field filter-search">
          <label htmlFor="filter-search" className="filter-label">
            {t("employees.search")}
          </label>
          <input id="filter-search" type="search" value={filters.search} onChange={set("search")} placeholder={t("employees.searchPlaceholder")} />
        </div>
        <div className="filter-field">
          <label htmlFor="filter-status" className="filter-label">
            {t("employees.employmentStatus")}
          </label>
          <select id="filter-status" value={filters.employment_status} onChange={set("employment_status")}>
            <option value="">{t("employees.all")}</option>
            {LIST_STATUSES.map((v) => (
              <option key={v} value={v}>
                {t(`employmentStatus.${v}`)}
              </option>
            ))}
          </select>
        </div>
        {caps.catalogFilters && (
          <div className="filter-field">
            <label htmlFor="filter-type" className="filter-label">
              {t("employees.employeeType")}
            </label>
            <select id="filter-type" value={filters.employee_type_id} onChange={set("employee_type_id")}>
              <option value="">{t("employees.all")}</option>
              {employeeTypes.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </select>
          </div>
        )}
        {caps.catalogFilters && (
          <div className="filter-field">
            <label htmlFor="filter-department" className="filter-label">
              {t("employees.department")}
            </label>
            <select id="filter-department" value={filters.department_id} onChange={set("department_id")}>
              <option value="">{t("employees.all")}</option>
              {departments.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="filter-field">
          <label htmlFor="filter-completeness" className="filter-label">
            {t("employees.completeness")}
          </label>
          <select id="filter-completeness" value={filters.operational_completeness} onChange={set("operational_completeness")}>
            <option value="">{t("employees.all")}</option>
            {LIST_COMPLETENESS.map((v) => (
              <option key={v} value={v}>
                {t(`employees.completenessOption.${v}`)}
              </option>
            ))}
          </select>
        </div>
        {filtered && (
          <Button variant="ghost" className="filter-clear" onClick={clear}>
            {t("employees.clearFilters")}
          </Button>
        )}
      </div>

      <ErrorBox error={error} />

      {result && (
        <p className="list-meta">
          {t("employees.count", { total: result.total, date: formatDate(result.status_as_of) })}
          {loading && <span className="muted"> · {t("employees.loading")}</span>}
        </p>
      )}

      {!result && !error && <p className="muted">{t("employees.loading")}</p>}

      {result && result.data.length === 0 && !loading && (
        <div className="table-wrap">
          {filtered ? (
            <EmptyState title={t("employees.noResultsTitle")} action={<Button onClick={clear}>{t("employees.clearFilters")}</Button>}>
              {t("employees.noResultsBody")}
            </EmptyState>
          ) : (
            <EmptyState
              title={t("employees.emptyTitle")}
              action={
                caps.addEmployee && (
                  <Link href="/employees/new" className="button primary">
                    + {t("employees.create")}
                  </Link>
                )
              }
            >
              {t("employees.emptyBody")}
            </EmptyState>
          )}
        </div>
      )}

      {result && result.data.length > 0 && (
        <>
          <div className="table-wrap employee-table" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th>{t("employees.columns.code")}</th>
                  <th>{t("employees.columns.name")}</th>
                  <th>{t("employees.columns.status")}</th>
                  <th>{t("employees.columns.employeeType")}</th>
                  <th>{t("employees.columns.department")}</th>
                  <th>{t("employees.columns.jobTitle")}</th>
                  <th className="col-email">{t("employees.columns.workEmail")}</th>
                  <th>{t("employees.columns.startDate")}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((e) => (
                  <tr key={e.id}>
                    <td className="col-code">{e.employee_code}</td>
                    <td className="col-name">
                      {/* The single navigation target of the row. */}
                      <Link href={`/employees/${e.id}`}>{e.full_name}</Link>
                      {e.operational_completeness === "incomplete" && (
                        <span className="attention-flag" title={t("employees.needsAttentionHint")}>
                          <IconAttention />
                          <span className="sr-only">{t("employees.needsAttention")}</span>
                        </span>
                      )}
                    </td>
                    <td className="col-status">
                      <StatusBadge kind="employment" code={e.employment_status} />
                    </td>
                    <td>{e.employee_type?.name ?? "—"}</td>
                    <td>{e.department?.name ?? "—"}</td>
                    <td>{e.job_title?.name_en ?? "—"}</td>
                    <td className="col-email" title={e.work_email ?? undefined}>
                      {e.work_email ?? "—"}
                    </td>
                    <td className="col-date">{formatDate(e.start_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span className="muted small">{t("employees.showing", { from, to, total: result.total })}</span>
            <div className="page-actions">
              <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t("employees.previous")}
              </Button>
              <span className="muted small">{t("employees.page", { page, pages: totalPages })}</span>
              <Button size="small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {t("employees.next")}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
