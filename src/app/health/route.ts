import { operations } from "@/contracts/core-hr/operations";
import { db } from "@/lib/db";
import { defineHandler } from "@/lib/http/handler";

export const dynamic = "force-dynamic";

// Public, minimal response: no version, configuration or database connection details.
export const GET = defineHandler(operations.getHealth, async () => {
  try {
    await db().$queryRaw`SELECT 1`;
    return { body: { status: "ok" } };
  } catch {
    return { status: 503, body: { status: "unavailable" } };
  }
});
