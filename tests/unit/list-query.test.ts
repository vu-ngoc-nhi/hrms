import { describe, expect, it } from "vitest";
import { filtersFromQuery, queryFromFilters } from "@/app/employees/listQuery";

// UX-3 (UAT Round 1): Employee List filters are initialised from and synchronised with the URL query.
describe("Employee List URL state", () => {
  it("initialises filters and page from the URL", () => {
    expect(filtersFromQuery("?search=UAT&employment_status=ended&department_id=1460e54f-0b1b-4035-a1be-982831c351c3&page=2")).toEqual({
      filters: { search: "UAT", employment_status: "ended", department_id: "1460e54f-0b1b-4035-a1be-982831c351c3" },
      page: 2,
    });
  });
  it("ignores unknown or malformed values", () => {
    expect(filtersFromQuery("?employment_status=retired&department_id=QA&page=-3")).toEqual({
      filters: { search: "", employment_status: "", department_id: "" },
      page: 1,
    });
    expect(filtersFromQuery("")).toEqual({ filters: { search: "", employment_status: "", department_id: "" }, page: 1 });
  });
  it("serialises the current state and round-trips", () => {
    const state = { filters: { search: "Nguyễn", employment_status: "active", department_id: "" }, page: 3 };
    const q = queryFromFilters(state.filters, state.page);
    expect(q).toBe("?search=Nguy%E1%BB%85n&employment_status=active&page=3");
    expect(filtersFromQuery(q)).toEqual(state);
    expect(queryFromFilters({ search: " ", employment_status: "", department_id: "" }, 1)).toBe("");
  });
});
