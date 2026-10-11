import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { getDashboard } from "@/modules/core-hr/dashboard/service";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.getCoreHrDashboard, async ({ principal }) => ({ status: 200, body: await getDashboard(principal) }));
