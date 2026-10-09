// S4.3 Profile edit (C-23, C-24). Full Name and personal/contact fields only; employment data is never edited here.
import type { EmployeeDetail, EmployeeUpdateInput } from "@/contracts/core-hr/schemas";
import { toDbDate, fromDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { ApiError, forbidden, notFound, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { getEmployee } from "./service";
import { normalizePersonalEmail, validateDateOfBirth, validateFullName, validateMobilePhone } from "./validation";

// Fields whose change requires a reason (C-23). Changes are compared after normalization.
const REASON_REQUIRED = new Set(["full_name", "personal.date_of_birth"]);

export async function updateEmployeeProfile(
  principal: Principal,
  personId: string,
  input: EmployeeUpdateInput,
  requestId: string,
): Promise<EmployeeDetail & { warnings: ErrorDetail[] }> {
  if (input.personal && Object.keys(input.personal).length && !principal.permissions.has("employees.write_personal")) {
    throw forbidden("You do not have permission to write personal information.");
  }
  const current = await db().person.findUnique({ where: { id: personId } });
  if (!current) throw notFound("Employee profile not found.");
  if (current.revision !== input.expected_revision) throw revisionConflict();

  const issues = { errors: [] as ErrorDetail[], warnings: [] as ErrorDetail[] };
  const today = todayInVietnam();
  const data: Record<string, unknown> = {};
  const changed: string[] = [];
  const set = (field: string, column: string, next: unknown, prev: unknown) => {
    if (next !== prev) {
      data[column] = next;
      changed.push(field);
    }
  };

  if (input.full_name !== undefined) {
    set("full_name", "fullName", validateFullName(input.full_name, issues), current.fullName);
  }
  const p = input.personal ?? {};
  if (p.gender !== undefined) set("personal.gender", "gender", p.gender, current.gender);
  if (p.date_of_birth !== undefined) {
    const dob = validateDateOfBirth(p.date_of_birth, today, issues);
    if (dob !== fromDbDate(current.dateOfBirth)) {
      data.dateOfBirth = dob ? toDbDate(dob) : null;
      changed.push("personal.date_of_birth");
    }
  }
  if (p.mobile_phone !== undefined) set("personal.mobile_phone", "mobilePhone", validateMobilePhone(p.mobile_phone, issues), current.mobilePhone);
  if (p.personal_email !== undefined) {
    set("personal.personal_email", "personalEmail", normalizePersonalEmail(p.personal_email), current.personalEmail);
  }
  if (issues.errors.length) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", issues.errors);

  const reason = input.reason?.trim() || null;
  const needsReason = changed.filter((f) => REASON_REQUIRED.has(f));
  if (needsReason.length && !reason) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "A reason is required when changing Full Name or Date of Birth.",
      needsReason.map((f) => ({ field: "reason", code: "REASON_REQUIRED", message: `A reason is required for ${f}.` })),
    );
  }

  if (changed.length) {
    await db().$transaction(async (tx) => {
      // Optimistic concurrency: only the revision the caller read may be updated (also guards concurrent writes).
      const res = await tx.person.updateMany({
        where: { id: personId, revision: input.expected_revision },
        data: { ...data, revision: { increment: 1 }, updatedAt: new Date() },
      });
      if (res.count !== 1) throw revisionConflict();
      // Personal values are never stored in audit: changed field names and the reason only (C-24).
      await recordAudit(
        {
          actorUserId: principal.userId,
          action: "employee.update",
          outcome: "success",
          entityType: "person",
          entityId: personId,
          requestId,
          changedFields: changed,
          reason,
        },
        tx,
      );
    });
  }
  const detail = await getEmployee(principal, personId);
  return { ...detail, warnings: issues.warnings };
}

function revisionConflict() {
  return new ApiError(409, "REVISION_CONFLICT", "The profile was changed by someone else. Reload it and try again.", [
    { field: "expected_revision", code: "STALE_REVISION", message: "The revision is out of date." },
  ]);
}
