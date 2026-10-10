// Employee List URL state (UX-3, UI-2): the visible filters and page are initialised from, and kept in sync with, the
// URL query, using the API parameter names as the canonical URL names (F-1; no aliases), e.g.
// /employees?search=DEMO&employment_status=active&employee_type_id=…&operational_completeness=incomplete&page=2.
// Pure helpers so they can be unit-tested.
export const LIST_STATUSES = ["active", "not_started", "ended", "no_employment"] as const;
export const LIST_COMPLETENESS = ["complete", "incomplete"] as const;
export type ListFilters = {
  search: string;
  employment_status: string;
  employee_type_id: string;
  department_id: string;
  operational_completeness: string;
};
export const EMPTY_FILTERS: ListFilters = { search: "", employment_status: "", employee_type_id: "", department_id: "", operational_completeness: "" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneOf = (value: string, allowed: readonly string[]) => (allowed.includes(value) ? value : "");

/** Reads filters and page from a query string; unknown or malformed values are ignored (never sent to the API). */
export function filtersFromQuery(query: string): { filters: ListFilters; page: number } {
  const p = new URLSearchParams(query);
  const uuid = (k: string) => (UUID.test(p.get(k) ?? "") ? p.get(k)! : "");
  const page = Number.parseInt(p.get("page") ?? "1", 10);
  return {
    filters: {
      search: (p.get("search") ?? "").slice(0, 100),
      employment_status: oneOf(p.get("employment_status") ?? "", LIST_STATUSES),
      employee_type_id: uuid("employee_type_id"),
      department_id: uuid("department_id"),
      operational_completeness: oneOf(p.get("operational_completeness") ?? "", LIST_COMPLETENESS),
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

export const hasActiveFilters = (filters: ListFilters) => Object.values(filters).some((v) => v.trim() !== "");

/** What the Employee List may offer, from server-provided capabilities (never role names). */
export function listCapabilities(can: (permission: string) => boolean) {
  return { read: can("employees.read"), addEmployee: can("employees.create"), catalogFilters: can("catalogs.read") };
}
