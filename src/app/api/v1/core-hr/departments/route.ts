import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createCatalogItem, listCatalog } from "@/modules/core-hr/catalogs/service";

export const dynamic = "force-dynamic";


export const GET = defineHandler(operations.listDepartments, async ({ query }) => ({
  body: await listCatalog("department", query),
}));

export const POST = defineHandler(operations.createDepartment, async ({ principal, body, requestId }) => ({
  body: await createCatalogItem("department", principal, body, requestId),
}));
