// S4.7R Reverse End Employment (C-38, C-54 to C-57): "exact reversal or no reversal".
// Restores the period and the End Employment side effects to the exact state immediately before the original End
// action, using ONLY the metadata stored on the Active End Event (C-52) — never audit, never date matching.
//  - HR_ADMIN only (route permission employment.correct), mandatory reversal reason (not the End Reason);
//  - end_date := previous_end_date (null → open again; a planned date stays; a historical date may stay Ended);
//  - the closed assignment gets its exact previous effective_to back, only if the End effect is still intact
//    (otherwise 409 END_EFFECT_CHANGED); no other assignment is ever touched;
//  - later business history blocks the reversal instead of being rewritten (later periods, later lifecycle events);
//  - the original `end` event stays as it is; a new `end_reversed` event references it (at most once, DB-unique).
import { randomUUID } from "node:crypto";
import type { EmployeeDetail, ReverseEndInput } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate } from "@/lib/dates";
import { db, pgErrorInfo } from "@/lib/db";
import { ApiError } from "@/lib/http/errors";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { reasonRequired, rule, runIdempotentCommand } from "./command";
import { activeEndEventWhere } from "./lifecycle-events";
import { correctionDbError } from "./period-correction";
import { loadWritableEmployment, operationalAssignmentWhere, operationalEmploymentWhere } from "./queries";

const OPERATION = "createReverseEnd";

const conflict = (code: "END_EFFECT_CHANGED" | "END_STATE_INCONSISTENT" | "LATER_PERIOD_EXISTS" | "LATER_LIFECYCLE_EVENT" | "END_ALREADY_REVERSED", message: string) =>
  new ApiError(409, code, message);
const effectChanged = (detail: string) =>
  conflict("END_EFFECT_CHANGED", `The assignment changed by End Employment is no longer in the state End Employment left it in (${detail}). Reversal is blocked; correct the assignments first if needed.`);

export async function createReverseEnd(
  principal: Principal,
  employmentId: string,
  input: ReverseEndInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  const eventId = randomUUID();
  return runIdempotentCommand({
    principal,
    operation: OPERATION,
    idempotencyKey,
    payload: { employmentId, ...input },
    resourceId: eventId,
    personIdForResource: async (id) =>
      (await db().employmentEvent.findUniqueOrThrow({ where: { id }, include: { employment: true } })).employment.personId,
    precheck: () => {
      if (!reason) throw reasonRequired("A reversal reason is required.");
    },
    mapError: (error) => {
      const info = pgErrorInfo(error);
      if (info.constraint === "employment_event_one_reversal_uq") {
        return conflict("END_ALREADY_REVERSED", "This End Employment has already been reversed.");
      }
      return correctionDbError(error);
    },
    execute: async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404, or 409 when cancelled
      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      // 1. Exactly one Active End Event (C-51), never found by date.
      const active = await tx.employmentEvent.findMany({ where: activeEndEventWhere(employmentId) });
      if (active.length === 0) {
        throw rule(
          "NO_ACTIVE_END_EVENT",
          "This employment period has no End Employment to reverse. A recorded end date without an End event is corrected through Correct Period.",
        );
      }
      if (active.length > 1) throw conflict("END_STATE_INCONSISTENT", "This employment period has more than one active End event.");
      const end = active[0];
      const endDate = fromDbDate(end.effectiveDate);
      const restoredEnd = fromDbDate(end.previousEndDate);

      // 2. The period still reflects this End event (its current, possibly corrected, date).
      if (fromDbDate(period.endDate) !== endDate) {
        throw conflict("END_STATE_INCONSISTENT", "The period end date no longer matches the End Employment event. Reversal is blocked.");
      }
      // 3. Internal consistency of the stored effect metadata.
      if (end.closedAssignmentId === null && end.closedAssignmentPreviousEffectiveTo !== null) {
        throw conflict("END_STATE_INCONSISTENT", "The End Employment event has inconsistent assignment metadata.");
      }

      // 4. Later lifecycle history of this period depends on the End event: never rewritten.
      const later = await tx.employmentEvent.count({
        where: { employmentId, id: { not: end.id }, recordedAt: { gt: end.recordedAt }, eventType: { not: "end_reversed" } },
      });
      if (later > 0) {
        throw conflict("LATER_LIFECYCLE_EVENT", "Lifecycle events were recorded for this period after End Employment. Reversal is blocked.");
      }
      // 5. Later periods of the same person (Rehire, Relationship Change, any non-cancelled period) created after the
      //    End or overlapping the restored range block the reversal.
      const others = await tx.employment.findMany({ where: operationalEmploymentWhere({ personId: period.personId, id: { not: employmentId } }) });
      const start = fromDbDate(period.startDate);
      const blocking = others.filter((o) => {
        const oStart = fromDbDate(o.startDate);
        const oEnd = fromDbDate(o.endDate);
        const overlapsRestored = (restoredEnd === null || oStart <= restoredEnd) && (oEnd === null || oEnd >= start);
        return overlapsRestored || (oStart > start && o.createdAt > end.recordedAt);
      });
      if (blocking.length) {
        throw conflict(
          "LATER_PERIOD_EXISTS",
          "Another employment period of this person depends on or conflicts with the restored period (e.g. a Rehire or Relationship Change). Reversal is blocked.",
        );
      }

      // 6. End effect on the assignment must be intact and exactly restorable.
      const structural: StructuralChange[] = [];
      let restoredRow: { id: string; from: string | null; to: string | null } | null = null;
      if (end.closedAssignmentId) {
        const row = await tx.jobAssignment.findUnique({ where: { id: end.closedAssignmentId } });
        if (!row || row.employmentId !== employmentId) throw effectChanged("the assignment no longer belongs to this period");
        const currentTo = fromDbDate(row.effectiveTo);
        if (currentTo !== addDays(endDate, 1)) throw effectChanged(`it now ends on ${currentTo ?? "no date"}`);
        const previousTo = fromDbDate(end.closedAssignmentPreviousEffectiveTo);
        const from = fromDbDate(row.effectiveFrom);
        if (previousTo !== null && previousTo <= from) throw effectChanged("restoring would leave an empty assignment");
        if (restoredEnd !== null && (previousTo === null || previousTo > addDays(restoredEnd, 1))) {
          throw effectChanged("restoring would extend the assignment beyond the restored end date");
        }
        // A cancelled planned assignment (PV-29) is history only and never blocks the reversal.
        const laterRows = await tx.jobAssignment.count({ where: operationalAssignmentWhere({ employmentId, effectiveFrom: { gt: row.effectiveFrom } }) });
        if (laterRows > 0) throw effectChanged("a later assignment exists after it");
        restoredRow = { id: row.id, from: currentTo, to: previousTo };
      }

      // 7. Restore exactly, then record the reversal.
      if (restoredEnd !== endDate) {
        await tx.employment.update({ where: { id: employmentId }, data: { endDate: restoredEnd === null ? null : toDbDate(restoredEnd) } });
        structural.push({ field: "employment.end_date", oldValue: endDate, newValue: restoredEnd });
      }
      if (restoredRow) {
        await tx.jobAssignment.update({ where: { id: restoredRow.id }, data: { effectiveTo: restoredRow.to === null ? null : toDbDate(restoredRow.to) } });
      }
      // The reversal is dated with the reversed End event's current date so history shows End → End reversed together.
      await tx.employmentEvent.create({
        data: { id: eventId, employmentId, eventType: "end_reversed", effectiveDate: end.effectiveDate, reason, reversesEventId: end.id, recordedBy: principal.userId },
      });

      const base = { actorUserId: principal.userId, outcome: "success" as const, requestId, reason };
      await recordAudit(
        {
          ...base,
          action: "employment.end.reverse",
          entityType: "employment",
          entityId: employmentId,
          changedFields: [...(structural.length ? ["employment.end_date"] : []), "employment_event.end_reversed"],
          structuralChanges: structural,
        },
        tx,
      );
      if (restoredRow) {
        await recordAudit(
          {
            ...base,
            action: "assignment.restore",
            entityType: "job_assignment",
            entityId: restoredRow.id,
            changedFields: ["assignment.effective_to"],
            structuralChanges: [{ field: "assignment.effective_to", oldValue: restoredRow.from, newValue: restoredRow.to }],
          },
          tx,
        );
      }
      return period.personId;
    },
  });
}
