// Employment status is COMPUTED from employment periods at a given date. It is never stored and never inferred
// from login accounts, contracts or blank cells. Suspension/return (employment_event) is planned for S4.
// The status value set is an MVP Decision (Pending Validation: e.g. on leave, rehire in progress).
export type EmploymentStatus = "no_employment" | "not_started" | "active" | "ended";

export type EmploymentDates = { startDate: string; endDate: string | null };

export function employmentStatus(employments: EmploymentDates[], asOf: string): EmploymentStatus {
  if (employments.length === 0) return "no_employment";
  if (employments.some((e) => e.startDate <= asOf && (e.endDate === null || e.endDate >= asOf))) return "active";
  if (employments.some((e) => e.startDate > asOf)) return "not_started";
  return "ended";
}

// Representative period: the active one, else the nearest upcoming one, else the most recently ended one.
export function representativeEmployment<T extends EmploymentDates>(employments: T[], asOf: string): T | null {
  const active = employments.find((e) => e.startDate <= asOf && (e.endDate === null || e.endDate >= asOf));
  if (active) return active;
  const upcoming = employments.filter((e) => e.startDate > asOf).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  if (upcoming.length) return upcoming[0];
  const ended = [...employments].sort((a, b) => ((a.endDate ?? "") > (b.endDate ?? "") ? -1 : 1));
  return ended[0] ?? null;
}

export type AssignmentDates = { effectiveFrom: string; effectiveTo: string | null };

// effective_from is inclusive, effective_to is exclusive.
export function assignmentOn<T extends AssignmentDates>(assignments: T[], date: string): T | null {
  return assignments.find((a) => a.effectiveFrom <= date && (a.effectiveTo === null || a.effectiveTo > date)) ?? null;
}

/**
 * Representative assignment of the representative period (C-76) — the single rule used by the list row, the list
 * Department filter and operational completeness:
 *  - active period: the assignment effective on `asOf`;
 *  - upcoming (pre-start) period: its first assignment;
 *  - ended period: its last assignment.
 */
export function representativeAssignment<T extends AssignmentDates>(period: EmploymentDates, assignments: readonly T[], asOf: string): T | null {
  const ordered = [...assignments].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  if (period.startDate > asOf) return ordered[0] ?? null;
  if (period.endDate !== null && period.endDate < asOf) return ordered.at(-1) ?? null;
  return assignmentOn(ordered, asOf);
}

/**
 * Assignment used for OPERATIONAL COMPLETENESS (C-78): readiness for the period. A pre-start period counts only an
 * assignment already in effect on its start date (first assignment effective_from <= start date); otherwise the
 * representative assignment. The list Department display and filter keep `representativeAssignment` (C-76).
 */
export function completenessAssignment<T extends AssignmentDates>(period: EmploymentDates, assignments: readonly T[], asOf: string): T | null {
  if (period.startDate > asOf) return assignmentOn([...assignments], period.startDate);
  return representativeAssignment(period, assignments, asOf);
}

