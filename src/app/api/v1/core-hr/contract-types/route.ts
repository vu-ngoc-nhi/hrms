import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createCatalogItem, listCatalog } from "@/modules/core-hr/catalogs/service";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.listContractTypes, async ({ query }) => ({
  body: await listCatalog("contract_type", query),
}));

export const POST = defineHandler(operations.createContractType, async ({ principal, body, requestId }) => ({
  body: await createCatalogItem("contract_type", principal, body, requestId),
}));
