import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { entraApiConfigFrom } from "@/lib/config";
import { createEntraVerifier, createTestIssuerVerifier, mintTestToken, TEST_TENANT_ID } from "@/modules/identity/token-verifiers";

// NOTE: claim-validation logic is exercised with locally generated RSA keys shaped like Entra v2 access tokens.
// This is NOT a test against real Microsoft Entra ID (the app registration does not exist yet).
const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const API_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const OID = "44444444-4444-4444-8444-444444444444";

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let verify: ReturnType<typeof createEntraVerifier>;

async function entraLikeToken(
  over: { iss?: string; aud?: string; tid?: string; scp?: string | null; exp?: number; key?: CryptoKey; roles?: string[]; ver?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { tid: over.tid ?? TENANT, oid: OID, ver: over.ver ?? "2.0" };
  if (over.scp !== null) payload.scp = over.scp ?? "access_as_user";
  if (over.roles) payload.roles = over.roles;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(over.iss ?? `https://login.microsoftonline.com/${TENANT}/v2.0`)
    .setAudience(over.aud ?? API_CLIENT_ID)
    .setIssuedAt(now - 10)
    .setExpirationTime(over.exp ?? now + 600)
    .sign(over.key ?? privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const cfg = entraApiConfigFrom({ ENTRA_TENANT_ID: TENANT, ENTRA_API_CLIENT_ID: API_CLIENT_ID })!;
  verify = createEntraVerifier({ ...cfg, jwks: createLocalJWKSet({ keys: [jwk] }) });
});

describe("Entra API configuration", () => {
  it("comes only from environment values; the expected audience is the API client ID; scope defaults to access_as_user", () => {
    expect(entraApiConfigFrom({})).toBeNull();
    expect(entraApiConfigFrom({ ENTRA_TENANT_ID: TENANT, ENTRA_API_CLIENT_ID: API_CLIENT_ID })).toEqual({
      tenantId: TENANT,
      audience: API_CLIENT_ID,
      requiredScope: "access_as_user",
    });
  });
});

describe("Entra access token verifier (simulated with local keys)", () => {
  it("accepts a v2 token with the right issuer, audience (API client ID), tenant, scope and expiry", async () => {
    await expect(verify(await entraLikeToken())).resolves.toMatchObject({ tenantId: TENANT, objectId: OID, issuerKind: "entra" });
  });
  it("rejects the App ID URI as audience (v1-style) and any non-2.0 token version", async () => {
    await expect(verify(await entraLikeToken({ aud: `api://${API_CLIENT_ID}` }))).rejects.toThrow();
    await expect(verify(await entraLikeToken({ ver: "1.0" }))).rejects.toThrow("access token version must be 2.0");
  });
  it("rejects a wrong audience (e.g. a Graph token or a SPA ID token)", async () => {
    await expect(verify(await entraLikeToken({ aud: "https://graph.microsoft.com" }))).rejects.toThrow();
    await expect(verify(await entraLikeToken({ aud: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", scp: null }))).rejects.toThrow();
  });
  it("rejects another tenant's issuer", async () => {
    await expect(
      verify(await entraLikeToken({ iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`, tid: OTHER_TENANT })),
    ).rejects.toThrow();
  });
  it("rejects a tid from another tenant even with the right issuer", async () => {
    await expect(verify(await entraLikeToken({ tid: OTHER_TENANT }))).rejects.toThrow("tenant mismatch");
  });
  it("rejects an expired token", async () => {
    await expect(verify(await entraLikeToken({ exp: Math.floor(Date.now() / 1000) - 3600 }))).rejects.toThrow();
  });
  it("rejects a token signed with another key", async () => {
    await expect(verify(await entraLikeToken({ key: otherKey }))).rejects.toThrow();
  });
  it("rejects a token without the access_as_user scope (app-only token with roles)", async () => {
    await expect(verify(await entraLikeToken({ scp: null, roles: ["HR"] }))).rejects.toThrow("missing required scope");
    await expect(verify(await entraLikeToken({ scp: "User.Read" }))).rejects.toThrow("missing required scope");
  });
  it("rejects test-issuer (HS256) tokens and alg none", async () => {
    const testToken = await mintTestToken("x".repeat(48), { objectId: OID, tenantId: TENANT, audience: API_CLIENT_ID });
    await expect(verify(testToken)).rejects.toThrow();
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(
      JSON.stringify({ tid: TENANT, oid: OID, aud: API_CLIENT_ID, scp: "access_as_user" }),
    ).toString("base64url")}.`;
    await expect(verify(none)).rejects.toThrow();
  });
});

describe("Development test issuer verifier", () => {
  const secret = "s".repeat(48);
  const v = createTestIssuerVerifier(secret);
  it("accepts a valid test token and marks it issuerKind=test", async () => {
    await expect(v(await mintTestToken(secret, { objectId: OID }))).resolves.toMatchObject({ issuerKind: "test", tenantId: TEST_TENANT_ID });
  });
  it("rejects a wrong secret, audience, tenant, an expired token and a missing scope", async () => {
    await expect(v(await mintTestToken("t".repeat(48), { objectId: OID }))).rejects.toThrow();
    await expect(v(await mintTestToken(secret, { objectId: OID, audience: "api://other" }))).rejects.toThrow();
    await expect(v(await mintTestToken(secret, { objectId: OID, tenantId: OTHER_TENANT }))).rejects.toThrow();
    await expect(v(await mintTestToken(secret, { objectId: OID, expiresInSeconds: -60 }))).rejects.toThrow();
    await expect(v(await mintTestToken(secret, { objectId: OID, scope: null }))).rejects.toThrow();
  });
});
