import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_VALUES,
  buildPayload,
  createdHref,
  initialState,
  isDirty,
  mapServerErrors,
  stepErrors,
  stepsFor,
  wizardCapabilities,
  wizardReducer,
  workEmailExpected,
  type WizardState,
  type WizardValues,
} from "@/app/employees/new/wizardModel";

// UI-8 Add Employee wizard: one create request, request-shape checks only, navigation that never loses input.
const DEPT = "1460e54f-0b1b-4035-a1be-982831c351c3";
const TITLE = "bf967625-59e1-4c94-80d5-08dd7f90f6c4";
const LEVEL = "6de910aa-285b-4869-93ee-cb98808a6176";
const MGR = "c70cc98b-4969-4856-a9ee-befca1da9016";
const EMPLOYEE = { id: "t-emp", requires_work_email: true };
const CONTRACTOR = { id: "t-sc", requires_work_email: false };
const ALL = { writePersonal: true, setCode: true };
const v = (o: Partial<WizardValues>): WizardValues => ({ ...EMPTY_VALUES, ...o });

describe("Payload (the existing single create request)", () => {
  it("name only: optional DOB, Gender, Mobile, Personal Email and employment are omitted", () => {
    expect(buildPayload(v({ full_name: " Lê Văn Demo " }), ALL)).toEqual({ full_name: "Lê Văn Demo" });
  });

  it("full record: personal, first Employment Period and Initial Assignment in one request", () => {
    const body = buildPayload(
      v({
        full_name: "Lê Văn Demo",
        gender: "male",
        date_of_birth: "1995-03-15",
        mobile_phone: "0901234567",
        personal_email: "demo@example.test",
        start_date: "2026-11-02",
        employee_type_id: EMPLOYEE.id,
        work_email: "le.demo@example.test",
        department_id: DEPT,
        job_title_id: TITLE,
        job_level_id: LEVEL,
        manager_person_id: MGR,
      }),
      ALL,
    );
    expect(body).toEqual({
      full_name: "Lê Văn Demo",
      personal: { gender: "male", date_of_birth: "1995-03-15", mobile_phone: "0901234567", personal_email: "demo@example.test" },
      employment: {
        start_date: "2026-11-02",
        employee_type_id: EMPLOYEE.id,
        work_email: "le.demo@example.test",
        assignment: { department_id: DEPT, job_title_id: TITLE, job_level_id: LEVEL, manager_person_id: MGR },
      },
    });
  });

  it("Level and Manager are optional; the assignment needs both Department and Job Title", () => {
    const body = buildPayload(v({ full_name: "A B", start_date: "2026-11-02", department_id: DEPT, job_title_id: TITLE }), ALL);
    expect(body.employment).toEqual({ start_date: "2026-11-02", assignment: { department_id: DEPT, job_title_id: TITLE } });
    expect(buildPayload(v({ full_name: "A B", start_date: "2026-11-02", department_id: DEPT }), ALL).employment).toEqual({ start_date: "2026-11-02" });
  });

  it("no assignment effective date is sent: the first assignment always starts on the Start Date (server rule)", () => {
    const body = buildPayload(v({ full_name: "A B", start_date: "2026-11-02", department_id: DEPT, job_title_id: TITLE }), ALL) as { employment: { assignment: object } };
    expect(Object.keys(body.employment.assignment)).not.toContain("effective_from");
  });

  it("nothing is sent the user may not write: personal values and legacy code follow capabilities", () => {
    const values = v({ full_name: "A B", gender: "female", employee_code: "EMS-0001" });
    expect(buildPayload(values, { writePersonal: false, setCode: false })).toEqual({ full_name: "A B" });
    expect(buildPayload(values, ALL)).toEqual({ full_name: "A B", employee_code: "EMS-0001", personal: { gender: "female" } });
  });

  it("never asks the server to refuse incomplete records: Needs Attention is a valid outcome", () => {
    expect(buildPayload(v({ full_name: "A B" }), ALL)).not.toHaveProperty("require_operational_completeness");
  });
});

describe("Step checks (request shape only)", () => {
  it("Full Name is the only required personal field", () => {
    expect(stepErrors("personal", v({}))).toEqual({ full_name: "wizard.error.fullNameRequired" });
    expect(stepErrors("personal", v({ full_name: "A B" }))).toEqual({});
  });
  it("Start Date is optional, but employment fields need it", () => {
    expect(stepErrors("employment", v({ full_name: "A B" }))).toEqual({});
    expect(stepErrors("employment", v({ employee_type_id: CONTRACTOR.id }))).toEqual({ start_date: "wizard.error.startDateNeeded" });
  });
  it("assignment: optional as a whole; Department and Job Title together; needs an Employment Period", () => {
    expect(stepErrors("assignment", v({ start_date: "2026-11-02" }))).toEqual({});
    expect(stepErrors("assignment", v({ start_date: "2026-11-02", job_level_id: LEVEL }))).toEqual({
      department_id: "wizard.error.departmentRequired",
      job_title_id: "wizard.error.jobTitleRequired",
    });
    expect(stepErrors("assignment", v({ department_id: DEPT }))).toEqual({ department_id: "wizard.error.assignmentNeedsEmployment" });
  });
  it("Work Email is never required to save; the hint follows the server's Employee Type flag", () => {
    expect(stepErrors("review", v({ full_name: "A B", start_date: "2026-11-02", employee_type_id: EMPLOYEE.id }))).toEqual({});
    expect(workEmailExpected([EMPLOYEE, CONTRACTOR], EMPLOYEE.id)).toBe(true);
    expect(workEmailExpected([EMPLOYEE, CONTRACTOR], CONTRACTOR.id)).toBe(false);
  });
});

describe("Navigation and submission", () => {
  const run = (s: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]) => actions.reduce(wizardReducer, s);

  it("Back / Next / Edit keep every entered value (Phase 1 steps for a user without contracts.manage)", () => {
    const steps = stepsFor({ createContract: false });
    expect(steps).toEqual(["personal", "employment", "assignment", "review"]);
    const s = run(
      initialState(),
      { type: "set", field: "full_name", value: "A B" },
      { type: "next", steps },
      { type: "set", field: "start_date", value: "2026-11-02" },
      { type: "next", steps },
      { type: "next", steps },
      { type: "goto", step: "personal" },
      { type: "back", steps },
      { type: "goto", step: "employment" },
    );
    expect(s.step).toBe("employment");
    expect(s.values).toMatchObject({ full_name: "A B", start_date: "2026-11-02" });
    expect(s.visited).toEqual(["personal", "employment", "assignment", "review"]);
  });

  it("with contracts.manage the optional Contract step sits between Assignment and Review", () => {
    const steps = stepsFor({ createContract: true });
    expect(steps).toEqual(["personal", "employment", "assignment", "contract", "review"]);
    const s = run(initialState(), { type: "next", steps }, { type: "next", steps }, { type: "next", steps }, { type: "next", steps });
    expect(s.visited).toEqual(["personal", "employment", "assignment", "contract", "review"]);
    expect(run(s, { type: "back", steps }).step).toBe("contract");
  });

  it("cannot jump to a step that was never reached", () => {
    expect(run(initialState(), { type: "goto", step: "review" }).step).toBe("personal");
  });

  it("while saving, nothing changes (no double submit, no edits) until the save ends", () => {
    const saving = run(initialState(), { type: "set", field: "full_name", value: "A B" }, { type: "saveStart" });
    expect(run(saving, { type: "saveStart" }, { type: "set", field: "full_name", value: "X" }, { type: "back" })).toBe(saving);
    expect(run(saving, { type: "saveEnd" }).saving).toBe(false);
  });

  it("dirty tracking for the leave confirmation", () => {
    expect(isDirty(EMPTY_VALUES)).toBe(false);
    expect(isDirty(v({ mobile_phone: "09" }))).toBe(true);
  });

  it("server field errors return HR to the first affected step; other errors stay on Review", () => {
    const m = mapServerErrors([
      { field: "employment.work_email", code: "IN_USE", message: "Work email already in use." },
      { field: "employment.assignment.manager_person_id", code: "MANAGER_NOT_EMPLOYED_ON_DATE", message: "The manager has no employment period on the effective date." },
      { code: "OTHER", message: "x" },
    ]);
    expect(m.fields).toEqual({ work_email: "Work email already in use.", manager_person_id: "The manager has no employment period on the effective date." });
    expect(m.firstStep).toBe("employment");
    expect(m.other).toHaveLength(1);
    expect(mapServerErrors([{ field: "employee_code", code: "DUPLICATE", message: "Code already issued." }]).firstStep).toBe("personal");
  });

  it("creation result opens the new record's Overview with a success notice", () => {
    expect(createdHref("p-1")).toBe("/employees/p-1?created=1");
  });
});

describe("Permissions (capabilities, never role names)", () => {
  it("maps capabilities", () => {
    const can = (set: string[]) => (p: string) => set.includes(p);
    expect(wizardCapabilities(can(["employees.create", "employees.write_personal"]))).toEqual({ create: true, writePersonal: true, setCode: false, createContract: false });
    expect(wizardCapabilities(can(["employees.read"]))).toEqual({ create: false, writePersonal: false, setCode: false, createContract: false });
    expect(wizardCapabilities(can(["employees.create", "contracts.manage"])).createContract).toBe(true);
  });
  it("wizard code has no role-name checks", () => {
    for (const f of [
      "src/app/employees/new/page.tsx",
      "src/app/employees/new/wizardModel.ts",
      "src/app/employees/new/onboardingSubmit.ts",
      "src/app/employees/new/OnboardingResult.tsx",
      "src/app/employees/new/ContractStepFields.tsx",
      "src/components/ui/Stepper.tsx",
    ]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});
