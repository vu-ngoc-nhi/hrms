import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, filtersFromQuery, hasActiveFilters, listCapabilities, queryFromFilters } from "@/app/employees/listQuery";

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

describe("Employee List capabilities (permission-based, never role names)", () => {
  it("Add Employee follows employees.create; catalog filters follow catalogs.read", () => {
    const can = (set: string[]) => (p: string) => set.includes(p);
    expect(listCapabilities(can(["employees.read", "employees.create", "catalogs.read"]))).toEqual({ read: true, addEmployee: true, catalogFilters: true });
    expect(listCapabilities(can(["employees.read"]))).toEqual({ read: true, addEmployee: false, catalogFilters: false });
    expect(listCapabilities(can(["docs.read"]))).toEqual({ read: false, addEmployee: false, catalogFilters: false });
  });
});
