import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createAssignmentCorrection } from "@/modules/core-hr/employments/assignment-correction";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = defineHandler(operations.createAssignmentCorrection, async ({ req, principal, params, body, requestId }) => {
  const key = readIdempotencyKey(req);
  const result = await createAssignmentCorrection(principal, params.id, body, key, requestId);
  return {
    status: 200,
    body: result.body,
    headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string>,
  };
});
