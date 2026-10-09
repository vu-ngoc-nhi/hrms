import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.getMe, async ({ principal }) => ({
  body: {
    user_id: principal.userId,
    display_name: principal.displayName,
    tenant_id: principal.tenantId,
    object_id: principal.objectId,
    auth_issuer: principal.issuerKind,
    roles: principal.roles,
  },
}));
