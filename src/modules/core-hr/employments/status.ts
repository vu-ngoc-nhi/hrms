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

// Reference date used to pick the assignment of the representative period.
export function referenceDate(e: EmploymentDates, asOf: string): string {
  if (e.startDate > asOf) return e.startDate;
  if (e.endDate !== null && e.endDate < asOf) return e.endDate;
  return asOf;
}

export type AssignmentDates = { effectiveFrom: string; effectiveTo: string | null };

// effective_from is inclusive, effective_to is exclusive.
export function assignmentOn<T extends AssignmentDates>(assignments: T[], date: string): T | null {
  return assignments.find((a) => a.effectiveFrom <= date && (a.effectiveTo === null || a.effectiveTo > date)) ?? null;
}
