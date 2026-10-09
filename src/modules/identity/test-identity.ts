import { z } from "zod";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/http/handler";
import { notFound, validationError } from "@/lib/http/errors";
import { isKnownRole } from "./permissions";
import { mintTestToken, TEST_ISSUER, TEST_TENANT_ID } from "./token-verifiers";

// Development test identity, local/test ONLY. When not allowed (production, flag off...) these endpoints return 404
// and the test verifier is never created, so test tokens are rejected too.
// The browser only picks ONE seeded test account; roles are always read from the database, never from the client.

const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export async function listTestUsers(): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    if (!getConfig().testIssuer) throw notFound();
    const users = await db().appUser.findMany({
      where: { entraTenantId: TEST_TENANT_ID, isEnabled: true },
      include: { roles: true },
      orderBy: { displayName: "asc" },
    });
    return new Response(
      JSON.stringify({
        data: users.map((u) => ({
          object_id: u.entraObjectId,
          display_name: u.displayName,
          roles: u.roles.map((r) => r.roleCode).filter(isKnownRole),
        })),
      }),
      { headers },
    );
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

const bodySchema = z.strictObject({ object_id: z.uuid() });

export async function issueTestToken(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const cfg = getConfig();
    if (!cfg.testIssuer) throw notFound();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw validationError([{ field: "object_id", code: "INVALID", message: "object_id must be a UUID." }]);
    const user = await db().appUser.findUnique({
      where: { entraTenantId_entraObjectId: { entraTenantId: TEST_TENANT_ID, entraObjectId: parsed.data.object_id } },
    });
    if (!user) throw notFound("Unknown test account.");
    const expiresIn = 3600;
    const token = await mintTestToken(cfg.testIssuer.secret, { objectId: user.entraObjectId, expiresInSeconds: expiresIn });
    return new Response(
      JSON.stringify({
        access_token: token,
        token_type: "Bearer",
        expires_in: expiresIn,
        issuer: TEST_ISSUER,
        notice: "Token from the local development test issuer. This is NOT Microsoft Entra ID.",
      }),
      { headers },
    );
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
