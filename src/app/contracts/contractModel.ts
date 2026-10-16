// Slice 2A-3 contract UI model. Pure helpers over the server representation (ContractDetail / ContractSummary):
// URL ↔ filters, labels for server codes, which server-allowed actions to show, the M-19 Finalize protocol outcome and
// draft-form request bodies. No lifecycle rule is re-derived here: states, Needs Review, readiness and allowed actions
// always come from the API; the form only performs convenience checks the server repeats.
import { tMaybe, t, formatDate } from "@/i18n";

// ---------------- Server shapes (subset used by the UI) ----------------
export type Finding = {
  code: string;
  message: string;
  field?: string;
  related_contract_id?: string;
  /** Server-provided presentation facts (owner acceptance fix); the UI formats them and derives no rule. */
  related_contract_number?: string | null;
  affected_from?: string;
  affected_to?: string | null;
};
export type ActionView = { allowed: boolean; reasons: string[] };
export type ContractState = {
  document_state: "draft" | "finalized" | "signed";
  disposition: "cancelled" | "voided" | null;
  operational: boolean;
  time_state: "upcoming" | "active" | "expired" | null;
  time_state_detail: "closed_by_employment_end" | "replaced_by_renewal" | null;
  operational_end: string | null;
  days_to_operational_end: number | null;
};
type Employment = { id: string; start_date: string; end_date: string | null; disposition: "cancelled" | "voided" | null; employee_type: { name: string } | null };
export type ContractSummary = {
  id: string;
  revision: number;
  employee: { person_id: string; employee_code: string; full_name: string };
  employment: Employment;
  contract_type: { id: string; code: string; name: string } | null;
  contract_number: string | null;
  effective_from: string | null;
  effective_to: string | null;
  is_open_ended: boolean;
  signed_at: string | null;
  relationship?: { type: "renewal" | null; parent_id: string | null; parent_number: string | null; renewal_id: string | null; renewal_state: "draft" | "finalized" | "signed" | null };
  state: ContractState;
  review: { needs_review: boolean; codes: string[] };
};
export type ActionKey = "edit" | "discard" | "finalize" | "return_to_draft" | "confirm_signed" | "renew" | "cancel_planned" | "correct" | "void";
export type ContractDetail = Omit<ContractSummary, "review" | "contract_type" | "relationship"> & {
  as_of: string;
  relationship: {
    type: "renewal" | null;
    parent_id: string | null;
    parent_number: string | null;
    renewal_id: string | null;
    renewal_number: string | null;
    renewal_state: "draft" | "finalized" | "signed" | null;
  };
  renewal_defaults: { contract_type_id: string | null; effective_from: string | null } | null;
  contract_type: { id: string; code: string; name: string; name_vi: string | null; is_active: boolean } | null;
  summary: string | null;
  review: { needs_review: boolean; items: Finding[] };
  finalize_check: { ready: boolean; blockers: Finding[]; warnings: Finding[]; warning_fingerprint: string | null } | null;
  actions: Record<ActionKey, ActionView>;
  finalized_at: string | null;
  finalized_by: { user_id: string; display_name: string } | null;
  created_at: string;
  created_by: { user_id: string; display_name: string } | null;
};
export type HistoryItem = {
  event_type: string;
  effective_date: string | null;
  recorded_at: string;
  recorded_by: { user_id: string; display_name: string } | null;
  reason: string | null;
  related_contract_id: string | null;
};

// ---------------- Portfolio list URL state (canonical API parameter names, like the Employee List) ----------------
export const DOCUMENT_STATES = ["draft", "finalized", "signed"] as const;
export const TIME_STATES = ["upcoming", "active", "expired"] as const;
export type ContractFilters = {
  search: string;
  contract_type_id: string;
  document_state: string;
  time_state: string;
  needs_review: string;
  expiring_within: string;
  awaiting_signature: string;
  effective_from_from: string;
  effective_from_to: string;
  include_disposed: string;
};
export const EMPTY_CONTRACT_FILTERS: ContractFilters = {
  search: "",
  contract_type_id: "",
  document_state: "",
  time_state: "",
  needs_review: "",
  expiring_within: "",
  awaiting_signature: "",
  effective_from_from: "",
  effective_from_to: "",
  include_disposed: "",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const oneOf = (v: string, allowed: readonly string[]) => (allowed.includes(v) ? v : "");

/** Filters and page from a query string; unknown or malformed values are dropped (never sent to the API). */
export function contractFiltersFromQuery(query: string): { filters: ContractFilters; page: number } {
  const p = new URLSearchParams(query);
  const get = (k: string) => p.get(k) ?? "";
  const page = Number.parseInt(get("page") || "1", 10);
  return {
    filters: {
      search: get("search").slice(0, 100),
      contract_type_id: UUID.test(get("contract_type_id")) ? get("contract_type_id") : "",
      document_state: oneOf(get("document_state"), DOCUMENT_STATES),
      time_state: oneOf(get("time_state"), TIME_STATES),
      needs_review: oneOf(get("needs_review"), ["true"]),
      expiring_within: oneOf(get("expiring_within"), EXPIRY_WINDOWS),
      awaiting_signature: oneOf(get("awaiting_signature"), ["true"]),
      effective_from_from: DATE.test(get("effective_from_from")) ? get("effective_from_from") : "",
      effective_from_to: DATE.test(get("effective_from_to")) ? get("effective_from_to") : "",
      include_disposed: oneOf(get("include_disposed"), ["true"]),
    },
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export function contractQueryFromFilters(filters: ContractFilters, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v.trim()) p.set(k, v.trim());
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const hasContractFilters = (f: ContractFilters) => Object.values(f).some((v) => v.trim() !== "");

// ---------------- Attention (2A-4): one compact control over the canonical attention parameters ----------------
export const EXPIRY_WINDOWS = ["30", "60", "90"] as const;
export const HOME_EXPIRY_WINDOW = "30"; // M-20: Home always uses the next 30 days
export const ATTENTION_OPTIONS = ["needs_review", "awaiting_signature", "expiring_30", "expiring_60", "expiring_90"] as const;
export type AttentionOption = (typeof ATTENTION_OPTIONS)[number];

/** The single "Attention" select value represented by the canonical parameters ("" = none or a combination). */
export function attentionValue(f: ContractFilters): AttentionOption | "" {
  const set = [f.needs_review === "true" && "needs_review", f.awaiting_signature === "true" && "awaiting_signature", f.expiring_within && `expiring_${f.expiring_within}`].filter(Boolean);
  return set.length === 1 ? (set[0] as AttentionOption) : "";
}

/** Sets one attention filter through the canonical parameters (the others are cleared). */
export function withAttention(f: ContractFilters, value: AttentionOption | ""): ContractFilters {
  return {
    ...f,
    needs_review: value === "needs_review" ? "true" : "",
    awaiting_signature: value === "awaiting_signature" ? "true" : "",
    expiring_within: value.startsWith("expiring_") ? value.slice("expiring_".length) : "",
  };
}

/** Canonical Contracts links for the Home signals — the same URL a user gets by choosing the filter on the page. */
export const ATTENTION_LINKS = {
  expiring_soon: `/contracts${contractQueryFromFilters(withAttention(EMPTY_CONTRACT_FILTERS, "expiring_30"), 1)}`,
  awaiting_signature: `/contracts${contractQueryFromFilters(withAttention(EMPTY_CONTRACT_FILTERS, "awaiting_signature"), 1)}`,
  needs_review: `/contracts${contractQueryFromFilters(withAttention(EMPTY_CONTRACT_FILTERS, "needs_review"), 1)}`,
} as const;

export type ReminderItem = {
  id: string;
  contract_number: string | null;
  employee: { person_id: string; employee_code: string; full_name: string };
  contract_type: string | null;
  effective_from: string | null;
  effective_to: string | null;
  document_state: "draft" | "finalized" | "signed";
  days_to_end: number | null;
  review_reason: string | null;
};
export type Reminders = {
  as_of: string;
  window_days: number;
  expiring_soon: { total: number; items: ReminderItem[] };
  awaiting_signature: { total: number; items: ReminderItem[] };
  needs_review: { total: number; items: ReminderItem[] };
};

// ---------------- Contract Type options (C-44) ----------------
export type ContractTypeRow = { id: string; name: string; is_active: boolean };
export type ContractTypeOption = { id: string; label: string; disabled: boolean };
/**
 * Contract Type choices per mode. "new" (Create, Edit Draft, Renew, Add Employee): active types only; a Draft's current
 * inactive type is shown, labelled and NOT selectable, so the form never offers it as a choice. "correction" (historical
 * Correction of a Signed contract, C-44): active and inactive types, inactive ones visibly labelled.
 */
export function contractTypeOptions(rows: ContractTypeRow[], mode: "new" | "correction", currentId?: string | null): ContractTypeOption[] {
  const label = (r: ContractTypeRow) => (r.is_active ? r.name : t("contracts.typeInactive", { name: r.name }));
  if (mode === "correction") return rows.map((r) => ({ id: r.id, label: label(r), disabled: false }));
  return rows.filter((r) => r.is_active || r.id === currentId).map((r) => ({ id: r.id, label: label(r), disabled: !r.is_active }));
}

// ---------------- Slice 2A-5: renewal form and correction bodies ----------------
/** Renew form prefilled from the SERVER's renewal_defaults (the browser computes no renewal rule). */
export function draftFromRenewalDefaults(c: ContractDetail): DraftForm {
  return {
    ...EMPTY_DRAFT,
    employment_id: c.employment.id,
    contract_type_id: c.renewal_defaults?.contract_type_id ?? "",
    effective_from: c.renewal_defaults?.effective_from ?? "",
  };
}

/** POST /contracts/{id}/renewals body (the period is the parent's; empty fields omitted). */
export function renewalBody(f: DraftForm): Record<string, unknown> {
  const { employment_id: _period, ...rest } = createDraftBody(f);
  void _period;
  return rest;
}

export type CorrectionForm = { contract_type_id: string; contract_number: string; effective_from: string; term: "fixed" | "open"; effective_to: string; signed_at: string; reason: string };
export const correctionFromContract = (c: ContractDetail): CorrectionForm => ({
  contract_type_id: c.contract_type?.id ?? "",
  contract_number: c.contract_number ?? "",
  effective_from: c.effective_from ?? "",
  term: c.is_open_ended ? "open" : "fixed",
  effective_to: c.effective_to ?? "",
  signed_at: c.signed_at ?? "",
  reason: "",
});

/** Correction body: only changed fields + expected_revision + reason; null when nothing changed. */
export function correctionBody(c: ContractDetail, f: CorrectionForm): Record<string, unknown> | null {
  const before = correctionFromContract(c);
  const body: Record<string, unknown> = {};
  if (f.contract_type_id !== before.contract_type_id) body.contract_type_id = f.contract_type_id;
  if (f.contract_number.trim() !== before.contract_number) body.contract_number = f.contract_number.trim();
  if (f.effective_from !== before.effective_from) body.effective_from = f.effective_from;
  if (f.term !== before.term || (f.term === "fixed" && f.effective_to !== before.effective_to)) {
    body.is_open_ended = f.term === "open";
    body.effective_to = f.term === "open" ? null : f.effective_to || null;
  }
  if (f.signed_at !== before.signed_at) body.signed_at = f.signed_at;
  return Object.keys(body).length ? { expected_revision: c.revision, reason: f.reason.trim(), ...body } : null;
}

/** "1 contract · as of …" / "N contracts · as of …" (the Contracts list count). */
export const contractCountText = (total: number, date: string) => (total === 1 ? t("contracts.countOne", { date }) : t("contracts.count", { total, date }));

/** Accessible name of a Home Contract Attention "View all" link, singular for one contract. */
export const viewAllLabelText = (total: number, title: string) =>
  total === 1 ? t("home.contracts.viewAllLabelOne", { title }) : t("home.contracts.viewAllLabel", { total, title });

/** "Ends today" / "Ends in 1 day" / "Ends in N days" for an expiring contract. */
export function endsInText(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return t("home.contracts.endsToday");
  return days === 1 ? t("home.contracts.endsInOne") : t("home.contracts.endsIn", { days });
}

/** What the contract screens may offer, from server capabilities (never role names). */
export const contractCapabilities = (can: (p: string) => boolean) => ({ read: can("contracts.read"), catalogs: can("catalogs.read") });

// ---------------- Labels for server codes (codes are never shown to HR) ----------------
export const contractTitle = (c: { contract_number: string | null }) => c.contract_number ?? t("contracts.draftContract");

/**
 * Plain-language warning / review item. When the server supplies the facts (the other contract, the dates concerned)
 * the specific sentence names them, e.g. "Overlaps with ACC-B-001 from 01 Jun 2027 to 31 Oct 2027."; otherwise the
 * general sentence for the code; the server message only if a code is not catalogued. Codes are never shown.
 */
export function findingText(f: Finding): string {
  const other = f.related_contract_number ?? (f.related_contract_id ? t("contracts.warningDetail.unnumbered") : null);
  if (other && f.affected_from) {
    const from = formatDate(f.affected_from);
    const range = f.affected_to ? t("contracts.warningDetail.range", { from, to: formatDate(f.affected_to) }) : t("contracts.warningDetail.rangeOpen", { from });
    const specific = tMaybe(`contracts.warningDetail.${f.code}`, { other, range });
    if (specific) return specific;
  }
  if (other && f.code === "ANOTHER_OPEN_DRAFT_FOR_PERIOD") return t("contracts.warningDetail.ANOTHER_OPEN_DRAFT_FOR_PERIOD", { other });
  return tMaybe(`contracts.warning.${f.code}`) ?? f.message;
}

export function blockerText(f: Finding): string {
  if (f.code === "REQUIRED") return t("contracts.blocker.REQUIRED", { field: tMaybe(`contracts.blockerField.${f.field}`) ?? t("contracts.fields.contractNumber") });
  return tMaybe(`contracts.blocker.${f.code}`) ?? f.message;
}

export const historyTitle = (e: HistoryItem) => tMaybe(`contracts.history.event.${e.event_type}`) ?? e.event_type;

/**
 * The business date of a history entry, labelled where it could be mistaken for the action's own date: a cancelled
 * planned contract carries its planned start (C-107 / C-115), never the date of the cancellation, which is "Recorded at".
 */
export function historyDateText(e: HistoryItem): string | null {
  if (!e.effective_date) return null;
  const label = tMaybe(`contracts.history.dateLabel.${e.event_type}`);
  return label ? `${label}: ${formatDate(e.effective_date)}` : formatDate(e.effective_date);
}

export function termText(c: { effective_to: string | null; is_open_ended: boolean }): string {
  if (c.is_open_ended) return t("contracts.openEnded");
  return formatDate(c.effective_to);
}

export function periodText(e: Employment): string {
  const range = e.end_date ? t("contracts.periodRange", { from: formatDate(e.start_date), to: formatDate(e.end_date) }) : t("contracts.periodOpen", { from: formatDate(e.start_date) });
  return e.employee_type ? t("contracts.periodWithType", { range, type: e.employee_type.name }) : range;
}

// ---------------- Actions: only what the server allows ----------------
export type ActionPlacement = { primary: ActionKey | null; secondary: ActionKey[]; menu: ActionKey[] };

/**
 * Lays out the actions the server marks allowed (nothing else is shown). Finalize is the main step of a Draft and
 * Confirm Signed of a Finalized contract; Edit and Renew stay visible; Return to Draft, Discard, Cancel planned,
 * Correct and Void go to the More menu.
 */
export function placeActions(actions: Record<ActionKey, ActionView>): ActionPlacement {
  const ok = (k: ActionKey) => actions[k]?.allowed === true;
  const primary: ActionKey | null = ok("finalize") ? "finalize" : ok("confirm_signed") ? "confirm_signed" : null;
  return {
    primary,
    secondary: (["edit", "renew"] as ActionKey[]).filter(ok),
    menu: (["return_to_draft", "discard", "cancel_planned", "correct", "void"] as ActionKey[]).filter(ok),
  };
}

/**
 * A server denial reason worth explaining to HR (the rest — permission, wrong state — simply hides the action).
 * Parent-period reasons and "not ready" materially help HR decide what to do next.
 */
export function explainedReason(actions: Record<ActionKey, ActionView>): string | null {
  const all = Object.values(actions).flatMap((a) => a.reasons);
  if (all.includes("PERIOD_VOIDED")) return t("contracts.reason.PERIOD_VOIDED");
  if (all.includes("PERIOD_CANCELLED")) return t("contracts.reason.PERIOD_CANCELLED");
  // C-115: a contract with a non-disposed renewal cannot be returned to Draft, cancelled or voided — HR deals with the
  // renewal first. Explained only when the renewal is the sole reason (not when the action is out of reach anyway).
  const onlyRenewal = (k: ActionKey) => actions[k]?.reasons.length === 1 && actions[k].reasons[0] === "DEPENDENT_CONTRACTS_EXIST";
  if ((["return_to_draft", "cancel_planned", "void"] as ActionKey[]).some(onlyRenewal)) return t("contracts.reason.DEPENDENT_CONTRACTS_EXIST");
  return null;
}

/**
 * Presentation code of a contract's disposition. The server has one Cancelled disposition (C-107 / C-115); a cancelled
 * Draft reads "Discarded", a cancelled Finalized contract "Cancelled" (Cancel planned). Voided stays "Voided".
 */
export function dispositionCode(state: Pick<ContractState, "disposition" | "document_state">): "discarded" | "cancelled" | "voided" | null {
  if (state.disposition === "voided") return "voided";
  if (state.disposition === "cancelled") return state.document_state === "draft" ? "discarded" : "cancelled";
  return null;
}

/** "Draft" / "Finalized" / "Signed" of the linked renewal, for the lineage line. */
export const renewalStateText = (s: "draft" | "finalized" | "signed" | null) => (s ? t(`contracts.documentStateValue.${s}`) : "");

/** Why "Create contract" is not offered on the Employee Contracts tab, when it helps HR (not for missing permission). */
export function explainedReasonForCreate(reasons: string[]): string | null {
  return reasons.includes("NO_VALID_EMPLOYMENT_PERIOD") && !reasons.includes("PERMISSION_REQUIRED") ? t("contracts.reason.NO_VALID_EMPLOYMENT_PERIOD") : null;
}

// ---------------- M-19 Finalize protocol ----------------
export type FinalizeOutcome =
  | { kind: "finalized" }
  | { kind: "confirm"; warnings: Finding[]; fingerprint: string; changed: boolean }
  | { kind: "error" };

/**
 * Interprets one Finalize response. A 409 FINALIZE_CONFIRMATION_REQUIRED opens (or refreshes) the review dialog with
 * the server's current warnings and fingerprint; `changed` = this was the answer to a Finalize Anyway, i.e. the warning
 * set changed since HR reviewed it. The UI never retries Finalize on its own.
 */
export function finalizeOutcome(
  res: { ok: true } | { ok: false; status: number; body?: { error?: string; details?: Finding[]; warning_fingerprint?: string } },
  sentFingerprint: string | null,
): FinalizeOutcome {
  if (res.ok) return { kind: "finalized" };
  if (res.status === 409 && res.body?.error === "FINALIZE_CONFIRMATION_REQUIRED" && res.body.warning_fingerprint) {
    return { kind: "confirm", warnings: res.body.details ?? [], fingerprint: res.body.warning_fingerprint, changed: sentFingerprint !== null };
  }
  return { kind: "error" };
}

/** Finalize request body: the fingerprint is sent only for Finalize Anyway (HR saw exactly these warnings). */
export const finalizeBody = (revision: number, fingerprint: string | null) =>
  fingerprint ? { expected_revision: revision, confirmed_warning_fingerprint: fingerprint } : { expected_revision: revision };

// ---------------- Draft form ----------------
export type DraftForm = {
  employment_id: string;
  contract_type_id: string;
  contract_number: string;
  effective_from: string;
  term: "fixed" | "open";
  effective_to: string;
  summary: string;
};
export const EMPTY_DRAFT: DraftForm = { employment_id: "", contract_type_id: "", contract_number: "", effective_from: "", term: "fixed", effective_to: "", summary: "" };

export function draftFromContract(c: ContractDetail): DraftForm {
  return {
    employment_id: c.employment.id,
    contract_type_id: c.contract_type?.id ?? "",
    contract_number: c.contract_number ?? "",
    effective_from: c.effective_from ?? "",
    term: c.is_open_ended ? "open" : "fixed",
    effective_to: c.effective_to ?? "",
    summary: c.summary ?? "",
  };
}

/** Convenience checks only (the server validates everything again). Message keys from the catalogue. */
export function draftErrors(f: DraftForm): Partial<Record<keyof DraftForm, string>> {
  const e: Partial<Record<keyof DraftForm, string>> = {};
  if (f.term === "fixed" && f.effective_from && f.effective_to && f.effective_to < f.effective_from) e.effective_to = "contracts.form.error.effectiveTo";
  return e;
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

function draftValues(f: DraftForm) {
  return {
    contract_type_id: orNull(f.contract_type_id),
    contract_number: orNull(f.contract_number),
    effective_from: orNull(f.effective_from),
    effective_to: f.term === "open" ? null : orNull(f.effective_to),
    is_open_ended: f.term === "open",
    summary: orNull(f.summary),
  };
}

/** POST /contracts body (empty fields omitted: a Draft may be incomplete). */
export function createDraftBody(f: DraftForm): Record<string, unknown> {
  const v = draftValues(f);
  const body: Record<string, unknown> = { employment_id: f.employment_id };
  for (const [k, val] of Object.entries(v)) if (val !== null && val !== false) body[k] = val;
  return body;
}

/** PATCH body with only the changed fields plus expected_revision; null when nothing changed. */
export function updateDraftBody(c: ContractDetail, f: DraftForm): Record<string, unknown> | null {
  const before = draftValues(draftFromContract(c));
  const after = draftValues(f);
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof typeof after)[]) if (after[k] !== before[k]) body[k] = after[k];
  return Object.keys(body).length ? { expected_revision: c.revision, ...body } : null;
}

/** Client convenience for Confirm Signed: the server decides with the Asia/Ho_Chi_Minh business date. */
export const signedDateIssue = (value: string, today: string): "required" | "future" | null => (!value ? "required" : value > today ? "future" : null);
