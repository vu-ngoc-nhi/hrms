import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate } from "@/i18n";
import { en } from "@/i18n/messages/en";

// Phase 1 final product review: small consistency fixes (presentation only).
describe("Date presentation", () => {
  it("English dates use fixed three-letter months (no 'Sept') and never shift the business date", () => {
    expect(formatDate("2024-09-02")).toBe("02 Sep 2024");
    expect(formatDate("2026-10-11")).toBe("11 Oct 2026");
    expect(formatDate("2026-01-31T23:59:59Z")).toBe("31 Jan 2026");
    expect(formatDate(null)).toBe("—");
  });
});

describe("Terminology", () => {
  it("one user-facing name for completeness: Record Health (list filter, Overview, Home); options Complete / Needs Attention", () => {
    expect(en.employees.completeness).toBe("Record Health");
    expect(en.overview.healthTitle).toBe("Record Health");
    expect(en.employees.completenessOption).toEqual({ complete: "Complete", incomplete: "Needs Attention" });
    expect(JSON.stringify(en)).not.toMatch(/Record Completeness|Line Manager|Headcount/);
  });
});

describe("Workflow forms", () => {
  it("no inline styles in Employee Detail workflow forms (shared classes only)", () => {
    const dir = "src/app/employees/[id]";
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
      expect(readFileSync(`${dir}/${f}`, "utf8"), f).not.toMatch(/style=\{\{/);
    }
  });
});

describe("Error messages", () => {
  it("never show internal ids or technical field names; repeated detail lines once; new PV-29 codes catalogued", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBox, {
        error: {
          status: 422,
          body: {
            error: "BUSINESS_RULE_VIOLATION",
            message: "x",
            request_id: "req-1",
            details: [
              { field: "end_date", code: "FUTURE_ASSIGNMENT_OUTSIDE_END", message: "Assignment 6f1c2d9e-0000-4000-8000-000000000001 starts on 2026-11-16." },
              { field: "end_date", code: "FUTURE_ASSIGNMENT_OUTSIDE_END", message: "Assignment 6f1c2d9e-0000-4000-8000-000000000002 starts on 2026-12-14." },
            ],
          },
        },
      }),
    );
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(html).not.toContain("end_date");
    expect(html.match(/Check the Assignment tab/g)).toHaveLength(1);
    expect(html).toContain("This change is not allowed.");
    expect(en.errors.LATER_ASSIGNMENT_EXISTS).toMatch(/Cancel the latest planned assignment first/);
    expect(en.errors.ASSIGNMENT_CANCELLED).toMatch(/Reload/);
  });
});

describe("Record Health helper (Product/UI freeze)", () => {
  it("no rule version, validation status or project terminology is shown to HR users", () => {
    const text = JSON.stringify(en);
    expect(text).not.toMatch(/MVP decision|pending HR validation/i);
    expect(en.overview.healthHelper).toBe("Record Health reflects required operational information only.");
    expect(text).not.toMatch(/\bPV-\d+|\bC-\d{2,}\b/);
    expect(en.voidPeriod.findings.RELATIONSHIP_CHANGE_SUCCESSOR).toBe("This Employment Period was created by a Relationship Change. Reversing that Relationship Change is not available yet.");
    const overview = readFileSync("src/app/employees/[id]/OverviewTab.tsx", "utf8");
    expect(overview).not.toMatch(/ruleVersion|rule_version/);
  });
});
