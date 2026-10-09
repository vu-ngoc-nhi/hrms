import { describe, expect, it } from "vitest";
import { assignmentOn, employmentStatus, representativeAssignment } from "@/modules/core-hr/employments/status";
import { completenessView, operationalItems, type OperationalInput } from "@/modules/core-hr/people/completeness";

describe("Employment status by date (employment end date is INCLUSIVE)", () => {
  const e = [{ startDate: "2026-01-01", endDate: "2026-06-30" }];
  it("handles boundaries", () => {
    expect(employmentStatus(e, "2025-12-31")).toBe("not_started");
    expect(employmentStatus(e, "2026-01-01")).toBe("active");
    expect(employmentStatus(e, "2026-06-30")).toBe("active");
    expect(employmentStatus(e, "2026-07-01")).toBe("ended");
    expect(employmentStatus([], "2026-07-01")).toBe("no_employment");
  });
  it("rehire: the new period becomes active", () => {
    const two = [...e, { startDate: "2026-09-01", endDate: null }];
    expect(employmentStatus(two, "2026-08-01")).toBe("not_started");
    expect(employmentStatus(two, "2026-10-07")).toBe("active");
  });
});

describe("Assignments: start inclusive, end EXCLUSIVE", () => {
  const a = [
    { effectiveFrom: "2026-01-01", effectiveTo: "2026-07-01", id: 1 },
    { effectiveFrom: "2026-07-01", effectiveTo: null, id: 2 },
  ];
  it("the changeover day belongs to the new assignment", () => {
    expect(assignmentOn(a, "2026-06-30")?.id).toBe(1);
    expect(assignmentOn(a, "2026-07-01")?.id).toBe(2);
    expect(assignmentOn(a, "2025-12-31")).toBeNull();
  });
});

describe("Operational completeness (MVP rule, PV-03 email rule)", () => {
  const employee = { requiresWorkEmail: true };
  const contractor = { requiresWorkEmail: false };
  const base = (over: Partial<OperationalInput> = {}, period: Partial<NonNullable<OperationalInput["period"]>> = {}): OperationalInput => ({
    fullName: "Nguyễn Văn An",
    personalEmail: null,
    employmentStatus: "active",
    ...over,
    period: { startDate: "2025-01-06", workEmail: "an.nguyen@example.test", employeeType: employee, departmentId: "d", jobTitleId: "j", ...period },
  });
  const missing = (i: OperationalInput) => operationalItems(i).filter((x) => !x.satisfied).map((x) => x.code);

  it("is complete with the MVP items; HR and legal dimensions are reported separately", () => {
    const v = completenessView(base());
    expect(v.operational.status).toBe("complete");
    expect(v.operational.rule_status).toBe("mvp_decision");
    expect(v.hr.status).toBe("not_defined");
    expect(v.legal.status).toBe("pending_legal_review");
  });
  it("an active employee whose type receives a company account needs a work email (a contact email is not enough)", () => {
    expect(missing(base({ personalEmail: "an.contact@example.test" }, { workEmail: null }))).toEqual(["work_email"]);
  });
  it("before the start date a contact email is enough", () => {
    expect(missing(base({ employmentStatus: "not_started", personalEmail: "an.contact@example.test" }, { workEmail: null }))).toEqual([]);
  });
  it("a service contractor without a company account may use a contact email", () => {
    expect(missing(base({ personalEmail: "contractor@example.test" }, { workEmail: null, employeeType: contractor }))).toEqual([]);
    expect(missing(base({}, { workEmail: null, employeeType: contractor }))).toEqual(["contact_email"]);
  });
  it("a missing employee type after the start date requires a work email (fail-safe) and is reported", () => {
    expect(missing(base({ personalEmail: "x@example.test" }, { workEmail: null, employeeType: null }))).toEqual(["work_email", "employee_type"]);
  });
});

describe("representativeAssignment (C-76)", () => {
  const rows = [
    { id: 2, effectiveFrom: "2026-07-01", effectiveTo: null },
    { id: 1, effectiveFrom: "2026-01-05", effectiveTo: "2026-07-01" },
  ];
  it("active period: the assignment effective today", () => {
    expect(representativeAssignment({ startDate: "2026-01-05", endDate: null }, rows, "2026-03-01")?.id).toBe(1);
  });
  it("pre-start period: the first assignment, even when it starts after the period start", () => {
    expect(representativeAssignment({ startDate: "2026-01-01", endDate: null }, rows, "2025-12-01")?.id).toBe(1);
  });
  it("ended period: the last assignment", () => {
    expect(representativeAssignment({ startDate: "2026-01-05", endDate: "2026-09-30" }, [{ ...rows[0], effectiveTo: "2026-08-01" }, rows[1]], "2026-12-01")?.id).toBe(2);
  });
  it("no assignment: null", () => {
    expect(representativeAssignment({ startDate: "2026-01-05", endDate: null }, [], "2026-03-01")).toBeNull();
  });
});

