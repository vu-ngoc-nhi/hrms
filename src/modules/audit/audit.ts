import { db, type Tx } from "@/lib/db";

// Audit records the NAMES of changed fields, never personal profile values (keeps personal payload out of long-lived
// records). S4.1 adds:
//   - `reason`, mandatory only where the business action requires one (C-23);
//   - old/new values for the approved non-sensitive STRUCTURAL fields only (C-24). The database enforces the same
//     allow-list with a CHECK constraint, so personal values cannot be stored even by mistake.
// Pass the business transaction (`tx`) so the audit rows commit or roll back together with the change they describe.
export const STRUCTURAL_AUDIT_FIELDS = [
  "employee_type_id",
  "department_id",
  "job_title_id",
  "job_level_id",
  "employment.start_date",
  "employment.end_date",
  "assignment.effective_from",
  "assignment.effective_to",
] as const;
export type StructuralAuditField = (typeof STRUCTURAL_AUDIT_FIELDS)[number];

export type StructuralChange = { field: StructuralAuditField; oldValue: string | null; newValue: string | null };

export type AuditInput = {
  actorUserId: string | null;
  action: string;
  outcome: "success" | "denied";
  entityType: string;
  entityId?: string | null;
  requestId: string;
  changedFields?: string[];
  reason?: string | null;
  structuralChanges?: StructuralChange[];
};

export class AuditMisuse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditMisuse";
  }
}

export async function recordAudit(input: AuditInput, tx?: Tx) {
  const changes = (input.structuralChanges ?? []).filter((c) => c.oldValue !== c.newValue);
  for (const c of changes) {
    // Programmer error, never user input: refuse rather than silently storing an unapproved value.
    if (!(STRUCTURAL_AUDIT_FIELDS as readonly string[]).includes(c.field)) {
      throw new AuditMisuse(`Field "${c.field}" is not approved for old/new value audit.`);
    }
  }
  const reason = input.reason?.trim() || null;
  const client = tx ?? db();
  await client.auditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      outcome: input.outcome,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      requestId: input.requestId,
      changedFields: input.changedFields ?? [],
      reason,
      ...(changes.length
        ? { fieldChanges: { create: changes.map((c) => ({ field: c.field, oldValue: c.oldValue, newValue: c.newValue })) } }
        : {}),
    },
  });
}
