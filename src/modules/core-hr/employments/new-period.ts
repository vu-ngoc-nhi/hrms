// S4.8: two DISTINCT business actions that create a new Employment Period for an existing Person (C-60, C-61).
//  - Add Initial Employment Period: the Person has zero non-cancelled periods (cancelled ones never make a rehire).
//    Initial Data Capture (PV-19): any start date; a past date on this later action needs a reason.
//  - Rehire: the latest non-cancelled period has a known end date (an `end` event is not required) and the new period
//    starts strictly after it (planned Rehire allowed). Operational business event (C-25); reason always required.
// Both: same Person and Employee Code, only the period's own fields (Employee Type, dates, optional Work Email),
// never copied from earlier periods, no automatic assignment, a `start` event, no End event for a planned end date.
import { randomUUID } from "node:crypto";
import type { EmployeeDetail, InitialEmploymentInput, RehireInput } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { ApiError, notFound, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { validateWorkEmail } from "../people/validation";
import { personIdForEmployment, reasonRequired, rule, runIdempotentCommand } from "./command";
import { assertEffectiveDateAllowed } from "./effective-date-policy";
import { correctionDbError } from "./period-correction";
import { operationalEmploymentWhere } from "./queries";

type PeriodFields = { start_date: string; end_date?: string; employee_type_id?: string; work_email?: string };

/** Validation shared by both actions that does not need the database. */
function checkFields(input: PeriodFields): { workEmail: string | null } {
  const issues = { errors: [] as ErrorDetail[], warnings: [] as ErrorDetail[] };
  const workEmail = input.work_email ? validateWorkEmail(input.work_email, issues, "work_email") : null;
  if (input.end_date !== undefined && input.end_date < input.start_date) {
    issues.errors.push({ field: "end_date", code: "END_BEFORE_START", message: "The end date cannot be before the start date." });
  }
  if (issues.errors.length) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", issues.errors);
  return { workEmail };
}

async function lockPerson(tx: Tx, personId: string, expectedRevision: number) {
  if (!(await tx.person.findUnique({ where: { id: personId } }))) throw notFound("Employee profile not found.");
  await bumpPersonRevision(tx, personId, expectedRevision); // serializes concurrent period creation for this Person
}

/** Inserts the new period and its `start` event, then audits it (no assignment, no End event). */
async function insertPeriod(
  tx: Tx,
  a: { id: string; personId: string; input: PeriodFields; workEmail: string | null; principal: Principal; requestId: string; action: string; reason: string | null },
) {
  const { input } = a;
  if (input.employee_type_id) {
    // A new period is current/future business data: the Employee Type must be active.
    const type = await tx.employeeType.findUnique({ where: { id: input.employee_type_id } });
    if (!type?.isActive) {
      throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", [
        { field: "employee_type_id", code: "NOT_ACTIVE", message: "Employee type does not exist or is inactive." },
      ]);
    }
  }
  await tx.employment.create({
    data: {
      id: a.id,
      personId: a.personId,
      startDate: toDbDate(input.start_date),
      endDate: input.end_date ? toDbDate(input.end_date) : null,
      employeeTypeId: input.employee_type_id ?? null,
      workEmail: a.workEmail,
      recordSource: "form",
      createdBy: a.principal.userId,
    },
  });
  await tx.employmentEvent.create({
    data: { employmentId: a.id, eventType: "start", effectiveDate: toDbDate(input.start_date), recordedBy: a.principal.userId },
  });
  const structural: StructuralChange[] = [{ field: "employment.start_date", oldValue: null, newValue: input.start_date }];
  if (input.end_date) structural.push({ field: "employment.end_date", oldValue: null, newValue: input.end_date });
  if (input.employee_type_id) structural.push({ field: "employee_type_id", oldValue: null, newValue: input.employee_type_id });
  await recordAudit(
    {
      actorUserId: a.principal.userId,
      action: a.action,
      outcome: "success",
      entityType: "employment",
      entityId: a.id,
      requestId: a.requestId,
      changedFields: [
        "employment.start_date",
        ...(input.end_date ? ["employment.end_date"] : []),
        ...(input.employee_type_id ? ["employment.employee_type_id"] : []),
        ...(a.workEmail ? ["employment.work_email"] : []), // field name only, never the address (C-24)
        "employment_event.start",
      ],
      reason: a.reason,
      structuralChanges: structural,
    },
    tx,
  );
}

export async function createInitialEmployment(
  principal: Principal,
  personId: string,
  input: InitialEmploymentInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason?.trim() || null;
  const employmentId = randomUUID();
  let backdated = false;
  let workEmail: string | null = null;
  return runIdempotentCommand({
    principal,
    operation: "createInitialEmployment",
    idempotencyKey,
    payload: { personId, ...input },
    resourceId: employmentId,
    personIdForResource: personIdForEmployment,
    precheck: () => {
      // PV-19 Initial Data Capture: HR_EDITOR may use a past start date; added later to an existing Person it needs a reason.
      backdated = assertEffectiveDateAllowed(principal, "initial_data_capture", input.start_date, todayInVietnam()).backdated;
      if (backdated && !reason) {
        throw reasonRequired("A reason is required when an initial employment period is recorded with a past start date (Initial Data Capture).");
      }
      ({ workEmail } = checkFields(input));
    },
    mapError: correctionDbError,
    execute: async (tx) => {
      await lockPerson(tx, personId, input.expected_revision);
      const real = await tx.employment.count({ where: operationalEmploymentWhere({ personId }) });
      if (real > 0) {
        throw rule(
          "EMPLOYMENT_ALREADY_EXISTS",
          "This person already has an employment period. A return after an ended period is a Rehire; a continuous type change is a Relationship Change.",
        );
      }
      await insertPeriod(tx, {
        id: employmentId,
        personId,
        input,
        workEmail,
        principal,
        requestId,
        action: backdated ? "employment.initial_data_capture" : "employment.initial",
        reason,
      });
      return personId;
    },
  });
}

export async function createRehire(
  principal: Principal,
  personId: string,
  input: RehireInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  const employmentId = randomUUID();
  let workEmail: string | null = null;
  return runIdempotentCommand({
    principal,
    operation: "createRehire",
    idempotencyKey,
    payload: { personId, ...input },
    resourceId: employmentId,
    personIdForResource: personIdForEmployment,
    precheck: () => {
      if (!reason) throw reasonRequired("A reason is required for a Rehire.");
      // C-25: an operational business event — HR_EDITOR today or later; a backdated Rehire requires HR_ADMIN.
      assertEffectiveDateAllowed(principal, "business_event", input.start_date, todayInVietnam());
      ({ workEmail } = checkFields(input));
    },
    mapError: correctionDbError,
    execute: async (tx) => {
      await lockPerson(tx, personId, input.expected_revision);
      const [latest] = await tx.employment.findMany({
        where: operationalEmploymentWhere({ personId }),
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        take: 1,
      });
      if (!latest) {
        throw rule("NO_PREVIOUS_EMPLOYMENT", "This person has no employment period to return from. Use Add Initial Employment Period.");
      }
      const previousEnd = fromDbDate(latest.endDate);
      if (previousEnd === null) {
        throw rule(
          "LATEST_PERIOD_HAS_NO_END",
          "The latest employment period has no end date. Record End Employment first (or use Relationship Change for a continuous transition).",
        );
      }
      // Latest-period rule: a Rehire always starts after the latest period; it never fills a gap between periods.
      const earliest = addDays(previousEnd, 1);
      if (input.start_date < earliest) {
        throw rule("REHIRE_START_NOT_AFTER_PREVIOUS_END", `A Rehire must start after the latest period ends (${previousEnd}).`, [
          { field: "start_date", code: "REHIRE_START_NOT_AFTER_PREVIOUS_END", message: `The earliest possible start date is ${earliest}.` },
        ]);
      }
      await insertPeriod(tx, { id: employmentId, personId, input, workEmail, principal, requestId, action: "employment.rehire", reason });
      return personId;
    },
  });
}
