// Shared runner for S4 employment commands that take an Idempotency-Key (C-34):
//  - same key + same payload: the action runs once; a retried or concurrent request replays the stored result;
//  - same key + different payload: 409 IDEMPOTENCY_KEY_REUSED, nothing runs;
//  - different keys + same expected_revision: normal optimistic concurrency (409 REVISION_CONFLICT).
// The key is claimed FIRST inside the business transaction, before any revision check, so a concurrent request with the
// same key waits on the claim and then replays instead of failing on the winner's revision bump.
import type { EmployeeDetail } from "@/contracts/core-hr/schemas";
import { db, type Tx } from "@/lib/db";
import { ApiError, type ErrorDetail } from "@/lib/http/errors";
import type { Principal } from "@/modules/identity/authenticate";
import { claimIdempotencyKey, requestFingerprint } from "@/modules/idempotency/idempotency";
import { getEmployee } from "../people/service";

export const rule = (code: string, message: string, details?: ErrorDetail[]) =>
  new ApiError(422, "BUSINESS_RULE_VIOLATION", message, details ?? [{ code, message }]);

export const reasonRequired = (message = "A reason is required for this action.") =>
  new ApiError(422, "BUSINESS_RULE_VIOLATION", message, [{ field: "reason", code: "REASON_REQUIRED", message }]);

export async function runIdempotentCommand(opts: {
  principal: Principal;
  operation: string;
  idempotencyKey: string;
  /** The full request (path ids + body) used for the payload fingerprint. */
  payload: unknown;
  /** Id stored with the key; used to find the owning person on replay. */
  resourceId: string;
  personIdForResource: (resourceId: string) => Promise<string>;
  /** Checks that do not need the transaction (run only for a first execution). */
  precheck?: () => void;
  /** The business write; returns the owning person id. */
  execute: (tx: Tx) => Promise<string>;
  /** Maps database errors to API errors (return nothing to rethrow the original). */
  mapError?: (error: unknown) => ApiError | undefined;
}): Promise<{ replayed: boolean; body: EmployeeDetail }> {
  const { principal, operation, idempotencyKey } = opts;
  const requestHmac = requestFingerprint(operation, opts.payload);
  const replay = async (storedHmac: string, resourceId: string) => {
    if (storedHmac !== requestHmac) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different payload.");
    }
    return { replayed: true, body: await getEmployee(principal, await opts.personIdForResource(resourceId)) };
  };

  // Fast path: a completed request is replayed without re-running business validation.
  const prior = await db().idempotencyRecord.findUnique({
    where: { actorUserId_operation_idempotencyKey: { actorUserId: principal.userId, operation, idempotencyKey } },
  });
  if (prior) return replay(prior.requestHmac, prior.resourceId);

  opts.precheck?.();
  let personId: string;
  try {
    personId = await db().$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, {
        actorUserId: principal.userId,
        operation,
        key: idempotencyKey,
        requestHmac,
        resourceId: opts.resourceId,
      });
      if (!claim.claimed) throw new ReplayDetected(claim.requestHmac, claim.resourceId);
      return opts.execute(tx);
    });
  } catch (error) {
    if (error instanceof ReplayDetected) return replay(error.storedHmac, error.resourceId);
    const mapped = opts.mapError?.(error);
    if (mapped) throw mapped;
    throw error;
  }
  return { replayed: false, body: await getEmployee(principal, personId) };
}

class ReplayDetected extends Error {
  constructor(
    public readonly storedHmac: string,
    public readonly resourceId: string,
  ) {
    super("idempotent replay");
  }
}

export async function personIdForAssignment(assignmentId: string): Promise<string> {
  const a = await db().jobAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { employment: true } });
  return a.employment.personId;
}

export async function personIdForEmployment(employmentId: string): Promise<string> {
  return (await db().employment.findUniqueOrThrow({ where: { id: employmentId } })).personId;
}
