// S4.6 Employment Period correction (C-40, C-43, C-44, C-45): fixes a wrongly entered Employee Type, start date or
// end date on the SAME period. HR_ADMIN only (route permission employment.correct), mandatory reason.
//  - end_date only changes from one date to another: null → USE_REVERSE_END_EMPLOYMENT (S4.7R), a date on an open
//    period → USE_END_EMPLOYMENT (S4.7);
//  - assignments move only when they were aligned with the old boundary (first row starting on the old start date,
//    last row ending with the old end date); nothing is invented or silently repaired otherwise — the correction is
//    blocked when an assignment would fall outside the corrected period;
//  - an existing `start` / `end` lifecycle event date is synced; no event is ever created (C-37, C-43);
//  - audit: employment.correct on the period plus assignment.correct on every moved row (same request id, reason).
import type { EmployeeDetail, PeriodCorrectionInput } from "@/contracts/core-hr/schemas";
import { addDays, fromDbDate, toDbDate } from "@/lib/dates";
import { pgErrorInfo, type Tx } from "@/lib/db";
import { ApiError, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { bumpPersonRevision } from "../people/revision";
import { assignmentTimelineConflict } from "./assignment-change";
import { personIdForEmployment, reasonRequired, rule, runIdempotentCommand } from "./command";
import { findActiveEndEvent } from "./lifecycle-events";
import { loadWritableEmployment } from "./queries";

const OPERATION = "createPeriodCorrection";

export function correctionDbError(error: unknown): ApiError | undefined {
  const info = pgErrorInfo(error);
  if (info.sqlState === "23P01" && info.constraint === "employment_no_overlap_ex") {
    return new ApiError(409, "PERIOD_OVERLAP", "The corrected dates would overlap another employment period of this person.");
  }
  if (info.sqlState === "23P01" && info.constraint === "employment_work_email_period_ex") {
    return new ApiError(409, "WORK_EMAIL_IN_USE", "With the corrected dates, this period's work email would overlap another period that uses it.", [
      { field: "work_email", code: "IN_USE", message: "Work email already in use." },
    ]);
  }
  return assignmentTimelineConflict(error);
}

type Row = { id: string; effectiveFrom: Date; effectiveTo: Date | null };
type Move = { row: Row; from: string; to: string | null };
const outside = (rows: Row[], message: string) =>
  rule(
    "ASSIGNMENT_OUTSIDE_PERIOD",
    message,
    rows.map((a) => ({
      code: "ASSIGNMENT_OUTSIDE_PERIOD",
      message: `Assignment ${a.id} (${fromDbDate(a.effectiveFrom)} – ${fromDbDate(a.effectiveTo) ?? "open"}) would fall outside the corrected period.`,
    })),
  );

export async function createPeriodCorrection(
  principal: Principal,
  employmentId: string,
  input: PeriodCorrectionInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const reason = input.reason.trim();
  return runIdempotentCommand({
    principal,
    operation: OPERATION,
    idempotencyKey,
    payload: { employmentId, ...input },
    resourceId: employmentId,
    personIdForResource: personIdForEmployment,
    precheck: () => {
      if (!reason) throw reasonRequired("A correction reason is required.");
      if (input.end_date === null) {
        throw rule(
          "USE_REVERSE_END_EMPLOYMENT",
          "An end date cannot be cleared by a correction. Use Reverse End Employment for an End Employment entered by mistake.",
        );
      }
    },
    mapError: correctionDbError,
    execute: async (tx) => {
      const period = await loadWritableEmployment(tx, employmentId); // 404, or 409 when cancelled
      await bumpPersonRevision(tx, period.personId, input.expected_revision);

      const oldStart = fromDbDate(period.startDate);
      const oldEnd = fromDbDate(period.endDate);
      if (input.end_date !== undefined && oldEnd === null) {
        throw rule("USE_END_EMPLOYMENT", "This period has no end date. Ending a period is End Employment, not a correction.");
      }
      const newStart = input.start_date ?? oldStart;
      const newEnd = input.end_date ?? oldEnd;
      const newType = input.employee_type_id ?? period.employeeTypeId;
      const startChanged = newStart !== oldStart;
      const endChanged = newEnd !== oldEnd;
      const typeChanged = newType !== period.employeeTypeId;
      if (!startChanged && !endChanged && !typeChanged) {
        throw rule("NO_CHANGE", "The corrected values are the same as the recorded values.");
      }
      if (newEnd !== null && newEnd < newStart) {
        throw rule("END_BEFORE_START", "The end date cannot be before the start date.", [
          { field: "end_date", code: "END_BEFORE_START", message: "The end date cannot be before the start date." },
        ]);
      }
      if (typeChanged) {
        // C-44: an existing inactive Employee Type may be referenced by a historical correction.
        const type = await tx.employeeType.findUnique({ where: { id: newType! } });
        if (!type) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", [unknownRef("employee_type_id", "Employee Type")]);
      }

      const rows = await tx.jobAssignment.findMany({ where: { employmentId }, orderBy: { effectiveFrom: "asc" } });
      // Per-row patch: a row moves only when it was aligned with the old period boundary.
      const patches = new Map<string, Move>();
      const patch = (row: Row) => {
        const existing = patches.get(row.id);
        if (existing) return existing;
        const m: Move = { row, from: fromDbDate(row.effectiveFrom), to: fromDbDate(row.effectiveTo) };
        patches.set(row.id, m);
        return m;
      };
      if (startChanged && rows.length) {
        const first = rows[0];
        if (fromDbDate(first.effectiveFrom) === oldStart) patch(first).from = newStart;
        else {
          const before = rows.filter((a) => fromDbDate(a.effectiveFrom) < newStart);
          if (before.length) throw outside(before, "Assignments start before the corrected start date. Correct the assignments first.");
        }
      }
      if (endChanged && rows.length) {
        const after = rows.filter((a) => fromDbDate(a.effectiveFrom) > newEnd!);
        if (after.length) {
          throw outside(after, "Assignments start after the corrected end date. Correct the assignments first (they are never changed automatically).");
        }
        const last = rows[rows.length - 1];
        const lastTo = fromDbDate(last.effectiveTo);
        if (lastTo === addDays(oldEnd!, 1)) patch(last).to = addDays(newEnd!, 1);
        else if (lastTo === null || lastTo > addDays(newEnd!, 1)) {
          throw outside([last], "The last assignment would end after the corrected end date. Correct the assignments first.");
        }
      }
      const moves = [...patches.values()];
      for (const m of moves) {
        // Positive duration where bounded (C-42).
        if (m.to !== null && m.from >= m.to) throw outside([m.row], "An assignment would become empty. Correct the assignments first.");
      }

      // Moving the first row's start or the last row's end can never overlap another row; each row is updated in one
      // statement (the from < to CHECK is immediate). The period/assignment containment trigger is deferred to commit.
      for (const m of moves) {
        await tx.jobAssignment.update({
          where: { id: m.row.id },
          data: { effectiveFrom: toDbDate(m.from), effectiveTo: m.to ? toDbDate(m.to) : null },
        });
      }
      await tx.employment.update({
        where: { id: employmentId },
        data: {
          ...(startChanged ? { startDate: toDbDate(newStart) } : {}),
          ...(endChanged ? { endDate: toDbDate(newEnd!) } : {}),
          ...(typeChanged ? { employeeTypeId: newType } : {}),
        },
      });

      // C-43: sync the date of an EXISTING lifecycle event only; never create one.
      let syncedEvents = 0;
      if (startChanged) {
        syncedEvents += (
          await tx.employmentEvent.updateMany({ where: { employmentId, eventType: "start" }, data: { effectiveDate: toDbDate(newStart) } })
        ).count;
      }
      if (endChanged) {
        // The Active End Event (C-51), never an end event matched by date. Legacy end dates may have no event.
        const activeEnd = await findActiveEndEvent(tx, employmentId);
        if (activeEnd) {
          syncedEvents += (await tx.employmentEvent.updateMany({ where: { id: activeEnd.id }, data: { effectiveDate: toDbDate(newEnd!) } })).count;
        }
      }

      await auditPeriodCorrection(tx, {
        principal,
        requestId,
        reason,
        employmentId,
        type: typeChanged ? [period.employeeTypeId, newType] : null,
        start: startChanged ? [oldStart, newStart] : null,
        end: endChanged ? [oldEnd, newEnd] : null,
        syncedEvents,
        moves,
      });
      return period.personId;
    },
  });
}

const unknownRef = (field: string, label: string): ErrorDetail => ({ field, code: "UNKNOWN_REFERENCE", message: `${label} does not exist.` });

async function auditPeriodCorrection(
  tx: Tx,
  a: {
    principal: Principal;
    requestId: string;
    reason: string;
    employmentId: string;
    type: [string | null, string | null] | null;
    start: [string, string] | null;
    end: [string | null, string | null] | null;
    syncedEvents: number;
    moves: Move[];
  },
) {
  const changedFields: string[] = [];
  const structural: StructuralChange[] = [];
  if (a.type) {
    changedFields.push("employment.employee_type_id");
    structural.push({ field: "employee_type_id", oldValue: a.type[0], newValue: a.type[1] });
  }
  if (a.start) {
    changedFields.push("employment.start_date");
    structural.push({ field: "employment.start_date", oldValue: a.start[0], newValue: a.start[1] });
  }
  if (a.end) {
    changedFields.push("employment.end_date");
    structural.push({ field: "employment.end_date", oldValue: a.end[0], newValue: a.end[1] });
  }
  if (a.syncedEvents) changedFields.push("employment_event.effective_date");
  const base = { actorUserId: a.principal.userId, outcome: "success" as const, requestId: a.requestId, reason: a.reason };
  await recordAudit({ ...base, action: "employment.correct", entityType: "employment", entityId: a.employmentId, changedFields, structuralChanges: structural }, tx);
  // Every assignment row moved with the period boundary gets its own audit record (same request id and reason).
  for (const m of a.moves) {
    const changes: StructuralChange[] = [
      { field: "assignment.effective_from", oldValue: fromDbDate(m.row.effectiveFrom), newValue: m.from },
      { field: "assignment.effective_to", oldValue: fromDbDate(m.row.effectiveTo), newValue: m.to },
    ].filter((c) => c.oldValue !== c.newValue) as StructuralChange[];
    await recordAudit(
      {
        ...base,
        action: "assignment.correct",
        entityType: "job_assignment",
        entityId: m.row.id,
        changedFields: changes.map((c) => c.field),
        structuralChanges: changes,
      },
      tx,
    );
  }
}
