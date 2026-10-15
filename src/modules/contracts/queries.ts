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
import { isOperationalPeriod, operationalEmploymentWhere } from "@/modules/core-hr/employments/queries";
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
