// Employee List URL state (UX-3): the visible filters and page are initialised from, and kept in sync with, the URL
// query (e.g. /employees?search=UAT&employment_status=active). Pure helpers so they can be unit-tested.
export const LIST_STATUSES = ["active", "not_started", "ended", "no_employment"] as const;
export type ListFilters = { search: string; employment_status: string; department_id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads filters and page from a query string; unknown or malformed values are ignored (never sent to the API). */
export function filtersFromQuery(query: string): { filters: ListFilters; page: number } {
  const p = new URLSearchParams(query);
  const status = p.get("employment_status") ?? "";
  const dept = p.get("department_id") ?? "";
  const page = Number.parseInt(p.get("page") ?? "1", 10);
  return {
    filters: {
      search: (p.get("search") ?? "").slice(0, 100),
      employment_status: (LIST_STATUSES as readonly string[]).includes(status) ? status : "",
      department_id: UUID.test(dept) ? dept : "",
    },
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** The query string representing the current state (empty values and page 1 omitted). */
export function queryFromFilters(filters: ListFilters, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v.trim()) p.set(k, v.trim());
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
