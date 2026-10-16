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
import {
  ATTENTION_OPTIONS,
  attentionValue,
  withAttention,
  type AttentionOption,
  contractCapabilities,
  contractFiltersFromQuery,
  contractQueryFromFilters,
  contractTitle,
  dispositionCode,
  DOCUMENT_STATES,
  EMPTY_CONTRACT_FILTERS,
  hasContractFilters,
  termText,
  TIME_STATES,
  type ContractFilters,
  type ContractSummary,
} from "./contractModel";

// Slice 2A-3 Contracts: portfolio list over GET /contracts. Filters use the canonical API parameter names in the URL so
// future Home cards can deep-link here. Every state shown (document, time, Needs Review) comes from the server.
type Page = { data: ContractSummary[]; total: number; page: number; page_size: number; as_of: string };
type TypeOption = { id: string; name: string; is_active: boolean };
const PAGE_SIZE = 20;

// The router's search params (not window.location) carry the canonical filters: on a client-side navigation — e.g.
// Home "View all" → /contracts?expiring_within=30 — window.location is not updated yet when the page first renders.
export default function ContractsPage() {
  return (
    <Suspense fallback={<p className="muted">{t("contracts.loading")}</p>}>
      <ContractsList />
    </Suspense>
  );
}

function ContractsList() {
  const session = useSession();
  const caps = contractCapabilities((p) => Boolean(session?.can(p)));
  const searchParams = useSearchParams();
  const [initial] = useState(() => contractFiltersFromQuery(searchParams.toString()));
  const [filters, setFilters] = useState<ContractFilters>(initial.filters);
  const [page, setPage] = useState(initial.page);
  const [result, setResult] = useState<Page | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [error, setError] = useState<ApiCallError | null>(null);
  const requestKey = contractQueryFromFilters(filters, page);

  useEffect(() => {
    if (!caps.read) return;
    let cancelled = false;
    const qs = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    for (const [k, v] of Object.entries(filters)) if (v.trim()) qs.set(k, v.trim());
    const url = `${window.location.pathname}${contractQueryFromFilters(filters, page)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
    api<Page>(`/api/v1/core-hr/contracts?${qs}`)
      .then((r) => {
        if (cancelled) return;
        setResult(r.data);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e as ApiCallError))
      .finally(() => !cancelled && setLoadedFor(contractQueryFromFilters(filters, page)));
    return () => {
      cancelled = true;
    };
  }, [filters, page, caps.read]);

  useEffect(() => {
    if (!caps.catalogs) return;
    api<{ data: TypeOption[] }>("/api/v1/core-hr/contract-types?page_size=100&include_inactive=true")
      .then((r) => setTypes(r.data.data))
      .catch(() => setTypes([]));
  }, [caps.catalogs]);

  if (session && !caps.read) return <p className="alert warn">{t("contracts.noPermission")}</p>;

  const loading = loadedFor !== requestKey;
  const filtered = hasContractFilters(filters);
  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const set = (k: keyof ContractFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    const value = e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? (e.target.checked ? "true" : "") : e.target.value;
    setFilters((f) => ({ ...f, [k]: value }));
  };
  const clear = () => {
    setPage(1);
    setFilters(EMPTY_CONTRACT_FILTERS);
  };
  const from = result && result.total ? (result.page - 1) * result.page_size + 1 : 0;
  const to = result ? Math.min(result.page * result.page_size, result.total) : 0;

  return (
    <>
      <PageHeader title={t("contracts.title")} subtitle={t("contracts.subtitle")} />

      <div className="filter-bar" role="search">
        <div className="filter-field filter-search">
          <label htmlFor="contract-search" className="filter-label">
            {t("contracts.search")}
          </label>
          <input id="contract-search" type="search" value={filters.search} onChange={set("search")} placeholder={t("contracts.searchPlaceholder")} />
        </div>
        {caps.catalogs && (
          <div className="filter-field">
            <label htmlFor="contract-type" className="filter-label">
              {t("contracts.contractType")}
            </label>
            <select id="contract-type" value={filters.contract_type_id} onChange={set("contract_type_id")}>
              <option value="">{t("contracts.all")}</option>
              {types.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="filter-field">
          <label htmlFor="contract-document" className="filter-label">
            {t("contracts.documentState")}
          </label>
          <select id="contract-document" value={filters.document_state} onChange={set("document_state")}>
            <option value="">{t("contracts.all")}</option>
            {DOCUMENT_STATES.map((v) => (
              <option key={v} value={v}>
                {t(`contracts.documentStateValue.${v}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="contract-time" className="filter-label">
            {t("contracts.timeState")}
          </label>
          <select id="contract-time" value={filters.time_state} onChange={set("time_state")}>
            <option value="">{t("contracts.all")}</option>
            {TIME_STATES.map((v) => (
              <option key={v} value={v}>
                {t(`contracts.timeStateValue.${v}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="contract-from-from" className="filter-label">
            {t("contracts.effectiveFromFrom")}
          </label>
          <input id="contract-from-from" type="date" value={filters.effective_from_from} onChange={set("effective_from_from")} />
        </div>
        <div className="filter-field">
          <label htmlFor="contract-from-to" className="filter-label">
            {t("contracts.effectiveFromTo")}
          </label>
          <input id="contract-from-to" type="date" value={filters.effective_from_to} onChange={set("effective_from_to")} />
        </div>
        <div className="filter-field">
          <label htmlFor="contract-attention" className="filter-label">
            {t("contracts.attention")}
          </label>
          {/* One compact control over the canonical attention parameters (needs_review / awaiting_signature /
              expiring_within) — the same URL the Home Contract Attention links use. */}
          <select
            id="contract-attention"
            value={attentionValue(filters)}
            onChange={(e) => {
              setPage(1);
              setFilters((f) => withAttention(f, e.target.value as AttentionOption | ""));
            }}
          >
            <option value="">{t("contracts.all")}</option>
            {ATTENTION_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {t(`contracts.attentionOption.${v}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field filter-checks">
          <label className="checkbox-field">
            <input type="checkbox" checked={filters.include_disposed === "true"} onChange={set("include_disposed")} />
            <span>{t("contracts.includeDisposed")}</span>
          </label>
        </div>
        {filtered && (
          <Button variant="ghost" className="filter-clear" onClick={clear}>
            {t("contracts.clearFilters")}
          </Button>
        )}
      </div>

      <ErrorBox error={error} />

      {result && (
        <p className="list-meta">
          {t("contracts.count", { total: result.total, date: formatDate(result.as_of) })}
          {loading && <span className="muted"> · {t("contracts.loading")}</span>}
        </p>
      )}
      {!result && !error && <p className="muted">{t("contracts.loading")}</p>}

      {result && result.data.length === 0 && !loading && (
        <div className="table-wrap">
          {filtered ? (
            <EmptyState title={t("contracts.noResultsTitle")} action={<Button onClick={clear}>{t("contracts.clearFilters")}</Button>}>
              {t("contracts.noResultsBody")}
            </EmptyState>
          ) : (
            <EmptyState title={t("contracts.emptyTitle")}>{t("contracts.emptyBody")}</EmptyState>
          )}
        </div>
      )}

      {result && result.data.length > 0 && (
        <>
          <div className="table-wrap contract-table" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  <th>{t("contracts.columns.number")}</th>
                  <th>{t("contracts.columns.employee")}</th>
                  <th>{t("contracts.columns.type")}</th>
                  <th>{t("contracts.columns.effectiveFrom")}</th>
                  <th>{t("contracts.columns.effectiveTo")}</th>
                  <th>{t("contracts.columns.document")}</th>
                  <th>{t("contracts.columns.time")}</th>
                  <th>{t("contracts.columns.review")}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((c) => (
                  <tr key={c.id} className={c.state.disposition ? "inactive-row" : undefined}>
                    <td className="col-name">
                      {/* The single navigation target of the row. */}
                      <Link href={`/contracts/${c.id}`}>{contractTitle(c)}</Link>
                    </td>
                    <td>
                      <div>{c.employee.full_name}</div>
                      <div className="muted small">{c.employee.employee_code}</div>
                    </td>
                    <td>{c.contract_type?.name ?? "—"}</td>
                    <td className="col-date">{formatDate(c.effective_from)}</td>
                    <td className="col-date">{c.effective_from || c.is_open_ended || c.effective_to ? termText(c) : "—"}</td>
                    <td>
                      {c.state.disposition ? <StatusBadge kind="contractDisposition" code={dispositionCode(c.state)!} /> : <StatusBadge kind="contractDocument" code={c.state.document_state} />}
                    </td>
                    <td>{c.state.time_state ? <StatusBadge kind="contractTime" code={c.state.time_state} /> : <span className="muted">—</span>}</td>
                    <td>
                      {c.review.needs_review ? (
                        <span className="badge warning review-flag" title={t("contracts.needsReviewHint")}>
                          <IconAttention />
                          {t("contracts.needsReview")}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span className="muted small">{t("contracts.showing", { from, to, total: result.total })}</span>
            <div className="page-actions">
              <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t("contracts.previous")}
              </Button>
              <span className="muted small">{t("contracts.page", { page, pages: totalPages })}</span>
              <Button size="small" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                {t("contracts.next")}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
