import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { finalizeContract } from "@/modules/contracts/service";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = defineHandler(operations.createContractFinalize, async ({ req, principal, params, body, requestId }) => {
  const result = await finalizeContract(principal, params.id, body, readIdempotencyKey(req), requestId);
  return { status: 201, body: result.body, headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string> };
});
