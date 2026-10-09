// S4.7 End Employment (C-21, C-28, C-49 to C-52): explicit business action on a non-cancelled period that has not
// operationally ended and has no Active End Event.
//  - Case A: open period → sets the end date. Case B: existing future end date → the same date (records the lifecycle
//    event, End Reason and audit only) or an earlier date. Never later (that is a Historical Correction, S4.6);
//  - HR_EDITOR today or later; a past end date requires employment.correct (C-25);
//  - assignments starting after the end date block the action and are never changed (C-28); the assignment in effect
//    on the end date is closed at end date + 1 when it extends past it (at most one row);
//  - the `end` event stores what a later Reverse End Employment needs: previous_end_date, closed_assignment_id and
//    closed_assignment_previous_effective_to. Audit is never the reversal source.
import { randomUUID } from "node:crypto";
import type { EmployeeDetail, EndEmploymentInput } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db, pgErrorInfo } from "@/lib/db";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { rule, runIdempotentCommand } from "./command";
import { assertEffectiveDateAllowed } from "./effective-date-policy";
import { findActiveEndEvent } from "./lifecycle-events";
import { correctionDbError } from "./period-correction";
import { loadWritableEmployment } from "./queries";

const OPERATION = "createEndEmployment";

const endAlreadyRecorded = () =>
  rule(
    "END_ALREADY_RECORDED",
    "This employment period already has a recorded End Employment. To change its date use Correct Period; if it was recorded by mistake use Reverse End Employment.",
  );

export async function createEndEmployment(
  principal: Principal,
  employmentId: string,
  input: EndEmploymentInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const note = input.note?.trim() || null;
  const end = input.end_date;
  const today = todayInVietnam();
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
      // C-25: HR_EDITOR today or later; a backdated End Employment requires employment.correct (HR_ADMIN).
      assertEffectiveDateAllowed(principal, "business_event", end, today);
    },
    mapError: (error) => {
      if (pgErrorInfo(error).constraint === "employment_event_one_active_end") return endAlreadyRecorded();
      return correctionDbError(error);
    },
    execute: async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404, or 409 when cancelled
      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      if (await findActiveEndEvent(tx, employmentId)) throw endAlreadyRecorded();
      const start = fromDbDate(period.startDate);
      const previousEnd = fromDbDate(period.endDate);
      if (previousEnd !== null && previousEnd < today) {
        throw rule(
          "PERIOD_ALREADY_ENDED",
          "This employment period has already ended. Use a historical correction for a wrong date, or Reverse End Employment when the End action itself was wrong.",
        );
      }
      if (end < start) {
        throw rule("END_BEFORE_START", "The end date cannot be before the start date.", [
          { field: "end_date", code: "END_BEFORE_START", message: "The end date cannot be before the start date." },
        ]);
      }
      if (previousEnd !== null && end > previousEnd) {
        throw rule(
          "END_DATE_LATER_THAN_PLANNED",
          `End Employment cannot move the planned end date (${previousEnd}) later. Changing it later is a historical correction.`,
          [{ field: "end_date", code: "END_DATE_LATER_THAN_PLANNED", message: `The planned end date is ${previousEnd}.` }],
        );
      }

      const reasonRow = await tx.endReason.findUnique({ where: { code: input.end_reason_code } });
      if (!reasonRow?.selectable) {
        throw rule("END_REASON_NOT_SELECTABLE", "This End Reason cannot be selected in End Employment.", [
          { field: "end_reason_code", code: "END_REASON_NOT_SELECTABLE", message: "This End Reason is set only by its own action." },
        ]);
      }
      if (reasonRow.noteRequired && !note) {
        throw rule("NOTE_REQUIRED", "A note is required for this End Reason.", [
          { field: "note", code: "NOTE_REQUIRED", message: "A note is required when the End Reason is Other." },
        ]);
      }

      // C-28: never delete, truncate or move a later assignment automatically.
      const rows = await tx.jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } });
      const after = rows.filter((a) => fromDbDate(a.effectiveFrom) > end);
      if (after.length) {
        throw rule(
          "FUTURE_ASSIGNMENT_OUTSIDE_END",
          "An assignment starts after the requested end date. Correct that assignment first; it is never changed automatically.",
          after.map((a) => ({
            field: "end_date",
            code: "FUTURE_ASSIGNMENT_OUTSIDE_END",
            message: `Assignment ${a.id} starts on ${fromDbDate(a.effectiveFrom)}.`,
          })),
        );
      }
      const closeAt = addDays(end, 1);
      const covering = rows.find((a) => fromDbDate(a.effectiveFrom) <= end && (a.effectiveTo === null || fromDbDate(a.effectiveTo) > end));
      const closed = covering && (covering.effectiveTo === null || fromDbDate(covering.effectiveTo) > closeAt) ? covering : null;

      const endChanged = previousEnd !== end;
      if (endChanged) await tx.employment.update({ where: { id: employmentId }, data: { endDate: toDbDate(end) } });
      if (closed) await tx.jobAssignment.update({ where: { id: closed.id }, data: { effectiveTo: toDbDate(closeAt) } });
      await tx.employmentEvent.create({
        data: {
          id: eventId,
          employmentId,
          eventType: "end",
          effectiveDate: toDbDate(end),
          endReasonCode: reasonRow.code,
          endNote: note,
          previousEndDate: period.endDate,
          closedAssignmentId: closed?.id ?? null,
          closedAssignmentPreviousEffectiveTo: closed ? closed.effectiveTo : null,
          recordedBy: principal.userId,
        },
      });

      // Audit = who changed which structural data (the lifecycle history lives in employment_event).
      const base = { actorUserId: principal.userId, outcome: "success" as const, requestId, reason: `End Reason: ${reasonRow.code}` };
      await recordAudit(
        {
          ...base,
          action: "employment.end",
          entityType: "employment",
          entityId: employmentId,
          changedFields: [...(endChanged ? ["employment.end_date"] : []), "employment_event.end"],
          structuralChanges: endChanged ? [{ field: "employment.end_date", oldValue: previousEnd, newValue: end }] : [],
        },
        tx,
      );
      if (closed) {
        await recordAudit(
          {
            ...base,
            action: "assignment.close",
            entityType: "job_assignment",
            entityId: closed.id,
            changedFields: ["assignment.effective_to"],
            structuralChanges: [{ field: "assignment.effective_to", oldValue: fromDbDate(closed.effectiveTo), newValue: closeAt }],
          },
          tx,
        );
      }
      return period.personId;
    },
  });
}
