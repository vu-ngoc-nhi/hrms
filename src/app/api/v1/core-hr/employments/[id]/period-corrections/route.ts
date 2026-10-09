import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createPeriodCorrection } from "@/modules/core-hr/employments/period-correction";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = defineHandler(operations.createPeriodCorrection, async ({ req, principal, params, body, requestId }) => {
  const key = readIdempotencyKey(req);
  const result = await createPeriodCorrection(principal, params.id, body, key, requestId);
  return {
    status: 200,
    body: result.body,
    headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string>,
  };
});
