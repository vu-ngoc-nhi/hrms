import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { updateCatalogItem } from "@/modules/core-hr/catalogs/service";

export const dynamic = "force-dynamic";

export const PATCH = defineHandler(operations.updateDepartment, async ({ principal, params, body, requestId }) => ({
  body: await updateCatalogItem("department", principal, params.id, body, requestId),
}));
