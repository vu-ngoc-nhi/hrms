import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, filtersFromQuery, hasActiveFilters, listBackHref, listCapabilities, queryFromFilters, urlStateChange } from "@/app/employees/listQuery";

// UX-3 / UI-2: Employee List filters are initialised from and synchronised with the URL query (canonical API names).
const DEPT = "1460e54f-0b1b-4035-a1be-982831c351c3";
const TYPE = "c2edcade-eff4-4015-b82c-72b4395100a4";

describe("Employee List URL state", () => {
  it("initialises filters and page from the URL", () => {
    expect(
      filtersFromQuery(`?search=UAT&employment_status=ended&employee_type_id=${TYPE}&department_id=${DEPT}&operational_completeness=incomplete&page=2`),
    ).toEqual({
      filters: { search: "UAT", employment_status: "ended", employee_type_id: TYPE, department_id: DEPT, operational_completeness: "incomplete" },
      page: 2,
    });
  });
  it("ignores unknown, malformed or alias values (no aliases such as status= or completeness=)", () => {
    expect(filtersFromQuery("?employment_status=retired&department_id=QA&employee_type_id=INTERN&operational_completeness=needs_attention&page=-3")).toEqual({
      filters: EMPTY_FILTERS,
      page: 1,
    });
    expect(filtersFromQuery("?status=active&department=QA&completeness=complete&type=EMPLOYEE")).toEqual({ filters: EMPTY_FILTERS, page: 1 });
    expect(filtersFromQuery("")).toEqual({ filters: EMPTY_FILTERS, page: 1 });
  });
  it("serialises the current state (filters and page preserved) and round-trips", () => {
    const state = { filters: { ...EMPTY_FILTERS, search: "Nguyễn", employment_status: "active", operational_completeness: "complete" }, page: 3 };
    const q = queryFromFilters(state.filters, state.page);
    expect(q).toBe("?search=Nguy%E1%BB%85n&employment_status=active&operational_completeness=complete&page=3");
    expect(filtersFromQuery(q)).toEqual(state);
    expect(queryFromFilters({ ...EMPTY_FILTERS, search: " " }, 1)).toBe("");
  });
  it("Clear filters: empty filters produce the bare list URL", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, employee_type_id: TYPE })).toBe(true);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(queryFromFilters(EMPTY_FILTERS, 1)).toBe("");
  });
});

describe("Back to Employees (UI-3)", () => {
  it("returns to the remembered list view, re-validated; falls back to the bare list", () => {
    expect(listBackHref(`?search=DEMO&employee_type_id=${TYPE}&page=2`)).toBe(`/employees?search=DEMO&employee_type_id=${TYPE}&page=2`);
    expect(listBackHref("?status=active&department_id=javascript:alert(1)")).toBe("/employees");
    expect(listBackHref(null)).toBe("/employees");
  });
});

describe("Employee List capabilities (permission-based, never role names)", () => {
  it("Add Employee follows employees.create; catalog filters follow catalogs.read", () => {
    const can = (set: string[]) => (p: string) => set.includes(p);
    expect(listCapabilities(can(["employees.read", "employees.create", "catalogs.read"]))).toEqual({ read: true, addEmployee: true, catalogFilters: true });
    expect(listCapabilities(can(["employees.read"]))).toEqual({ read: true, addEmployee: false, catalogFilters: false });
    expect(listCapabilities(can(["docs.read"]))).toEqual({ read: false, addEmployee: false, catalogFilters: false });
  });
});

// Phase 1 post-freeze regression fix (2026-10-16): Home → Employees canonical filters were lost on in-app navigation
// because the list read window.location (still the previous page) on its first render.
describe("URL is the source of truth for the Employee List (regression fix)", () => {
  const page = readFileSync("src/app/employees/page.tsx", "utf8");
  it("reads its filters from the router's search params on first render, inside a Suspense boundary", () => {
    expect(page).toContain("useSearchParams().toString()");
    expect(page).toContain("filtersFromQuery(search)");
    expect(page).not.toContain("window.location.search)"); // stale during client-side navigation
    expect(page).toContain("<Suspense");
  });
  it("every Home link to the list is a canonical URL the list reads back exactly (Active, Pre-start, Ended, Needs Attention)", () => {
    for (const href of [
      "/employees?employment_status=active",
      "/employees?employment_status=not_started",
      "/employees?employment_status=ended",
      "/employees?operational_completeness=incomplete",
    ]) {
      const { filters, page: p } = filtersFromQuery(href.slice("/employees".length));
      expect(`/employees${queryFromFilters(filters, p)}`).toBe(href);
    }
  });
  it("adopts a changed URL (Back / Forward, another in-app link) and ignores the URL it wrote itself", () => {
    const current = { filters: { ...EMPTY_FILTERS, employment_status: "active" }, page: 2 };
    expect(urlStateChange(current, "employment_status=active&page=2")).toBeNull(); // own replaceState: no loop
    expect(urlStateChange(current, "operational_completeness=incomplete")).toEqual({ filters: { ...EMPTY_FILTERS, operational_completeness: "incomplete" }, page: 1 });
    expect(urlStateChange(current, "")).toEqual({ filters: EMPTY_FILTERS, page: 1 }); // back to the bare list: no stale filter
    expect(urlStateChange(current, "employment_status=bogus")).toEqual({ filters: EMPTY_FILTERS, page: 1 }); // malformed values still dropped
  });
  it("filter changes still write the canonical URL (no second state model)", () => {
    expect(page).toContain("window.history.replaceState(null, \"\", url)");
    expect(page).toContain("queryFromFilters(filters, page)");
  });
});
