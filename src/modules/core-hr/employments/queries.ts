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
import type { Db, Tx } from "@/lib/db";
import { ApiError, notFound } from "@/lib/http/errors";

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

// ---------------- Write guard (C-29 clarification) ----------------
// A cancelled Employment Period is read-only history in S4: no period edit, Work Email update, assignment add/edit/
// correction/change, End Employment or Relationship Change may write to it. Every S4 write path must load the target
// period through `loadWritableEmployment` (or call `assertEmploymentWritable` on an already-loaded row) instead of
// checking the marker itself.
export const EMPLOYMENT_READ_ONLY = "EMPLOYMENT_PERIOD_READ_ONLY";

export const employmentReadOnly = () =>
  new ApiError(409, EMPLOYMENT_READ_ONLY, "This employment period was cancelled and is read-only history.", [
    { field: "employment_id", code: EMPLOYMENT_READ_ONLY, message: "Cancelled employment periods cannot be changed." },
  ]);

export function assertEmploymentWritable(row: { id: string; cancelledAt: Date | null }): void {
  if (row.cancelledAt !== null) throw employmentReadOnly();
}

/** Loads a period (or 404) and rejects it when it is cancelled. Use inside the write transaction. */
export async function loadWritableEmployment(client: Tx | Db, employmentId: string) {
  const row = await client.employment.findUnique({ where: { id: employmentId } });
  if (!row) throw notFound("Employment period not found.");
  assertEmploymentWritable(row);
  return row;
}

/**
 * Sets the cancellation marker (S4.10, C-70) — the only write of `cancelled_at`. Conditional on the period still being
 * non-cancelled, so a concurrent cancellation can never set it twice; nothing else on the period is changed.
 */
export async function markEmploymentCancelled(tx: Tx, employmentId: string, at: Date): Promise<void> {
  const { count } = await tx.employment.updateMany({ where: { id: employmentId, cancelledAt: null }, data: { cancelledAt: at } });
  if (count !== 1) throw employmentReadOnly();
}
