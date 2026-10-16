import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ATTENTION_LINKS,
  attentionValue,
  contractFiltersFromQuery,
  contractQueryFromFilters,
  EMPTY_CONTRACT_FILTERS,
  endsInText,
  withAttention,
} from "@/app/contracts/contractModel";
import { t } from "@/i18n";
import { addDays, todayInVietnam } from "@/lib/dates";
import { awaitingSignature, daysUntil, expiresWithin, HOME_EXPIRY_WINDOW_DAYS, type ContractInContext } from "@/modules/contracts/evaluation";

// Slice 2A-4 (M-20): the attention predicates as pure rules, Vietnam business dates, and the Home / Contracts link model.
const TODAY = "2026-10-16";
const period = { id: "e1", startDate: "2026-01-01", endDate: null as string | null, cancelled: false, voided: false };
function finalized(over: Partial<ContractInContext["contract"]> = {}, p: Partial<typeof period> = {}): ContractInContext {
  return {
    contract: {
      id: "c1",
      employmentId: "e1",
      parentContractId: null,
      relationshipType: null,
      contractTypeId: "t1",
      contractTypeActive: true,
      contractNumber: "N-1",
      effectiveFrom: "2026-01-01",
      effectiveTo: addDays(TODAY, 10),
      isOpenEnded: false,
      documentState: "finalized",
      cancelled: false,
      voided: false,
      ...over,
    },
    period: { ...period, ...p },
  };
}

describe("Expiring within N days (inclusive both ends, Asia/Ho_Chi_Minh)", () => {
  it("Home window is fixed at 30 days", () => {
    expect(HOME_EXPIRY_WINDOW_DAYS).toBe(30);
  });
  it("today and T+30 are in; T+31 and yesterday are out", () => {
    const at = (to: string) => expiresWithin(finalized({ effectiveTo: to }), [], TODAY, 30);
    expect(at(TODAY)).toBe(true);
    expect(at(addDays(TODAY, 30))).toBe(true);
    expect(at(addDays(TODAY, 31))).toBe(false);
    expect(at(addDays(TODAY, -1))).toBe(false);
  });
  it("open-ended, drafts, discarded/voided and contracts of a cancelled/voided period are never expiry reminders", () => {
    expect(expiresWithin(finalized({ isOpenEnded: true, effectiveTo: null }), [], TODAY, 30)).toBe(false);
    expect(expiresWithin(finalized({ documentState: "draft" }), [], TODAY, 30)).toBe(false);
    expect(expiresWithin(finalized({ cancelled: true }), [], TODAY, 30)).toBe(false);
    expect(expiresWithin(finalized({ voided: true }), [], TODAY, 30)).toBe(false);
    expect(expiresWithin(finalized({}, { cancelled: true }), [], TODAY, 30)).toBe(false);
    expect(expiresWithin(finalized({}, { voided: true }), [], TODAY, 30)).toBe(false);
  });
  it("a contract whose employment period already ended is over, even if its own end is in the window", () => {
    expect(expiresWithin(finalized({}, { endDate: addDays(TODAY, -1) }), [], TODAY, 30)).toBe(false);
    expect(expiresWithin(finalized({}, { endDate: addDays(TODAY, 5) }), [], TODAY, 30)).toBe(true); // still running today
  });
  it("Signed contracts expire like Finalized ones", () => {
    expect(expiresWithin(finalized({ documentState: "signed" }), [], TODAY, 30)).toBe(true);
  });
  it("business dates follow Asia/Ho_Chi_Minh, not UTC", () => {
    expect(todayInVietnam(new Date("2026-10-15T17:30:00Z"))).toBe("2026-10-16"); // 00:30 in Vietnam
    expect(todayInVietnam(new Date("2026-10-15T16:59:00Z"))).toBe("2026-10-15"); // 23:59 in Vietnam
    expect(daysUntil(addDays(TODAY, 30), TODAY)).toBe(30);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
  });
});

describe("Awaiting signature", () => {
  it("Finalized and not Signed on an operational period; no deadline", () => {
    expect(awaitingSignature(finalized())).toBe(true);
    expect(awaitingSignature(finalized({ effectiveTo: "2020-01-01" }))).toBe(true);
    expect(awaitingSignature(finalized({ documentState: "signed" }))).toBe(false);
    expect(awaitingSignature(finalized({ documentState: "draft" }))).toBe(false);
    expect(awaitingSignature(finalized({ voided: true }))).toBe(false);
    expect(awaitingSignature(finalized({}, { cancelled: true }))).toBe(false); // shown under Needs review instead
  });
});

describe("Canonical attention filters and Home deep links (one filter model)", () => {
  it("Home links are exactly the Contracts page URLs for the same filters", () => {
    expect(ATTENTION_LINKS).toEqual({
      expiring_soon: "/contracts?expiring_within=30",
      awaiting_signature: "/contracts?awaiting_signature=true",
      needs_review: "/contracts?needs_review=true",
    });
    for (const href of Object.values(ATTENTION_LINKS)) {
      const { filters } = contractFiltersFromQuery(href.slice("/contracts".length));
      expect(`/contracts${contractQueryFromFilters(filters, 1)}`).toBe(href);
    }
  });
  it("one Attention control maps to the canonical parameters; only 30/60/90 windows are accepted", () => {
    const f = withAttention(EMPTY_CONTRACT_FILTERS, "expiring_60");
    expect(f).toMatchObject({ expiring_within: "60", needs_review: "", awaiting_signature: "" });
    expect(attentionValue(f)).toBe("expiring_60");
    expect(attentionValue(withAttention(f, "needs_review"))).toBe("needs_review");
    expect(attentionValue(withAttention(f, ""))).toBe("");
    expect(contractFiltersFromQuery("?expiring_within=45").filters.expiring_within).toBe("");
    expect(contractFiltersFromQuery("?expiring_within=90&awaiting_signature=true").filters).toMatchObject({ expiring_within: "90", awaiting_signature: "true" });
  });
  it("the Contracts page reads its filters from the router, so a client-side Home link keeps them", () => {
    const page = readFileSync("src/app/contracts/page.tsx", "utf8");
    expect(page).toContain("contractFiltersFromQuery(searchParams.toString())");
    expect(page).not.toContain("window.location.search)"); // not read on first render (stale during client navigation)
    expect(page).toContain("<Suspense");
  });
  it("plain-language end text", () => {
    expect(endsInText(0)).toBe("Ends today");
    expect(endsInText(1)).toBe("Ends in 1 day");
    expect(endsInText(12)).toBe("Ends in 12 days");
  });
});

describe("Home integration rules", () => {
  const home = readFileSync("src/app/page.tsx", "utf8");
  const section = readFileSync("src/app/ContractAttention.tsx", "utf8");
  it("one Contract Attention section, only with contracts.read, loaded from the reminder API (no client rule)", () => {
    expect(home).toContain('{session?.can("contracts.read") && <ContractAttention />}');
    expect(section).toContain('api<Reminders>("/api/v1/core-hr/contract-reminders")');
    expect(section).not.toMatch(/effective_to\s*[<>]=?|addDays|todayInVietnam/); // no expiry computed in the browser
    expect(t("home.contracts.title")).toBe("Contract Attention");
  });
  it("no charts, trends or renewal content before 2A-5; each signal says what HR should do", () => {
    const code = section.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"); // comments may state the exclusions
    expect(code).not.toMatch(/renew|chart|trend/i);
    for (const k of ["home.contracts.expiringAction", "home.contracts.awaitingAction", "home.contracts.reviewAction"] as const) expect(t(k).length).toBeGreaterThan(10);
    expect(t("home.contracts.expiringAction")).not.toMatch(/renew/i);
  });
});
