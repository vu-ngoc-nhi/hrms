// S4.10 Cancel Planned Period (C-29, C-69 to C-71): a future period that has not become effective will not take
// effect. Nothing is deleted or cleared: the period, its dates, Employee Type, Work Email, assignments, events and
// audit stay as historical evidence; operational queries ignore it through the shared query module.
//  - only when start_date > today (date-based; today is already effective), the period is the latest non-cancelled
//    one, and it has no Active End Event (reverse the End first);
//  - employment.manage (HR_EDITOR, HR_ADMIN), mandatory reason, expected_revision, Idempotency-Key, atomic;
//  - one `cancel_planned_start` event dated with the planned start; an existing start event is kept, none synthesized.
import { randomUUID } from "node:crypto";
import type { CancelPlannedInput, EmployeeDetail } from "@/contracts/core-hr/schemas";
import { fromDbDate, todayInVietnam } from "@/lib/dates";
import { db, pgErrorInfo } from "@/lib/db";
import { ApiError } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { reasonRequired, rule, runIdempotentCommand } from "./command";
import { findActiveEndEvent } from "./lifecycle-events";
import { employmentReadOnly, loadWritableEmployment, markEmploymentCancelled, operationalEmploymentWhere } from "./queries";

export async function createCancelPlanned(
  principal: Principal,
  employmentId: string,
  input: CancelPlannedInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  const eventId = randomUUID();
  return runIdempotentCommand({
    principal,
    operation: "createCancelPlanned",
    idempotencyKey,
    payload: { employmentId, ...input },
    resourceId: eventId,
    personIdForResource: async (id) =>
      (await db().employmentEvent.findUniqueOrThrow({ where: { id }, include: { employment: true } })).employment.personId,
    precheck: () => {
      if (!reason) throw reasonRequired("A cancellation reason is required.");
    },
    // Final safety net: at most one cancellation event per period.
    mapError: (error) => (pgErrorInfo(error).constraint === "employment_event_one_cancel_uq" ? employmentReadOnly() : undefined),
    execute: async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404, or 409 when already cancelled
      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      const start = fromDbDate(period.startDate);
      if (start <= todayInVietnam()) {
        throw rule(
          "PERIOD_ALREADY_STARTED",
          `This period starts on ${start}, which is not after today. Only a period that has not become effective can be cancelled.`,
        );
      }
      const later = await tx.employment.count({
        where: operationalEmploymentWhere({ personId: period.personId, id: { not: employmentId }, startDate: { gt: period.startDate } }),
      });
      if (later > 0) {
        throw new ApiError(409, "LATER_PERIOD_EXISTS", "A later employment period exists. Only the latest planned period can be cancelled; nothing is cascaded.");
      }
      if (await findActiveEndEvent(tx, employmentId)) {
        throw rule("ACTIVE_END_EVENT_EXISTS", "This planned period has an End Employment. Reverse that End Employment first, then cancel the period.");
      }

      const recordedAt = new Date();
      await markEmploymentCancelled(tx, employmentId, recordedAt);
      await tx.employmentEvent.create({
        data: {
          id: eventId,
          employmentId,
          eventType: "cancel_planned_start",
          effectiveDate: period.startDate, // the planned start that will not take effect
          reason,
          recordedAt,
          recordedBy: principal.userId,
        },
      });
      await recordAudit(
        {
          actorUserId: principal.userId,
          action: "employment.cancel_planned",
          outcome: "success",
          entityType: "employment",
          entityId: employmentId,
          requestId,
          changedFields: ["employment.cancelled", "employment_event.cancel_planned_start"],
          reason,
        },
        tx,
      );
      return period.personId;
    },
  });
}
