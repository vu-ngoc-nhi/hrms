// S4.6 Assignment row correction (C-40, C-42, C-44): fixes a wrongly entered assignment row IN PLACE (no new row, no
// fake Assignment Change, no lifecycle event). HR_ADMIN only (route permission employment.correct), mandatory reason,
// past, current and future-dated rows alike.
//  - Department, Job Title, Job Level (existing inactive values allowed) and Manager can be corrected;
//  - effective_from can be corrected; effective_to is never edited directly. For a non-first row the immediately
//    previous row's effective_to moves to the corrected effective_from (C-42); unrelated rows never change;
//  - blocked when a row would become empty, leave the period, or when the previous row is not contiguous
//    (unrelated timeline problems are never repaired silently);
//  - audit: assignment.correct on every modified row (same request id and reason).
import type { AssignmentCorrectionInput, EmployeeDetail } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { ApiError, notFound, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { assignmentTimelineConflict } from "./assignment-change";
import { personIdForAssignment, reasonRequired, rule, runIdempotentCommand } from "./command";
import { assertAssignmentWritable, currentEmploymentWhere, loadWritableEmployment, operationalAssignmentWhere } from "./queries";

const OPERATION = "createAssignmentCorrection";

export async function createAssignmentCorrection(
  principal: Principal,
  assignmentId: string,
  input: AssignmentCorrectionInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  return runIdempotentCommand({
    principal,
    operation: OPERATION,
    idempotencyKey,
    payload: { assignmentId, ...input },
    resourceId: assignmentId,
    personIdForResource: personIdForAssignment,
    precheck: () => {
      if (!reason) throw reasonRequired("A correction reason is required.");
    },
    mapError: assignmentTimelineConflict,
    execute: async (tx) => {
      const row = await tx.jobAssignment.findUnique({ where: { id: assignmentId } });
      if (!row) throw notFound("Assignment not found.");
      const period = await loadWritableEmployment(tx, row.employmentId); // 409 when the period is cancelled
      assertAssignmentWritable(row); // PV-29: a cancelled planned assignment is read-only history (409)
      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      const rows = await tx.jobAssignment.findMany({
        where: operationalAssignmentWhere({ employmentId: row.employmentId }),
        orderBy: { effectiveFrom: "asc" },
      });
      const index = rows.findIndex((a) => a.id === row.id);
      const previous = index > 0 ? rows[index - 1] : null;
      const oldFrom = fromDbDate(row.effectiveFrom);
      const to = fromDbDate(row.effectiveTo);
      const newFrom = input.effective_from ?? oldFrom;
      const next = await resolveCorrectedValues(tx, input, row, period.personId, newFrom);

      const fromChanged = newFrom !== oldFrom;
      if (fromChanged) {
        const start = fromDbDate(period.startDate);
        const end = fromDbDate(period.endDate);
        if (newFrom < start || (end !== null && newFrom > end)) {
          throw rule("OUTSIDE_EMPLOYMENT_PERIOD", "The corrected start must fall within the employment period.", [
            { field: "effective_from", code: "OUTSIDE_EMPLOYMENT_PERIOD", message: "The corrected start is outside the employment period." },
          ]);
        }
        if (to !== null && newFrom >= to) {
          throw rule("ASSIGNMENT_WOULD_BE_EMPTY", "The corrected start must be before the end of this assignment.", [
            { field: "effective_from", code: "ASSIGNMENT_WOULD_BE_EMPTY", message: `This assignment ends on ${addDays(to, -1)}.` },
          ]);
        }
        if (previous) {
          if (fromDbDate(previous.effectiveTo) !== oldFrom) {
            throw rule(
              "ASSIGNMENT_TIMELINE_GAP",
              "The previous assignment does not end where this one starts. This timeline problem must be reviewed; it is not repaired automatically.",
            );
          }
          if (newFrom <= fromDbDate(previous.effectiveFrom)) {
            throw rule("PREVIOUS_ASSIGNMENT_WOULD_BE_EMPTY", "The corrected start must be after the start of the previous assignment.", [
              {
                field: "effective_from",
                code: "PREVIOUS_ASSIGNMENT_WOULD_BE_EMPTY",
                message: `The previous assignment starts on ${fromDbDate(previous.effectiveFrom)}.`,
              },
            ]);
          }
        }
      }

      const changedFields: string[] = [];
      const structural: StructuralChange[] = [];
      const track = (name: string, field: StructuralChange["field"] | null, before: string | null, after: string | null) => {
        if (before === after) return;
        changedFields.push(name);
        if (field) structural.push({ field, oldValue: before, newValue: after });
      };
      track("assignment.department_id", "department_id", row.departmentId, next.departmentId);
      track("assignment.job_title_id", "job_title_id", row.jobTitleId, next.jobTitleId);
      track("assignment.job_level_id", "job_level_id", row.jobLevelId, next.jobLevelId);
      track("assignment.manager", null, row.managerEmploymentId, next.managerEmploymentId); // field name only (C-24)
      track("assignment.effective_from", "assignment.effective_from", oldFrom, newFrom);
      if (changedFields.length === 0) throw rule("NO_CHANGE", "The corrected values are the same as the recorded values.");

      // The assignment overlap constraint is immediate: shrink before extending.
      const movePrevious = () =>
        tx.jobAssignment.update({ where: { id: previous!.id }, data: { effectiveTo: toDbDate(newFrom) } });
      const updateRow = () =>
        tx.jobAssignment.update({
          where: { id: row.id },
          data: {
            effectiveFrom: toDbDate(newFrom),
            departmentId: next.departmentId,
            jobTitleId: next.jobTitleId,
            jobLevelId: next.jobLevelId,
            managerEmploymentId: next.managerEmploymentId,
          },
        });
      if (fromChanged && previous && newFrom < oldFrom) {
        await movePrevious();
        await updateRow();
      } else {
        await updateRow();
        if (fromChanged && previous) await movePrevious();
      }

      const base = { actorUserId: principal.userId, outcome: "success" as const, requestId, reason, entityType: "job_assignment" };
      await recordAudit({ ...base, action: "assignment.correct", entityId: row.id, changedFields, structuralChanges: structural }, tx);
      if (fromChanged && previous) {
        // C-42: the automatically moved previous row is audited too.
        await recordAudit(
          {
            ...base,
            action: "assignment.correct",
            entityId: previous.id,
            changedFields: ["assignment.effective_to"],
            structuralChanges: [{ field: "assignment.effective_to", oldValue: fromDbDate(previous.effectiveTo), newValue: newFrom }],
          },
          tx,
        );
      }
      return period.personId;
    },
  });
}

type Current = { departmentId: string; jobTitleId: string; jobLevelId: string | null; managerEmploymentId: string | null };

// C-44: a historical correction may reference an existing INACTIVE catalog value; non-existent ids are rejected.
async function resolveCorrectedValues(tx: Tx, input: AssignmentCorrectionInput, row: Current, personId: string, onDate: string): Promise<Current> {
  const errors: ErrorDetail[] = [];
  const exists = async (field: string, label: string, lookup: Promise<unknown>) => {
    if (!(await lookup)) errors.push({ field, code: "UNKNOWN_REFERENCE", message: `${label} does not exist.` });
  };
  await Promise.all([
    input.department_id ? exists("department_id", "Department", tx.department.findUnique({ where: { id: input.department_id } })) : null,
    input.job_title_id ? exists("job_title_id", "Job title", tx.jobTitle.findUnique({ where: { id: input.job_title_id } })) : null,
    input.job_level_id ? exists("job_level_id", "Job level", tx.jobLevel.findUnique({ where: { id: input.job_level_id } })) : null,
  ]);
  let managerEmploymentId = row.managerEmploymentId;
  if (input.manager_person_id === null) managerEmploymentId = null;
  else if (input.manager_person_id !== undefined) {
    if (input.manager_person_id === personId) {
      errors.push({ field: "manager_person_id", code: "SELF_MANAGER", message: "A person cannot be their own manager." });
    } else {
      const mgr = await tx.employment.findFirst({ where: currentEmploymentWhere(toDbDate(onDate), { personId: input.manager_person_id }) });
      if (!mgr) {
        errors.push({ field: "manager_person_id", code: "MANAGER_NOT_EMPLOYED_ON_DATE", message: "The manager has no employment period on the assignment start date." });
      } else managerEmploymentId = mgr.id;
    }
  }
  if (errors.length) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", errors);
  return {
    departmentId: input.department_id ?? row.departmentId,
    jobTitleId: input.job_title_id ?? row.jobTitleId,
    jobLevelId: input.job_level_id === undefined ? row.jobLevelId : input.job_level_id,
    managerEmploymentId,
  };
}
