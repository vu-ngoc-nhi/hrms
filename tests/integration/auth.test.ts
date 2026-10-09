import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as listEmployees, POST as createEmployee } from "@/app/api/v1/core-hr/employees/route";
import { GET as getOpenApi } from "@/app/api/v1/internal/openapi.json/route";
import { GET as getMe } from "@/app/api/v1/me/route";
import { POST as issueTestToken } from "@/app/api/v1/dev/test-tokens/route";
import { GET as health } from "@/app/health/route";
import { db } from "@/lib/db";
import { call, key, resetAuthState, tokenFor } from "../helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthState();
});

describe("401: not authenticated / invalid token", () => {
  it("missing token", async () => {
    const r = await call(getMe, { path: "/api/v1/me" });
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ error: "UNAUTHENTICATED" });
    expect(r.body.request_id).toEqual(expect.any(String));
    expect(r.headers.get("www-authenticate")).toContain("Bearer");
  });
  it("wrong audience / tenant / expired / missing scope / wrong issuer / malformed", async () => {
    const bad = [
      await tokenFor("admin", { audience: "api://other-app" }),
      await tokenFor("admin", { tenantId: "33333333-3333-4333-8333-333333333333" }),
      await tokenFor("admin", { expiresInSeconds: -120 }),
      await tokenFor("admin", { scope: null }),
      await tokenFor("admin", { issuer: "https://login.microsoftonline.com/x/v2.0" }),
      "aaa.bbb.ccc",
    ];
    for (const token of bad) {
      expect((await call(listEmployees, { path: "/api/v1/core-hr/employees", token })).status).toBe(401);
    }
  });
  it("Authorization header is not a Bearer JWT", async () => {
    const r = await call(getMe, { path: "/api/v1/me", headers: { authorization: "Basic abc" } });
    expect(r.status).toBe(401);
  });
});

describe("403: authenticated but not permitted", () => {
  it("disabled account or no HRMS account", async () => {
    expect((await call(getMe, { path: "/api/v1/me", user: "disabled" })).status).toBe(403);
    const unknown = await tokenFor("admin", { objectId: "99999999-9999-4999-8999-999999999999" });
    expect((await call(getMe, { path: "/api/v1/me", token: unknown })).status).toBe(403);
  });
  it("a user without roles can read /me but not employee profiles", async () => {
    expect((await call(getMe, { path: "/api/v1/me", user: "noroles" })).status).toBe(200);
    expect((await call(listEmployees, { path: "/api/v1/core-hr/employees", user: "noroles" })).status).toBe(403);
  });
  it("API_DOCS_READER cannot read or create employee profiles", async () => {
    const r = await call(createEmployee, {
      path: "/api/v1/core-hr/employees",
      method: "POST",
      user: "docs",
      body: { full_name: "Test Employee Z" },
      headers: { "idempotency-key": key() },
    });
    expect(r.status).toBe(403);
    expect((await call(listEmployees, { path: "/api/v1/core-hr/employees", user: "docs" })).status).toBe(403);
  });
  it("a retired or unknown role code (e.g. HR_VIEWER) grants nothing", async () => {
    const uid = (await db().appUser.findFirstOrThrow({ where: { displayName: "Test User Without Roles" } })).id;
    await db().appUserRole.create({ data: { userId: uid, roleCode: "HR_VIEWER" } });
    try {
      expect((await call(listEmployees, { path: "/api/v1/core-hr/employees", user: "noroles" })).status).toBe(403);
      expect((await call(getMe, { path: "/api/v1/me", user: "noroles" })).body.roles).toEqual([]);
    } finally {
      await db().appUserRole.delete({ where: { userId_roleCode: { userId: uid, roleCode: "HR_VIEWER" } } });
    }
  });
  it("a denial is audited without payload", async () => {
    const before = await db().auditEvent.count({ where: { outcome: "denied", action: "listEmployees" } });
    await call(listEmployees, { path: "/api/v1/core-hr/employees", user: "docs" });
    expect(await db().auditEvent.count({ where: { outcome: "denied", action: "listEmployees" } })).toBe(before + 1);
  });
});

describe("Internal OpenAPI document", () => {
  it("401 without token, 403 for HR_EDITOR/HR_ADMIN (no docs.read), 200 for API_DOCS_READER", async () => {
    expect((await call(getOpenApi, { path: "/api/v1/internal/openapi.json" })).status).toBe(401);
    expect((await call(getOpenApi, { path: "/api/v1/internal/openapi.json", user: "editor" })).status).toBe(403);
    expect((await call(getOpenApi, { path: "/api/v1/internal/openapi.json", user: "admin" })).status).toBe(403);
    const ok = await call(getOpenApi, { path: "/api/v1/internal/openapi.json", user: "docs" });
    expect(ok.status).toBe(200);
    expect(ok.body.openapi).toBe("3.1.0");
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });
});

describe("The test identity is disabled in production", () => {
  it("NODE_ENV=production: a valid test token gets 401 and the token endpoint returns 404", async () => {
    const token = await tokenFor("admin");
    expect((await call(getMe, { path: "/api/v1/me", token })).status).toBe(200);
    vi.stubEnv("NODE_ENV", "production");
    resetAuthState();
    expect((await call(getMe, { path: "/api/v1/me", token })).status).toBe(401);
    const issued = await call(issueTestToken, {
      path: "/api/v1/dev/test-tokens",
      method: "POST",
      body: { object_id: "00000000-0000-4000-8000-0000000000a1" },
    });
    expect(issued.status).toBe(404);
  });
  it("APP_ENV=production also blocks it", async () => {
    const token = await tokenFor("admin");
    vi.stubEnv("APP_ENV", "production");
    resetAuthState();
    expect((await call(getMe, { path: "/api/v1/me", token })).status).toBe(401);
  });
  it("AUTH_MODE=entra without configuration: nobody can authenticate", async () => {
    const token = await tokenFor("admin");
    vi.stubEnv("AUTH_MODE", "entra");
    resetAuthState();
    expect((await call(getMe, { path: "/api/v1/me", token })).status).toBe(401);
  });
  it("/me reports the issuer as test, not Entra", async () => {
    const r = await call(getMe, { path: "/api/v1/me", user: "admin" });
    expect(r.body.auth_issuer).toBe("test");
  });
});

describe("/health", () => {
  it("is public with a minimal response", async () => {
    const r = await call(health, { path: "/health" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
  });
});
