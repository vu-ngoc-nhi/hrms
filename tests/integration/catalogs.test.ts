import { describe, expect, it } from "vitest";
import { PATCH as patchDept } from "@/app/api/v1/core-hr/departments/[id]/route";
import { GET as listDept, POST as createDept } from "@/app/api/v1/core-hr/departments/route";
import { GET as listTypes, POST as createType } from "@/app/api/v1/core-hr/employee-types/route";
import { GET as listLevels } from "@/app/api/v1/core-hr/job-levels/route";
import { POST as createTitle } from "@/app/api/v1/core-hr/job-titles/route";
import { DepartmentListSchema, DepartmentSchema, EmployeeTypeListSchema, JobLevelListSchema, JobTitleSchema } from "@/contracts/core-hr/schemas";
import { db } from "@/lib/db";
import { call } from "../helpers";

describe("Catalogs", () => {
  it("HR_ADMIN creates a department; a case-insensitive duplicate code is 409", async () => {
    const r = await call(createDept, { path: "/api/v1/core-hr/departments", method: "POST", user: "admin", body: { code: "OPS", name: "  Operations   Team " } });
    expect(r.status).toBe(201);
    DepartmentSchema.parse(r.body);
    expect(r.body.name).toBe("Operations Team");
    const dup = await call(createDept, { path: "/api/v1/core-hr/departments", method: "POST", user: "admin", body: { code: "ops", name: "Other" } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("DUPLICATE_CATALOG_CODE");
  });
  it("job titles keep an optional Vietnamese name as business data", async () => {
    const r = await call(createTitle, {
      path: "/api/v1/core-hr/job-titles",
      method: "POST",
      user: "admin",
      body: { code: "BA", name_en: "Business Analyst", name_vi: "Chuyên viên phân tích nghiệp vụ" },
    });
    expect(r.status).toBe(201);
    expect(JobTitleSchema.parse(r.body)).toMatchObject({ name_en: "Business Analyst", name_vi: "Chuyên viên phân tích nghiệp vụ" });
  });
  it("employee types are HR-managed catalog values with a requires_work_email flag (default true)", async () => {
    const r = await call(createType, { path: "/api/v1/core-hr/employee-types", method: "POST", user: "admin", body: { code: "FREELANCER", name: "Freelancer", requires_work_email: false } });
    expect(r.status).toBe(201);
    expect(r.body.requires_work_email).toBe(false);
    const d = await call(createType, { path: "/api/v1/core-hr/employee-types", method: "POST", user: "admin", body: { code: "APPRENTICE", name: "Apprentice" } });
    expect(d.body.requires_work_email).toBe(true);
    const list = await call(listTypes, { path: "/api/v1/core-hr/employee-types?page_size=100", user: "editor" });
    expect(EmployeeTypeListSchema.parse(list.body).data.map((t) => t.code)).toEqual(
      expect.arrayContaining(["EMPLOYEE", "SERVICE_CONTRACTOR", "INTERN", "FREELANCER"]),
    );
  });
  it("HR_EDITOR can read catalogs but not create or change them", async () => {
    expect((await call(listDept, { path: "/api/v1/core-hr/departments", user: "editor" })).status).toBe(200);
    expect((await call(createTitle, { path: "/api/v1/core-hr/job-titles", method: "POST", user: "editor", body: { code: "PM", name_en: "PM" } })).status).toBe(403);
    expect((await call(createType, { path: "/api/v1/core-hr/employee-types", method: "POST", user: "editor", body: { code: "X", name: "X" } })).status).toBe(403);
  });
  it("deactivates instead of deleting; inactive items are hidden by default; codes cannot change", async () => {
    const dept = await db().department.findFirstOrThrow({ where: { code: "OPS" } });
    const r = await call(patchDept, { path: "/x", method: "PATCH", user: "admin", params: { id: dept.id }, body: { is_active: false } });
    expect(r.status).toBe(200);
    expect(r.body.is_active).toBe(false);
    const active = await call(listDept, { path: "/api/v1/core-hr/departments?page_size=100", user: "editor" });
    DepartmentListSchema.parse(active.body);
    expect(active.body.data.map((d: { code: string }) => d.code)).not.toContain("OPS");
    const all = await call(listDept, { path: "/api/v1/core-hr/departments?page_size=100&include_inactive=true", user: "editor" });
    expect(all.body.data.map((d: { code: string }) => d.code)).toContain("OPS");
    expect((await call(patchDept, { path: "/x", method: "PATCH", user: "admin", params: { id: dept.id }, body: { code: "NEW" } })).status).toBe(400);
    expect((await call(patchDept, { path: "/x", method: "PATCH", user: "admin", params: { id: dept.id }, body: {} })).status).toBe(400);
  });
  it("levels are ordered by sort_order", async () => {
    const r = await call(listLevels, { path: "/api/v1/core-hr/job-levels", user: "editor" });
    expect(JobLevelListSchema.parse(r.body).data.map((l) => l.code)).toEqual(["L1", "L2", "L3", "L4"]);
  });
  it("PATCH on an unknown id is 404", async () => {
    const r = await call(patchDept, { path: "/x", method: "PATCH", user: "admin", params: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, body: { name: "X" } });
    expect(r.status).toBe(404);
  });
});
