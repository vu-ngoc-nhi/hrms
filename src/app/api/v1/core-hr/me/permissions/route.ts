import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.getMyCoreHrPermissions, async ({ principal }) => ({
  body: {
    permissions: [...principal.permissions].sort(),
    field_groups: {
      directory: principal.permissions.has("employees.read"),
      personal: principal.permissions.has("employees.read_personal"),
      sensitive: false, // the sensitive group is not implemented
    },
  },
}));
