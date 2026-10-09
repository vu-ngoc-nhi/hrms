// S4.9 Relationship Change (C-63 to C-67): a continuous transition of the Person's LATEST non-cancelled period to a
// DIFFERENT Employee Type. Atomically:
//  - ends the old period at new start − 1 with an `end` event (system End Reason RELATIONSHIP_CHANGE + the C-52
//    reversal metadata), closing the applicable assignment at the new start date (C-28 integrity);
//  - creates the new period (same Person/Employee Code) with exactly one `start` event, an optional planned end,
//    only the Work Email that was submitted, and an optional explicitly submitted Initial Assignment.
// Never copies the old assignment or Work Email, never replaces an Active End Event, never rewrites an already
// effective historical end date, and never inserts a transition into earlier history.
import { randomUUID } from "node:crypto";
import type { EmployeeDetail, RelationshipChangeInput } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { pgErrorInfo } from "@/lib/db";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { resolveAssignmentValues } from "./assignment-change";
import { personIdForEmployment, reasonRequired, rule, runIdempotentCommand } from "./command";
import { assertEffectiveDateAllowed } from "./effective-date-policy";
import { findActiveEndEvent } from "./lifecycle-events";
import { checkFields, insertPeriod } from "./new-period";
import { correctionDbError } from "./period-correction";
import { loadWritableEmployment, operationalEmploymentWhere } from "./queries";

const activeEndExists = () =>
  rule(
    "ACTIVE_END_EVENT_EXISTS",
    "This employment period already has an End Employment. Resolve it first (for example Reverse End Employment if it was recorded by mistake).",
  );

export async function createRelationshipChange(
  principal: Principal,
  employmentId: string,
  input: RelationshipChangeInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  const start = input.start_date;
  const oldEndNew = addDays(start, -1);
  const today = todayInVietnam();
  const newEmploymentId = randomUUID();
  let workEmail: string | null = null;
  return runIdempotentCommand({
    principal,
    operation: "createRelationshipChange",
    idempotencyKey,
    payload: { employmentId, ...input },
    resourceId: newEmploymentId,
    personIdForResource: personIdForEmployment,
    precheck: () => {
      if (!reason) throw reasonRequired("A reason is required for a Relationship Change.");
      // C-25: effective date = new start date. HR_EDITOR today or later; backdated requires HR_ADMIN.
      assertEffectiveDateAllowed(principal, "business_event", start, today);
      ({ workEmail } = checkFields(input));
    },
    mapError: (error) => (pgErrorInfo(error).constraint === "employment_event_one_active_end" ? activeEndExists() : correctionDbError(error)),
    execute: async (tx) => {
      const old = await loadWritableEmployment(tx, employmentId); // 404, or 409 when cancelled
      const personId = old.personId;
      await bumpPersonRevision(tx, personId, input.expected_revision);

      // Latest non-cancelled period only.
      const later = await tx.employment.count({
        where: operationalEmploymentWhere({ personId, id: { not: employmentId }, startDate: { gt: old.startDate } }),
      });
      if (later > 0) {
        throw rule("NOT_LATEST_PERIOD", "A later employment period exists. Relationship Change only applies to the latest period.");
      }
      if (await findActiveEndEvent(tx, employmentId)) throw activeEndExists();

      // Employee Type must change. An unknown old type cannot prove a change of relationship.
      if (!old.employeeTypeId) {
        throw rule("OLD_EMPLOYEE_TYPE_UNKNOWN", "The current period has no Employee Type. Correct it first so the change can be verified.");
      }
      if (input.employee_type_id === old.employeeTypeId) {
        throw rule("SAME_EMPLOYEE_TYPE", "The new Employee Type is the same as the current one. Relationship Change requires a different Employee Type.", [
          { field: "employee_type_id", code: "SAME_EMPLOYEE_TYPE", message: "Choose a different Employee Type." },
        ]);
      }

      const oldStart = fromDbDate(old.startDate);
      const previousEnd = fromDbDate(old.endDate);
      if (oldEndNew < oldStart) {
        throw rule("START_NOT_AFTER_PERIOD_START", "The new period must start after the first day of the current period.", [
          { field: "start_date", code: "START_NOT_AFTER_PERIOD_START", message: `The earliest possible start date is ${addDays(oldStart, 1)}.` },
        ]);
      }
      // C-64 Case C: an already-ended period is never rewritten to manufacture continuity.
      if (previousEnd !== null && previousEnd < today && previousEnd !== oldEndNew) {
        throw start > addDays(previousEnd, 1)
          ? rule("GAP_USE_REHIRE", `The current period ended on ${previousEnd}. A start after a gap is a Rehire, not a Relationship Change.`)
          : rule(
              "HISTORICAL_END_MISMATCH",
              `The current period already ended on ${previousEnd}. The new period must start on ${addDays(previousEnd, 1)}; correct the historical end date first if it is wrong.`,
            );
      }

      // C-65: assignments starting on or after the transition block it; the applicable one closes at the new start.
      const rows = await tx.jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } });
      const after = rows.filter((a) => fromDbDate(a.effectiveFrom) >= start);
      if (after.length) {
        throw rule(
          "FUTURE_ASSIGNMENT_OUTSIDE_END",
          "An assignment of the current period starts on or after the Relationship Change date. Correct it first; it is never changed automatically.",
          after.map((a) => ({ field: "start_date", code: "FUTURE_ASSIGNMENT_OUTSIDE_END", message: `Assignment ${a.id} starts on ${fromDbDate(a.effectiveFrom)}.` })),
        );
      }
      const last = rows.at(-1);
      const lastTo = last ? fromDbDate(last.effectiveTo) : null;
      // The last row follows the period boundary when it is open, ends with the old (planned) end, or extends past it.
      const aligned = last && (lastTo === null || (previousEnd !== null && lastTo === addDays(previousEnd, 1)) || lastTo > start);
      const closed = aligned && lastTo !== start ? last : null;

      // Old period: end date, assignment, End event (metadata captured before any change).
      if (previousEnd !== oldEndNew) await tx.employment.update({ where: { id: employmentId }, data: { endDate: toDbDate(oldEndNew) } });
      if (closed) await tx.jobAssignment.update({ where: { id: closed.id }, data: { effectiveTo: toDbDate(start) } });
      await tx.employmentEvent.create({
        data: {
          employmentId,
          eventType: "end",
          effectiveDate: toDbDate(oldEndNew),
          endReasonCode: "RELATIONSHIP_CHANGE",
          reason, // the business reason; never exposed in the generic history
          previousEndDate: old.endDate,
          closedAssignmentId: closed?.id ?? null,
          closedAssignmentPreviousEffectiveTo: closed ? closed.effectiveTo : null,
          recordedBy: principal.userId,
        },
      });

      // New period with its start event (shared S4.8 helper; validates the Employee Type is active).
      await insertPeriod(tx, {
        id: newEmploymentId,
        personId,
        input,
        workEmail,
        principal,
        requestId,
        action: "employment.relationship_change",
        reason,
      });

      // Optional, explicitly submitted Initial Assignment of the new period (never copied).
      let initialAssignmentId: string | null = null;
      let initialStructural: StructuralChange[] = [];
      let initialFields: string[] = [];
      if (input.initial_assignment) {
        const v = await resolveAssignmentValues(tx, input.initial_assignment, null, personId, start);
        initialAssignmentId = randomUUID();
        const to = input.end_date ? addDays(input.end_date, 1) : null;
        await tx.jobAssignment.create({
          data: {
            id: initialAssignmentId,
            employmentId: newEmploymentId,
            effectiveFrom: toDbDate(start),
            effectiveTo: to ? toDbDate(to) : null,
            departmentId: v.departmentId,
            jobTitleId: v.jobTitleId,
            jobLevelId: v.jobLevelId,
            managerEmploymentId: v.managerEmploymentId,
            recordSource: "form",
            changeReason: "initial_assignment",
            createdBy: principal.userId,
          },
        });
        initialStructural = [
          { field: "department_id", oldValue: null, newValue: v.departmentId },
          { field: "job_title_id", oldValue: null, newValue: v.jobTitleId },
          { field: "job_level_id", oldValue: null, newValue: v.jobLevelId },
          { field: "assignment.effective_from", oldValue: null, newValue: start },
          { field: "assignment.effective_to", oldValue: null, newValue: to },
        ];
        initialFields = [
          "assignment.department_id",
          "assignment.job_title_id",
          ...(v.jobLevelId ? ["assignment.job_level_id"] : []),
          ...(v.managerEmploymentId ? ["assignment.manager"] : []), // manager by field name only
          "assignment.effective_from",
        ];
      }

      // Audit: one request id across the composite action (the new period's record was written by insertPeriod).
      const base = { actorUserId: principal.userId, outcome: "success" as const, requestId, reason };
      await recordAudit(
        {
          ...base,
          action: "employment.relationship_change",
          entityType: "employment",
          entityId: employmentId,
          changedFields: [...(previousEnd !== oldEndNew ? ["employment.end_date"] : []), "employment_event.end"],
          structuralChanges: previousEnd !== oldEndNew ? [{ field: "employment.end_date", oldValue: previousEnd, newValue: oldEndNew }] : [],
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
            structuralChanges: [{ field: "assignment.effective_to", oldValue: lastTo, newValue: start }],
          },
          tx,
        );
      }
      if (initialAssignmentId) {
        await recordAudit(
          { ...base, action: "assignment.initial", entityType: "job_assignment", entityId: initialAssignmentId, changedFields: initialFields, structuralChanges: initialStructural },
          tx,
        );
      }
      return personId;
    },
  });
}
