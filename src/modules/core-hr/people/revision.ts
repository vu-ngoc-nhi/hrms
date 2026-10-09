// Optimistic concurrency for a person and all of its child data (ADR-0004 §6). Every S4 write calls this inside its
// transaction: it increments person.revision only if it still equals the revision the caller read, which also
// serializes concurrent writes on the same person (row lock) and makes the losing write roll back.
import type { Tx } from "@/lib/db";
import { ApiError } from "@/lib/http/errors";

export function revisionConflict() {
  return new ApiError(409, "REVISION_CONFLICT", "The profile was changed by someone else. Reload it and try again.", [
    { field: "expected_revision", code: "STALE_REVISION", message: "The revision is out of date." },
  ]);
}

export async function bumpPersonRevision(tx: Tx, personId: string, expectedRevision: number, data: Record<string, unknown> = {}) {
  const res = await tx.person.updateMany({
    where: { id: personId, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 }, updatedAt: new Date() },
  });
  if (res.count !== 1) throw revisionConflict();
}
