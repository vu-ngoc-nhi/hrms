import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  blockerText,
  contractFiltersFromQuery,
  contractQueryFromFilters,
  contractTitle,
  createDraftBody,
  draftErrors,
  EMPTY_CONTRACT_FILTERS,
  EMPTY_DRAFT,
  explainedReason,
  explainedReasonForCreate,
  findingText,
  finalizeBody,
  finalizeOutcome,
  historyTitle,
  placeActions,
  signedDateIssue,
  termText,
  updateDraftBody,
  type ActionKey,
  type ActionView,
  type ContractDetail,
} from "@/app/contracts/contractModel";
import { statusVariant } from "@/components/ui/StatusBadge";
import { t } from "@/i18n";

// Slice 2A-3 contract UI model: presentation over the server representation — no lifecycle rule is re-derived here.
const allowed = (...keys: ActionKey[]): Record<ActionKey, ActionView> =>
  Object.fromEntries((["edit", "discard", "finalize", "return_to_draft", "confirm_signed"] as ActionKey[]).map((k) => [k, { allowed: keys.includes(k), reasons: keys.includes(k) ? [] : ["NOT_DRAFT"] }])) as Record<
    ActionKey,
    ActionView
  >;

const detail = (over: Partial<ContractDetail> = {}): ContractDetail => ({
  id: "c1",
  revision: 3,
  as_of: "2026-10-16",
  employee: { person_id: "p1", employee_code: "ES0001", full_name: "Test Person" },
  employment: { id: "e1", start_date: "2026-01-01", end_date: null, disposition: null, employee_type: { name: "Employee" } },
  contract_type: { id: "t1", code: "TEST_TYPE_A", name: "Test Type A (synthetic)", name_vi: null, is_active: true },
  contract_number: "HD-1",
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
  is_open_ended: false,
  signed_at: null,
  summary: null,
  state: { document_state: "draft", disposition: null, operational: true, time_state: null, time_state_detail: null, operational_end: null, days_to_operational_end: null },
  review: { needs_review: false, items: [] },
  finalize_check: { ready: true, blockers: [], warnings: [], warning_fingerprint: null },
  actions: allowed("edit", "discard", "finalize"),
  finalized_at: null,
  finalized_by: null,
  created_at: "2026-10-16T01:00:00Z",
  created_by: null,
  ...over,
});

describe("Contracts list URL state (canonical API parameter names)", () => {
  it("round-trips known filters and drops unknown or malformed values", () => {
    const q = "?search=HD&contract_type_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&document_state=signed&time_state=active&needs_review=true&effective_from_from=2026-01-01&include_disposed=true&page=2";
    const { filters, page } = contractFiltersFromQuery(q);
    expect(page).toBe(2);
    expect(contractQueryFromFilters(filters, page)).toBe(q);
    const bad = contractFiltersFromQuery("?document_state=pending&time_state=soon&needs_review=yes&contract_type_id=x&effective_from_to=16/10/2026&page=-3");
    expect(bad).toEqual({ filters: EMPTY_CONTRACT_FILTERS, page: 1 });
  });
  it("Home cards can deep-link with the same parameters (e.g. Needs Review)", () => {
    expect(contractFiltersFromQuery("?needs_review=true").filters.needs_review).toBe("true");
  });
});

describe("Allowed actions come only from the server", () => {
  it("shows exactly the allowed actions: Finalize (Draft) or Confirm Signed as the main step, Edit visible, the rest in More", () => {
    expect(placeActions(allowed("edit", "discard", "finalize"))).toEqual({ primary: "finalize", secondary: ["edit"], menu: ["discard"] });
    expect(placeActions(allowed("return_to_draft", "confirm_signed"))).toEqual({ primary: "confirm_signed", secondary: [], menu: ["return_to_draft"] });
    expect(placeActions(allowed())).toEqual({ primary: null, secondary: [], menu: [] });
  });
  it("explains parent-period denials in plain words (cancelled and voided are told apart)", () => {
    const withReason = (code: string) => ({ ...allowed(), confirm_signed: { allowed: false, reasons: [code] } });
    expect(explainedReason(withReason("PERIOD_VOIDED"))).toBe(t("contracts.reason.PERIOD_VOIDED"));
    expect(explainedReason(withReason("PERIOD_CANCELLED"))).toBe(t("contracts.reason.PERIOD_CANCELLED"));
    expect(explainedReason(withReason("PERMISSION_REQUIRED"))).toBeNull(); // missing permission simply hides the action
    expect(explainedReasonForCreate(["NO_VALID_EMPLOYMENT_PERIOD"])).toBe(t("contracts.reason.NO_VALID_EMPLOYMENT_PERIOD"));
    expect(explainedReasonForCreate(["PERMISSION_REQUIRED", "NO_VALID_EMPLOYMENT_PERIOD"])).toBeNull();
  });
});

describe("M-19 Finalize protocol (UI side)", () => {
  const confirmBody = { error: "FINALIZE_CONFIRMATION_REQUIRED", details: [{ code: "OVERLAPPING_CONTRACT", message: "x", related_contract_id: "c2" }], warning_fingerprint: "w1:abc" };
  it("first request carries no fingerprint; Finalize Anyway sends exactly the fingerprint the server issued", () => {
    expect(finalizeBody(3, null)).toEqual({ expected_revision: 3 });
    expect(finalizeBody(3, "w1:abc")).toEqual({ expected_revision: 3, confirmed_warning_fingerprint: "w1:abc" });
  });
  it("success finalizes; 409 FINALIZE_CONFIRMATION_REQUIRED opens the review with the server's warnings", () => {
    expect(finalizeOutcome({ ok: true }, null)).toEqual({ kind: "finalized" });
    expect(finalizeOutcome({ ok: false, status: 409, body: confirmBody }, null)).toEqual({ kind: "confirm", warnings: confirmBody.details, fingerprint: "w1:abc", changed: false });
  });
  it("a confirmation answered with a new warning set means the warnings changed: review again, never a silent retry", () => {
    const next = { ...confirmBody, warning_fingerprint: "w1:def" };
    expect(finalizeOutcome({ ok: false, status: 409, body: next }, "w1:abc")).toMatchObject({ kind: "confirm", fingerprint: "w1:def", changed: true });
    const page = readFileSync("src/app/contracts/[id]/page.tsx", "utf8");
    expect(page).toContain("requestFinalize(c!, null)"); // the first click never sends a fingerprint
    const dialogs = readFileSync("src/app/contracts/[id]/LifecycleDialogs.tsx", "utf8");
    expect(dialogs).toContain("requestFinalize(contract, fingerprint)"); // Finalize Anyway sends the reviewed fingerprint
  });
  it("blockers and other errors are errors, not a confirmation", () => {
    expect(finalizeOutcome({ ok: false, status: 422, body: { error: "CONTRACT_NOT_READY" } }, "w1:abc")).toEqual({ kind: "error" });
    expect(finalizeOutcome({ ok: false, status: 409, body: { error: "REVISION_CONFLICT" } }, null)).toEqual({ kind: "error" });
  });
  it("the review dialog asks for no reason, has no per-warning checkbox and never claims the warning is resolved", () => {
    const dialogs = readFileSync("src/app/contracts/[id]/LifecycleDialogs.tsx", "utf8");
    const finalizeDialog = dialogs.slice(dialogs.indexOf("export function FinalizeReviewDialog"), dialogs.indexOf("export function ReturnToDraftDialog"));
    expect(finalizeDialog).not.toMatch(/type="checkbox"|textarea|reason/);
    expect(t("contracts.finalizeDialog.note")).toMatch(/does not resolve/);
    expect([t("contracts.finalizeDialog.review"), t("contracts.finalizeDialog.confirm"), t("contracts.finalizeDialog.title")]).toEqual(["Review contract", "Finalize anyway", "Review before finalizing"]);
  });
});

describe("Warnings, Needs Review and states in HR language (no internal codes)", () => {
  it.each(["OVERLAPPING_CONTRACT", "GAP_AFTER_PREDECESSOR", "ANOTHER_OPEN_DRAFT_FOR_PERIOD", "CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD", "PERIOD_CANCELLED", "PERIOD_VOIDED", "EFFECTIVE_FROM_OUTSIDE_PERIOD"])(
    "%s has plain copy",
    (code) => {
      const text = findingText({ code, message: "server text" });
      expect(text).not.toBe("server text");
      expect(text).not.toContain(code);
    },
  );
  it("Needs Review is a warning tone and states never use the danger/brand colours", () => {
    for (const [kind, codes] of [["contractDocument", ["draft", "finalized", "signed"]], ["contractTime", ["upcoming", "active", "expired"]], ["contractDisposition", ["cancelled", "voided"]]] as const) {
      for (const code of codes) expect(["danger", "primary"]).not.toContain(statusVariant(kind, code));
    }
    expect(readFileSync("src/app/contracts/page.tsx", "utf8")).toContain('className="badge warning review-flag"');
    expect(readFileSync("src/app/contracts/ContractStateBadges.tsx", "utf8")).toContain('className="badge warning review-flag"');
  });
  it("labels: draft title, open-ended term, blockers and history events", () => {
    expect(contractTitle({ contract_number: null })).toBe("Draft contract");
    expect(termText({ effective_to: null, is_open_ended: true })).toBe("Open-ended");
    expect(blockerText({ code: "REQUIRED", field: "contract_number", message: "x" })).toBe("Contract Number is required.");
    expect(historyTitle({ event_type: "returned_to_draft", effective_date: null, recorded_at: "", recorded_by: null, reason: "r", related_contract_id: null })).toBe("Returned to draft");
    expect(historyTitle({ event_type: "signed_confirmed", effective_date: "2026-01-01", recorded_at: "", recorded_by: null, reason: null, related_contract_id: null })).toBe("Signature confirmed");
  });
});

describe("Document status vs Time status; discarded records (owner checks before closing 2A-3)", () => {
  const badges = readFileSync("src/app/contracts/ContractStateBadges.tsx", "utf8");
  it("the two concepts always carry their own label and Signed is only a document status", () => {
    expect(t("contracts.stateLabel.document")).toBe("Document status");
    expect(t("contracts.stateLabel.time")).toBe("Time status");
    expect([t("contracts.columns.document"), t("contracts.columns.time")]).toEqual(["Document status", "Time status"]);
    expect(Object.values({ a: t("contracts.timeStateValue.upcoming"), b: t("contracts.timeStateValue.active"), c: t("contracts.timeStateValue.expired") })).not.toContain("Signed");
    expect(badges).toContain('t("contracts.stateLabel.document")');
    expect(badges).toContain('t("contracts.stateLabel.time")');
    for (const f of ["src/app/contracts/[id]/page.tsx", "src/app/employees/[id]/ContractsTab.tsx"]) expect(readFileSync(f, "utf8"), f).toContain("<ContractStateBadges");
  });
  it("a discarded or voided record shows only its disposition — never a time status such as Active", () => {
    // The disposition branch renders no document or time badge.
    const dispositionBranch = badges.slice(badges.indexOf("{state.disposition ? ("), badges.indexOf(") : ("));
    expect(dispositionBranch).toContain('kind="contractDisposition"');
    expect(dispositionBranch).not.toContain("contractTime");
    const list = readFileSync("src/app/contracts/page.tsx", "utf8");
    expect(list).toContain('c.state.disposition ? <StatusBadge kind="contractDisposition"');
    expect(t("contracts.dispositionValue.cancelled")).toBe("Discarded");
  });
});

describe("Draft form (Phase 2A fields only)", () => {
  it("create body omits empty fields (a Draft may be incomplete) and sends the open-ended choice explicitly", () => {
    expect(createDraftBody({ ...EMPTY_DRAFT, employment_id: "e1" })).toEqual({ employment_id: "e1" });
    expect(createDraftBody({ ...EMPTY_DRAFT, employment_id: "e1", contract_number: "  HD-9 ", effective_from: "2026-01-01", term: "open", effective_to: "2026-12-31" })).toEqual({
      employment_id: "e1",
      contract_number: "HD-9",
      effective_from: "2026-01-01",
      is_open_ended: true,
    });
  });
  it("edit sends only changed fields with expected_revision; clearing a number sends null; no change → null", () => {
    const c = detail();
    const same = { employment_id: "e1", contract_type_id: "t1", contract_number: "HD-1", effective_from: "2026-01-01", term: "fixed" as const, effective_to: "2026-12-31", summary: "" };
    expect(updateDraftBody(c, same)).toBeNull();
    expect(updateDraftBody(c, { ...same, contract_number: "" })).toEqual({ expected_revision: 3, contract_number: null });
    expect(updateDraftBody(c, { ...same, term: "open" })).toEqual({ expected_revision: 3, effective_to: null, is_open_ended: true });
  });
  it("convenience checks only (the server decides): Effective To before Effective From; future signed date", () => {
    expect(draftErrors({ ...EMPTY_DRAFT, effective_from: "2026-05-01", effective_to: "2026-04-30" })).toEqual({ effective_to: "contracts.form.error.effectiveTo" });
    expect(draftErrors({ ...EMPTY_DRAFT, effective_from: "2026-05-01", term: "open", effective_to: "2026-04-30" })).toEqual({});
    expect(signedDateIssue("2026-10-17", "2026-10-16")).toBe("future");
    expect(signedDateIssue("2026-10-16", "2026-10-16")).toBeNull();
    expect(signedDateIssue("", "2026-10-16")).toBe("required");
  });
  it("offers no salary, ID, address, template, document or amendment fields", () => {
    // Code only (comments that state the exclusions are ignored).
    const form = readFileSync("src/app/contracts/ContractDraftForm.tsx", "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(form).not.toMatch(/salary|passport|address|template|upload|amendment/i);
  });
});

describe("Permissions are capabilities, never role names", () => {
  it("nav, list, detail and the Employee Contracts tab are gated by contracts.read", () => {
    expect(readFileSync("src/components/AppShell.tsx", "utf8")).toContain('show: session?.can("contracts.read")');
    expect(readFileSync("src/app/employees/[id]/page.tsx", "utf8")).toContain('id !== "contracts" || can("contracts.read")');
    for (const f of ["src/app/contracts/page.tsx", "src/app/contracts/[id]/page.tsx", "src/app/contracts/contractModel.ts", "src/app/contracts/ContractDraftForm.tsx", "src/app/contracts/[id]/LifecycleDialogs.tsx", "src/app/employees/[id]/ContractsTab.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/HR_ADMIN|HR_EDITOR|API_DOCS_READER|\.roles\b|hasRole/);
    }
  });
});
