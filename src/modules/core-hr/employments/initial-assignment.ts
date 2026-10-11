// S4.5A Add Initial Assignment (C-41): the FIRST assignment of a non-cancelled Employment Period that has none.
// Separate from Assignment Change (which now refuses periods without assignments with NO_ASSIGNMENT_YET).
//  - HR_EDITOR and HR_ADMIN (employment.manage); a historical effective date is allowed (Initial Data Capture, PV-19);
//  - effective date today or later: normal onboarding, no reason;
//  - effective date in the past: backdated Initial Data Capture on an existing period, reason mandatory;
//  - the row must fall within the period; nothing is invented before it and it is not moved to the period start.
import { randomUUID } from "node:crypto";
import type { EmployeeDetail, InitialAssignmentInput } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { assignmentTimelineConflict, resolveAssignmentValues } from "./assignment-change";
import { personIdForAssignment, reasonRequired, rule, runIdempotentCommand } from "./command";
import { assertEffectiveDateAllowed } from "./effective-date-policy";
import { loadWritableEmployment, operationalAssignmentWhere } from "./queries";

const OPERATION = "createInitialAssignment";

export async function createInitialAssignment(
  principal: Principal,
  employmentId: string,
  input: InitialAssignmentInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason?.trim() || null;
  const d = input.effective_date;
  const newAssignmentId = randomUUID();
  let backdated = false;
  return runIdempotentCommand({
    principal,
    operation: OPERATION,
    idempotencyKey,
    payload: { employmentId, ...input },
    resourceId: newAssignmentId,
    personIdForResource: personIdForAssignment,
    precheck: () => {
      backdated = assertEffectiveDateAllowed(principal, "initial_data_capture", d, todayInVietnam()).backdated;
      if (backdated && !reason) {
        throw reasonRequired("A reason is required when an initial assignment is recorded with a past effective date (Initial Data Capture).");
      }
    },
    mapError: assignmentTimelineConflict,
    execute: async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404, or 409 when cancelled
      // Lock the aggregate first so a concurrent first assignment cannot pass the eligibility check as well.
      await bumpPersonRevision(tx, period.personId, input.expected_revision);
      // PV-29: a cancelled planned (initial) assignment does not count; the period may receive a new first assignment.
      if ((await tx.jobAssignment.count({ where: operationalAssignmentWhere({ employmentId }) })) > 0) {
        throw rule(
          "ASSIGNMENT_ALREADY_EXISTS",
          "This employment period already has an assignment. Use Assignment Change or a historical assignment correction.",
        );
      }
      const start = fromDbDate(period.startDate);
      const end = fromDbDate(period.endDate);
      if (d < start || (end !== null && d > end)) {
        throw rule("OUTSIDE_EMPLOYMENT_PERIOD", "The effective date must fall within the employment period.", [
          { field: "effective_date", code: "OUTSIDE_EMPLOYMENT_PERIOD", message: "The effective date is outside the employment period." },
        ]);
      }
      // Current/future business data: catalog values must be active (only historical corrections may use inactive ones).
      const values = await resolveAssignmentValues(tx, input, null, period.personId, d);
      const effectiveTo = end !== null ? addDays(end, 1) : null;
      await tx.jobAssignment.create({
        data: {
          id: newAssignmentId,
          employmentId,
          effectiveFrom: toDbDate(d),
          effectiveTo: effectiveTo ? toDbDate(effectiveTo) : null,
          departmentId: values.departmentId,
          jobTitleId: values.jobTitleId,
          jobLevelId: values.jobLevelId,
          managerEmploymentId: values.managerEmploymentId,
          recordSource: "form",
          changeReason: "initial_assignment",
          createdBy: principal.userId,
        },
      });
      const structural: StructuralChange[] = [
        { field: "department_id", oldValue: null, newValue: values.departmentId },
        { field: "job_title_id", oldValue: null, newValue: values.jobTitleId },
        { field: "job_level_id", oldValue: null, newValue: values.jobLevelId },
        { field: "assignment.effective_from", oldValue: null, newValue: d },
        { field: "assignment.effective_to", oldValue: null, newValue: effectiveTo },
      ];
      await recordAudit(
        {
          actorUserId: principal.userId,
          action: backdated ? "assignment.initial_data_capture" : "assignment.initial",
          outcome: "success",
          entityType: "employment",
          entityId: employmentId,
          requestId,
          changedFields: [
            "assignment.department_id",
            "assignment.job_title_id",
            ...(values.jobLevelId ? ["assignment.job_level_id"] : []),
            ...(values.managerEmploymentId ? ["assignment.manager"] : []),
            "assignment.effective_from",
          ],
          reason,
          structuralChanges: structural,
        },
        tx,
      );
      return period.personId;
    },
  });
}
