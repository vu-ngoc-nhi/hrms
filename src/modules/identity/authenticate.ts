import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { forbidden, unauthenticated } from "@/lib/http/errors";
import { isKnownRole, permissionsForRoles, type Permission, type RoleCode } from "./permissions";
import {
  createEntraVerifier,
  createTestIssuerVerifier,
  TokenRejected,
  type VerifiedClaims,
} from "./token-verifiers";

export type Principal = {
  userId: string;
  displayName: string;
  tenantId: string;
  objectId: string;
  issuerKind: "entra" | "test";
  roles: RoleCode[];
  permissions: Set<Permission>;
};

type Verifier = (token: string) => Promise<VerifiedClaims>;
let verifierCache: { key: string; verify: Verifier | null } | null = null;

function getVerifier(): Verifier | null {
  const cfg = getConfig();
  const key = JSON.stringify([cfg.authMode, cfg.testIssuer ? "t" : "", cfg.entra]);
  if (verifierCache?.key === key) return verifierCache.verify;
  let verify: Verifier | null = null;
  if (cfg.authMode === "test" && cfg.testIssuer) verify = createTestIssuerVerifier(cfg.testIssuer.secret);
  if (cfg.authMode === "entra" && cfg.entra) verify = createEntraVerifier(cfg.entra);
  verifierCache = { key, verify };
  return verify;
}

export function resetVerifierForTests() {
  verifierCache = null;
}

export function readBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const m = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header.trim());
  return m ? m[1] : null;
}

export async function authenticate(req: Request): Promise<Principal> {
  const token = readBearer(req);
  if (!token) throw unauthenticated();
  const verify = getVerifier();
  // No valid verifier (e.g. test mode in production, Entra not configured) => nobody can authenticate.
  if (!verify) throw unauthenticated("Authentication is not configured for this environment.");
  let claims: VerifiedClaims;
  try {
    claims = await verify(token);
  } catch (e) {
    if (e instanceof TokenRejected) throw unauthenticated();
    throw e;
  }
  const user = await db().appUser.findUnique({
    where: {
      entraTenantId_entraObjectId: { entraTenantId: claims.tenantId, entraObjectId: claims.objectId },
    },
    include: { roles: true },
  });
  // A valid token without an HRMS account is not authorized: signing in never grants HR access by itself.
  if (!user || !user.isEnabled) throw forbidden("Your account has not been granted access to HRMS.");
  const roles = user.roles.map((r) => r.roleCode).filter(isKnownRole) as RoleCode[];
  return {
    userId: user.id,
    displayName: user.displayName,
    tenantId: claims.tenantId,
    objectId: claims.objectId,
    issuerKind: claims.issuerKind,
    roles,
    permissions: permissionsForRoles(roles),
  };
}
