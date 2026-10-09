import { createHmac } from "node:crypto";
import { getConfig } from "@/lib/config";
import type { Tx } from "@/lib/db";
import { ApiError } from "@/lib/http/errors";

export const IDEMPOTENCY_TTL_HOURS = 24; // MVP Decision (product choice), not a legal requirement

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function readIdempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.");
  }
  if (!KEY_RE.test(key)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Idempotency-Key must be 8-128 characters of [A-Za-z0-9._:-].", [
      { field: "Idempotency-Key", code: "INVALID", message: "Invalid format." },
    ]);
  }
  return key;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Keyed HMAC: the payload is never stored, and personal data is never hashed without a secret key.
export function requestFingerprint(operation: string, payload: unknown): string {
  return createHmac("sha256", getConfig().idempotencyHmacKey)
    .update(`${operation}\n${canonical(payload)}`)
    .digest("hex");
}

export type ClaimResult = { claimed: true } | { claimed: false; resourceId: string; requestHmac: string };

// Claims the key in the SAME transaction as the business write. INSERT ... ON CONFLICT waits for a concurrent
// transaction holding the same key to finish, so only one request actually writes.
export async function claimIdempotencyKey(
  tx: Tx,
  args: { actorUserId: string; operation: string; key: string; requestHmac: string; resourceId: string },
): Promise<ClaimResult> {
  const inserted = await tx.$queryRaw<{ resource_id: string }[]>`
    INSERT INTO idempotency_record (actor_user_id, operation, idempotency_key, request_hmac, resource_id, expires_at)
    VALUES (${args.actorUserId}::uuid, ${args.operation}, ${args.key}, ${args.requestHmac}, ${args.resourceId}::uuid,
            now() + make_interval(hours => ${IDEMPOTENCY_TTL_HOURS}))
    ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING
    RETURNING resource_id`;
  if (inserted.length === 1) return { claimed: true };
  const existing = await tx.$queryRaw<{ resource_id: string; request_hmac: string }[]>`
    SELECT resource_id, request_hmac FROM idempotency_record
    WHERE actor_user_id = ${args.actorUserId}::uuid AND operation = ${args.operation} AND idempotency_key = ${args.key}`;
  return { claimed: false, resourceId: existing[0].resource_id, requestHmac: existing[0].request_hmac };
}
