// Shared Employment Period query concepts (C-29). This module is the ONLY place that knows how a cancelled planned
// period is represented. Services must use these helpers instead of filtering on the cancellation marker themselves,
// so no operational query can accidentally treat a cancelled period as a real relationship.
//
//   operational periods  - non-cancelled; the default for status, completeness, list filters, manager resolution
//                          and current-assignment resolution
//   current period       - operational and covering a given date (end date inclusive)
//   future planned       - operational and starting after a given date
//   employment history   - ALL periods including cancelled ones, each flagged (see `historyFlags`)
import type { Prisma } from "@/generated/prisma/client";

const OPERATIONAL: Prisma.EmploymentWhereInput = { cancelledAt: null };

/** Where-clause for operational (non-cancelled) periods, optionally combined with extra conditions. */
export function operationalEmploymentWhere(extra?: Prisma.EmploymentWhereInput): Prisma.EmploymentWhereInput {
  return extra ? { AND: [OPERATIONAL, extra] } : OPERATIONAL;
}

/** Operational periods covering `onDate` (start <= date <= end, end inclusive). */
export function currentEmploymentWhere(onDate: Date, extra?: Prisma.EmploymentWhereInput): Prisma.EmploymentWhereInput {
  return operationalEmploymentWhere({
    AND: [{ startDate: { lte: onDate } }, { OR: [{ endDate: null }, { endDate: { gte: onDate } }] }, ...(extra ? [extra] : [])],
  });
}

/** Operational periods starting strictly after `afterDate`. */
export function futurePlannedEmploymentWhere(afterDate: Date): Prisma.EmploymentWhereInput {
  return operationalEmploymentWhere({ startDate: { gt: afterDate } });
}

/** In-memory counterpart for already-loaded rows (history loads everything; computations use only these). */
export function operationalPeriods<T extends { cancelledAt: Date | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.cancelledAt === null);
}

/** History presentation flag for a loaded period. */
export function historyFlags(row: { cancelledAt: Date | null }): { cancelled_at: string | null } {
  return { cancelled_at: row.cancelledAt ? row.cancelledAt.toISOString() : null };
}
