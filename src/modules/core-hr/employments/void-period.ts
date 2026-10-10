// PV-25 Void Employment Period (design revision 2): HR confirms that an already-effective period was entered in error and
// the relationship it represents never existed in reality. Nothing is deleted or cleared: the period and every internal
// record (assignments, corrections, Work Email, planned end, lifecycle events incl. an Active End Event, audit) stay as
// history; the period's disposition becomes Voided and the shared query module excludes it from all operational logic.
//  - eligibility: effective (start_date <= today), not cancelled/voided, and no cross-period dependency
//    (void-dependencies.ts — the same list for the preview and the action, fail closed);
//  - employment.correct (declared in the contract registry only), mandatory reason, expected_revision, Idempotency-Key;
//  - one transaction: claim key → write guard → revision → effective → lock period → dependency checks → void marker →
//    one `employment_voided` event (effective_date = start_date) → audit `employment.void`;
//  - no Unvoid.
import { randomUUID } from "node:crypto";
import type { EmployeeDetail, EmploymentEventType, VoidEligibility, VoidEmploymentInput } from "@/contracts/core-hr/schemas";
import { formatDate } from "@/i18n";
import { fromDbDate, todayInVietnam } from "@/lib/dates";
import { db, pgErrorInfo } from "@/lib/db";
import { ApiError, notFound, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { reasonRequired, rule, runIdempotentCommand } from "./command";
import { activeEndEventOf, historyEventOrder } from "./lifecycle-events";
import {
  EMPLOYMENT_READ_ONLY,
  employmentReadOnly,
  loadWritableEmployment,
  lockEmploymentRow,
  markEmploymentVoided,
  operationalEmploymentWhere,
  periodDisposition,
} from "./queries";
import { employmentStatus } from "./status";
import { DEPENDENCY_CHECK_FAILED, evaluateVoidDependencies, type VoidFinding, type VoidReference } from "./void-dependencies";

const notEffective = (start: string): VoidFinding => ({
  code: "PERIOD_NOT_EFFECTIVE",
  message: `This period starts on ${formatDate(start)}, which is after today. A period that has not become effective is not voided: use Cancel Planned Period.`,
  references: [],
});

// ---------------- Eligibility preview (read-only) ----------------
export async function getVoidEligibility(employmentId: string): Promise<VoidEligibility> {
  const today = todayInVietnam();
  return db().$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    // Sequential reads (no nested includes): one connection, one query at a time inside the transaction.
    const period = await tx.employment.findUnique({ where: { id: employmentId } });
    if (!period) throw notFound("Employment period not found.");
    const { revision } = await tx.person.findUniqueOrThrow({ where: { id: period.personId }, select: { revision: true } });
    const employeeType = period.employeeTypeId ? await tx.employeeType.findUnique({ where: { id: period.employeeTypeId } }) : null;
    const events = await tx.employmentEvent.findMany({ where: { employmentId }, orderBy: [{ effectiveDate: "asc" }, { recordedAt: "asc" }] });
    const assignments = await tx.jobAssignment.count({ where: { employmentId } });
    const start = fromDbDate(period.startDate);
    const end = fromDbDate(period.endDate);
    const disposition = periodDisposition(period);

    let blockers: VoidFinding[] = [];
    let warnings: VoidFinding[] = [];
    if (disposition) {
      blockers = [{ code: EMPLOYMENT_READ_ONLY, message: `This employment period was ${disposition} and is read-only history.`, references: [] }];
    } else if (start > today) {
      blockers = [notEffective(start)];
    } else {
      ({ blockers, warnings } = await evaluateVoidDependencies({ tx, period, today }));
    }

    const otherValid = await tx.employment.findMany({
      where: operationalEmploymentWhere({ personId: period.personId, id: { not: period.id } }),
      select: { startDate: true },
    });
    const consequences: VoidEligibility["consequences"] = ["NO_OPERATIONAL_EFFECT"];
    if (period.workEmail) consequences.push("WORK_EMAIL_RELEASED");
    if (otherValid.length === 0) consequences.push("PERSON_HAS_NO_VALID_EMPLOYMENT");
    if (otherValid.some((o) => o.startDate < period.startDate)) consequences.push("PREVIOUS_PERIOD_UNCHANGED");
    consequences.push("VOID_IS_PERMANENT");

    return {
      employment_id: period.id,
      evaluated_revision: revision,
      as_of: today,
      eligible: blockers.length === 0,
      period: {
        start_date: start,
        end_date: end,
        employee_type: employeeType ? { code: employeeType.code, name: employeeType.name } : null,
        period_lifecycle: disposition ? null : employmentStatus([{ startDate: start, endDate: end }], today),
      },
      blockers,
      warnings,
      affected_internal_records: {
        assignments,
        lifecycle_events: historyEventOrder(events).map((e) => ({
          event_type: e.eventType as EmploymentEventType,
          effective_date: fromDbDate(e.effectiveDate),
        })),
        has_active_end_event: activeEndEventOf(events) !== null,
        work_email: period.workEmail,
        planned_end_date: end !== null && end > today ? end : null,
      },
      consequences,
    };
  });
}

// ---------------- Void action ----------------
const describeReference = (r: VoidReference): string =>
  r.assignment_id
    ? `${r.employee_code}: assignment from ${formatDate(r.effective_from!)}${r.effective_to ? ` until before ${formatDate(r.effective_to)}` : " (open-ended)"}`
    : `Employment period ${r.start_date ? `from ${formatDate(r.start_date)}` : ""}${r.end_date ? ` to ${formatDate(r.end_date)}` : ""}`.trim();

/** The same blockers as the preview, as an API error (first blocker decides the status; every blocker is in details). */
export function voidBlockedError(blockers: VoidFinding[]): ApiError {
  const details: ErrorDetail[] = blockers.flatMap((b) => [
    { code: b.code, message: b.message },
    ...b.references.map((r) => ({
      field: r.assignment_id ? "assignment_id" : "employment_id",
      code: b.code,
      message: describeReference(r),
    })),
  ]);
  const first = blockers[0];
  if (first.code === "LATER_PERIOD_EXISTS") return new ApiError(409, "LATER_PERIOD_EXISTS", first.message, details);
  if (first.code === DEPENDENCY_CHECK_FAILED) return new ApiError(503, "SERVICE_UNAVAILABLE", first.message, details);
  return new ApiError(422, "BUSINESS_RULE_VIOLATION", first.message, details);
}

export async function createVoidEmployment(
  principal: Principal,
  employmentId: string,
  input: VoidEmploymentInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  const eventId = randomUUID();
  return runIdempotentCommand({
    principal,
    operation: "createVoidEmployment",
    idempotencyKey,
    payload: { employmentId, ...input },
    resourceId: eventId,
    personIdForResource: async (id) =>
      (await db().employmentEvent.findUniqueOrThrow({ where: { id }, include: { employment: true } })).employment.personId,
    precheck: () => {
      if (!reason) throw reasonRequired("A reason is required to void an employment period.");
    },
    // Final safety nets: one void event per period; a period has at most one disposition.
    mapError: (error) => {
      const constraint = pgErrorInfo(error).constraint;
      if (constraint === "employment_event_one_void_uq" || constraint === "employment_voided_is_terminal") return employmentReadOnly("voided");
      if (constraint === "employment_single_disposition_ck" || constraint === "employment_cancelled_is_terminal") return employmentReadOnly("cancelled");
      return undefined;
    },
    execute: async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404, or 409 when cancelled/voided
      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      const start = fromDbDate(period.startDate);
      const today = todayInVietnam();
      if (start > today) {
        const finding = notEffective(start);
        throw rule(finding.code, finding.message);
      }

      // Lock the period before the checks so no other employee's assignment can start referencing it as manager in
      // between (the assignment trigger share-locks the manager period).
      await lockEmploymentRow(tx, employmentId);
      const { blockers } = await evaluateVoidDependencies({ tx, period, today });
      if (blockers.length) throw voidBlockedError(blockers);

      const recordedAt = new Date();
      await markEmploymentVoided(tx, employmentId, recordedAt);
      await tx.employmentEvent.create({
        data: {
          id: eventId,
          employmentId,
          eventType: "employment_voided",
          effectiveDate: period.startDate, // void ab initio: the period is void from its beginning
          reason,
          recordedAt,
          recordedBy: principal.userId,
        },
      });
      await recordAudit(
        {
          actorUserId: principal.userId,
          action: "employment.void",
          outcome: "success",
          entityType: "employment",
          entityId: employmentId,
          requestId,
          changedFields: ["employment.voided", "employment_event.employment_voided"],
          reason,
        },
        tx,
      );
      return period.personId;
    },
  });
}
