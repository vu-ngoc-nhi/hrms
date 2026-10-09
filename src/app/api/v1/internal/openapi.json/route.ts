import { buildOpenApiDocument } from "@/contracts/core-hr/openapi";
import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";

// The internal spec is served only after authentication with docs.read; it is never placed in public/.
export const GET = defineHandler(operations.getInternalOpenApi, async () => ({
  body: buildOpenApiDocument(),
}));
