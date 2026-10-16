import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createContract } from "@/modules/contracts/service";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = defineHandler(operations.createContract, async ({ req, principal, body, requestId }) => {
  const result = await createContract(principal, body, readIdempotencyKey(req), requestId);
  return { status: 201, body: result.body, headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string> };
});
