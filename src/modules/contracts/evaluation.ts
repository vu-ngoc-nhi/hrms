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

/**
 * A blocker / warning / review item. `related_contract_number`, `affected_from` and `affected_to` are presentation
 * facts computed here (owner acceptance fix) so the UI can name the other contract and the dates concerned without
 * re-deriving any rule. `affected_from` / `affected_to` are authoritative facts and are part of the M-19 warning
 * fingerprint (C-120); `related_contract_number` and `message` are presentation and never are.
 */
export type Finding = {
  code: string;
  message: string;
  field?: string;
  related_contract_id?: string;
  related_contract_number?: string | null;
  affected_from?: string;
  affected_to?: string | null;
};

export type TimeState = "upcoming" | "active" | "expired";
export type TimeStateDetail = "closed_by_employment_end" | "replaced_by_renewal" | null;

// ---------------- Codes ----------------
export const WARNING = {
  OVERLAPPING_CONTRACT: "OVERLAPPING_CONTRACT",
  GAP_AFTER_PREDECESSOR: "GAP_AFTER_PREDECESSOR",
  ANOTHER_OPEN_DRAFT_FOR_PERIOD: "ANOTHER_OPEN_DRAFT_FOR_PERIOD",
  CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD: "CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD",
  RENEWAL_OVERLAPS_PREDECESSOR: "RENEWAL_OVERLAPS_PREDECESSOR",
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

/**
 * The non-disposed direct renewal of an agreement — Draft, Finalized or Signed (C-115: one non-disposed direct renewal
 * per parent agreement; disposed = Discarded, Cancelled or Voided).
 */
export function directRenewalOf(c: ContractFacts, others: ContractInContext[]): ContractFacts | null {
  return others.find((o) => o.contract.parentContractId === c.id && o.contract.relationshipType === "renewal" && !o.contract.cancelled && !o.contract.voided)?.contract ?? null;
}

/**
 * C-115: only a SIGNED non-disposed direct renewal is the confirmed successor. A Draft or a Finalized-but-unsigned
 * renewal has no effect on the parent's projection or reminders (Finalized ≠ confirmed).
 */
function confirmedSuccessorOf(c: ContractFacts, others: ContractInContext[]): ContractFacts | null {
  const r = directRenewalOf(c, others);
  return r && r.documentState === "signed" ? r : null;
}

/**
 * Operational end (inclusive) = least(own Effective To, period end, Signed renewal start − 1). Null = no end yet
 * (open-ended on an open period). Derived only — the stored Effective To is never changed. `ignoreRenewals` is used
 * when judging a predecessor against its own successor.
 */
export function operationalRange(
  x: ContractInContext,
  others: ContractInContext[],
  opts: { ignoreRenewals?: boolean } = {},
): { from: string; end: string | null; detail: TimeStateDetail } | null {
  const c = x.contract;
  if (!c.effectiveFrom) return null;
  const own = c.isOpenEnded ? null : c.effectiveTo;
  const renewal = opts.ignoreRenewals ? null : confirmedSuccessorOf(c, others);
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
export function finalizeBlockers(x: ContractInContext, others: ContractInContext[] = []): Finding[] {
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
  // C-115: a renewal starts after the contract it renews.
  const parent = c.parentContractId ? others.find((o) => o.contract.id === c.parentContractId)?.contract : null;
  if (parent?.effectiveFrom && c.effectiveFrom && c.effectiveFrom <= parent.effectiveFrom) {
    out.push({ field: "effective_from", code: "RENEWAL_STARTS_BEFORE_PARENT", message: "A renewal must start after the contract it renews.", related_contract_id: parent.id });
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
      if (linked) continue; // the renewal pair has its own warnings (GAP / RENEWAL_OVERLAPS_PREDECESSOR, C-115)
      const r = operationalRange(o, others);
      if (r && overlaps(range, r)) {
        out.push({
          code: WARNING.OVERLAPPING_CONTRACT,
          message: "Overlaps another contract of this person.",
          related_contract_id: o.contract.id,
          related_contract_number: o.contract.contractNumber,
          // The overlapping days of the two operational ranges (null end = no end yet).
          affected_from: range.from > r.from ? range.from : r.from,
          affected_to: minDate(range.end, r.end),
        });
      }
    }
  }
  // C-115: against the parent's OWN Effective To (a renewable parent always has one). Both stay in Needs Review while
  // true — also after the renewal is Signed.
  if (c.relationshipType === "renewal" && c.parentContractId && c.effectiveFrom) {
    const parent = others.find((o) => o.contract.id === c.parentContractId)?.contract;
    const parentTo = parent?.effectiveTo ?? null;
    const related = { related_contract_id: c.parentContractId, related_contract_number: parent?.contractNumber ?? null };
    if (parentTo && c.effectiveFrom > addDays(parentTo, 1)) {
      // Uncovered days: from the day after the parent's own Effective To to the day before this renewal starts.
      out.push({ code: WARNING.GAP_AFTER_PREDECESSOR, message: "There is a gap after the previous contract.", ...related, affected_from: addDays(parentTo, 1), affected_to: addDays(c.effectiveFrom, -1) });
    }
    if (parentTo && c.effectiveFrom <= parentTo) {
      out.push({ code: WARNING.RENEWAL_OVERLAPS_PREDECESSOR, message: "The renewal starts before the previous contract ends.", ...related, affected_from: c.effectiveFrom, affected_to: parentTo });
    }
  }
  if (!c.isOpenEnded && c.effectiveTo && x.period.endDate !== null && c.effectiveTo > x.period.endDate) {
    out.push({
      field: "effective_to",
      code: WARNING.CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD,
      message: "Effective To is after the end of the employment period.",
      // The days the contract runs beyond the period (a later period correction changes them).
      affected_from: addDays(x.period.endDate, 1),
      affected_to: c.effectiveTo,
    });
  }
  return out;
}

/** Finalize warnings for a Draft (M-19): data warnings plus other open Drafts on the same period. */
export function finalizeWarnings(x: ContractInContext, others: ContractInContext[]): Finding[] {
  const out = dataWarnings(x, others);
  for (const o of others) {
    if (o.contract.id !== x.contract.id && o.contract.employmentId === x.contract.employmentId && o.contract.documentState === "draft" && isOperational(o)) {
      out.push({
        code: WARNING.ANOTHER_OPEN_DRAFT_FOR_PERIOD,
        message: "Another draft contract is open for this employment period.",
        related_contract_id: o.contract.id,
        related_contract_number: o.contract.contractNumber,
      });
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
/**
 * The facts that define a warning for M-19 confirmation (C-120): code, the related contract's stable id, the field
 * and the affected business-date range. A confirmation binds to these facts, so HR re-reviews when e.g. an overlap
 * range or a gap changes even though the code and the related contract stay the same. Display text (message,
 * translations, formatting) and the related contract NUMBER are presentation, never identity. Fixed key order.
 */
export function warningFingerprintFacts(w: Finding) {
  return {
    code: w.code,
    related_contract_id: w.related_contract_id ?? null,
    field: w.field ?? null,
    affected_from: w.affected_from ?? null,
    affected_to: w.affected_to ?? null,
  };
}

/**
 * M-19 warning fingerprint, version 2: sha256 over the JSON array of each warning's facts serialized as JSON and
 * sorted (order-independent, unambiguous — no delimiter concatenation). Version 1 hashed only code + related id and
 * therefore accepted a stale confirmation after the overlap / gap dates changed; a w1 value never matches a w2 value.
 */
export function warningFingerprint(warnings: Finding[]): string | null {
  if (warnings.length === 0) return null;
  const canonical = JSON.stringify(warnings.map((w) => JSON.stringify(warningFingerprintFacts(w))).sort());
  return `w2:${createHash("sha256").update(canonical).digest("hex")}`;
}

// ---------------- Allowed actions (per caller) ----------------
export type ActionKey = "edit" | "discard" | "finalize" | "return_to_draft" | "confirm_signed" | "renew" | "cancel_planned" | "correct" | "void";
export type ActionView = { allowed: boolean; reasons: string[] };
export const ACTION_KEYS: ActionKey[] = ["edit", "discard", "finalize", "return_to_draft", "confirm_signed", "renew", "cancel_planned", "correct", "void"];

export const ACTION_PERMISSION: Record<ActionKey, Permission> = {
  edit: "contracts.manage",
  discard: "contracts.manage",
  finalize: "contracts.finalize",
  return_to_draft: "contracts.finalize",
  confirm_signed: "contracts.finalize",
  renew: "contracts.manage", // creates a Draft; finalizing it needs contracts.finalize
  cancel_planned: "contracts.finalize",
  correct: "contracts.correct",
  void: "contracts.correct",
};

/** Why an action is not possible in the current state (empty = allowed by state). Permission is added by `actions`. */
export function stateReasons(action: ActionKey, x: ContractInContext, others: ContractInContext[], today: string): string[] {
  const c = x.contract;
  const r: string[] = [];
  if (c.voided) return ["CONTRACT_VOIDED"];
  if (c.cancelled) return ["CONTRACT_CANCELLED"];
  const periodCode = x.period.voided ? REVIEW_ONLY.PERIOD_VOIDED : x.period.cancelled ? REVIEW_ONLY.PERIOD_CANCELLED : null;
  const hasRenewal = directRenewalOf(c, others) !== null;
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
      else if (finalizeBlockers(x, others).length) r.push("NOT_READY");
      break;
    case "return_to_draft":
      if (c.documentState === "signed") r.push("ALREADY_SIGNED");
      else if (c.documentState !== "finalized") r.push("NOT_FINALIZED");
      if (periodCode) r.push(periodCode); // C-109: Cancelled/Voided blocks; Ended never does
      if (hasRenewal) r.push("DEPENDENT_CONTRACTS_EXIST");
      break;
    case "confirm_signed":
      if (c.documentState === "signed") r.push("ALREADY_SIGNED");
      else if (c.documentState !== "finalized") r.push("NOT_FINALIZED");
      if (x.period.voided) r.push(REVIEW_ONLY.PERIOD_VOIDED); // C-111: Cancelled allowed, Voided refused
      break;
    // ---- slice 2A-5 (C-115, C-107 refined) ----
    case "renew":
      if (c.documentState === "draft") r.push("NOT_FINALIZED");
      if (c.isOpenEnded || !c.effectiveTo) r.push("OPEN_ENDED"); // renewal requires a finite parent term
      if (hasRenewal) r.push("RENEWAL_EXISTS");
      if (periodCode) r.push(periodCode);
      break;
    case "cancel_planned": // contract-wide: Finalized + unsigned + Effective From after the Vietnam business date
      if (c.documentState === "draft") r.push("NOT_FINALIZED"); // a Draft is discarded instead
      else if (c.documentState === "signed") r.push("ALREADY_SIGNED"); // withdrawal of a signed contract = PL-10
      if (!c.effectiveFrom || c.effectiveFrom <= today) r.push("NOT_UPCOMING"); // started (or no date): not "planned"
      if (hasRenewal) r.push("DEPENDENT_CONTRACTS_EXIST");
      break;
    case "correct": // Signed data only; a Finalized-unsigned contract is returned to Draft instead
      if (c.documentState === "draft") r.push("NOT_FINALIZED");
      else if (c.documentState === "finalized") r.push("NOT_SIGNED");
      if (x.period.voided) r.push(REVIEW_ONLY.PERIOD_VOIDED); // read-only under a voided period (C-111)
      break;
    case "void": // erroneous records only; never early termination of a valid contract
      if (c.documentState === "draft") r.push("NOT_FINALIZED"); // a Draft is discarded instead
      if (hasRenewal) r.push("DEPENDENT_CONTRACTS_EXIST");
      break;
  }
  return r;
}

export function actions(x: ContractInContext, others: ContractInContext[], can: (p: Permission) => boolean, today: string): Record<ActionKey, ActionView> {
  return Object.fromEntries(
    ACTION_KEYS.map((k) => {
      const reasons = [...(can(ACTION_PERMISSION[k]) ? [] : ["PERMISSION_REQUIRED"]), ...stateReasons(k, x, others, today)];
      return [k, { allowed: reasons.length === 0, reasons }];
    }),
  ) as Record<ActionKey, ActionView>;
}

// ---------------- Attention (slice 2A-4; PV-36 → M-20) ----------------
// The ONLY definitions behind the Home Contract Attention section and the matching Contracts filters, so a Home count,
// its list and the filtered Contracts page always agree.

/** M-20: Home uses a fixed 30-day expiry window (not configurable in MVP). The Contracts page also offers 60 / 90. */
export const HOME_EXPIRY_WINDOW_DAYS = 30;
export const EXPIRY_WINDOWS = [30, 60, 90] as const;

/**
 * Expiring within N days: a Finalized/Signed contract that is operational (not discarded/cancelled/voided and its
 * period not Cancelled/Voided), not open-ended, whose own Effective To lies from today through today + N — both
 * ends INCLUSIVE (T and T+N count, T+N+1 does not), Asia/Ho_Chi_Minh business dates. Excluded as well: a contract
 * already over because its employment period ended earlier, and one with a SIGNED renewal — the confirmed successor
 * (C-115). A Draft or Finalized-unsigned renewal leaves the parent in Expiring soon.
 * Drafts are not reminders: they have no time state until Finalized (they surface through Needs Review / Drafts).
 */
export function expiresWithin(x: ContractInContext, others: ContractInContext[], today: string, days: number): boolean {
  const c = x.contract;
  if (!isOperational(x) || !isFinal(c) || c.isOpenEnded || !c.effectiveTo) return false;
  if (c.effectiveTo < today || c.effectiveTo > addDays(today, days)) return false;
  const range = operationalRange(x, others);
  if (range?.end !== null && range?.end !== undefined && range.end < today) return false; // ended with its period
  if (confirmedSuccessorOf(c, others)) return false;
  return true;
}

/**
 * Awaiting signature: Finalized, not Signed, not discarded/cancelled/voided, and its period not Cancelled/Voided —
 * such a contract is shown under Needs Review instead (PERIOD_CANCELLED / PERIOD_VOIDED), not as a clean reminder.
 * No deadline is implied.
 */
export function awaitingSignature(x: ContractInContext): boolean {
  return isOperational(x) && x.contract.documentState === "finalized";
}

/** Days from today to the contract's own Effective To (0 = ends today). */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}
