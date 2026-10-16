// Slice 2A-2 contract evaluation (ADR-0005 §5, §7; M-17, M-19, C-109, C-111). ONE pure module decides, for a contract
// and its context, the computed time state, the Finalize blockers and warnings, the Needs Review items and the
// per-caller allowed actions. The read model (ContractDetail) and the writing services both call it, so what HR is
// shown before an action and what the server enforces can never disagree. It is a fixed list of named checks, not a
// rules framework. Business dates are YYYY-MM-DD strings (Asia/Ho_Chi_Minh); string comparison is date order.
import { createHash } from "node:crypto";
import { addDays } from "@/lib/dates";
import type { Permission } from "@/modules/identity/permissions";
import type { DocumentState } from "./model";

export type PeriodFacts = { id: string; startDate: string; endDate: string | null; cancelled: boolean; voided: boolean };

export type ContractFacts = {
  id: string;
  employmentId: string;
  parentContractId: string | null;
  relationshipType: string | null;
  contractTypeId: string | null;
  contractTypeActive: boolean | null; // null when no type is set
  contractNumber: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isOpenEnded: boolean;
  documentState: DocumentState;
  cancelled: boolean;
  voided: boolean;
};

/** A contract together with its own period, as needed to compare it with others of the same person. */
export type ContractInContext = { contract: ContractFacts; period: PeriodFacts };

export type Finding = { code: string; message: string; field?: string; related_contract_id?: string };

export type TimeState = "upcoming" | "active" | "expired";
export type TimeStateDetail = "closed_by_employment_end" | "replaced_by_renewal" | null;

// ---------------- Codes ----------------
export const WARNING = {
  OVERLAPPING_CONTRACT: "OVERLAPPING_CONTRACT",
  GAP_AFTER_PREDECESSOR: "GAP_AFTER_PREDECESSOR",
  ANOTHER_OPEN_DRAFT_FOR_PERIOD: "ANOTHER_OPEN_DRAFT_FOR_PERIOD",
  CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD: "CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD",
} as const;
export const REVIEW_ONLY = {
  EFFECTIVE_FROM_OUTSIDE_PERIOD: "EFFECTIVE_FROM_OUTSIDE_PERIOD",
  PERIOD_CANCELLED: "PERIOD_CANCELLED",
  PERIOD_VOIDED: "PERIOD_VOIDED",
} as const;

// ---------------- Dispositions and periods ----------------
export const periodValid = (p: PeriodFacts) => !p.cancelled && !p.voided;
export const isOperational = (x: ContractInContext) => !x.contract.cancelled && !x.contract.voided && periodValid(x.period);
const isFinal = (c: ContractFacts) => c.documentState !== "draft";

function periodDisposition(p: PeriodFacts): Finding | null {
  if (p.voided) return { code: REVIEW_ONLY.PERIOD_VOIDED, message: "The linked employment period was voided." };
  if (p.cancelled) return { code: REVIEW_ONLY.PERIOD_CANCELLED, message: "The linked employment period was cancelled." };
  return null;
}

// ---------------- Time state ----------------
const minDate = (...ds: (string | null)[]) => ds.filter((d): d is string => d !== null).sort()[0] ?? null;

/** The live, finalized renewal of an agreement (its start ends the predecessor early). */
function finalizedRenewalOf(c: ContractFacts, others: ContractInContext[]): ContractFacts | null {
  return (
    others.find((o) => o.contract.parentContractId === c.id && o.contract.relationshipType === "renewal" && isOperational(o) && isFinal(o.contract))
      ?.contract ?? null
  );
}

/**
 * Operational end (inclusive) = least(own Effective To, period end, finalized renewal start − 1). Null = no end yet
 * (open-ended on an open period). `ignoreRenewals` is used when judging a predecessor against its own successor.
 */
export function operationalRange(
  x: ContractInContext,
  others: ContractInContext[],
  opts: { ignoreRenewals?: boolean } = {},
): { from: string; end: string | null; detail: TimeStateDetail } | null {
  const c = x.contract;
  if (!c.effectiveFrom) return null;
  const own = c.isOpenEnded ? null : c.effectiveTo;
  const renewal = opts.ignoreRenewals ? null : finalizedRenewalOf(c, others);
  const renewalBound = renewal?.effectiveFrom ? addDays(renewal.effectiveFrom, -1) : null;
  const end = minDate(own, x.period.endDate, renewalBound);
  let detail: TimeStateDetail = null;
  if (end !== null && end !== own) detail = end === renewalBound ? "replaced_by_renewal" : "closed_by_employment_end";
  return { from: c.effectiveFrom, end, detail };
}

export function timeState(
  x: ContractInContext,
  others: ContractInContext[],
  today: string,
): { timeState: TimeState | null; detail: TimeStateDetail; operationalEnd: string | null; daysToOperationalEnd: number | null } {
  const range = isOperational(x) && isFinal(x.contract) ? operationalRange(x, others) : null;
  if (!range) return { timeState: null, detail: null, operationalEnd: null, daysToOperationalEnd: null };
  const state: TimeState = range.from > today ? "upcoming" : range.end !== null && range.end < today ? "expired" : "active";
  const days = range.end === null ? null : Math.round((Date.parse(range.end) - Date.parse(today)) / 86_400_000);
  return { timeState: state, detail: range.detail, operationalEnd: range.end, daysToOperationalEnd: days };
}

// ---------------- Blockers (never overridable, M-19) ----------------
export function finalizeBlockers(x: ContractInContext): Finding[] {
  const c = x.contract;
  const out: Finding[] = [];
  const p = periodDisposition(x.period);
  if (p) out.push({ code: "PERIOD_NOT_VALID", message: p.message });
  if (!c.contractTypeId) out.push({ field: "contract_type_id", code: "REQUIRED", message: "Contract Type is required." });
  else if (c.contractTypeActive === false) out.push({ field: "contract_type_id", code: "CONTRACT_TYPE_INACTIVE", message: "The Contract Type is inactive." });
  if (!c.contractNumber) out.push({ field: "contract_number", code: "REQUIRED", message: "Contract Number is required before Finalize." });
  if (!c.effectiveFrom) out.push({ field: "effective_from", code: "REQUIRED", message: "Effective From is required." });
  if (c.isOpenEnded && c.effectiveTo) out.push({ field: "effective_to", code: "INVALID_TERM", message: "A contract cannot have Effective To and be open-ended." });
  else if (!c.isOpenEnded && !c.effectiveTo) out.push({ field: "effective_to", code: "REQUIRED", message: "Enter Effective To or mark the contract open-ended." });
  if (c.effectiveFrom && c.effectiveTo && c.effectiveTo < c.effectiveFrom) {
    out.push({ field: "effective_to", code: "INVALID_TERM", message: "Effective To cannot be before Effective From." });
  }
  if (c.effectiveFrom && (c.effectiveFrom < x.period.startDate || (x.period.endDate !== null && c.effectiveFrom > x.period.endDate))) {
    out.push({ field: "effective_from", code: "EFFECTIVE_FROM_OUTSIDE_PERIOD", message: "Effective From is outside the linked employment period." });
  }
  return out;
}

// ---------------- Warnings / Needs Review (non-blocking, M-17) ----------------
const overlaps = (a: { from: string; end: string | null }, b: { from: string; end: string | null }) =>
  a.from <= (b.end ?? "9999-12-31") && b.from <= (a.end ?? "9999-12-31");

function dataWarnings(x: ContractInContext, others: ContractInContext[]): Finding[] {
  const c = x.contract;
  const out: Finding[] = [];
  // For a Draft being finalized the range is computed as if it were final.
  const asFinal: ContractInContext = { ...x, contract: { ...c, documentState: c.documentState === "draft" ? "finalized" : c.documentState } };
  const range = operationalRange(asFinal, others);
  if (range) {
    for (const o of others) {
      if (o.contract.id === c.id || !isOperational(o) || !isFinal(o.contract)) continue;
      const linked = o.contract.id === c.parentContractId || o.contract.parentContractId === c.id;
      if (linked) continue; // a renewal replacing its predecessor is intended (C-104)
      const r = operationalRange(o, others);
      if (r && overlaps(range, r)) {
        out.push({ code: WARNING.OVERLAPPING_CONTRACT, message: "Overlaps another contract of this person.", related_contract_id: o.contract.id });
      }
    }
  }
  if (c.relationshipType === "renewal" && c.parentContractId && c.effectiveFrom) {
    const parent = others.find((o) => o.contract.id === c.parentContractId);
    const pr = parent ? operationalRange(parent, others, { ignoreRenewals: true }) : null;
    if (pr?.end && c.effectiveFrom > addDays(pr.end, 1)) {
      out.push({ code: WARNING.GAP_AFTER_PREDECESSOR, message: "There is a gap after the previous contract.", related_contract_id: c.parentContractId });
    }
  }
  if (!c.isOpenEnded && c.effectiveTo && x.period.endDate !== null && c.effectiveTo > x.period.endDate) {
    out.push({ field: "effective_to", code: WARNING.CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD, message: "Effective To is after the end of the employment period." });
  }
  return out;
}

/** Finalize warnings for a Draft (M-19): data warnings plus other open Drafts on the same period. */
export function finalizeWarnings(x: ContractInContext, others: ContractInContext[]): Finding[] {
  const out = dataWarnings(x, others);
  for (const o of others) {
    if (o.contract.id !== x.contract.id && o.contract.employmentId === x.contract.employmentId && o.contract.documentState === "draft" && isOperational(o)) {
      out.push({ code: WARNING.ANOTHER_OPEN_DRAFT_FOR_PERIOD, message: "Another draft contract is open for this employment period.", related_contract_id: o.contract.id });
    }
  }
  return sortFindings(out);
}

/**
 * Needs Review (computed on read; confirming a warning at Finalize never resolves it). Disposed contracts have none.
 * Drafts only surface a lost period; Finalized / Signed contracts also surface the data conditions.
 */
export function reviewItems(x: ContractInContext, others: ContractInContext[]): Finding[] {
  if (x.contract.cancelled || x.contract.voided) return [];
  const out: Finding[] = [];
  const p = periodDisposition(x.period);
  if (p) out.push(p);
  if (isFinal(x.contract)) {
    if (!p) out.push(...dataWarnings(x, others));
    const c = x.contract;
    if (c.effectiveFrom && (c.effectiveFrom < x.period.startDate || (x.period.endDate !== null && c.effectiveFrom > x.period.endDate))) {
      out.push({ field: "effective_from", code: REVIEW_ONLY.EFFECTIVE_FROM_OUTSIDE_PERIOD, message: "Effective From is outside the linked employment period." });
    }
  }
  return sortFindings(out);
}

function sortFindings(fs: Finding[]): Finding[] {
  return [...fs].sort((a, b) => (a.code + (a.related_contract_id ?? "")).localeCompare(b.code + (b.related_contract_id ?? "")));
}

/**
 * M-19 warning fingerprint: a change detector over the warning SET (code + related contract), server-issued and
 * recomputed in the writing transaction. Not a security token — every blocker is re-checked regardless.
 */
export function warningFingerprint(warnings: Finding[]): string | null {
  if (warnings.length === 0) return null;
  const canonical = warnings.map((w) => `${w.code}|${w.related_contract_id ?? ""}`).sort().join("\n");
  return `w1:${createHash("sha256").update(canonical).digest("hex")}`;
}

// ---------------- Allowed actions (per caller) ----------------
export type ActionKey = "edit" | "discard" | "finalize" | "return_to_draft" | "confirm_signed";
export type ActionView = { allowed: boolean; reasons: string[] };

export const ACTION_PERMISSION: Record<ActionKey, Permission> = {
  edit: "contracts.manage",
  discard: "contracts.manage",
  finalize: "contracts.finalize",
  return_to_draft: "contracts.finalize",
  confirm_signed: "contracts.finalize",
};

/** Why an action is not possible in the current state (empty = allowed by state). Permission is added by `actions`. */
export function stateReasons(action: ActionKey, x: ContractInContext, others: ContractInContext[]): string[] {
  const c = x.contract;
  const r: string[] = [];
  if (c.voided) return ["CONTRACT_VOIDED"];
  if (c.cancelled) return ["CONTRACT_CANCELLED"];
  const periodCode = x.period.voided ? REVIEW_ONLY.PERIOD_VOIDED : x.period.cancelled ? REVIEW_ONLY.PERIOD_CANCELLED : null;
  switch (action) {
    case "edit":
      if (c.documentState !== "draft") r.push("NOT_DRAFT");
      if (periodCode) r.push(periodCode);
      break;
    case "discard":
      if (c.documentState !== "draft") r.push("NOT_DRAFT"); // allowed under a cancelled/voided period (cleanup)
      break;
    case "finalize":
      if (c.documentState !== "draft") r.push("NOT_DRAFT");
      else if (periodCode) r.push(periodCode);
      else if (finalizeBlockers(x).length) r.push("NOT_READY");
      break;
    case "return_to_draft":
      if (c.documentState === "signed") r.push("ALREADY_SIGNED");
      else if (c.documentState !== "finalized") r.push("NOT_FINALIZED");
      if (periodCode) r.push(periodCode); // C-109: Cancelled/Voided blocks; Ended never does
      if (others.some((o) => o.contract.parentContractId === c.id && !o.contract.cancelled && !o.contract.voided)) r.push("DEPENDENT_CONTRACTS_EXIST");
      break;
    case "confirm_signed":
      if (c.documentState === "signed") r.push("ALREADY_SIGNED");
      else if (c.documentState !== "finalized") r.push("NOT_FINALIZED");
      if (x.period.voided) r.push(REVIEW_ONLY.PERIOD_VOIDED); // C-111: Cancelled allowed, Voided refused
      break;
  }
  return r;
}

export function actions(x: ContractInContext, others: ContractInContext[], can: (p: Permission) => boolean): Record<ActionKey, ActionView> {
  const keys: ActionKey[] = ["edit", "discard", "finalize", "return_to_draft", "confirm_signed"];
  return Object.fromEntries(
    keys.map((k) => {
      const reasons = [...(can(ACTION_PERMISSION[k]) ? [] : ["PERMISSION_REQUIRED"]), ...stateReasons(k, x, others)];
      return [k, { allowed: reasons.length === 0, reasons }];
    }),
  ) as Record<ActionKey, ActionView>;
}
