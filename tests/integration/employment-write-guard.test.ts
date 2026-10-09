import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/http/errors";
import { assertEmploymentWritable, loadWritableEmployment } from "@/modules/core-hr/employments/queries";
import { call, catalogIds, key } from "../helpers";

// C-29 clarification: cancelled periods are read-only; every S4 write path goes through this shared guard.
let app: pg.Client;
let cancelledId: string;
let liveId: string;

beforeAll(async () => {
  const ids = await catalogIds();
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  const mk = async (name: string) =>
    (
      await call(createRoute, {
        path: "/api/v1/core-hr/employees",
        method: "POST",
        user: "editor",
        headers: { "idempotency-key": key("guard") },
        body: {
          full_name: name,
          employment: {
            start_date: addDays(todayInVietnam(), 50),
            employee_type_id: ids.et.EMPLOYEE,
            assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE },
          },
        },
      })
    ).body.employments[0].id as string;
  cancelledId = await mk("Test Guard Cancelled");
  liveId = await mk("Test Guard Live");
  await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [cancelledId]);
});

afterAll(async () => {
  await app.end();
});

describe("Shared employment write guard", () => {
  it("rejects a cancelled period with 409 EMPLOYMENT_PERIOD_READ_ONLY", async () => {
    await expect(loadWritableEmployment(db(), cancelledId)).rejects.toMatchObject({ status: 409, code: "EMPLOYMENT_PERIOD_READ_ONLY" });
    expect(() => assertEmploymentWritable({ id: "x", cancelledAt: new Date() })).toThrow(ApiError);
  });
  it("returns a non-cancelled period and 404s an unknown one", async () => {
    await expect(loadWritableEmployment(db(), liveId)).resolves.toMatchObject({ id: liveId });
    await expect(loadWritableEmployment(db(), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).rejects.toMatchObject({ status: 404 });
  });
  it("works inside a transaction", async () => {
    await expect(db().$transaction((tx) => loadWritableEmployment(tx, cancelledId))).rejects.toMatchObject({ status: 409 });
  });
});
