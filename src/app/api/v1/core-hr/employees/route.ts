import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { createEmployee, listEmployees, rejectProtectedFields } from "@/modules/core-hr/people/service";
import { readIdempotencyKey } from "@/modules/idempotency/idempotency";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.listEmployees, async ({ principal, query }) => ({
  body: await listEmployees(principal, query),
}));

export const POST = defineHandler(
  operations.createEmployee,
  async ({ req, principal, body, requestId }) => {
    const key = readIdempotencyKey(req);
    const result = await createEmployee(principal, body, key, requestId);
    return {
      status: 201,
      body: result.body,
      headers: (result.replayed ? { "Idempotent-Replayed": "true" } : {}) as Record<string, string>,
    };
  },
  { preValidateBody: rejectProtectedFields },
);
