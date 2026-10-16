import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { listContractHistory } from "@/modules/contracts/service";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.listContractHistory, async ({ params }) => ({
  body: await listContractHistory(params.id),
}));
