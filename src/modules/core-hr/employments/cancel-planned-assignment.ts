// PV-29 Cancel Planned Assignment (BD-1 … BD-10, approved 2026-10-11): a planned assignment that has not taken effect
// will not take effect. A normal lifecycle action — not a correction, not a delete.
//  - employment.manage (HR_EDITOR, HR_ADMIN); mandatory reason (audit only, never returned); expected_revision;
//    Idempotency-Key; one transaction;
//  - only when effective_from > today (Asia/Ho_Chi_Minh): a row effective today has taken effect (BD-2);
//  - only the latest operational row of its period: cancel from latest to earliest (BD-3, 409 LATER_ASSIGNMENT_EXISTS);
//  - blocked only while an Active End Event closes this exact row (BD-5; reversed / historical End events never block);
//  - the predecessor takes back the cancelled row's end — the exact inverse of scheduling it (Assignment Change set
//    predecessor.effective_to := d and gave the new row the predecessor's old end, and any later boundary move was
//    applied to that last row). It must end exactly where the planned row starts; a malformed chain is never repaired
//    (422 ASSIGNMENT_TIMELINE_GAP). A planned first (initial) assignment has no predecessor: the period simply has no
//    assignment afterwards (BD-4, may show Needs Attention);
//  - the row keeps its dates and values; only `cancelled_at` is set (permanent, BD-10; DB trigger
//    job_assignment_cancelled_is_terminal);
//  - a manager of the predecessor who is not employed through the restored range is a warning only (BD-8, C-73);
//  - audit: assignment.cancel_planned (+ assignment.restore_end on the predecessor), same request id and reason.
import type { AssignmentCancelPlannedInput, EmployeeDetail } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, todayInVietnam } from "@/lib/dates";
import { pgErrorInfo } from "@/lib/db";
import { ApiError, notFound, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { assignmentTimelineConflict } from "./assignment-change";
import { personIdForAssignment, reasonRequired, rule, runIdempotentCommand } from "./command";
import { findActiveEndEvent } from "./lifecycle-events";
import {
  assertAssignmentWritable,
  isOperationalPeriod,
  loadWritableEmployment,
  markAssignmentCancelled,
  operationalAssignmentWhere,
} from "./queries";

const OPERATION = "createAssignmentCancelPlanned";

export const MANAGER_NOT_EMPLOYED_FOR_RESTORED_RANGE = "MANAGER_NOT_EMPLOYED_FOR_RESTORED_RANGE";

const closedByActiveEnd = () =>
  rule(
    "ACTIVE_END_EVENT_EXISTS",
    "A recorded End Employment currently ends this planned assignment. Use Reverse End Employment first, then cancel the planned assignment.",
  );

export async function createAssignmentCancelPlanned(
  principal: Principal,
  assignmentId: string,
  input: AssignmentCancelPlannedInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail & { warnings: ErrorDetail[] } }> {
  const reason = input.reason.trim();
  const warnings: ErrorDetail[] = [];
  const result = await runIdempotentCommand({
    principal,
    operation: OPERATION,
    idempotencyKey,
    payload: { assignmentId, ...input },
    resourceId: assignmentId,
    personIdForResource: personIdForAssignment,
    precheck: () => {
      if (!reason) throw reasonRequired("A reason is required to cancel a planned assignment.");
    },
    mapError: (error) => {
      if (pgErrorInfo(error).constraint === "job_assignment_cancel_closed_by_end") return closedByActiveEnd();
      return assignmentTimelineConflict(error);
    },
    execute: async (tx) => {
      const row = await tx.jobAssignment.findUnique({ where: { id: assignmentId } });
      if (!row) throw notFound("Assignment not found.");
      const period = await loadWritableEmployment(tx, row.employmentId); // 409 when the period is cancelled or voided
      assertAssignmentWritable(row); // 409 ASSIGNMENT_CANCELLED
      // Locks the person aggregate: concurrent changes to the same timeline serialize here (409 REVISION_CONFLICT).
      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      // One instant decides both "today" and the cancellation time, so the scanner invariant
      // (cancelled_at as a Vietnam date < effective_from) holds exactly, even across midnight.
      const at = new Date();
      const today = todayInVietnam(at);
      const from = fromDbDate(row.effectiveFrom)!;
      if (from <= today) {
        throw rule(
          "ASSIGNMENT_ALREADY_EFFECTIVE",
          `This assignment takes effect on ${from}, which is not after today. Only an assignment that has not taken effect can be cancelled.`,
        );
      }

      const rows = await tx.jobAssignment.findMany({ where: operationalAssignmentWhere({ employmentId: row.employmentId }), orderBy: { effectiveFrom: "asc" } });
      const index = rows.findIndex((a) => a.id === row.id);
      if (index < rows.length - 1) {
        throw new ApiError(
          409,
          "LATER_ASSIGNMENT_EXISTS",
          "A later planned assignment exists in this employment period. Cancel the latest planned assignment first.",
          rows.slice(index + 1).map((a) => ({
            field: "assignment_id",
            code: "LATER_ASSIGNMENT_EXISTS",
            message: `Assignment ${a.id} starts on ${fromDbDate(a.effectiveFrom)}.`,
          })),
        );
      }
      // BD-5: only an End with current operational effect on this row blocks (reversed End events never do).
      const activeEnd = await findActiveEndEvent(tx, row.employmentId);
      if (activeEnd?.closedAssignmentId === row.id) throw closedByActiveEnd();

      const predecessor = index > 0 ? rows[index - 1] : null;
      if (predecessor && fromDbDate(predecessor.effectiveTo) !== from) {
        throw rule(
          "ASSIGNMENT_TIMELINE_GAP",
          "The previous assignment does not end where this planned assignment starts. This timeline problem must be reviewed; it is not repaired automatically.",
        );
      }

      // Cancel first (the overlap exclusion ignores cancelled rows), then give the predecessor its boundary back.
      await markAssignmentCancelled(tx, row.id, at);
      const restoredTo = fromDbDate(row.effectiveTo);
      if (predecessor) {
        await tx.jobAssignment.update({ where: { id: predecessor.id }, data: { effectiveTo: row.effectiveTo } });
        const manager = predecessor.managerEmploymentId
          ? await tx.employment.findUnique({ where: { id: predecessor.managerEmploymentId } })
          : null;
        if (manager) {
          const managerEnd = fromDbDate(manager.endDate);
          const coversRange =
            isOperationalPeriod(manager) && (managerEnd === null || (restoredTo !== null && addDays(managerEnd, 1) >= restoredTo));
          if (!coversRange) {
            warnings.push({
              field: "manager",
              code: MANAGER_NOT_EMPLOYED_FOR_RESTORED_RANGE,
              message:
                managerEnd !== null && isOperationalPeriod(manager)
                  ? `The manager of the assignment that stays in effect is employed only until ${managerEnd}. Review the manager.`
                  : "The manager of the assignment that stays in effect is not employed for the whole period it now covers. Review the manager.",
            });
          }
        }
      }

      const base = { actorUserId: principal.userId, outcome: "success" as const, requestId, reason, entityType: "job_assignment" };
      await recordAudit({ ...base, action: "assignment.cancel_planned", entityId: row.id, changedFields: ["assignment.cancelled"] }, tx);
      if (predecessor) {
        await recordAudit(
          {
            ...base,
            action: "assignment.restore_end",
            entityId: predecessor.id,
            changedFields: ["assignment.effective_to"],
            structuralChanges: [{ field: "assignment.effective_to", oldValue: from, newValue: restoredTo }],
          },
          tx,
        );
      }
      return period.personId;
    },
  });
  return { replayed: result.replayed, body: { ...result.body, warnings: result.replayed ? [] : warnings } };
}
