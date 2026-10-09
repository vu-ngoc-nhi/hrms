import { db, type Tx } from "@/lib/db";

// Audit records only the NAMES of changed fields, never profile values (keeps personal payload out of long-lived logs).
export type AuditInput = {
  actorUserId: string | null;
  action: string;
  outcome: "success" | "denied";
  entityType: string;
  entityId?: string | null;
  requestId: string;
  changedFields?: string[];
};

export async function recordAudit(input: AuditInput, tx?: Tx) {
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
    },
  });
}
