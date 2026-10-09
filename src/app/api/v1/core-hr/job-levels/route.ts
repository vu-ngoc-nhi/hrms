import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createCatalogItem, listCatalog } from "@/modules/core-hr/catalogs/service";

export const dynamic = "force-dynamic";


export const GET = defineHandler(operations.listJobLevels, async ({ query }) => ({
  body: await listCatalog("job_level", query),
}));

export const POST = defineHandler(operations.createJobLevel, async ({ principal, body, requestId }) => ({
  body: await createCatalogItem("job_level", principal, body, requestId),
}));
