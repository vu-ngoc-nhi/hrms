import { describe, expect, it } from "vitest";
import { evaluateEffectiveDate } from "@/modules/core-hr/employments/effective-date-policy";
import { permissionsForRoles } from "@/modules/identity/permissions";

const admin = { permissions: permissionsForRoles(["HR_ADMIN"]) };
const editor = { permissions: permissionsForRoles(["HR_EDITOR"]) };
const docs = { permissions: permissionsForRoles(["API_DOCS_READER"]) };
const TODAY = "2026-10-09";

describe("Effective-date policy (C-25, PV-19)", () => {
  it("business events: HR_EDITOR today or later; past dates require HR_ADMIN", () => {
    expect(evaluateEffectiveDate(editor, "business_event", TODAY, TODAY)).toEqual({ allowed: true, backdated: false });
    expect(evaluateEffectiveDate(editor, "business_event", "2026-11-01", TODAY)).toEqual({ allowed: true, backdated: false });
    expect(evaluateEffectiveDate(editor, "business_event", "2026-10-08", TODAY).allowed).toBe(false);
    expect(evaluateEffectiveDate(admin, "business_event", "2020-01-01", TODAY)).toEqual({ allowed: true, backdated: true });
  });
  it("historical corrections are HR_ADMIN only, with no time window", () => {
    expect(evaluateEffectiveDate(editor, "historical_correction", "2026-12-01", TODAY).allowed).toBe(false);
    expect(evaluateEffectiveDate(editor, "historical_correction", "2020-01-01", TODAY).allowed).toBe(false);
    expect(evaluateEffectiveDate(admin, "historical_correction", "2001-01-01", TODAY)).toEqual({ allowed: true, backdated: true });
  });
  it("initial data capture lets HR_EDITOR use a past start date", () => {
    expect(evaluateEffectiveDate(editor, "initial_data_capture", "2019-06-03", TODAY)).toEqual({ allowed: true, backdated: true });
    expect(evaluateEffectiveDate(admin, "initial_data_capture", "2019-06-03", TODAY).allowed).toBe(true);
  });
  it("roles without employment permissions are refused", () => {
    for (const kind of ["business_event", "historical_correction", "initial_data_capture"] as const) {
      expect(evaluateEffectiveDate(docs, kind, TODAY, TODAY).allowed).toBe(false);
    }
  });
});

describe("S4 permissions (C-22)", () => {
  it("HR_EDITOR has employment.manage and employees.update but never employment.correct", () => {
    expect(editor.permissions.has("employment.manage")).toBe(true);
    expect(editor.permissions.has("employees.update")).toBe(true);
    expect(editor.permissions.has("employment.correct")).toBe(false);
  });
  it("HR_ADMIN has all three S4 permissions; API_DOCS_READER has none", () => {
    for (const p of ["employees.update", "employment.manage", "employment.correct"] as const) {
      expect(admin.permissions.has(p)).toBe(true);
      expect(docs.permissions.has(p)).toBe(false);
    }
  });
});
