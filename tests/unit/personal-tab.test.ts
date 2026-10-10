import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  correctionChanges,
  correctionPayload,
  dateOfBirthEditable,
  editInitial,
  editPayload,
  fieldErrors,
  GENDERS,
  personalCapabilities,
  type ProfileSource,
} from "@/app/employees/[id]/personalModel";

// UI-4 Personal tab: normal update vs correction (C-23), optional values, capabilities (never role names).
const full: ProfileSource = {
  revision: 7,
  full_name: "Phan Minh Khoa",
  personal: { gender: "male", date_of_birth: "1990-04-12", mobile_phone: "0901234567", personal_email: "khoa.personal@example.test" },
};
const empty: ProfileSource = { revision: 2, full_name: "Đoàn Hữu Phước", personal: { gender: null, date_of_birth: null, mobile_phone: null, personal_email: null } };
const hidden: ProfileSource = { revision: 2, full_name: "Đoàn Hữu Phước" };
const can = (set: string[]) => (p: string) => set.includes(p);
const HR_ADMIN = can(["employees.read", "employees.read_personal", "employees.update", "employees.write_personal", "employment.correct"]);
const HR_EDITOR = can(["employees.read", "employees.read_personal", "employees.update", "employees.write_personal"]);

describe("Optional personal values", () => {
  it("absent Date of Birth, Gender, Mobile and Personal Email start empty (no required value)", () => {
    expect(editInitial(empty)).toEqual({ gender: "", date_of_birth: "", mobile_phone: "", personal_email: "" });
    expect(editPayload(empty, editInitial(empty))).toBeNull();
  });
  it("Gender uses the authoritative contract values only", () => {
    expect([...GENDERS].sort()).toEqual(["female", "male", "other"]);
  });
});

describe("Normal update (no reason)", () => {
  it("sends only changed contact values, never Full Name or a reason", () => {
    const body = editPayload(full, { ...editInitial(full), mobile_phone: " 0912345678 ", gender: "" });
    expect(body).toEqual({ expected_revision: 7, personal: { gender: null, mobile_phone: "0912345678" } });
    expect(body).not.toHaveProperty("reason");
    expect(body).not.toHaveProperty("full_name");
  });
  it("a missing Date of Birth may be filled in (completion, C-23)", () => {
    expect(dateOfBirthEditable(empty)).toBe(true);
    expect(editPayload(empty, { ...editInitial(empty), date_of_birth: "1995-01-20" })).toEqual({ expected_revision: 2, personal: { date_of_birth: "1995-01-20" } });
  });
  it("a recorded Date of Birth is never changed by the normal update", () => {
    expect(dateOfBirthEditable(full)).toBe(false);
    expect(editPayload(full, { ...editInitial(full), date_of_birth: "1991-01-01" })).toBeNull();
  });
  it("clearing an optional value sends null", () => {
    expect(editPayload(full, { ...editInitial(full), personal_email: "" })).toEqual({ expected_revision: 7, personal: { personal_email: null } });
  });
});

describe("Correction (reason required)", () => {
  it("Full Name change carries the reason", () => {
    const form = { full_name: "Phan Minh Khoa Anh", date_of_birth: "1990-04-12" };
    expect(correctionChanges(full, form, true)).toEqual(["full_name"]);
    expect(correctionPayload(full, form, " Typo in name ", true)).toEqual({ expected_revision: 7, full_name: "Phan Minh Khoa Anh", reason: "Typo in name" });
  });
  it("correcting or removing a recorded Date of Birth", () => {
    expect(correctionPayload(full, { full_name: full.full_name, date_of_birth: "1990-04-21" }, "Wrong day", true)).toEqual({
      expected_revision: 7,
      personal: { date_of_birth: "1990-04-21" },
      reason: "Wrong day",
    });
    expect(correctionPayload(full, { full_name: full.full_name, date_of_birth: "" }, "Entered for wrong person", true)?.personal).toEqual({ date_of_birth: null });
  });
  it("without the personal write capability only Full Name is corrected", () => {
    expect(correctionChanges(full, { full_name: full.full_name, date_of_birth: "1990-04-21" }, false)).toEqual([]);
  });
});

describe("Capabilities (permission-based)", () => {
  it("HR_ADMIN and HR_EDITOR: edit and correct; DOB correction only when one is recorded", () => {
    expect(personalCapabilities(HR_ADMIN, full)).toEqual({ visible: true, edit: true, correct: true, correctDateOfBirth: true });
    expect(personalCapabilities(HR_EDITOR, full)).toEqual({ visible: true, edit: true, correct: true, correctDateOfBirth: true });
    expect(personalCapabilities(HR_ADMIN, empty).correctDateOfBirth).toBe(false);
  });
  it("read-only or no personal access: nothing editable", () => {
    expect(personalCapabilities(can(["employees.read", "employees.read_personal"]), full)).toEqual({ visible: true, edit: false, correct: false, correctDateOfBirth: false });
    expect(personalCapabilities(can(["employees.read", "employees.update"]), hidden)).toEqual({ visible: false, edit: false, correct: true, correctDateOfBirth: false });
  });
  it("the Personal tab code never checks role names", () => {
    for (const f of ["src/app/employees/[id]/PersonalTab.tsx", "src/app/employees/[id]/personalModel.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});

describe("Field-level errors", () => {
  it("maps API field errors to fields and keeps the rest for the error box", () => {
    const { byField, rest } = fieldErrors(
      [
        { field: "personal.mobile_phone", code: "INVALID", message: "Mobile phone must be 0xxxxxxxxx or +84xxxxxxxxx." },
        { code: "OTHER", message: "x" },
      ],
      { "personal.mobile_phone": "mobile_phone" },
    );
    expect(byField).toEqual({ mobile_phone: "Mobile phone must be 0xxxxxxxxx or +84xxxxxxxxx." });
    expect(rest).toHaveLength(1);
  });
});
