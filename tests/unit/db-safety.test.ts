import { describe, expect, it } from "vitest";
import { assertSafeMigrationTarget, assertSafeTestDatabaseReset } from "@/lib/db-safety";

const LOCAL_TEST = "postgresql://owner:pw@127.0.0.1:55432/hrms_test";
const safe = {
  APP_ENV: "test",
  NODE_ENV: "test",
  TEST_MIGRATION_DATABASE_URL: LOCAL_TEST,
  DATABASE_URL: "postgresql://app:pw@127.0.0.1:55432/hrms_test",
};

describe("Test database reset guard (fails closed)", () => {
  it("allows only an explicitly test, local hrms_test target without production credentials", () => {
    expect(assertSafeTestDatabaseReset(safe).pathname).toBe("/hrms_test");
    expect(() => assertSafeTestDatabaseReset({ ...safe, TEST_MIGRATION_DATABASE_URL: "postgresql://o:p@localhost/hrms_test" })).not.toThrow();
  });
  it.each([
    ["APP_ENV missing", { APP_ENV: undefined }],
    ["APP_ENV=local", { APP_ENV: "local" }],
    ["APP_ENV=production", { APP_ENV: "production" }],
    ["NODE_ENV=production", { NODE_ENV: "production" }],
    ["dev database name", { TEST_MIGRATION_DATABASE_URL: "postgresql://o:p@127.0.0.1:55432/hrms_dev" }],
    ["similar database name", { TEST_MIGRATION_DATABASE_URL: "postgresql://o:p@127.0.0.1:55432/hrms_test_copy" }],
    ["remote host", { TEST_MIGRATION_DATABASE_URL: "postgresql://o:p@db.example.com:5432/hrms_test" }],
    ["test URL missing", { TEST_MIGRATION_DATABASE_URL: undefined }],
    ["invalid URL", { TEST_MIGRATION_DATABASE_URL: "not a url" }],
    ["another DATABASE_URL is remote", { DATABASE_URL: "postgresql://o:p@prod-db.internal:5432/hrms" }],
    ["production credential variable present", { PROD_DATABASE_URL: "postgresql://o:p@127.0.0.1/x" }],
    ["PRODUCTION_ variable present", { PRODUCTION_DB_PASSWORD: "secret" }],
  ])("refuses when %s", (_label, override) => {
    expect(() => assertSafeTestDatabaseReset({ ...safe, ...override })).toThrow(/Refusing database operation/);
  });
});

describe("Migration target guard", () => {
  it("allows a local target outside production", () => {
    expect(() => assertSafeMigrationTarget({ APP_ENV: "local", MIGRATION_DATABASE_URL: LOCAL_TEST })).not.toThrow();
  });
  it.each([
    ["remote host", { APP_ENV: "local", MIGRATION_DATABASE_URL: "postgresql://o:p@db.example.com/hrms" }],
    ["APP_ENV=production", { APP_ENV: "production", MIGRATION_DATABASE_URL: LOCAL_TEST }],
    ["NODE_ENV=production", { NODE_ENV: "production", MIGRATION_DATABASE_URL: LOCAL_TEST }],
    ["URL missing", { APP_ENV: "local" }],
  ])("refuses when %s", (_label, env) => {
    expect(() => assertSafeMigrationTarget(env)).toThrow(/Refusing database operation/);
  });
});
