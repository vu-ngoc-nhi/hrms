// Slice 2A-2 — core contract lifecycle (ADR-0005; docs/design/phase2a-slice-2a-2-lifecycle.md; M-15 … M-19,
// C-109 … C-111). Create / read / edit / discard a Draft, Finalize (with the M-19 warning confirmation), controlled
// Return to Draft, Confirm Signed and the contract history.
//  - Every write: one transaction; the contract row is locked FOR UPDATE and `expected_revision` checked (contract's
//    own aggregate revision — person.revision is untouched, M-11); revision + 1; one audit event; lifecycle actions
//    add one business history event. Lifecycle POSTs take an Idempotency-Key claimed inside the transaction, so a
//    rejected request (blocker, confirmation required, conflict) leaves the key unused.
//  - State rules come from evaluation.ts (`stateReasons`), the same module that projects the allowed actions, so the
//    preview and the enforcement cannot disagree. The database triggers stay the final backstop.
//  - Contracts never change employment, assignment or person data.
import { randomUUID } from "node:crypto";
import type {
  ContractConfirmSignedInput,
  ContractCreateInput,
  ContractDetail,
  ContractDiscardInput,
  ContractFinalizeInput,
  ContractReturnToDraftInput,
  ContractUpdateInput,
} from "@/contracts/core-hr/schemas";
import { fromDbDate, todayInVietnam, toDbDate } from "@/lib/dates";
import { db, pgErrorInfo, type Tx } from "@/lib/db";
import { ApiError, notFound, type ErrorDetail } from "@/lib/http/errors";
import { recordAudit, type StructuralChange } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { claimIdempotencyKey, requestFingerprint } from "@/modules/idempotency/idempotency";
import {
  actions,
  finalizeBlockers,
  finalizeWarnings,
  reviewItems,
  stateReasons,
  timeState,
  warningFingerprint,
  type ActionKey,
  type ContractInContext,
  type Finding,
} from "./evaluation";
import { documentState, isSignedDateAllowed, normalizeContractNumber } from "./model";
import { contractDisposition, contractDispositionFlags, markContractDiscarded, periodFacts } from "./queries";

type Client = Tx | ReturnType<typeof db>;

// ---------------- Loading ----------------
const CONTEXT_INCLUDE = { contractType: true, employment: true } as const;

async function loadContext(client: Client, id: string) {
  const row = await client.contract.findUnique({
    where: { id },
    include: { contractType: true, employment: { include: { person: true, employeeType: true } } },
  });
  if (!row) throw notFound("Contract not found.");
  // Every contract of the same person: overlap is person-wide, renewals and drafts are period-wide.
  const siblings = await client.contract.findMany({ where: { employment: { personId: row.employment.personId } }, include: CONTEXT_INCLUDE });
  const facts = (r: (typeof siblings)[number]): ContractInContext => ({
    contract: {
      id: r.id,
      employmentId: r.employmentId,
      parentContractId: r.parentContractId,
      relationshipType: r.relationshipType,
      contractTypeId: r.contractTypeId,
      contractTypeActive: r.contractType ? r.contractType.isActive : null,
      contractNumber: r.contractNumber,
      effectiveFrom: fromDbDate(r.effectiveFrom),
      effectiveTo: fromDbDate(r.effectiveTo),
      isOpenEnded: r.isOpenEnded,
      documentState: documentState(r),
      ...contractDispositionFlags(r),
    },
    period: periodFacts(r.employment),
  });
  const self = facts(siblings.find((s) => s.id === id)!);
  const others = siblings.filter((s) => s.id !== id).map(facts);
  return { row, x: self, others };
}
type Context = Awaited<ReturnType<typeof loadContext>>;

async function lockForWrite(tx: Tx, id: string, expectedRevision: number): Promise<void> {
  const rows = await tx.$queryRaw<{ revision: number }[]>`SELECT revision FROM contract WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound("Contract not found.");
  if (rows[0].revision !== expectedRevision) {
    throw new ApiError(409, "REVISION_CONFLICT", "The contract was changed by someone else. Reload it and try again.", [
      { field: "expected_revision", code: "STALE", message: `Current revision is ${rows[0].revision}.` },
    ]);
  }
}

// ---------------- Projection (server-authoritative representation) ----------------
async function actorNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => i !== null))];
  if (wanted.length === 0) return new Map();
  const users = await db().appUser.findMany({ where: { id: { in: wanted } }, select: { id: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName]));
}
const actor = (names: Map<string, string>, id: string | null) => (id ? { user_id: id, display_name: names.get(id) ?? "Unknown user" } : null);

async function project(principal: Principal, ctx: Context, today: string): Promise<ContractDetail> {
  const { row, x, others } = ctx;
  const names = await actorNames([row.createdBy, row.finalizedBy]);
  const ts = timeState(x, others, today);
  const review = reviewItems(x, others);
  const isDraftOpen = x.contract.documentState === "draft" && !x.contract.cancelled && !x.contract.voided;
  const blockers = isDraftOpen ? finalizeBlockers(x) : [];
  const warnings = isDraftOpen ? finalizeWarnings(x, others) : [];
  const renewal = others.find((o) => o.contract.parentContractId === row.id && o.contract.relationshipType === "renewal" && !o.contract.cancelled && !o.contract.voided);
  const e = row.employment;
  return {
    id: row.id,
    revision: row.revision,
    as_of: today,
    employee: { person_id: e.person.id, employee_code: e.person.employeeCode, full_name: e.person.fullName },
    employment: {
      id: e.id,
      start_date: fromDbDate(e.startDate),
      end_date: fromDbDate(e.endDate),
      disposition: x.period.voided ? "voided" : x.period.cancelled ? "cancelled" : null,
      employee_type: e.employeeType ? { id: e.employeeType.id, code: e.employeeType.code, name: e.employeeType.name } : null,
    },
    contract_type: row.contractType
      ? { id: row.contractType.id, code: row.contractType.code, name: row.contractType.name, name_vi: row.contractType.nameVi, is_active: row.contractType.isActive }
      : null,
    contract_number: row.contractNumber,
    effective_from: fromDbDate(row.effectiveFrom),
    effective_to: fromDbDate(row.effectiveTo),
    is_open_ended: row.isOpenEnded,
    summary: row.summary,
    signed_at: fromDbDate(row.signedAt),
    relationship: {
      type: row.relationshipType === "renewal" ? "renewal" : null,
      parent_id: row.parentContractId,
      renewal_id: renewal?.contract.id ?? null,
    },
    state: {
      document_state: x.contract.documentState,
      disposition: contractDisposition(row),
      operational: !x.contract.cancelled && !x.contract.voided && !x.period.cancelled && !x.period.voided,
      time_state: ts.timeState,
      time_state_detail: ts.detail,
      operational_end: ts.operationalEnd,
      days_to_operational_end: ts.daysToOperationalEnd,
    },
    review: { needs_review: review.length > 0, items: review },
    finalize_check: isDraftOpen
      ? { ready: blockers.length === 0, blockers, warnings, warning_fingerprint: warningFingerprint(warnings) }
      : null,
    actions: actions(x, others, (p) => principal.permissions.has(p)),
    finalized_at: row.finalizedAt?.toISOString() ?? null,
    finalized_by: actor(names, row.finalizedBy),
    created_at: row.createdAt.toISOString(),
    created_by: actor(names, row.createdBy),
  };
}

export async function getContract(principal: Principal, id: string): Promise<ContractDetail> {
  return project(principal, await loadContext(db(), id), todayInVietnam());
}

export async function listContractHistory(id: string) {
  if (!(await db().contract.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Contract not found.");
  const events = await db().contractHistoryEvent.findMany({ where: { contractId: id }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });
  const names = await actorNames(events.map((e) => e.recordedBy));
  return {
    data: events.map((e) => ({
      event_type: e.eventType,
      effective_date: fromDbDate(e.effectiveDate),
      recorded_at: e.recordedAt.toISOString(),
      recorded_by: actor(names, e.recordedBy),
      reason: e.reason,
      related_contract_id: e.relatedContractId,
    })),
  };
}

// ---------------- Errors ----------------
const fail = (status: number, code: ConstructorParameters<typeof ApiError>[1], message: string, details?: ErrorDetail[]) =>
  new ApiError(status, code, message, details ?? [{ code, message }]);

/** Maps the first state reason of an action (evaluation.ts) to the API error. */
function assertAllowed(action: ActionKey, ctx: Context): void {
  const [reason] = stateReasons(action, ctx.x, ctx.others);
  if (!reason) return;
  switch (reason) {
    case "CONTRACT_CANCELLED":
    case "CONTRACT_VOIDED":
      throw fail(409, "CONTRACT_READ_ONLY", "This contract is cancelled or voided and is read-only history.", [{ code: reason, message: "Cancelled or voided." }]);
    case "NOT_DRAFT":
      throw fail(409, "CONTRACT_NOT_DRAFT", "Only a Draft can be changed this way.", [{ code: reason, message: "The contract is not a Draft." }]);
    case "NOT_FINALIZED":
    case "ALREADY_SIGNED":
      throw fail(409, "CONTRACT_STATE_CONFLICT", reason === "ALREADY_SIGNED" ? "The contract is already Signed." : "The contract is not Finalized.", [
        { code: reason, message: reason === "ALREADY_SIGNED" ? "Already Signed." : "Not Finalized." },
      ]);
    case "PERIOD_CANCELLED":
    case "PERIOD_VOIDED":
      throw fail(422, "PERIOD_NOT_VALID", `The linked employment period is ${reason === "PERIOD_VOIDED" ? "voided" : "cancelled"}; this action is not available.`, [
        { field: "employment_id", code: reason, message: reason === "PERIOD_VOIDED" ? "The employment period was voided." : "The employment period was cancelled." },
      ]);
    case "DEPENDENT_CONTRACTS_EXIST":
      throw fail(409, "DEPENDENT_CONTRACTS_EXIST", "A renewal depends on this contract. Discard or cancel it first.");
    case "NOT_READY":
      throw fail(422, "CONTRACT_NOT_READY", "The contract is not ready to finalize.", finalizeBlockers(ctx.x));
    default:
      throw fail(422, "BUSINESS_RULE_VIOLATION", "This action is not available.", [{ code: reason, message: reason }]);
  }
}

/** Database backstop → API error (the service checks first; anything unexpected stays a 500). */
function mapDbError(error: unknown): ApiError | undefined {
  const info = pgErrorInfo(error);
  if (info.constraint === "contract_number_ci_uq" || (info.sqlState === "23505" && String(error).includes("contract_number"))) {
    return fail(409, "DUPLICATE_CONTRACT_NUMBER", "This Contract Number is already used by another contract (compared without case).", [
      { field: "contract_number", code: "DUPLICATE", message: "Contract Number already used." },
    ]);
  }
  switch (info.constraint) {
    case "contract_effective_from_within_period":
      return fail(422, "EFFECTIVE_FROM_OUTSIDE_PERIOD", "Effective From is outside the linked employment period.", [
        { field: "effective_from", code: "EFFECTIVE_FROM_OUTSIDE_PERIOD", message: "Outside the employment period." },
      ]);
    case "contract_period_valid":
    case "contract_voided_parent_read_only":
      return fail(422, "PERIOD_NOT_VALID", "The linked employment period is cancelled or voided.");
    case "contract_term_exclusive_ck":
    case "contract_dates_ck":
      return fail(422, "INVALID_TERM", "Effective To and Open-ended are inconsistent.", [{ field: "effective_to", code: "INVALID_TERM", message: "Invalid term." }]);
    case "contract_disposition_is_terminal":
      return fail(409, "CONTRACT_READ_ONLY", "This contract is cancelled or voided and is read-only history.");
  }
  return undefined;
}

// ---------------- Draft field handling ----------------
type DraftValues = {
  contractTypeId: string | null;
  contractNumber: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isOpenEnded: boolean;
  summary: string | null;
};

const normalizeSummary = (s: string | null | undefined) => (s == null ? null : s.trim() === "" ? null : s.trim());

/** Objectively invalid Draft values (missing values are allowed in a Draft). */
async function assertDraftValues(client: Client, v: DraftValues, period: { startDate: string; endDate: string | null }, typeChanged: boolean) {
  if (v.contractTypeId && typeChanged) {
    const type = await client.contractType.findUnique({ where: { id: v.contractTypeId } });
    if (!type) throw notFound("Contract Type not found.");
    if (!type.isActive) {
      throw fail(422, "CONTRACT_TYPE_INACTIVE", "The Contract Type is inactive and cannot be chosen.", [{ field: "contract_type_id", code: "CONTRACT_TYPE_INACTIVE", message: "Inactive." }]);
    }
  }
  if (v.isOpenEnded && v.effectiveTo) {
    throw fail(422, "INVALID_TERM", "A contract cannot have Effective To and be open-ended.", [{ field: "effective_to", code: "INVALID_TERM", message: "Choose Effective To or Open-ended." }]);
  }
  if (v.effectiveFrom && v.effectiveTo && v.effectiveTo < v.effectiveFrom) {
    throw fail(422, "INVALID_TERM", "Effective To cannot be before Effective From.", [{ field: "effective_to", code: "INVALID_TERM", message: "Before Effective From." }]);
  }
  if (v.effectiveFrom && (v.effectiveFrom < period.startDate || (period.endDate !== null && v.effectiveFrom > period.endDate))) {
    throw fail(422, "EFFECTIVE_FROM_OUTSIDE_PERIOD", "Effective From is outside the linked employment period.", [
      { field: "effective_from", code: "EFFECTIVE_FROM_OUTSIDE_PERIOD", message: "Outside the employment period." },
    ]);
  }
}

const dbDraftData = (v: DraftValues) => ({
  contractTypeId: v.contractTypeId,
  contractNumber: v.contractNumber,
  effectiveFrom: v.effectiveFrom ? toDbDate(v.effectiveFrom) : null,
  effectiveTo: v.effectiveTo ? toDbDate(v.effectiveTo) : null,
  isOpenEnded: v.isOpenEnded,
  summary: v.summary,
});

const STRUCTURAL: { key: keyof DraftValues; field: StructuralChange["field"] }[] = [
  { key: "contractTypeId", field: "contract.contract_type_id" },
  { key: "contractNumber", field: "contract.contract_number" },
  { key: "effectiveFrom", field: "contract.effective_from" },
  { key: "effectiveTo", field: "contract.effective_to" },
  { key: "isOpenEnded", field: "contract.is_open_ended" },
];
const API_NAME: Record<keyof DraftValues, string> = {
  contractTypeId: "contract_type_id",
  contractNumber: "contract_number",
  effectiveFrom: "effective_from",
  effectiveTo: "effective_to",
  isOpenEnded: "is_open_ended",
  summary: "summary",
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ---------------- Idempotent command runner ----------------
async function runCommand(opts: {
  principal: Principal;
  operation: string;
  idempotencyKey: string;
  payload: unknown;
  contractId: string;
  execute: (tx: Tx) => Promise<void>;
}): Promise<{ replayed: boolean; body: ContractDetail }> {
  const { principal, operation, idempotencyKey } = opts;
  const requestHmac = requestFingerprint(operation, opts.payload);
  const replay = async (storedHmac: string, resourceId: string) => {
    if (storedHmac !== requestHmac) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different payload.");
    return { replayed: true, body: await getContract(principal, resourceId) };
  };
  const prior = await db().idempotencyRecord.findUnique({
    where: { actorUserId_operation_idempotencyKey: { actorUserId: principal.userId, operation, idempotencyKey } },
  });
  if (prior) return replay(prior.requestHmac, prior.resourceId);
  try {
    await db().$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, { actorUserId: principal.userId, operation, key: idempotencyKey, requestHmac, resourceId: opts.contractId });
      if (!claim.claimed) throw new ReplayDetected(claim.requestHmac, claim.resourceId);
      await opts.execute(tx);
    });
  } catch (error) {
    if (error instanceof ReplayDetected) return replay(error.storedHmac, error.resourceId);
    throw mapDbError(error) ?? error;
  }
  return { replayed: false, body: await getContract(principal, opts.contractId) };
}

class ReplayDetected extends Error {
  constructor(
    public readonly storedHmac: string,
    public readonly resourceId: string,
  ) {
    super("idempotent replay");
  }
}

const audit = (tx: Tx, principal: Principal, requestId: string, action: string, contractId: string, extra: { changedFields?: string[]; reason?: string | null; structuralChanges?: StructuralChange[] } = {}) =>
  recordAudit({ actorUserId: principal.userId, action, outcome: "success", entityType: "contract", entityId: contractId, requestId, ...extra }, tx);

const history = (tx: Tx, principal: Principal, contractId: string, eventType: string, at: Date, extra: { reason?: string | null; effectiveDate?: string | null } = {}) =>
  tx.contractHistoryEvent.create({
    data: {
      contractId,
      eventType,
      recordedAt: at,
      recordedBy: principal.userId,
      reason: extra.reason ?? null,
      effectiveDate: extra.effectiveDate ? toDbDate(extra.effectiveDate) : null,
    },
  });

// ---------------- Commands ----------------
export async function createContract(principal: Principal, input: ContractCreateInput, idempotencyKey: string, requestId: string) {
  const contractId = randomUUID();
  const values: DraftValues = {
    contractTypeId: input.contract_type_id ?? null,
    contractNumber: normalizeContractNumber(input.contract_number),
    effectiveFrom: input.effective_from ?? null,
    effectiveTo: input.effective_to ?? null,
    isOpenEnded: input.is_open_ended ?? false,
    summary: normalizeSummary(input.summary),
  };
  return runCommand({
    principal,
    operation: "createContract",
    idempotencyKey,
    payload: input,
    contractId,
    execute: async (tx) => {
      const period = await tx.employment.findUnique({ where: { id: input.employment_id } });
      if (!period) throw notFound("Employment period not found.");
      const facts = periodFacts(period);
      if (facts.cancelled || facts.voided) {
        const code = facts.voided ? "PERIOD_VOIDED" : "PERIOD_CANCELLED";
        throw fail(422, "PERIOD_NOT_VALID", "Contracts cannot be created on a cancelled or voided employment period.", [
          { field: "employment_id", code, message: "The employment period is not valid." },
        ]);
      }
      await assertDraftValues(tx, values, facts, true);
      const at = new Date();
      await tx.contract.create({ data: { id: contractId, employmentId: period.id, createdBy: principal.userId, createdAt: at, updatedAt: at, ...dbDraftData(values) } });
      await history(tx, principal, contractId, "created", at);
      const provided = (Object.keys(API_NAME) as (keyof DraftValues)[]).filter((k) => values[k] !== null && values[k] !== false);
      await audit(tx, principal, requestId, "contract.create", contractId, {
        changedFields: ["employment_id", ...provided.map((k) => API_NAME[k])],
        structuralChanges: STRUCTURAL.filter((s) => provided.includes(s.key)).map((s) => ({ field: s.field, oldValue: null, newValue: str(values[s.key]) })),
      });
    },
  });
}

export async function updateContractDraft(principal: Principal, id: string, input: ContractUpdateInput, requestId: string): Promise<ContractDetail> {
  try {
    await db().$transaction(async (tx) => {
      await lockForWrite(tx, id, input.expected_revision);
      const ctx = await loadContext(tx, id);
      assertAllowed("edit", ctx);
      const c = ctx.x.contract;
      const current: DraftValues = {
        contractTypeId: c.contractTypeId,
        contractNumber: c.contractNumber,
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
        isOpenEnded: c.isOpenEnded,
        summary: ctx.row.summary,
      };
      const next: DraftValues = {
        contractTypeId: input.contract_type_id !== undefined ? input.contract_type_id : current.contractTypeId,
        contractNumber: input.contract_number !== undefined ? normalizeContractNumber(input.contract_number) : current.contractNumber,
        effectiveFrom: input.effective_from !== undefined ? input.effective_from : current.effectiveFrom,
        effectiveTo: input.effective_to !== undefined ? input.effective_to : current.effectiveTo,
        isOpenEnded: input.is_open_ended ?? current.isOpenEnded,
        summary: input.summary !== undefined ? normalizeSummary(input.summary) : current.summary,
      };
      const changed = (Object.keys(API_NAME) as (keyof DraftValues)[]).filter((k) => next[k] !== current[k]);
      if (changed.length === 0) return; // no-op: no revision bump, no audit (Phase 1 PATCH convention)
      await assertDraftValues(tx, next, ctx.x.period, changed.includes("contractTypeId"));
      const at = new Date();
      await tx.contract.update({ where: { id }, data: { ...dbDraftData(next), revision: { increment: 1 }, updatedAt: at } });
      await audit(tx, principal, requestId, "contract.update_draft", id, {
        changedFields: changed.map((k) => API_NAME[k]),
        structuralChanges: STRUCTURAL.filter((s) => changed.includes(s.key)).map((s) => ({ field: s.field, oldValue: str(current[s.key]), newValue: str(next[s.key]) })),
      });
    });
  } catch (error) {
    throw mapDbError(error) ?? error;
  }
  return getContract(principal, id);
}

export async function discardContract(principal: Principal, id: string, input: ContractDiscardInput, idempotencyKey: string, requestId: string) {
  const reason = normalizeSummary(input.reason);
  return runCommand({
    principal,
    operation: "createContractDiscard",
    idempotencyKey,
    payload: { id, ...input },
    contractId: id,
    execute: async (tx) => {
      await lockForWrite(tx, id, input.expected_revision);
      const ctx = await loadContext(tx, id);
      assertAllowed("discard", ctx); // allowed under a cancelled/voided period (cleanup)
      const at = new Date();
      await markContractDiscarded(tx, id, at);
      await history(tx, principal, id, "discarded", at, { reason });
      await audit(tx, principal, requestId, "contract.discard", id, { changedFields: ["contract.cancelled"], reason });
    },
  });
}

/**
 * M-19: blockers are never overridable; with warnings the server answers 409 FINALIZE_CONFIRMATION_REQUIRED (current
 * warnings + fingerprint, nothing changed) unless the request carries the fingerprint of exactly the current warning
 * set. Everything is recomputed inside the writing transaction. No acknowledgement record is kept.
 */
export async function finalizeContract(principal: Principal, id: string, input: ContractFinalizeInput, idempotencyKey: string, requestId: string) {
  return runCommand({
    principal,
    operation: "createContractFinalize",
    idempotencyKey,
    payload: { id, ...input },
    contractId: id,
    execute: async (tx) => {
      await lockForWrite(tx, id, input.expected_revision);
      const ctx = await loadContext(tx, id);
      assertAllowed("finalize", ctx); // includes NOT_READY → 422 CONTRACT_NOT_READY with the blockers
      const warnings: Finding[] = finalizeWarnings(ctx.x, ctx.others);
      const fingerprint = warningFingerprint(warnings);
      if (fingerprint !== null && input.confirmed_warning_fingerprint !== fingerprint) {
        throw new ApiError(
          409,
          "FINALIZE_CONFIRMATION_REQUIRED",
          input.confirmed_warning_fingerprint
            ? "The warnings changed since they were reviewed. Review them again before finalizing."
            : "Review the warnings before finalizing.",
          warnings,
          { warning_fingerprint: fingerprint },
        );
      }
      const at = new Date();
      await tx.contract.update({ where: { id }, data: { finalizedAt: at, finalizedBy: principal.userId, revision: { increment: 1 }, updatedAt: at } });
      await history(tx, principal, id, "finalized", at);
      await audit(tx, principal, requestId, "contract.finalize", id, {
        changedFields: ["contract.finalized_at"],
        structuralChanges: [{ field: "contract.finalized_at", oldValue: null, newValue: at.toISOString() }],
      });
    },
  });
}

export async function returnContractToDraft(principal: Principal, id: string, input: ContractReturnToDraftInput, idempotencyKey: string, requestId: string) {
  const reason = input.reason.trim();
  if (!reason) throw fail(422, "REASON_REQUIRED", "A reason is required to return a contract to Draft.", [{ field: "reason", code: "REASON_REQUIRED", message: "Required." }]);
  return runCommand({
    principal,
    operation: "createContractReturnToDraft",
    idempotencyKey,
    payload: { id, ...input },
    contractId: id,
    execute: async (tx) => {
      await lockForWrite(tx, id, input.expected_revision);
      const ctx = await loadContext(tx, id);
      assertAllowed("return_to_draft", ctx); // C-109: not Signed; period not Cancelled/Voided (Ended is fine); no dependants
      const at = new Date();
      await tx.contract.update({ where: { id }, data: { finalizedAt: null, finalizedBy: null, revision: { increment: 1 }, updatedAt: at } });
      await history(tx, principal, id, "returned_to_draft", at, { reason });
      await audit(tx, principal, requestId, "contract.return_to_draft", id, {
        changedFields: ["contract.finalized_at"],
        reason,
        structuralChanges: [{ field: "contract.finalized_at", oldValue: ctx.row.finalizedAt?.toISOString() ?? null, newValue: null }],
      });
    },
  });
}

export async function confirmContractSigned(principal: Principal, id: string, input: ContractConfirmSignedInput, idempotencyKey: string, requestId: string) {
  return runCommand({
    principal,
    operation: "createContractSignatureConfirmation",
    idempotencyKey,
    payload: { id, ...input },
    contractId: id,
    execute: async (tx) => {
      await lockForWrite(tx, id, input.expected_revision);
      const ctx = await loadContext(tx, id);
      assertAllowed("confirm_signed", ctx); // C-111: a Cancelled period allows it, a Voided period refuses it
      const today = todayInVietnam();
      if (!isSignedDateAllowed(input.signed_at, today)) {
        throw fail(422, "SIGNED_AT_IN_FUTURE", `The signature date cannot be after today (${today}, Asia/Ho_Chi_Minh).`, [
          { field: "signed_at", code: "SIGNED_AT_IN_FUTURE", message: "Future date." },
        ]);
      }
      const at = new Date();
      await tx.contract.update({ where: { id }, data: { signedAt: toDbDate(input.signed_at), revision: { increment: 1 }, updatedAt: at } });
      await history(tx, principal, id, "signed_confirmed", at, { effectiveDate: input.signed_at });
      await audit(tx, principal, requestId, "contract.confirm_signed", id, {
        changedFields: ["contract.signed_at"],
        structuralChanges: [{ field: "contract.signed_at", oldValue: null, newValue: input.signed_at }],
      });
    },
  });
}
