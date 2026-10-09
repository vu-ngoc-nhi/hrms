// Profile completeness is COMPUTED at read time from a versioned rule, never stored, so the rule can change
// without rewriting data. Three dimensions are kept separate:
//   operational: MVP Decision (minimum operational profile, PV-03 email rule confirmed 2026-10-08).
//   hr:          no approved rule yet.
//   legal:       Pending Legal Review.
// DOB, gender, level, legal ID and personal details do NOT affect operational completeness.
import type { EmploymentStatus } from "../employments/status";

export const OPERATIONAL_RULE_VERSION = "operational-mvp-2026-10-08.2";

export type OperationalInput = {
  fullName: string;
  personalEmail: string | null; // personal/contact email (person)
  employmentStatus: EmploymentStatus;
  period: null | {
    startDate: string;
    workEmail: string | null; // company-issued email (employment period)
    employeeType: null | { requiresWorkEmail: boolean };
    departmentId: string | null;
    jobTitleId: string | null;
  };
};

export type OperationalItem = { code: string; satisfied: boolean };

/**
 * Email rule (PV-03). Work email and contact email are different fields and never an identity key.
 * - Before the start date: a work email or a contact email is enough.
 * - From the start date: types that receive a company account (requires_work_email) need a work email;
 *   types without one (e.g. a Service Contractor without an EmeSoft account) may use a contact email.
 * - Unknown employee type after the start date: a work email is required (fail-safe; the type item also fails).
 */
function emailItem(input: OperationalInput): OperationalItem {
  const work = Boolean(input.period?.workEmail);
  const contact = work || Boolean(input.personalEmail);
  const started = input.employmentStatus === "active" || input.employmentStatus === "ended";
  const type = input.period?.employeeType ?? null;
  if (!started || (type && !type.requiresWorkEmail)) return { code: "contact_email", satisfied: contact };
  return { code: "work_email", satisfied: work };
}

export function operationalItems(input: OperationalInput): OperationalItem[] {
  const p = input.period;
  return [
    { code: "full_name", satisfied: input.fullName.trim().length >= 2 },
    emailItem(input),
    { code: "start_date", satisfied: Boolean(p?.startDate) },
    { code: "employment_status", satisfied: input.employmentStatus !== "no_employment" },
    { code: "department", satisfied: Boolean(p?.departmentId) },
    { code: "job_title", satisfied: Boolean(p?.jobTitleId) },
    { code: "employee_type", satisfied: Boolean(p?.employeeType) },
  ];
}

export function missingOperationalItems(input: OperationalInput): string[] {
  return operationalItems(input).filter((i) => !i.satisfied).map((i) => i.code);
}

export function completenessView(input: OperationalInput) {
  const items = operationalItems(input);
  return {
    operational: {
      status: items.every((i) => i.satisfied) ? ("complete" as const) : ("incomplete" as const),
      rule_version: OPERATIONAL_RULE_VERSION,
      rule_status: "mvp_decision" as const,
      items,
    },
    hr: { status: "not_defined" as const },
    legal: { status: "pending_legal_review" as const },
  };
}
