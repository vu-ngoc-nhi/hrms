// S4.5 Assignment Change: a genuine organizational business event (department, job title, level, manager).
// It closes the assignment applicable on the effective date and opens a NEW effective-dated assignment row.
// Historical assignment correction is S4.6 (HR_ADMIN) and is not handled here.
//
// Timeline semantics: assignments are [effective_from, effective_to). The change is blocked (never auto-fixed) when an
// assignment already starts on or after the effective date, because changing it would rewrite planned/recorded history.
import { randomUUID } from "node:crypto";
import type { AssignmentChangeInput, EmployeeDetail } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db, pgErrorInfo, type Tx } from "@/lib/db";
import { ApiError, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { claimIdempotencyKey, requestFingerprint } from "@/modules/idempotency/idempotency";
import { bumpPersonRevision } from "../people/revision";
import { checkActive, getEmployee } from "../people/service";
import { assertEffectiveDateAllowed } from "./effective-date-policy";
import { currentEmploymentWhere, loadWritableEmployment } from "./queries";

const OPERATION = "createAssignmentChange";

const rule = (code: string, message: string, details?: ErrorDetail[]) =>
  new ApiError(422, "BUSINESS_RULE_VIOLATION", message, details ?? [{ code, message }]);

export async function createAssignmentChange(
  principal: Principal,
  employmentId: string,
  input: AssignmentChangeInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const requestHmac = requestFingerprint(OPERATION, { employmentId, ...input });
  const prior = await db().idempotencyRecord.findUnique({
    where: { actorUserId_operation_idempotencyKey: { actorUserId: principal.userId, operation: OPERATION, idempotencyKey } },
  });
  if (prior) return replay(principal, prior.requestHmac, requestHmac, prior.resourceId);

  const reason = input.reason.trim();
  if (!reason) throw rule("REASON_REQUIRED", "A reason is required for an Assignment Change.");
  const today = todayInVietnam();
  // C-25: HR_EDITOR today or later; a past effective date requires employment.correct (HR_ADMIN).
  assertEffectiveDateAllowed(principal, "business_event", input.effective_date, today);

  const newAssignmentId = randomUUID();
  let personId: string;
  try {
    personId = await db().$transaction(async (tx) => {
      // Claim the key first: a concurrent request with the same key waits here and then replays the stored result.
      const claim = await claimIdempotencyKey(tx, {
        actorUserId: principal.userId,
        operation: OPERATION,
        key: idempotencyKey,
        requestHmac,
        resourceId: newAssignmentId,
      });
      if (!claim.claimed) throw new ReplayDetected(claim.requestHmac, claim.resourceId);
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

      const assignments = await tx.jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } });
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
      const previous =
        assignments.find((a) => fromDbDate(a.effectiveFrom) < d && (a.effectiveTo === null || fromDbDate(a.effectiveTo) > d)) ?? null;

      const next = await resolveValues(tx, input, previous, period.personId, d);
      const changedFields: string[] = [];
      const structural: StructuralChange[] = [];
      const track = (name: string, field: StructuralChange["field"] | null, before: string | null, after: string | null) => {
        if (before === after) return;
        changedFields.push(name);
        if (field) structural.push({ field, oldValue: before, newValue: after });
      };
      track("assignment.department_id", "department_id", previous?.departmentId ?? null, next.departmentId);
      track("assignment.job_title_id", "job_title_id", previous?.jobTitleId ?? null, next.jobTitleId);
      track("assignment.job_level_id", "job_level_id", previous?.jobLevelId ?? null, next.jobLevelId);
      // Manager: field name only, never old/new ids (C-24).
      track("assignment.manager", null, previous?.managerEmploymentId ?? null, next.managerEmploymentId);
      if (changedFields.length === 0) {
        throw rule("NO_CHANGE", "The requested assignment is the same as the assignment already in effect on that date.");
      }

      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      // New row inherits the previous row's closing date (e.g. the period end), or the period end if there is none.
      const newEffectiveTo = previous ? previous.effectiveTo : end !== null ? toDbDate(addDays(end, 1)) : null;
      if (previous) {
        await tx.jobAssignment.update({ where: { id: previous.id }, data: { effectiveTo: toDbDate(d) } });
        structural.push({ field: "assignment.effective_to", oldValue: fromDbDate(previous.effectiveTo), newValue: d });
      }
      await tx.jobAssignment.create({
        data: {
          id: newAssignmentId,
          employmentId,
          effectiveFrom: toDbDate(d),
          effectiveTo: newEffectiveTo,
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
    });
  } catch (error) {
    if (error instanceof ReplayDetected) return replay(principal, error.storedHmac, requestHmac, error.resourceId);
    const info = pgErrorInfo(error);
    if (info.sqlState === "23P01" || info.constraint === "job_assignment_within_employment") {
      throw rule("ASSIGNMENT_TIMELINE_CONFLICT", "The change would make assignments overlap or fall outside the employment period.");
    }
    throw error;
  }
  return { replayed: false, body: await getEmployee(principal, personId) };
}

type Values = { departmentId: string; jobTitleId: string; jobLevelId: string | null; managerEmploymentId: string | null };

async function resolveValues(
  tx: Tx,
  input: AssignmentChangeInput,
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

class ReplayDetected extends Error {
  constructor(
    public readonly storedHmac: string,
    public readonly resourceId: string,
  ) {
    super("idempotent replay");
  }
}

async function replay(principal: Principal, storedHmac: string, requestHmac: string, assignmentId: string) {
  if (storedHmac !== requestHmac) {
    throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different payload.");
  }
  const assignment = await db().jobAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { employment: true } });
  return { replayed: true, body: await getEmployee(principal, assignment.employment.personId) };
}
