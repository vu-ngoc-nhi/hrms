import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createCatalogItem, listCatalog } from "@/modules/core-hr/catalogs/service";

export const dynamic = "force-dynamic";


export const GET = defineHandler(operations.listJobTitles, async ({ query }) => ({
  body: await listCatalog("job_title", query),
}));

export const POST = defineHandler(operations.createJobTitle, async ({ principal, body, requestId }) => ({
  body: await createCatalogItem("job_title", principal, body, requestId),
}));
