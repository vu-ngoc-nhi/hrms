import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { employeeContracts } from "@/modules/contracts/read";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.listEmployeeContracts, async ({ principal, params }) => ({
  body: await employeeContracts(principal, params.id),
}));
