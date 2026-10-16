// Slice 2A-3 contract read models: the portfolio list (GET /contracts) and the per-employee grouping
// (GET /employees/{id}/contracts). Every computed field — document state, time state, Needs Review, grouping — comes
// from evaluation.ts through the same facts as the contract detail; the browser never infers lifecycle rules.
//
// Scale note (C-84, EmeSoft ~70–100 people): computed states (time state, Needs Review) are not stored, so the list
// evaluates the whole contract register in memory and then filters, sorts and pages. Stored-field filters would move to
// SQL first if the register ever grows beyond a few thousand rows.
import type { ContractListQuery, ContractSummary } from "@/contracts/core-hr/schemas";
import { fromDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import type { Principal } from "@/modules/identity/authenticate";
import { representativeEmployment } from "@/modules/core-hr/employments/status";
import { awaitingSignature, daysUntil, expiresWithin, HOME_EXPIRY_WINDOW_DAYS, reviewItems, timeState, type ContractInContext } from "./evaluation";
import { toContractInContext } from "./facts";
import { contractDisposition, periodFacts } from "./queries";

const ROW_INCLUDE = { contractType: true, employment: { include: { person: true, employeeType: true } } } as const;
type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(where: { employment?: { personId: string } } = {}) {
  return db().contract.findMany({ where, include: ROW_INCLUDE });
}

type Evaluated = { row: Row; x: ContractInContext; others: ContractInContext[]; summary: ContractSummary };

/** Evaluates rows with their person's other contracts as context (overlap is person-wide). */
function evaluate(rows: Row[], today: string): Evaluated[] {
  const facts = new Map(rows.map((r) => [r.id, toContractInContext(r)]));
  const byPerson = new Map<string, ContractInContext[]>();
  for (const r of rows) byPerson.set(r.employment.personId, [...(byPerson.get(r.employment.personId) ?? []), facts.get(r.id)!]);
  return rows.map((row) => {
    const x = facts.get(row.id)!;
    const others = byPerson.get(row.employment.personId)!.filter((o) => o.contract.id !== row.id);
    const ts = timeState(x, others, today);
    const review = reviewItems(x, others);
    const renewal = others.find((o) => o.contract.parentContractId === row.id && o.contract.relationshipType === "renewal" && !o.contract.cancelled && !o.contract.voided);
    const e = row.employment;
    const summary: ContractSummary = {
      id: row.id,
      revision: row.revision,
      employee: { person_id: e.person.id, employee_code: e.person.employeeCode, full_name: e.person.fullName },
      employment: {
        id: e.id,
        start_date: fromDbDate(e.startDate),
        end_date: fromDbDate(e.endDate),
        disposition: x.period.voided ? "voided" : x.period.cancelled ? "cancelled" : null,
        employee_type: e.employeeType ? { id: e.employeeType.id, code: e.employeeType.code, name: e.employeeType.name } : null,
      },
      contract_type: row.contractType ? { id: row.contractType.id, code: row.contractType.code, name: row.contractType.name } : null,
      contract_number: row.contractNumber,
      effective_from: fromDbDate(row.effectiveFrom),
      effective_to: fromDbDate(row.effectiveTo),
      is_open_ended: row.isOpenEnded,
      signed_at: fromDbDate(row.signedAt),
      relationship: { type: row.relationshipType === "renewal" ? "renewal" : null, parent_id: row.parentContractId, renewal_id: renewal?.contract.id ?? null },
      state: {
        document_state: x.contract.documentState,
        disposition: contractDisposition(row),
        operational: !x.contract.cancelled && !x.contract.voided && !x.period.cancelled && !x.period.voided,
        time_state: ts.timeState,
        time_state_detail: ts.detail,
        operational_end: ts.operationalEnd,
        days_to_operational_end: ts.daysToOperationalEnd,
      },
      review: { needs_review: review.length > 0, codes: [...new Set(review.map((i) => i.code))] },
    };
    return { row, x, others, summary };
  });
}

// ---------------- Portfolio list ----------------
const norm = (s: string) => s.trim().toLocaleLowerCase("vi");
const disposed = (x: ContractInContext) => x.contract.cancelled || x.contract.voided;

function matches(e: Evaluated, q: ContractListQuery, today: string): boolean {
  const s = e.summary;
  if (q.include_disposed !== "true" && disposed(e.x)) return false;
  if (q.search) {
    const needle = norm(q.search);
    const hay = [s.contract_number ?? "", s.employee.employee_code, s.employee.full_name].map(norm);
    if (!hay.some((h) => h.includes(needle))) return false;
  }
  if (q.contract_type_id && s.contract_type?.id !== q.contract_type_id) return false;
  if (q.document_state && s.state.document_state !== q.document_state) return false;
  if (q.time_state && s.state.time_state !== q.time_state) return false;
  if (q.needs_review === "true" && !s.review.needs_review) return false;
  if (q.needs_review === "false" && s.review.needs_review) return false;
  // Attention filters (2A-4): the same predicates as the Home Contract Attention section.
  if (q.expiring_within && !expiresWithin(e.x, e.others, today, Number(q.expiring_within))) return false;
  if (q.awaiting_signature === "true" && !awaitingSignature(e.x)) return false;
  if (q.effective_from_from && (!s.effective_from || s.effective_from < q.effective_from_from)) return false;
  if (q.effective_from_to && (!s.effective_from || s.effective_from > q.effective_from_to)) return false;
  return true;
}

const cmp = (a: string | null, b: string | null, nullsLast = true) =>
  a === b ? 0 : a === null ? (nullsLast ? 1 : -1) : b === null ? (nullsLast ? -1 : 1) : a < b ? -1 : 1;

function order(q: ContractListQuery) {
  return (a: Evaluated, b: Evaluated) => {
    const x = a.summary;
    const y = b.summary;
    let r = 0;
    switch (q.sort ?? "operational_end") {
      case "operational_end":
        r = cmp(x.state.operational_end, y.state.operational_end) || -cmp(x.effective_from, y.effective_from, false);
        break;
      case "effective_from":
        r = -cmp(x.effective_from, y.effective_from, false);
        break;
      case "contract_number":
        r = cmp(x.contract_number, y.contract_number);
        break;
      case "employee_code":
        r = cmp(x.employee.employee_code, y.employee.employee_code);
        break;
    }
    return r || cmp(x.contract_number, y.contract_number) || (x.id < y.id ? -1 : 1);
  };
}

export async function listContracts(q: ContractListQuery) {
  const today = todayInVietnam();
  const all = evaluate(await loadRows(), today).filter((e) => matches(e, q, today)).sort(order(q));
  const start = (q.page - 1) * q.page_size;
  return { data: all.slice(start, start + q.page_size).map((e) => e.summary), total: all.length, page: q.page, page_size: q.page_size, as_of: today };
}

// ---------------- Employee Contracts tab ----------------
/**
 * Server-side grouping for the Employee Contracts tab:
 *  - current: operational Finalized/Signed contracts in force today (more than one = overlap, shown with Needs Review);
 *  - upcoming: operational Finalized/Signed contracts that start later;
 *  - drafts: operational Drafts;
 *  - history: operational contracts that have ended;
 *  - not_operational: discarded, cancelled or voided contracts and contracts of a cancelled/voided period (evidence).
 */
export async function employeeContracts(principal: Principal, personId: string) {
  const person = await db().person.findUnique({ where: { id: personId }, include: { employments: { include: { employeeType: true } } } });
  if (!person) throw notFound("Employee not found.");
  const today = todayInVietnam();
  const evaluated = evaluate(await loadRows({ employment: { personId } }), today);
  const pick = (f: (e: Evaluated) => boolean, sort: (a: ContractSummary, b: ContractSummary) => number) =>
    evaluated.filter(f).map((e) => e.summary).sort(sort);
  const op = (e: Evaluated) => e.summary.state.operational;
  const byFrom = (a: ContractSummary, b: ContractSummary) => cmp(a.effective_from, b.effective_from) || cmp(a.contract_number, b.contract_number);
  const byFromDesc = (a: ContractSummary, b: ContractSummary) => -cmp(a.effective_from, b.effective_from, false) || cmp(a.contract_number, b.contract_number);

  // Periods a new Draft may be linked to: any period of this person that is not Cancelled/Voided (Ended included —
  // existing contracts are often registered after the fact, C-109). Default = the representative period (C-76).
  const valid = person.employments.map((e) => ({ e, f: periodFacts(e) })).filter(({ f }) => !f.cancelled && !f.voided);
  const rep = representativeEmployment(valid.map(({ f }) => ({ startDate: f.startDate, endDate: f.endDate, id: f.id })), today);
  const periods = valid
    .map(({ e, f }) => ({ id: f.id, start_date: f.startDate, end_date: f.endDate, employee_type: e.employeeType?.name ?? null, is_default: f.id === rep?.id }))
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const reasons = [...(principal.permissions.has("contracts.manage") ? [] : ["PERMISSION_REQUIRED"]), ...(periods.length ? [] : ["NO_VALID_EMPLOYMENT_PERIOD"])];

  return {
    as_of: today,
    current: pick((e) => op(e) && e.summary.state.time_state === "active", byFrom),
    upcoming: pick((e) => op(e) && e.summary.state.time_state === "upcoming", byFrom),
    drafts: pick((e) => op(e) && e.summary.state.document_state === "draft", byFromDesc),
    history: pick((e) => op(e) && e.summary.state.time_state === "expired", byFromDesc),
    not_operational: pick((e) => !op(e), byFromDesc),
    create: { allowed: reasons.length === 0, reasons, periods },
  };
}

// ---------------- Home Contract Attention (2A-4) ----------------
const REMINDER_ITEMS = 5;

function reminderItem(e: Evaluated, today: string) {
  const s = e.summary;
  return {
    id: s.id,
    contract_number: s.contract_number,
    employee: s.employee,
    contract_type: s.contract_type?.name ?? null,
    effective_from: s.effective_from,
    effective_to: s.effective_to,
    document_state: s.state.document_state,
    days_to_end: s.effective_to ? daysUntil(s.effective_to, today) : null,
    // Needs Review only: the main condition, as a stable code the UI turns into plain words.
    review_reason: s.review.codes[0] ?? null,
  };
}

/**
 * GET /contract-reminders: three actionable signals with authoritative totals and a short list each. The totals equal
 * the Contracts list totals for ?expiring_within=30, ?awaiting_signature=true and ?needs_review=true (same predicates,
 * same default exclusion of discarded/voided records).
 */
export async function contractReminders() {
  const today = todayInVietnam();
  const live = evaluate(await loadRows(), today).filter((e) => !(e.x.contract.cancelled || e.x.contract.voided));
  const signal = (f: (e: Evaluated) => boolean, sort: (a: Evaluated, b: Evaluated) => number) => {
    const all = live.filter(f).sort(sort);
    return { total: all.length, items: all.slice(0, REMINDER_ITEMS).map((e) => reminderItem(e, today)) };
  };
  const byNumber = (a: Evaluated, b: Evaluated) => cmp(a.summary.contract_number, b.summary.contract_number) || (a.summary.id < b.summary.id ? -1 : 1);
  return {
    as_of: today,
    window_days: HOME_EXPIRY_WINDOW_DAYS,
    expiring_soon: signal((e) => expiresWithin(e.x, e.others, today, HOME_EXPIRY_WINDOW_DAYS), (a, b) => cmp(a.summary.effective_to, b.summary.effective_to) || byNumber(a, b)),
    awaiting_signature: signal((e) => awaitingSignature(e.x), (a, b) => cmp(a.summary.effective_from, b.summary.effective_from) || byNumber(a, b)),
    needs_review: signal((e) => e.summary.review.needs_review, (a, b) => cmp(a.summary.effective_from, b.summary.effective_from) || byNumber(a, b)),
  };
}
