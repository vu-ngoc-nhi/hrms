import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { getVoidEligibility } from "@/modules/core-hr/employments/void-period";

export const dynamic = "force-dynamic";

// Authorization: the shared handler enforces the permission declared for this operation (employment.correct).
export const GET = defineHandler(operations.getVoidEligibility, async ({ params }) => ({
  body: await getVoidEligibility(params.id),
}));
