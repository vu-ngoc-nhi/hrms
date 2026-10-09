import { z } from "zod";

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
