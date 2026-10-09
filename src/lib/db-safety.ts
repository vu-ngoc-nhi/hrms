// Executable guards for destructive or schema-changing database operations.
// Every check fails closed: if the target cannot be positively identified as safe, the operation is refused.

export const TEST_DATABASE_NAME = "hrms_test";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class UnsafeDatabaseOperation extends Error {
  constructor(reason: string) {
    super(`Refusing database operation: ${reason}`);
    this.name = "UnsafeDatabaseOperation";
  }
}

type Env = Record<string, string | undefined>;

function parseUrl(name: string, value: string | undefined): URL {
  if (!value) throw new UnsafeDatabaseOperation(`${name} is not set`);
  try {
    return new URL(value);
  } catch {
    throw new UnsafeDatabaseOperation(`${name} is not a valid URL`);
  }
}

export function isLoopbackHost(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

// Any variable that looks like a production credential means this shell is not a safe test context.
export function productionCredentialVariables(env: Env): string[] {
  return Object.entries(env)
    .filter(([key, value]) => Boolean(value) && /(^|_)PROD(UCTION)?(_|$)/i.test(key))
    .map(([key]) => key);
}

function assertAllDatabaseUrlsLocal(env: Env) {
  for (const [key, value] of Object.entries(env)) {
    if (!value || !/DATABASE_URL$/.test(key)) continue;
    if (!isLoopbackHost(parseUrl(key, value))) {
      throw new UnsafeDatabaseOperation(`${key} points to a non-local host`);
    }
  }
}

/** Allowed in Auto mode only when ALL conditions hold (Decision: automated test database). */
export function assertSafeTestDatabaseReset(env: Env): URL {
  if (env.APP_ENV !== "test") throw new UnsafeDatabaseOperation("APP_ENV must be explicitly 'test'");
  if (env.NODE_ENV === "production") throw new UnsafeDatabaseOperation("NODE_ENV is 'production'");
  const prodVars = productionCredentialVariables(env);
  if (prodVars.length) throw new UnsafeDatabaseOperation(`production-like variables present: ${prodVars.join(", ")}`);
  assertAllDatabaseUrlsLocal(env);
  const url = parseUrl("TEST_MIGRATION_DATABASE_URL", env.TEST_MIGRATION_DATABASE_URL);
  if (url.pathname !== `/${TEST_DATABASE_NAME}`) {
    throw new UnsafeDatabaseOperation(`database name must be exactly '${TEST_DATABASE_NAME}'`);
  }
  if (!isLoopbackHost(url)) throw new UnsafeDatabaseOperation("test database host is not local");
  return url;
}

/** Migrations may run automatically only against a local database outside production. */
export function assertSafeMigrationTarget(env: Env): URL {
  if (env.APP_ENV === "production" || env.NODE_ENV === "production") {
    throw new UnsafeDatabaseOperation("production migrations require explicit manual approval");
  }
  const url = parseUrl("MIGRATION_DATABASE_URL", env.MIGRATION_DATABASE_URL);
  if (!isLoopbackHost(url)) {
    throw new UnsafeDatabaseOperation("migration target is not local; staging/production migrations require explicit manual approval");
  }
  return url;
}
