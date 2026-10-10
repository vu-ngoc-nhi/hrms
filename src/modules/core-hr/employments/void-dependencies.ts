// PV-25 Void Employment Period — the single ordered list of void dependency checks (design §3.D).
//
// Internal records of the period (assignments, corrections, Work Email, planned end, Active End Event, End + End
// Reversed pairs, audit) never block: they stay as history and stop mattering once the whole period is voided.
// Only CROSS-PERIOD dependencies are checked here. Each check:
//  - has a stable `key`;
//  - runs read-only inside the caller's transaction (the eligibility preview and the POST evaluate the SAME list);
//  - returns zero or more blockers and warnings `{ code, message, references[] }`.
// Fail closed: a check that throws produces a DEPENDENCY_CHECK_FAILED blocker — it never silently passes.
//
// Future modules (Payroll, Leave, Contracts, external-system references) add their own check to VOID_DEPENDENCY_CHECKS
// with a module-specific code (e.g. PAYROLL_DEPENDENCY, LEAVE_DEPENDENCY, CONTRACT_DEPENDENCY, EXTERNAL_REFERENCE)
// when the dependency actually exists; the Void action itself does not change.
import { addDays, fromDbDate } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { findActiveEndEvent } from "./lifecycle-events";
import { operationalEmploymentWhere } from "./queries";

/** Ids, codes and dates only — enough for HR to find and correct the dependent record. */
export type VoidReference = {
  employment_id?: string;
  start_date?: string;
  end_date?: string | null;
  person_id?: string;
  employee_code?: string;
  full_name?: string;
  assignment_id?: string;
  effective_from?: string;
  effective_to?: string | null;
};
export type VoidFinding = { code: string; message: string; references: VoidReference[] };

export type VoidCandidate = { id: string; personId: string; startDate: Date; endDate: Date | null };
export type VoidCheckContext = { tx: Tx; period: VoidCandidate; today: string };
export type VoidCheckResult = { blockers?: VoidFinding[]; warnings?: VoidFinding[] };
export type VoidDependencyCheck = { key: string; run: (ctx: VoidCheckContext) => Promise<VoidCheckResult> };

export const DEPENDENCY_CHECK_FAILED = "DEPENDENCY_CHECK_FAILED";

/** A later valid (non-cancelled, non-voided) period of the same Person depends on this one. */
const laterPeriod: VoidDependencyCheck = {
  key: "later_period",
  run: async ({ tx, period }) => {
    const later = await tx.employment.findMany({
      where: operationalEmploymentWhere({ personId: period.personId, id: { not: period.id }, startDate: { gt: period.startDate } }),
      orderBy: { startDate: "asc" },
    });
    if (!later.length) return {};
    return {
      blockers: [
        {
          code: "LATER_PERIOD_EXISTS",
          message: "A later employment period exists for this person. Only the latest valid period can be voided.",
          references: later.map((l) => ({ employment_id: l.id, start_date: fromDbDate(l.startDate), end_date: fromDbDate(l.endDate) })),
        },
      ],
    };
  },
};

/**
 * This period is the successor of a Relationship Change (deterministic, from lifecycle data — audit is never used):
 * the immediately preceding valid period ends exactly on start_date − 1 and its Active End Event has End Reason
 * RELATIONSHIP_CHANGE. Undoing an effective Relationship Change is PV-24, not Void.
 * The opposite side — this period was ENDED by a Relationship Change whose successor is no longer valid — does not
 * block (no valid cross-period dependency remains), but it is never treated as a routine case: the normal recovery for
 * a genuine predecessor is Cancel successor → Reverse End, so the preview warns explicitly.
 */
const relationshipChange: VoidDependencyCheck = {
  key: "relationship_change_successor",
  run: async ({ tx, period }) => {
    const blockers: VoidFinding[] = [];
    const warnings: VoidFinding[] = [];
    const previous = await tx.employment.findFirst({
      where: operationalEmploymentWhere({ personId: period.personId, id: { not: period.id }, startDate: { lt: period.startDate } }),
      orderBy: { startDate: "desc" },
    });
    if (previous && fromDbDate(previous.endDate) === addDays(fromDbDate(period.startDate), -1)) {
      const end = await findActiveEndEvent(tx, previous.id);
      if (end?.endReasonCode === "RELATIONSHIP_CHANGE") {
        blockers.push({
          code: "RELATIONSHIP_CHANGE_SUCCESSOR",
          message:
            "This period was created by a Relationship Change. Void cannot undo a Relationship Change: that would leave the previous period ended for a change that never happened. Undoing an effective Relationship Change is a separate workflow (PV-24) that is not available yet.",
          references: [{ employment_id: previous.id, start_date: fromDbDate(previous.startDate), end_date: fromDbDate(previous.endDate) }],
        });
      }
    }
    const ownEnd = await findActiveEndEvent(tx, period.id);
    if (ownEnd?.endReasonCode === "RELATIONSHIP_CHANGE") {
      warnings.push({
        code: "RELATIONSHIP_CHANGE_PREDECESSOR",
        message:
          "This period was ended by a Relationship Change whose new period is not valid. If this period itself is genuine, do not void it: use Reverse End Employment to restore it. Void it only if HR confirms that this period itself was entered in error.",
        references: [{ employment_id: period.id, end_date: fromDbDate(ownEnd.effectiveDate) }],
      });
    }
    return { blockers, warnings };
  },
};

/**
 * Other employees' assignments that use THIS period as their manager (design §4). Blocks when the assignment belongs to
 * a valid period and its dates overlap this period (the manager relationship is valid only because this period
 * exists). References to other periods of the same person do not match (they point to another employment id);
 * references from cancelled or voided periods are ignored; a reference without overlap is already inconsistent and is
 * only a warning (also reported by the integrity scan). Nothing is corrected automatically (C-73).
 */
const managerDependency: VoidDependencyCheck = {
  key: "manager_dependency",
  run: async ({ tx, period }) => {
    const rows = await tx.jobAssignment.findMany({
      where: { managerEmploymentId: period.id, employmentId: { not: period.id }, employment: { is: operationalEmploymentWhere() } },
      include: { employment: { include: { person: true } } },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
    });
    const vStart = fromDbDate(period.startDate);
    const vEnd = fromDbDate(period.endDate);
    const vEndExclusive = vEnd === null ? null : addDays(vEnd, 1);
    const overlapping: VoidReference[] = [];
    const outside: VoidReference[] = [];
    for (const a of rows) {
      const from = fromDbDate(a.effectiveFrom);
      const to = fromDbDate(a.effectiveTo);
      const ref: VoidReference = {
        person_id: a.employment.person.id,
        employee_code: a.employment.person.employeeCode,
        full_name: a.employment.person.fullName,
        assignment_id: a.id,
        effective_from: from,
        effective_to: to,
      };
      const overlaps = (vEndExclusive === null || from < vEndExclusive) && (to === null || vStart < to);
      (overlaps ? overlapping : outside).push(ref);
    }
    return {
      blockers: overlapping.length
        ? [
            {
              code: "MANAGER_DEPENDENCY",
              message:
                "Other employees' assignments use this period as their manager for dates within it. Correct those assignments first (Assignment Change, or Historical Assignment Correction for past rows); they are never changed automatically.",
              references: overlapping,
            },
          ]
        : [],
      warnings: outside.length
        ? [
            {
              code: "MANAGER_REFERENCE_WITHOUT_OVERLAP",
              message:
                "Other employees' assignments reference this period as manager for dates outside it. They do not block Void, but the reference is already inconsistent and should be reviewed.",
              references: outside,
            },
          ]
        : [],
    };
  },
};

/** Phase 1 checks, in evaluation order. */
export const VOID_DEPENDENCY_CHECKS: readonly VoidDependencyCheck[] = [laterPeriod, relationshipChange, managerDependency];

/** Runs every check (fail closed). The preview and the POST call this with the same list. */
export async function evaluateVoidDependencies(
  ctx: VoidCheckContext,
  checks: readonly VoidDependencyCheck[] = VOID_DEPENDENCY_CHECKS,
): Promise<{ blockers: VoidFinding[]; warnings: VoidFinding[] }> {
  const blockers: VoidFinding[] = [];
  const warnings: VoidFinding[] = [];
  for (const check of checks) {
    try {
      const result = await check.run(ctx);
      blockers.push(...(result.blockers ?? []));
      warnings.push(...(result.warnings ?? []));
    } catch (error) {
      // Technical log only: the check key and error type, never data values.
      console.error(JSON.stringify({ level: "error", event: "void_dependency_check_failed", check: check.key, type: (error as Error)?.name ?? "unknown" }));
      blockers.push({
        code: DEPENDENCY_CHECK_FAILED,
        message: `The dependency check "${check.key}" could not be completed, so Void is blocked. Try again later.`,
        references: [],
      });
    }
  }
  return { blockers, warnings };
}

