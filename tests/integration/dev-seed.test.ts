import { describe, expect, it } from "vitest";
import { GET as listRoute } from "@/app/api/v1/core-hr/employees/route";
import { db } from "@/lib/db";
import { DEMO_EXPECTATIONS, seedDemoProfiles } from "../../scripts/seed-demo";
import { call } from "../helpers";

// Proves the development demo seed is compatible with the current migrations and produces the documented
// employment statuses and operational completeness. Runs against hrms_test only.
describe("Development demo seed", () => {
  it("runs on a freshly migrated database and yields the expected statuses and completeness", async () => {
    await seedDemoProfiles(db());
    const all = await call(listRoute, { path: "/api/v1/core-hr/employees?page_size=100", user: "admin" });
    for (const [name, expected] of Object.entries(DEMO_EXPECTATIONS)) {
      const row = all.body.data.find((x: { full_name: string }) => x.full_name === name);
      expect(row, name).toBeDefined();
      expect(row.employment_status, name).toBe(expected.status);
      expect(row.operational_completeness, name).toBe(expected.completeness);
    }
  });
  it("records a Service Contractor -> Employee change as two employment periods", async () => {
    const person = await db().person.findFirstOrThrow({
      where: { fullName: "Trịnh Hải Yến" },
      include: { employments: { orderBy: { startDate: "asc" }, include: { employeeType: true } } },
    });
    expect(person.employments.map((e) => e.employeeType?.code)).toEqual(["SERVICE_CONTRACTOR", "EMPLOYEE"]);
  });
});
