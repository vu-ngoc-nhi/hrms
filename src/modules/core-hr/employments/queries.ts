// Shared Employment Period query concepts (C-29, PV-25). This module is the ONLY place that knows how the record
// dispositions of a period are represented: Cancelled (planned period that never took effect, `cancelled_at`) and
// Voided (effective period entered in error, `voided_at`). Services must use these helpers instead of filtering on the
// markers themselves, so no operational query can accidentally treat a cancelled or voided period as a real
// relationship.
//
//   operational periods  - neither cancelled nor voided; the default for status, completeness, list filters, manager
//                          resolution and current-assignment resolution
//   current period       - operational and covering a given date (end date inclusive)
//   future planned       - operational and starting after a given date
//   employment history   - ALL periods including cancelled and voided ones, each flagged (see `historyFlags`)
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/lib/db";
import { ApiError, notFound } from "@/lib/http/errors";

// cancelled_at IS NULL AND voided_at IS NULL
const OPERATIONAL: Prisma.EmploymentWhereInput = { cancelledAt: null, voidedAt: null };

type Dispositions = { cancelledAt: Date | null; voidedAt: Date | null };

/** Where-clause for operational (non-cancelled, non-voided) periods, optionally combined with extra conditions. */
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
export function operationalPeriods<T extends Dispositions>(rows: readonly T[]): T[] {
  return rows.filter(isOperationalPeriod);
}

/** True when a loaded period is neither cancelled nor voided. */
export function isOperationalPeriod(row: Dispositions): boolean {
  return row.cancelledAt === null && row.voidedAt === null;
}

/** History presentation flags for a loaded period. */
export function historyFlags(row: Dispositions): { cancelled_at: string | null; voided_at: string | null } {
  return {
    cancelled_at: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    voided_at: row.voidedAt ? row.voidedAt.toISOString() : null,
  };
}

// ---------------- Write guard (C-29 clarification, PV-25) ----------------
// A cancelled or voided Employment Period is read-only history: no period edit, Work Email update, assignment add/edit/
// correction/change, End Employment, Reverse End, Relationship Change, Cancel or Void may write to it. Every S4 write path must load the target
// period through `loadWritableEmployment` (or call `assertEmploymentWritable` on an already-loaded row) instead of
// checking the marker itself.
export const EMPLOYMENT_READ_ONLY = "EMPLOYMENT_PERIOD_READ_ONLY";

export const employmentReadOnly = (disposition: "cancelled" | "voided" = "cancelled") =>
  new ApiError(409, EMPLOYMENT_READ_ONLY, `This employment period was ${disposition} and is read-only history.`, [
    {
      field: "employment_id",
      code: EMPLOYMENT_READ_ONLY,
      message: disposition === "voided" ? "Voided employment periods cannot be changed." : "Cancelled employment periods cannot be changed.",
    },
  ]);

/** The record disposition of a loaded period (null = operational). */
export function periodDisposition(row: Dispositions): "cancelled" | "voided" | null {
  return row.voidedAt !== null ? "voided" : row.cancelledAt !== null ? "cancelled" : null;
}

export function assertEmploymentWritable(row: { id: string } & Dispositions): void {
  const disposition = periodDisposition(row);
  if (disposition) throw employmentReadOnly(disposition);
}

/** Loads a period (or 404) and rejects it when it is cancelled or voided. Use inside the write transaction. */
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
  const { count } = await tx.employment.updateMany({ where: { id: employmentId, ...OPERATIONAL }, data: { cancelledAt: at } });
  if (count !== 1) throw employmentReadOnly();
}

/**
 * Sets the void marker (PV-25) — the only write of `voided_at`. Conditional on the period still being operational, so a
 * concurrent Cancel or Void can never set a second disposition; nothing else on the period is changed.
 */
export async function markEmploymentVoided(tx: Tx, employmentId: string, at: Date): Promise<void> {
  const { count } = await tx.employment.updateMany({ where: { id: employmentId, ...OPERATIONAL }, data: { voidedAt: at } });
  if (count !== 1) throw employmentReadOnly("voided");
}

/**
 * Row-locks a period (FOR UPDATE) before dependency checks that must not race with writes referencing it — e.g. another
 * employee's assignment choosing this period as manager (the DB trigger share-locks the manager period).
 */
export async function lockEmploymentRow(tx: Tx, employmentId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM employment WHERE id = ${employmentId}::uuid FOR UPDATE`;
}
