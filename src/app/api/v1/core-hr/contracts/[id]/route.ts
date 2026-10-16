import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { getContract, updateContractDraft } from "@/modules/contracts/service";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.getContract, async ({ principal, params }) => ({
  body: await getContract(principal, params.id),
}));

export const PATCH = defineHandler(operations.updateContractDraft, async ({ principal, params, body, requestId }) => ({
  body: await updateContractDraft(principal, params.id, body, requestId),
}));
