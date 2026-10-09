import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { updateEmployeeProfile } from "@/modules/core-hr/people/profile-edit";
import { getEmployee, rejectProtectedFields } from "@/modules/core-hr/people/service";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.getEmployee, async ({ principal, params }) => ({
  body: await getEmployee(principal, params.id),
}));

export const PATCH = defineHandler(
  operations.updateEmployee,
  async ({ principal, params, body, requestId }) => ({
    body: await updateEmployeeProfile(principal, params.id, body, requestId),
  }),
  { preValidateBody: rejectProtectedFields },
);
