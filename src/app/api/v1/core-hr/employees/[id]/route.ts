import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { getEmployee } from "@/modules/core-hr/people/service";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.getEmployee, async ({ principal, params }) => ({
  body: await getEmployee(principal, params.id),
}));
