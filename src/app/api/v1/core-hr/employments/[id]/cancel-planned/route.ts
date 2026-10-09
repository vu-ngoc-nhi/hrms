import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createCancelPlanned } from "@/modules/core-hr/employments/cancel-planned";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = defineHandler(operations.createCancelPlanned, async ({ req, principal, params, body, requestId }) => {
  const key = readIdempotencyKey(req);
  const result = await createCancelPlanned(principal, params.id, body, key, requestId);
  return {
    status: 201,
    body: result.body,
    headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string>,
  };
});
