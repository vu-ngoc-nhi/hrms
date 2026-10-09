// S4.4 Work Email management (C-30). Work Email belongs to an Employment Period:
//  - pre-start or active (not ended) period: normal update, employment.manage, no reason;
//  - ended period: historical correction, employment.correct (HR_ADMIN) and a mandatory reason;
//  - cancelled period: read-only (shared write guard).
// Audit records the field name and reason only; email values are never stored (C-24).
import type { EmployeeDetail, WorkEmailUpdateInput } from "@/contracts/core-hr/schemas";
import { fromDbDate, todayInVietnam } from "@/lib/dates";
import { db, pgErrorInfo } from "@/lib/db";
import { ApiError, forbidden, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision, revisionConflict } from "../people/revision";
import { getEmployee } from "../people/service";
import { validateWorkEmail } from "../people/validation";
import { loadWritableEmployment } from "./queries";

export async function updateWorkEmail(
  principal: Principal,
  employmentId: string,
  input: WorkEmailUpdateInput,
  requestId: string,
): Promise<EmployeeDetail> {
  const issues = { errors: [] as ErrorDetail[], warnings: [] as ErrorDetail[] };
  const email = validateWorkEmail(input.work_email, issues, "work_email");
  if (issues.errors.length) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", issues.errors);
  const reason = input.reason?.trim() || null;
  const today = todayInVietnam();

  let personId: string;
  try {
    personId = await db().$transaction(async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404 / 409 when cancelled
      const ended = period.endDate !== null && fromDbDate(period.endDate) < today;
      if (ended) {
        if (!principal.permissions.has("employment.correct")) {
          throw forbidden("Changing the Work Email of an ended employment period is a historical correction for HR administrators.");
        }
        if (!reason) {
          throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "A correction reason is required for an ended employment period.", [
            { field: "reason", code: "REASON_REQUIRED", message: "A reason is required for this correction." },
          ]);
        }
      }
      if (period.workEmail === email) {
        // No effective change: no audit, no revision bump (but a stale client still learns it is stale).
        const person = await tx.person.findUniqueOrThrow({ where: { id: period.personId } });
        if (person.revision !== input.expected_revision) throw revisionConflict();
        return period.personId;
      }
      await bumpPersonRevision(tx, period.personId, input.expected_revision);
      await tx.employment.update({ where: { id: period.id }, data: { workEmail: email } });
      await recordAudit(
        {
          actorUserId: principal.userId,
          action: ended ? "employment.work_email.correct" : "employment.work_email.update",
          outcome: "success",
          entityType: "employment",
          entityId: period.id,
          requestId,
          changedFields: ["employment.work_email"],
          reason,
        },
        tx,
      );
      return period.personId;
    });
  } catch (error) {
    const info = pgErrorInfo(error);
    if (info.sqlState === "23P01" && info.constraint === "employment_work_email_period_ex") {
      throw new ApiError(409, "WORK_EMAIL_IN_USE", "This work email is assigned to someone else for an overlapping period.", [
        { field: "work_email", code: "IN_USE", message: "Work email already in use." },
      ]);
    }
    throw error;
  }
  return getEmployee(principal, personId);
}
