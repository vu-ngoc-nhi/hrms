import { describe, expect, it } from "vitest";
import { unsafeRuntimeConfig } from "@/lib/config";

// Synthetic values only; none of them is a real tenant, client or secret.
const SAFE = {
  APP_ENV: "production",
  NODE_ENV: "production",
  AUTH_MODE: "entra",
  ENTRA_TENANT_ID: "0f8f1a52-3c5e-4d7a-9b1e-2a6c4d8e0f13",
  ENTRA_API_CLIENT_ID: "5b0c7e2d-9a14-4f63-8d2b-7e1f3a9c6b40",
  ENTRA_API_SCOPE: "access_as_user",
  IDEMPOTENCY_HMAC_KEY: "Zm9yLXRlc3RzLW9ubHktbm90LWEtcmVhbC1rZXktMTIzNDU2",
  COMPANY_EMAIL_DOMAINS: "synthetic-company.vn",
  DATABASE_URL: "postgresql://hrms_app:Synthetic-Strong-Pass@db.internal:5432/hrms",
};
const check = (overrides: Record<string, string | undefined>) => unsafeRuntimeConfig({ ...SAFE, ...overrides });

describe("Production startup configuration (L2)", () => {
  it("accepts a complete production configuration", () => {
    expect(unsafeRuntimeConfig(SAFE)).toEqual([]);
  });

  it("does not check local / test development processes", () => {
    expect(unsafeRuntimeConfig({ APP_ENV: "local", NODE_ENV: "development", AUTH_MODE: "test" })).toEqual([]);
    expect(unsafeRuntimeConfig({ APP_ENV: "test", NODE_ENV: "test" })).toEqual([]);
  });

  it("treats a missing APP_ENV as production and refuses an unknown one", () => {
    expect(check({ APP_ENV: undefined })).toEqual([]);
    expect(unsafeRuntimeConfig({ NODE_ENV: "production" })).toContain("ENTRA_TENANT_ID must be a tenant GUID");
    expect(check({ APP_ENV: "staging" })).toEqual(["APP_ENV must be local, test or production"]);
  });

  it("refuses a production build running with development semantics", () => {
    expect(unsafeRuntimeConfig({ APP_ENV: "local", NODE_ENV: "production" })).toEqual([
      "APP_ENV must be production when NODE_ENV is production",
    ]);
    expect(check({ NODE_ENV: "development" })).toEqual(["NODE_ENV must be production"]);
  });

  it("requires Entra and refuses the development test identity", () => {
    expect(check({ AUTH_MODE: "test" })).toEqual(["AUTH_MODE must be entra"]);
    expect(check({ ENTRA_TENANT_ID: "" })).toEqual(["ENTRA_TENANT_ID must be a tenant GUID"]);
    expect(check({ ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111" })).toEqual([
      "ENTRA_TENANT_ID is the development test tenant",
    ]);
    expect(check({ ENTRA_API_CLIENT_ID: "api://5b0c7e2d-9a14-4f63-8d2b-7e1f3a9c6b40" })).toEqual([
      "ENTRA_API_CLIENT_ID must be the API client GUID",
    ]);
    expect(check({ ENTRA_API_SCOPE: "api://x/access_as_user" })).toEqual([
      "ENTRA_API_SCOPE must be the bare scope name (e.g. access_as_user)",
    ]);
    expect(check({ ENTRA_API_SCOPE: undefined })).toEqual([]);
    expect(check({ AUTH_TEST_ISSUER_ENABLED: "true", AUTH_TEST_ISSUER_SECRET: "x".repeat(40) })).toEqual([
      "AUTH_TEST_ISSUER_ENABLED must not be set in the running application",
      "AUTH_TEST_ISSUER_SECRET must not be set in the running application",
    ]);
  });

  it("refuses development secrets, databases and domains", () => {
    expect(check({ IDEMPOTENCY_HMAC_KEY: "short" })).toEqual(["IDEMPOTENCY_HMAC_KEY must be set (>= 32 chars)"]);
    expect(check({ DATABASE_URL: "postgresql://hrms_app:hrms_local_dev_only@db.internal:5432/hrms" })).toEqual([
      "DATABASE_URL uses the development password",
    ]);
    expect(check({ DATABASE_URL: "postgresql://hrms_app:Synthetic-Strong-Pass@db.internal:5432/hrms_dev" })).toEqual([
      "DATABASE_URL points to a development/test database",
    ]);
    expect(check({ DATABASE_URL: "not a url" })).toEqual(["DATABASE_URL must be a postgresql:// URL"]);
    for (const domains of ["", "example.test", "synthetic-company.vn,example.com", "corp.local", "not_a_domain"]) {
      expect(check({ COMPANY_EMAIL_DOMAINS: domains }), domains).toHaveLength(1);
    }
  });

  it("refuses owner, test and operator credentials in the running application", () => {
    const problems = check({
      MIGRATION_DATABASE_URL: "postgresql://owner:x@db.internal/hrms",
      TEST_DATABASE_URL: "postgresql://a:b@127.0.0.1/hrms_test",
      TEST_MIGRATION_DATABASE_URL: "postgresql://a:b@127.0.0.1/hrms_test",
      ACCESS_ADMIN_DATABASE_URL: "postgresql://op:x@db.internal/hrms",
    });
    expect(problems).toHaveLength(4);
  });

  it("never echoes configuration values", () => {
    const secret = "postgresql://hrms_app:hrms_local_dev_only@db.internal:5432/hrms_dev";
    const text = check({ DATABASE_URL: secret, IDEMPOTENCY_HMAC_KEY: "hrms_local_dev_only-hrms_local_dev_only" }).join("\n");
    expect(text).not.toContain("hrms_local_dev_only");
    expect(text).not.toContain("db.internal");
  });
});
