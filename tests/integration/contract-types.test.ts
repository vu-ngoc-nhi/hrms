import { describe, expect, it } from "vitest";
import { PATCH as patchType } from "@/app/api/v1/core-hr/contract-types/[id]/route";
import { GET as listTypes, POST as createType } from "@/app/api/v1/core-hr/contract-types/route";
import { ContractTypeListSchema, ContractTypeSchema } from "@/contracts/core-hr/schemas";
import { db } from "@/lib/db";
import { call } from "../helpers";

// Phase 2A slice 2A-1 (C-104): Contract Type catalog — reference data on the Organization catalog conventions
// (catalogs.read / catalogs.manage), no delete, no business rules. Values are synthetic (PV-31).
const PATH = "/api/v1/core-hr/contract-types";

describe("Contract Type catalog", () => {
  it("lists the synthetic seed values; no business-rule fields are exposed", async () => {
    const r = await call(listTypes, { path: `${PATH}?page_size=100`, user: "editor" });
    expect(r.status).toBe(200);
    const list = ContractTypeListSchema.parse(r.body);
    expect(list.data.map((t) => t.code)).toEqual(expect.arrayContaining(["TEST_TYPE_A", "TEST_TYPE_B"]));
    expect(Object.keys(list.data[0]).sort()).toEqual(["code", "created_at", "id", "is_active", "name", "name_vi", "updated_at"]);
  });

  it("HR_ADMIN creates a type with an optional Vietnamese name; codes are unique case-insensitively", async () => {
    const r = await call(createType, { path: PATH, method: "POST", user: "admin", body: { code: "TEST_TYPE_C", name: "  Test   Type C ", name_vi: "Loại thử nghiệm C" } });
    expect(r.status).toBe(201);
    expect(ContractTypeSchema.parse(r.body)).toMatchObject({ code: "TEST_TYPE_C", name: "Test Type C", name_vi: "Loại thử nghiệm C", is_active: true });
    const dup = await call(createType, { path: PATH, method: "POST", user: "admin", body: { code: "test_type_c", name: "Other" } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("DUPLICATE_CATALOG_CODE");
    const audit = await db().auditEvent.findFirst({ where: { action: "contract_type.create", entityId: r.body.id } });
    expect(audit?.changedFields.sort()).toEqual(["code", "name", "name_vi"]);
  });

  it("rejects business-rule fields and unknown fields (strict body)", async () => {
    for (const extra of [{ is_fixed_term: true }, { term_kind: "fixed_term" }, { requires_salary: false }]) {
      const r = await call(createType, { path: PATH, method: "POST", user: "admin", body: { code: "TEST_TYPE_X", name: "X", ...extra } });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
  });

  it("rename, clear the Vietnamese name, deactivate and reactivate — the code never changes and nothing is deleted", async () => {
    const created = await call(createType, { path: PATH, method: "POST", user: "admin", body: { code: "TEST_TYPE_D", name: "Test Type D", name_vi: "Loại D" } });
    const id = created.body.id as string;
    const patch = (body: unknown) => call(patchType, { path: `${PATH}/${id}`, method: "PATCH", user: "admin", body, params: { id } });
    expect((await patch({ name: "Test Type D renamed", name_vi: null })).body).toMatchObject({ name: "Test Type D renamed", name_vi: null, code: "TEST_TYPE_D" });
    expect((await patch({ code: "OTHER" })).status).toBe(400);
    expect((await patch({ is_active: false })).body.is_active).toBe(false);

    const active = await call(listTypes, { path: `${PATH}?page_size=100`, user: "admin" });
    expect(active.body.data.map((t: { code: string }) => t.code)).not.toContain("TEST_TYPE_D");
    const all = await call(listTypes, { path: `${PATH}?page_size=100&include_inactive=true`, user: "admin" });
    expect(all.body.data.find((t: { code: string }) => t.code === "TEST_TYPE_D")).toMatchObject({ is_active: false });

    expect((await patch({ is_active: true })).body.is_active).toBe(true);
    expect(await db().contractType.count({ where: { code: "TEST_TYPE_D" } })).toBe(1);
  });

  it("uses the catalog permissions: HR_EDITOR reads but cannot manage; API_DOCS_READER and role-less users get nothing", async () => {
    expect((await call(createType, { path: PATH, method: "POST", user: "editor", body: { code: "TEST_TYPE_E", name: "E" } })).status).toBe(403);
    expect((await call(listTypes, { path: PATH, user: "docs" })).status).toBe(403);
    expect((await call(listTypes, { path: PATH, user: "noroles" })).status).toBe(403);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect((await call(patchType, { path: `${PATH}/${id}`, method: "PATCH", user: "admin", body: { name: "X" }, params: { id } })).status).toBe(404);
  });
});
