// Shared Contract query concepts (ADR-0005 §6). This module is the ONLY place that knows how contract dispositions
// are represented — Cancelled (`cancelled_at`: discarded Draft or planned contract that will not take effect) and
// Voided (`voided_at`: a record that should never have existed) — and that a contract also leaves operations when its
// Employment Period is Cancelled or Voided. Services use these helpers instead of filtering on the markers, so no
// reminder, list or check can treat a disposed contract as operational.
//
//   operational contract = cancelled_at IS NULL AND voided_at IS NULL AND period operational (not Cancelled/Voided)
//
// Employment Status (Pre-start / Active / Ended) is deliberately NOT part of the predicate: it never gates contracts.
import type { Prisma } from "@/generated/prisma/client";
import { fromDbDate } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { isOperationalPeriod, operationalEmploymentWhere } from "@/modules/core-hr/employments/queries";
import type { PeriodFacts } from "./evaluation";
import type { Disposition } from "./model";

// cancelled_at IS NULL AND voided_at IS NULL
const OPERATIONAL_CONTRACT: Prisma.ContractWhereInput = { cancelledAt: null, voidedAt: null };

/** Where-clause for operational contracts, optionally combined with extra conditions. */
export function operationalContractWhere(extra?: Prisma.ContractWhereInput): Prisma.ContractWhereInput {
  const base: Prisma.ContractWhereInput = { AND: [OPERATIONAL_CONTRACT, { employment: { is: operationalEmploymentWhere() } }] };
  return extra ? { AND: [base, extra] } : base;
}

type ContractDispositions = { cancelledAt: Date | null; voidedAt: Date | null };

/** The contract's own disposition (period validity is a separate fact). */
export function contractDisposition(c: ContractDispositions): Disposition {
  if (c.voidedAt) return "voided";
  return c.cancelledAt ? "cancelled" : null;
}

/** In-memory counterpart of `operationalContractWhere` for rows loaded with their period dispositions. */
export function isOperationalContract(c: ContractDispositions & { employment: Parameters<typeof isOperationalPeriod>[0] }): boolean {
  return contractDisposition(c) === null && isOperationalPeriod(c.employment);
}

// ---------------- Facts for the evaluation module (slice 2A-2) ----------------
// The disposition markers are read and written only here (contract boundary test).
type PeriodRow = { id: string; startDate: Date; endDate: Date | null; cancelledAt: Date | null; voidedAt: Date | null };

/** Period facts for `evaluation.ts`: dates as business dates, dispositions as flags. Ended is not a disposition. */
export function periodFacts(e: PeriodRow): PeriodFacts {
  return { id: e.id, startDate: fromDbDate(e.startDate), endDate: fromDbDate(e.endDate), cancelled: e.cancelledAt !== null, voided: e.voidedAt !== null };
}

/** The contract's own disposition flags. */
export function contractDispositionFlags(c: ContractDispositions): { cancelled: boolean; voided: boolean } {
  return { cancelled: c.cancelledAt !== null, voided: c.voidedAt !== null };
}

/**
 * The Cancelled disposition — a discarded Draft or a cancelled planned contract (C-107 / C-115); content, number and
 * history stay (terminal, DB trigger).
 */
export async function markContractCancelled(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.contract.update({ where: { id }, data: { cancelledAt: at, revision: { increment: 1 }, updatedAt: at } });
}

/** The Voided disposition — an erroneous record (C-107 / C-115); final, no Unvoid, nothing deleted. */
export async function markContractVoided(tx: Tx, id: string, at: Date): Promise<void> {
  await tx.contract.update({ where: { id }, data: { voidedAt: at, revision: { increment: 1 }, updatedAt: at } });
}
