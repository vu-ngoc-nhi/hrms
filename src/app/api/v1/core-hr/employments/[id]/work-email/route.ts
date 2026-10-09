import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { updateWorkEmail } from "@/modules/core-hr/employments/work-email";

export const dynamic = "force-dynamic";

export const PATCH = defineHandler(operations.updateEmploymentWorkEmail, async ({ principal, params, body, requestId }) => ({
  body: await updateWorkEmail(principal, params.id, body, requestId),
}));
