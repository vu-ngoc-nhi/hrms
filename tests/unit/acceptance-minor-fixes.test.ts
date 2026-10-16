import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contractCountText, findingText, historyDateText, viewAllLabelText, type HistoryItem } from "@/app/contracts/contractModel";
import { DETAIL_TABS, tabFromQuery, tabHref } from "@/app/employees/[id]/tabQuery";
import { upcomingRow, type Dashboard } from "@/app/homeModel";

// Phase 2A owner acceptance — minor fix package (no business rule change).
const code = (f: string) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

describe("1. Employee Detail tab URL (C-114 pattern)", () => {
  it("canonical ?tab= values select their tab; anything else is Overview, the bare URL", () => {
    for (const tab of DETAIL_TABS) expect(tabFromQuery(tab)).toBe(tab);
    expect([tabFromQuery(null), tabFromQuery(""), tabFromQuery("documents"), tabFromQuery("CONTRACTS")]).toEqual(["overview", "overview", "overview", "overview"]);
    expect(tabHref("/employees/p1", "contracts")).toBe("/employees/p1?tab=contracts");
    expect(tabHref("/employees/p1", "overview")).toBe("/employees/p1");
  });
  it("the page reads the tab from the router's search params (never window.location) and adopts later URL changes", () => {
    const page = code("src/app/employees/[id]/page.tsx");
    expect(page).toContain('const urlTab = tabFromQuery(searchParams.get("tab"));');
    expect(page).toContain("if (urlTab !== adoptedUrlTab) {");
    expect(page).not.toMatch(/window\.location\.search\)\.get\("tab"\)/);
    expect(page).not.toMatch(/function tabFromUrl/);
  });
  it("the links that target a tab use the canonical form: Home Upcoming, Contract Detail → Employee Contracts tab", () => {
    const item = { person_id: "p1", employee_code: "ES0001", full_name: "Synthetic", employee_type: null, previous_employee_type: null, assignment: null, previous_assignment: null };
    expect(upcomingRow({ ...item, type: "employment_end", effective_date: "2026-11-02" } as Dashboard["upcoming"]["items"][number]).href).toBe("/employees/p1?tab=employment");
    expect(code("src/app/contracts/[id]/page.tsx")).toContain("href={`/employees/${c.employee.person_id}?tab=contracts`}");
  });
});

describe("2. Warning copy names the other contract and the dates (server-provided facts)", () => {
  const base = { message: "server text", related_contract_id: "11111111-1111-4111-8111-111111111111" };
  it("overlap, renewal overlap and gap read as specific sentences", () => {
    expect(findingText({ ...base, code: "OVERLAPPING_CONTRACT", related_contract_number: "ACC-B-001", affected_from: "2027-06-01", affected_to: "2027-10-31" })).toBe(
      "Overlaps with ACC-B-001 from 01 Jun 2027 to 31 Oct 2027.",
    );
    expect(findingText({ ...base, code: "OVERLAPPING_CONTRACT", related_contract_number: "ACC-B-001", affected_from: "2027-06-01", affected_to: null })).toBe(
      "Overlaps with ACC-B-001 from 01 Jun 2027 onwards.",
    );
    expect(findingText({ ...base, code: "RENEWAL_OVERLAPS_PREDECESSOR", related_contract_number: "SYN-1", affected_from: "2027-05-01", affected_to: "2027-05-31" })).toBe(
      "This renewal overlaps SYN-1 from 01 May 2027 to 31 May 2027.",
    );
    expect(findingText({ ...base, code: "GAP_AFTER_PREDECESSOR", related_contract_number: "ACC-R-B-001", affected_from: "2027-11-06", affected_to: "2027-11-30" })).toBe(
      "Coverage gap after ACC-R-B-001 from 06 Nov 2027 to 30 Nov 2027.",
    );
    expect(findingText({ ...base, code: "ANOTHER_OPEN_DRAFT_FOR_PERIOD", related_contract_number: null })).toBe(
      "Another draft contract (a contract without a number) is open for the same employment period.",
    );
  });
  it("without facts the general sentence stays (e.g. Home review reasons send only the code); codes are never shown", () => {
    expect(findingText({ code: "OVERLAPPING_CONTRACT", message: "" })).toBe("Its dates overlap another contract of this employee.");
    expect(findingText({ code: "GAP_AFTER_PREDECESSOR", message: "" })).toBe("There is a gap between the previous contract and this one.");
    expect(findingText({ code: "UNKNOWN_CODE", message: "server text" })).toBe("server text");
  });
  it("the browser derives no dates: the formatter only reads affected_from / affected_to", () => {
    const fn = findingText.toString();
    expect(fn).not.toMatch(/addDays|effective_from|effective_to|operational/);
  });
});

describe("3. Cancel Planned history: the planned start date is labelled", () => {
  const h = (event_type: string, effective_date: string | null): HistoryItem => ({
    event_type,
    effective_date,
    recorded_at: "2026-10-16T07:34:00Z",
    recorded_by: null,
    reason: null,
    related_contract_id: null,
  });
  it("never reads as if the cancellation happened on that future date", () => {
    expect(historyDateText(h("cancelled", "2027-06-01"))).toBe("Planned start date: 01 Jun 2027");
    expect(historyDateText(h("signed_confirmed", "2026-10-16"))).toBe("Signed date: 16 Oct 2026");
    expect(historyDateText(h("finalized", null))).toBeNull();
    expect(code("src/app/contracts/[id]/page.tsx")).toContain("historyDateText(h)");
  });
});

describe("4. Singular / plural contract counts", () => {
  it("1 contract, N contracts", () => {
    expect(contractCountText(1, "16 Oct 2026")).toBe("1 contract · as of 16 Oct 2026");
    expect(contractCountText(0, "16 Oct 2026")).toBe("0 contracts · as of 16 Oct 2026");
    expect(contractCountText(7, "16 Oct 2026")).toBe("7 contracts · as of 16 Oct 2026");
    expect(viewAllLabelText(1, "Expiring soon")).toBe("View all 1 contract: Expiring soon");
    expect(viewAllLabelText(3, "Awaiting signature")).toBe("View all 3 contracts: Awaiting signature");
    expect(code("src/app/contracts/page.tsx")).toContain("contractCountText(result.total");
    expect(code("src/app/ContractAttention.tsx")).toContain("viewAllLabelText(signal.total, title)");
  });
});
