// Shared conversion from contract rows to the facts `evaluation.ts` works on. Detail (service.ts) and lists (read.ts)
// use the same conversion, so a contract is judged identically wherever it appears.
import type { Prisma } from "@/generated/prisma/client";
import { fromDbDate } from "@/lib/dates";
import type { ContractInContext } from "./evaluation";
import { documentState } from "./model";
import { contractDispositionFlags, periodFacts } from "./queries";

export const FACTS_INCLUDE = { contractType: true, employment: true } as const satisfies Prisma.ContractInclude;
export type FactsRow = Prisma.ContractGetPayload<{ include: typeof FACTS_INCLUDE }>;

export function toContractInContext(r: FactsRow): ContractInContext {
  return {
    contract: {
      id: r.id,
      employmentId: r.employmentId,
      parentContractId: r.parentContractId,
      relationshipType: r.relationshipType,
      contractTypeId: r.contractTypeId,
      contractTypeActive: r.contractType ? r.contractType.isActive : null,
      contractNumber: r.contractNumber,
      effectiveFrom: fromDbDate(r.effectiveFrom),
      effectiveTo: fromDbDate(r.effectiveTo),
      isOpenEnded: r.isOpenEnded,
      documentState: documentState(r),
      ...contractDispositionFlags(r),
    },
    period: periodFacts(r.employment),
  };
}
