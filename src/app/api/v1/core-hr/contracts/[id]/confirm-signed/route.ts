import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { confirmContractSigned } from "@/modules/contracts/service";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const POST = defineHandler(operations.createContractSignatureConfirmation, async ({ req, principal, params, body, requestId }) => {
  const result = await confirmContractSigned(principal, params.id, body, readIdempotencyKey(req), requestId);
  return { status: 201, body: result.body, headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string> };
});
