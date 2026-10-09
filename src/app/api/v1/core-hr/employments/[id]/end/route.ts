import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createEndEmployment } from "@/modules/core-hr/employments/end-employment";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = defineHandler(operations.createEndEmployment, async ({ req, principal, params, body, requestId }) => {
  const key = readIdempotencyKey(req);
  const result = await createEndEmployment(principal, params.id, body, key, requestId);
  return {
    status: 201,
    body: result.body,
    headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string>,
  };
});
