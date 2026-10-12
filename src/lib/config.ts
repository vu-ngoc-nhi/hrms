import { z } from "zod";
import { TEST_TENANT_ID } from "@/modules/identity/token-verifiers";

const envSchema = z.object({
  APP_ENV: z.enum(["local", "test", "production"]).default("production"),
  NODE_ENV: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  AUTH_MODE: z.enum(["test", "entra"]).default("entra"),
  AUTH_TEST_ISSUER_ENABLED: z.string().optional(),
  AUTH_TEST_ISSUER_SECRET: z.string().optional(),
  // API app registration (owned by EmeSoft IT / Entra Administrator). Never hardcode these values.
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_API_CLIENT_ID: z.string().optional(),
  ENTRA_API_SCOPE: z.string().optional(),
  IDEMPOTENCY_HMAC_KEY: z.string().optional(),
  COMPANY_EMAIL_DOMAINS: z.string().optional(),
});

export type EntraApiConfig = {
  tenantId: string;
  /** Expected `aud`. The API standardizes on v2 access tokens, whose `aud` is always the API client ID. */
  audience: string;
  requiredScope: string;
};

export type AppConfig = {
  appEnv: "local" | "test" | "production";
  nodeEnv: string;
  databaseUrl: string;
  authMode: "test" | "entra";
  testIssuer: { secret: string } | null;
  entra: EntraApiConfig | null;
  idempotencyHmacKey: string;
  companyEmailDomains: string[];
};

export const DEFAULT_API_SCOPE = "access_as_user";

// The development test identity is enabled only when ALL conditions hold; production always blocks it.
export function isTestIdentityAllowed(env: {
  appEnv: string;
  nodeEnv: string;
  authMode: string;
  testIssuerFlag: string | undefined;
}): boolean {
  return (
    env.authMode === "test" &&
    env.testIssuerFlag === "true" &&
    (env.appEnv === "local" || env.appEnv === "test") &&
    env.nodeEnv !== "production"
  );
}

export function entraApiConfigFrom(env: Record<string, string | undefined>): EntraApiConfig | null {
  const tenantId = env.ENTRA_TENANT_ID?.trim();
  const clientId = env.ENTRA_API_CLIENT_ID?.trim();
  if (!tenantId || !clientId) return null;
  return { tenantId, audience: clientId, requiredScope: env.ENTRA_API_SCOPE?.trim() || DEFAULT_API_SCOPE };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_NAME = /^[A-Za-z0-9._-]+$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// Reserved / non-routable names (RFC 2606, RFC 6761, mDNS) used by synthetic data and local setups.
const RESERVED_DOMAIN = /(^|\.)(test|example|invalid|localhost|local)$|^example\.(com|net|org)$/;
const DEVELOPMENT_PASSWORD = "hrms_local_dev_only";
const DEVELOPMENT_DATABASES = new Set(["hrms_dev", "hrms_test"]);
// Owner, test and operator credentials belong to the attended migration step, the test suite or the operator machine,
// never to the running application (`it-pre-production-handoff.md` §0).
const FORBIDDEN_RUNTIME_VARIABLES = [
  "MIGRATION_DATABASE_URL",
  "TEST_DATABASE_URL",
  "TEST_MIGRATION_DATABASE_URL",
  "ACCESS_ADMIN_DATABASE_URL",
  "AUTH_TEST_ISSUER_ENABLED",
  "AUTH_TEST_ISSUER_SECRET",
];

/**
 * Startup check (L2, run by `src/instrumentation.ts`): problems that make this process unsafe to serve.
 * Messages name variables, never values.
 * Only APP_ENV=production is checked in depth; a production build (NODE_ENV=production) must also run as production.
 */
export function unsafeRuntimeConfig(env: Record<string, string | undefined>): string[] {
  const set = (name: string) => Boolean(env[name]?.trim());
  const appEnv = env.APP_ENV?.trim() || "production";
  if (!["local", "test", "production"].includes(appEnv)) return ["APP_ENV must be local, test or production"];
  const problems: string[] = [];
  if (env.NODE_ENV === "production" && appEnv !== "production") {
    problems.push("APP_ENV must be production when NODE_ENV is production");
  }
  if (appEnv !== "production") return problems;

  if (env.NODE_ENV !== "production") problems.push("NODE_ENV must be production");
  if ((env.AUTH_MODE?.trim() || "entra") !== "entra") problems.push("AUTH_MODE must be entra");
  const tenant = env.ENTRA_TENANT_ID?.trim() ?? "";
  if (!GUID.test(tenant)) problems.push("ENTRA_TENANT_ID must be a tenant GUID");
  else if (tenant.toLowerCase() === TEST_TENANT_ID) problems.push("ENTRA_TENANT_ID is the development test tenant");
  if (!GUID.test(env.ENTRA_API_CLIENT_ID?.trim() ?? "")) problems.push("ENTRA_API_CLIENT_ID must be the API client GUID");
  if (set("ENTRA_API_SCOPE") && !SCOPE_NAME.test(env.ENTRA_API_SCOPE!.trim())) {
    problems.push("ENTRA_API_SCOPE must be the bare scope name (e.g. access_as_user)");
  }
  if ((env.IDEMPOTENCY_HMAC_KEY ?? "").length < 32) problems.push("IDEMPOTENCY_HMAC_KEY must be set (>= 32 chars)");
  if (env.IDEMPOTENCY_HMAC_KEY?.includes(DEVELOPMENT_PASSWORD)) problems.push("IDEMPOTENCY_HMAC_KEY is a development value");

  const domains = (env.COMPANY_EMAIL_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!domains.length) problems.push("COMPANY_EMAIL_DOMAINS must list the company domain(s)");
  else if (domains.some((d) => !DOMAIN.test(d) || RESERVED_DOMAIN.test(d))) {
    problems.push("COMPANY_EMAIL_DOMAINS contains an invalid or reserved (development) domain");
  }

  let db: URL | null = null;
  try {
    db = new URL(env.DATABASE_URL ?? "");
  } catch {
    problems.push("DATABASE_URL must be a postgresql:// URL");
  }
  if (db) {
    if (!["postgres:", "postgresql:"].includes(db.protocol)) problems.push("DATABASE_URL must be a postgresql:// URL");
    if (decodeURIComponent(db.password) === DEVELOPMENT_PASSWORD) problems.push("DATABASE_URL uses the development password");
    if (DEVELOPMENT_DATABASES.has(db.pathname.slice(1))) problems.push("DATABASE_URL points to a development/test database");
  }

  for (const name of FORBIDDEN_RUNTIME_VARIABLES) {
    if (set(name)) problems.push(`${name} must not be set in the running application`);
  }
  return problems;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const env = envSchema.parse(process.env);
  const nodeEnv = env.NODE_ENV ?? "development";
  const testAllowed = isTestIdentityAllowed({
    appEnv: env.APP_ENV,
    nodeEnv,
    authMode: env.AUTH_MODE,
    testIssuerFlag: env.AUTH_TEST_ISSUER_ENABLED,
  });
  const secret = env.AUTH_TEST_ISSUER_SECRET ?? "";
  const hmacKey = env.IDEMPOTENCY_HMAC_KEY ?? "";
  if (hmacKey.length < 32) throw new Error("IDEMPOTENCY_HMAC_KEY must be set (>= 32 chars)");
  cached = {
    appEnv: env.APP_ENV,
    nodeEnv,
    databaseUrl: env.DATABASE_URL,
    authMode: env.AUTH_MODE,
    testIssuer: testAllowed && secret.length >= 32 ? { secret } : null,
    entra: env.AUTH_MODE === "entra" ? entraApiConfigFrom(process.env) : null,
    idempotencyHmacKey: hmacKey,
    companyEmailDomains: (env.COMPANY_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}
