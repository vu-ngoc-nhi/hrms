import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createCatalogItem, listCatalog } from "@/modules/core-hr/catalogs/service";

export const dynamic = "force-dynamic";


export const GET = defineHandler(operations.listEmployeeTypes, async ({ query }) => ({
  body: await listCatalog("employee_type", query),
}));

export const POST = defineHandler(operations.createEmployeeType, async ({ principal, body, requestId }) => ({
  body: await createCatalogItem("employee_type", principal, body, requestId),
}));
