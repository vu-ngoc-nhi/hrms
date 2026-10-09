import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";

export type VerifiedClaims = { tenantId: string; objectId: string; issuerKind: "entra" | "test" };

export class TokenRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TokenRejected";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkCommonClaims(
  payload: JWTPayload,
  expected: { tenantId: string; requiredScope: string },
): { tenantId: string; objectId: string } {
  const tid = payload.tid;
  const oid = payload.oid;
  if (typeof tid !== "string" || tid.toLowerCase() !== expected.tenantId.toLowerCase()) {
    throw new TokenRejected("tenant mismatch");
  }
  if (typeof oid !== "string" || !UUID_RE.test(oid)) throw new TokenRejected("missing oid");
  // Only delegated (user) tokens carrying the HRMS API scope are accepted. App-only tokens are not supported yet.
  const scp = typeof payload.scp === "string" ? payload.scp.split(" ") : [];
  if (!scp.includes(expected.requiredScope)) throw new TokenRejected("missing required scope");
  return { tenantId: tid.toLowerCase(), objectId: oid.toLowerCase() };
}

// ---------------- Microsoft Entra ID (v2 access tokens issued for the HRMS API registration) ----------------
// Requires the API registration to set api.requestedAccessTokenVersion = 2 (Microsoft Graph manifest format;
// null defaults to v1). Only v2 tokens are accepted, so `aud` must equal the API client ID.
export function createEntraVerifier(opts: {
  tenantId: string;
  audience: string;
  requiredScope: string;
  jwks?: JWTVerifyGetKey; // injected in tests; defaults to the tenant's public JWKS
}) {
  const jwks =
    opts.jwks ??
    createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${opts.tenantId}/discovery/v2.0/keys`));
  const issuer = `https://login.microsoftonline.com/${opts.tenantId}/v2.0`;
  return async (token: string): Promise<VerifiedClaims> => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: opts.audience,
        algorithms: ["RS256"],
        clockTolerance: 60,
        requiredClaims: ["exp", "iat", "tid", "oid"],
      }));
    } catch {
      throw new TokenRejected("signature/issuer/audience/expiry check failed");
    }
    if (payload.ver !== "2.0") throw new TokenRejected("access token version must be 2.0");
    return { ...checkCommonClaims(payload, opts), issuerKind: "entra" };
  };
}

// ---------------- Development test issuer (local/test only; NOT Microsoft Entra ID) ----------------
export const TEST_ISSUER = "https://test-issuer.hrms.invalid";
export const TEST_AUDIENCE = "api://hrms-core-hr-local";
export const TEST_TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_SCOPE = "access_as_user";

function secretKey(secret: string) {
  return new TextEncoder().encode(secret);
}

export function createTestIssuerVerifier(secret: string) {
  const key = secretKey(secret);
  return async (token: string): Promise<VerifiedClaims> => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        algorithms: ["HS256"],
        requiredClaims: ["exp", "iat", "tid", "oid"],
      }));
    } catch {
      throw new TokenRejected("signature/issuer/audience/expiry check failed");
    }
    return {
      ...checkCommonClaims(payload, { tenantId: TEST_TENANT_ID, requiredScope: TEST_SCOPE }),
      issuerKind: "test",
    };
  };
}

export async function mintTestToken(
  secret: string,
  claims: {
    objectId: string;
    tenantId?: string;
    audience?: string;
    issuer?: string;
    scope?: string | null;
    expiresInSeconds?: number;
  },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = { tid: claims.tenantId ?? TEST_TENANT_ID, oid: claims.objectId };
  if (claims.scope !== null) payload.scp = claims.scope ?? TEST_SCOPE;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(claims.issuer ?? TEST_ISSUER)
    .setAudience(claims.audience ?? TEST_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (claims.expiresInSeconds ?? 3600))
    .sign(secretKey(secret));
}
