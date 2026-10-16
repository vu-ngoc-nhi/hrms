// Slice 2A-6: Add Employee + optional Contract Draft. The wizard looks like one flow, but the backend stays two
// INDEPENDENT operations — there is no combined transaction and no rollback of the employee:
//   1. POST /employees          — the existing atomic Add Employee (its own Idempotency-Key);
//   2. POST /contracts          — only after (1) succeeded and only if a Contract Draft was requested, linked to the
//                                 Employment Period id RETURNED by (1) (its own, separate Idempotency-Key).
// A failure of (2) is a partial success: the employee stays created; "Retry Contract Draft" repeats (2) only, with the
// same contract key, so an uncertain earlier attempt is resolved by the server's idempotency, never by guessing.
import { ApiCallError } from "@/lib/client/api";

/** POST with an Idempotency-Key; resolves to the response body, rejects with ApiCallError or a network error. */
export type PostFn = (path: string, body: string, idempotencyKey: string) => Promise<unknown>;

export const EMPLOYEES_PATH = "/api/v1/core-hr/employees";
export const CONTRACTS_PATH = "/api/v1/core-hr/contracts";

type CreatedEmployee = { id: string; employments?: { id: string; start_date: string; cancelled_at?: string | null; voided_at?: string | null }[] };

/**
 * The Employment Period created by THIS Add Employee request, from the server's response: the only period of the new
 * person, starting on the requested Start Date. Anything else → null (the Contract Draft is then not attempted; the
 * period is never inferred from dates or status later).
 */
export function createdPeriodId(created: CreatedEmployee, startDate: string): string | null {
  const periods = (created.employments ?? []).filter((e) => !e.cancelled_at && !e.voided_at);
  return periods.length === 1 && periods[0].start_date === startDate ? periods[0].id : null;
}

export type ContractAttempt =
  | { status: "created"; contractId: string }
  /** `uncertain`: no answer (network / server error) — retrying with the same key is safe. `keyUsed`: an earlier
   *  attempt with this key was already processed (a draft may exist); HR checks the employee's Contracts tab. */
  | { status: "failed"; error: ApiCallError | null; uncertain: boolean; keyUsed: boolean }
  /** The response did not identify exactly one new Employment Period; nothing was sent. */
  | { status: "no_period" };

export type OnboardingOutcome =
  | { kind: "employee_failed"; error: unknown }
  | { kind: "employee_created"; personId: string; employmentId: string | null; contract: ContractAttempt | null };

/** Step 2 only: create the Contract Draft. Also used by "Retry Contract Draft" — it never touches the employee. */
export async function createContractDraft(post: PostFn, body: Record<string, unknown>, contractKey: string): Promise<ContractAttempt> {
  try {
    const r = (await post(CONTRACTS_PATH, JSON.stringify(body), contractKey)) as { id: string };
    return { status: "created", contractId: r.id };
  } catch (err) {
    if (!(err instanceof ApiCallError)) return { status: "failed", error: null, uncertain: true, keyUsed: false };
    return { status: "failed", error: err, uncertain: err.status >= 500, keyUsed: err.body?.error === "IDEMPOTENCY_KEY_REUSED" };
  }
}

/**
 * Step 1, then (only on success and only when requested) step 2. `contract.body` receives the server-returned
 * Employment Period id. The two keys must differ: they are separate idempotency scopes.
 */
export async function submitOnboarding(
  post: PostFn,
  input: {
    employeePayload: string;
    employeeKey: string;
    startDate: string;
    contract: null | { key: string; body: (employmentId: string) => Record<string, unknown> };
  },
): Promise<OnboardingOutcome> {
  if (input.contract && input.contract.key === input.employeeKey) throw new Error("Employee and Contract requests need separate Idempotency-Keys.");
  let created: CreatedEmployee;
  try {
    created = (await post(EMPLOYEES_PATH, input.employeePayload, input.employeeKey)) as CreatedEmployee;
  } catch (error) {
    return { kind: "employee_failed", error }; // no Contract request is made
  }
  const employmentId = input.startDate ? createdPeriodId(created, input.startDate) : null;
  if (!input.contract) return { kind: "employee_created", personId: created.id, employmentId, contract: null };
  if (!employmentId) return { kind: "employee_created", personId: created.id, employmentId, contract: { status: "no_period" } };
  return { kind: "employee_created", personId: created.id, employmentId, contract: await createContractDraft(post, input.contract.body(employmentId), input.contract.key) };
}
