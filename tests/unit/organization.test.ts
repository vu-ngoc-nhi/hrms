import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  KINDS,
  counts,
  createBody,
  displayName,
  formErrors,
  formFromRow,
  kindFromQuery,
  organizationCapabilities,
  selectableForNewRecords,
  statusBody,
  updateBody,
  type CatalogRow,
} from "@/app/catalogs/organizationModel";
import { statusVariant } from "@/components/ui/StatusBadge";

// UI-10 Organization: presentation over the unchanged catalog API.
const dept: CatalogRow = { id: "d1", code: "ENG", name: "Engineering", is_active: true };
const legacy: CatalogRow = { id: "d2", code: "LEG", name: "Legacy Department", is_active: false };
const title: CatalogRow = { id: "j1", code: "SE", name_en: "Software Engineer", name_vi: null, is_active: true };
const level: CatalogRow = { id: "l1", code: "L2", name: "Middle", sort_order: 20, is_active: true };
const type: CatalogRow = { id: "t1", code: "EMPLOYEE", name: "Employee", requires_work_email: true, is_active: true };

describe("Tabs", () => {
  it("four reference lists; tab from the URL, Departments by default", () => {
    expect(KINDS).toEqual(["departments", "job-titles", "job-levels", "employee-types"]);
    expect(kindFromQuery("?tab=employee-types")).toBe("employee-types");
    expect(kindFromQuery("?tab=catalogs")).toBe("departments");
    expect(kindFromQuery("")).toBe("departments");
  });
});

describe("Active / Inactive", () => {
  it("Active is success, Inactive neutral (never the brand red)", () => {
    expect(statusVariant("catalog", "active")).toBe("success");
    expect(statusVariant("catalog", "inactive")).toBe("neutral");
  });
  it("inactive values stay displayable (historical records) but are not selectable for new records", () => {
    expect(displayName(legacy)).toBe("Legacy Department");
    expect(selectableForNewRecords([dept, legacy]).map((r) => r.code)).toEqual(["ENG"]);
    expect(counts([dept, legacy])).toEqual({ active: 1, inactive: 1 });
  });
  it("Deactivate / Reactivate only flip the active flag (nothing is deleted)", () => {
    expect(statusBody(dept)).toEqual({ is_active: false });
    expect(statusBody(legacy)).toEqual({ is_active: true });
  });
});

describe("Create / edit request mapping", () => {
  it("create sends the code and the kind's own fields", () => {
    expect(createBody("departments", { ...EMPTY_FORM, code: " QA ", name: " Quality Assurance " })).toEqual({ code: "QA", name: "Quality Assurance" });
    expect(createBody("job-titles", { ...EMPTY_FORM, code: "QAE", name: "QA Engineer", name_vi: "Kỹ sư kiểm thử" })).toEqual({ code: "QAE", name_en: "QA Engineer", name_vi: "Kỹ sư kiểm thử" });
    expect(createBody("job-levels", { ...EMPTY_FORM, code: "L3", name: "Senior", sort_order: "30" })).toEqual({ code: "L3", name: "Senior", sort_order: 30 });
    expect(createBody("employee-types", { ...EMPTY_FORM, code: "SC", name: "Service Contractor", requires_work_email: false })).toEqual({ code: "SC", name: "Service Contractor", requires_work_email: false });
  });

  it("edit sends only changed fields and never the code", () => {
    expect(updateBody("departments", dept, formFromRow(dept))).toBeNull();
    expect(updateBody("departments", dept, { ...formFromRow(dept), code: "X", name: "Engineering & Platform" })).toEqual({ name: "Engineering & Platform" });
    expect(updateBody("job-titles", title, { ...formFromRow(title), name_vi: "Kỹ sư phần mềm" })).toEqual({ name_vi: "Kỹ sư phần mềm" });
    expect(updateBody("job-levels", level, { ...formFromRow(level), sort_order: "" })).toEqual({ sort_order: null });
  });

  it("Employee Type: the Work Email expectation (server flag) is created and edited explicitly", () => {
    expect(formFromRow(type).requires_work_email).toBe(true);
    expect(updateBody("employee-types", type, { ...formFromRow(type), requires_work_email: false })).toEqual({ requires_work_email: false });
  });

  it("request-shape checks mirror the contract", () => {
    expect(formErrors("departments", { ...EMPTY_FORM }, true)).toEqual({ code: "organization.error.code", name: "organization.error.name" });
    expect(formErrors("departments", { ...EMPTY_FORM, code: "bad code!", name: "X" }, true)).toEqual({ code: "organization.error.code" });
    expect(formErrors("departments", { ...EMPTY_FORM, name: "X" }, false)).toEqual({}); // the code is not edited
    expect(formErrors("job-levels", { ...EMPTY_FORM, code: "L9", name: "X", sort_order: "1001" }, true)).toEqual({ sort_order: "organization.error.sortOrder" });
  });
});

describe("Permissions (capabilities, never role names)", () => {
  it("read with catalogs.read; create / edit / deactivate with catalogs.manage", () => {
    const can = (set: string[]) => (p: string) => set.includes(p);
    expect(organizationCapabilities(can(["catalogs.read", "catalogs.manage"]))).toEqual({ read: true, manage: true });
    expect(organizationCapabilities(can(["catalogs.read"]))).toEqual({ read: true, manage: false });
    expect(organizationCapabilities(can([]))).toEqual({ read: false, manage: false });
  });
  it("read-only users get no mutation controls (gated on manage) and the code has no role names", () => {
    const page = readFileSync("src/app/catalogs/page.tsx", "utf8");
    expect(page).toMatch(/caps\.manage && \(/);
    expect(page).toMatch(/\{caps\.manage && <th className="col-actions">/);
    for (const f of ["src/app/catalogs/page.tsx", "src/app/catalogs/organizationModel.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});
