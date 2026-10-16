import { operations } from "@/contracts/core-hr/operations";
import { defineHandler } from "@/lib/http/handler";
import { contractReminders } from "@/modules/contracts/read";

export const dynamic = "force-dynamic";

export const GET = defineHandler(operations.getContractReminders, async () => ({
  body: await contractReminders(),
}));
