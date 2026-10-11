// S4.5 Assignment Change: a genuine organizational business event (department, job title, level, manager).
// It closes the assignment applicable on the effective date and opens a NEW effective-dated assignment row.
// Historical assignment correction is S4.6 (HR_ADMIN) and is not handled here.
//
// Timeline semantics: assignments are [effective_from, effective_to). The change is blocked (never auto-fixed) when an
// assignment already starts on or after the effective date, because changing it would rewrite planned/recorded history.
import { randomUUID } from "node:crypto";
import type { AssignmentChangeInput, EmployeeDetail } from "@/contracts/core-hr/schemas";
import { fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { pgErrorInfo, type Tx } from "@/lib/db";
import { ApiError, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { checkActive } from "../people/service";
import { personIdForAssignment, rule, runIdempotentCommand } from "./command";
import { assertEffectiveDateAllowed } from "./effective-date-policy";
import { currentEmploymentWhere, loadWritableEmployment, operationalAssignmentWhere } from "./queries";

const OPERATION = "createAssignmentChange";

export const assignmentTimelineConflict = (error: unknown) => {
  const info = pgErrorInfo(error);
  // PV-25 safety net: the manager period was voided concurrently (manager resolution itself ignores voided periods).
  if (info.constraint === "job_assignment_manager_not_voided") {
    return rule("MANAGER_PERIOD_VOIDED", "The selected manager's employment period was voided. Choose the manager again.", [
      { field: "manager_person_id", code: "MANAGER_PERIOD_VOIDED", message: "The manager's employment period was voided." },
    ]);
  }
  if (info.sqlState === "23P01" || info.constraint === "job_assignment_within_employment") {
    return rule("ASSIGNMENT_TIMELINE_CONFLICT", "The change would make assignments overlap or fall outside the employment period.");
  }
  return undefined;
};

export async function createAssignmentChange(
  principal: Principal,
  employmentId: string,
  input: AssignmentChangeInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  const today = todayInVietnam();
  const newAssignmentId = randomUUID();
  return runIdempotentCommand({
    principal,
    operation: OPERATION,
    idempotencyKey,
    payload: { employmentId, ...input },
    resourceId: newAssignmentId,
    personIdForResource: personIdForAssignment,
    precheck: () => {
      if (!reason) throw rule("REASON_REQUIRED", "A reason is required for an Assignment Change.");
      // C-25: HR_EDITOR today or later; a past effective date requires employment.correct (HR_ADMIN).
      assertEffectiveDateAllowed(principal, "business_event", input.effective_date, today);
    },
    mapError: assignmentTimelineConflict,
    execute: async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404, or 409 when cancelled
      const start = fromDbDate(period.startDate);
      const end = fromDbDate(period.endDate);
      if (end !== null && end < today) {
        throw rule(
          "PERIOD_ENDED",
          "This employment period has ended. Assignments of an ended period can only be changed through a historical correction.",
        );
      }
      const d = input.effective_date;
      if (d < start || (end !== null && d > end)) {
        throw rule("OUTSIDE_EMPLOYMENT_PERIOD", "The effective date must fall within the employment period.", [
          { field: "effective_date", code: "OUTSIDE_EMPLOYMENT_PERIOD", message: "The effective date is outside the employment period." },
        ]);
      }

      // Operational rows only (PV-29): a cancelled planned assignment is neither a predecessor nor a later row.
      const assignments = await tx.jobAssignment.findMany({ where: operationalAssignmentWhere({ employmentId }), orderBy: { effectiveFrom: "asc" } });
      // C-41: the first assignment of a period is recorded with Add Initial Assignment, never with Assignment Change.
      if (assignments.length === 0) {
        throw rule("NO_ASSIGNMENT_YET", "This employment period has no assignment yet. Use Add Initial Assignment.");
      }
      const laterOrSameDay = assignments.filter((a) => fromDbDate(a.effectiveFrom) >= d);
      if (laterOrSameDay.length) {
        throw rule(
          "FUTURE_ASSIGNMENT_EXISTS",
          "An assignment already starts on or after this effective date. Correct it through the historical correction workflow first.",
          laterOrSameDay.map((a) => ({
            field: "effective_date",
            code: "FUTURE_ASSIGNMENT_EXISTS",
            message: `Assignment ${a.id} starts on ${fromDbDate(a.effectiveFrom)}.`,
          })),
        );
      }
      const previous = assignments.find((a) => fromDbDate(a.effectiveFrom) < d && (a.effectiveTo === null || fromDbDate(a.effectiveTo) > d));
      // C-42: never open a row after a gap; a date not covered by any assignment is a timeline problem to correct first.
      if (!previous) {
        throw rule(
          "NO_ASSIGNMENT_IN_EFFECT",
          "No assignment is in effect on this date. Correct the assignment timeline through the historical correction workflow first.",
        );
      }

      const next = await resolveAssignmentValues(tx, input, previous, period.personId, d);
      const changedFields: string[] = [];
      const structural: StructuralChange[] = [];
      const track = (name: string, field: StructuralChange["field"] | null, before: string | null, after: string | null) => {
        if (before === after) return;
        changedFields.push(name);
        if (field) structural.push({ field, oldValue: before, newValue: after });
      };
      track("assignment.department_id", "department_id", previous.departmentId, next.departmentId);
      track("assignment.job_title_id", "job_title_id", previous.jobTitleId, next.jobTitleId);
      track("assignment.job_level_id", "job_level_id", previous.jobLevelId, next.jobLevelId);
      // Manager: field name only, never old/new ids (C-24).
      track("assignment.manager", null, previous.managerEmploymentId, next.managerEmploymentId);
      if (changedFields.length === 0) {
        throw rule("NO_CHANGE", "The requested assignment is the same as the assignment already in effect on that date.");
      }

      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      // The new row inherits the previous row's closing date (e.g. the period end).
      await tx.jobAssignment.update({ where: { id: previous.id }, data: { effectiveTo: toDbDate(d) } });
      structural.push({ field: "assignment.effective_to", oldValue: fromDbDate(previous.effectiveTo), newValue: d });
      await tx.jobAssignment.create({
        data: {
          id: newAssignmentId,
          employmentId,
          effectiveFrom: toDbDate(d),
          effectiveTo: previous.effectiveTo,
          departmentId: next.departmentId,
          jobTitleId: next.jobTitleId,
          jobLevelId: next.jobLevelId,
          managerEmploymentId: next.managerEmploymentId,
          recordSource: "form",
          changeReason: "assignment_change",
          createdBy: principal.userId,
        },
      });
      structural.push({ field: "assignment.effective_from", oldValue: null, newValue: d });
      await recordAudit(
        {
          actorUserId: principal.userId,
          action: "assignment.change",
          outcome: "success",
          entityType: "employment",
          entityId: employmentId,
          requestId,
          changedFields,
          reason,
          structuralChanges: structural,
        },
        tx,
      );
      return period.personId;
    },
  });
}

type Values = { departmentId: string; jobTitleId: string; jobLevelId: string | null; managerEmploymentId: string | null };

export async function resolveAssignmentValues(
  tx: Tx,
  input: Pick<AssignmentChangeInput, "department_id" | "job_title_id" | "job_level_id" | "manager_person_id">,
  previous: { departmentId: string; jobTitleId: string; jobLevelId: string | null; managerEmploymentId: string | null } | null,
  personId: string,
  onDate: string,
): Promise<Values> {
  const errors: ErrorDetail[] = [];
  const departmentId = input.department_id ?? previous?.departmentId;
  const jobTitleId = input.job_title_id ?? previous?.jobTitleId;
  if (!departmentId) errors.push({ field: "department_id", code: "REQUIRED", message: "Department is required (no assignment is in effect on that date)." });
  if (!jobTitleId) errors.push({ field: "job_title_id", code: "REQUIRED", message: "Job title is required (no assignment is in effect on that date)." });
  const jobLevelId = input.job_level_id === undefined ? (previous?.jobLevelId ?? null) : input.job_level_id;

  // Only newly referenced catalog values must be active; an unchanged inherited value stays as it is.
  await Promise.all([
    input.department_id ? checkActive(errors, "department_id", "Department", tx.department.findUnique({ where: { id: input.department_id } })) : null,
    input.job_title_id ? checkActive(errors, "job_title_id", "Job title", tx.jobTitle.findUnique({ where: { id: input.job_title_id } })) : null,
    input.job_level_id ? checkActive(errors, "job_level_id", "Job level", tx.jobLevel.findUnique({ where: { id: input.job_level_id } })) : null,
  ]);

  let managerEmploymentId = previous?.managerEmploymentId ?? null;
  if (input.manager_person_id === null) managerEmploymentId = null;
  else if (input.manager_person_id !== undefined) {
    if (input.manager_person_id === personId) {
      errors.push({ field: "manager_person_id", code: "SELF_MANAGER", message: "A person cannot be their own manager." });
    } else {
      const mgr = await tx.employment.findFirst({ where: currentEmploymentWhere(toDbDate(onDate), { personId: input.manager_person_id }) });
      if (!mgr) {
        errors.push({ field: "manager_person_id", code: "MANAGER_NOT_EMPLOYED_ON_DATE", message: "The manager has no employment period on the effective date." });
      } else managerEmploymentId = mgr.id;
    }
  }
  if (errors.length) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", errors);
  return { departmentId: departmentId!, jobTitleId: jobTitleId!, jobLevelId, managerEmploymentId };
}
