import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nextRovingIndex } from "@/components/ui/keyboard";
import { statusVariant } from "@/components/ui/StatusBadge";

// UI refresh UI-0: design-token discipline and the pure parts of the shared primitives.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : files(full);
    return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

describe("Design tokens (D-UI-10)", () => {
  it("the temporary primary red exists only as the central token", () => {
    const offenders = files("src").filter((f) => !f.endsWith(path.normalize("app/tokens.css")) && /#c8102e/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    const tokens = readFileSync("src/app/tokens.css", "utf8");
    expect(tokens).toMatch(/--color-primary: #c8102e;/);
    expect(tokens).toContain("Brand red pending final EmeSoft brand confirmation");
  });
  it("global styles use tokens only (no raw colours)", () => {
    expect(readFileSync("src/app/globals.css", "utf8")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

describe("Phone-width layout (no page-level horizontal scroll at 375 px)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const block = (query: string) => {
    const start = css.indexOf(`@media (${query})`);
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf("\n}", start);
    return css.slice(start, end === -1 ? undefined : end);
  };
  it("the stacked shell column and sidebar footer can shrink below their min-content", () => {
    const shell = block("max-width: 900px");
    expect(shell).toMatch(/\.app \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(shell).toMatch(/\.sidebar-footer \{[^}]*min-width: 0;[^}]*flex-wrap: wrap;/);
  });
  it("the list filter bar stacks to one shrinkable column on phones", () => {
    expect(css).toMatch(/@media \(max-width: 480px\) \{ \.filter-bar \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  });
  it("wide tables scroll inside their own wrapper", () => {
    expect(css).toMatch(/\.table-wrap \{ overflow-x: auto;/);
  });
});

describe("Status badge variants (red is not a status colour)", () => {
  it("maps stable codes to semantic variants", () => {
    expect(statusVariant("employment", "active")).toBe("success");
    expect(statusVariant("employment", "not_started")).toBe("info");
    expect(statusVariant("employment", "ended")).toBe("neutral");
    expect(statusVariant("employment", "no_employment")).toBe("neutral");
    expect(statusVariant("completeness", "complete")).toBe("success");
    expect(statusVariant("completeness", "incomplete")).toBe("warning");
    expect(statusVariant("disposition", "voided")).toBe("neutral");
    expect(statusVariant("employment", "unknown_code")).toBe("neutral");
  });
});

describe("Roving keyboard navigation (Tabs, ActionMenu)", () => {
  it("moves with arrows (wrapping), Home and End; ignores other keys", () => {
    expect(nextRovingIndex(0, "ArrowRight", 3, "horizontal")).toBe(1);
    expect(nextRovingIndex(2, "ArrowRight", 3, "horizontal")).toBe(0);
    expect(nextRovingIndex(0, "ArrowLeft", 3, "horizontal")).toBe(2);
    expect(nextRovingIndex(1, "ArrowDown", 4, "vertical")).toBe(2);
    expect(nextRovingIndex(0, "ArrowUp", 4, "vertical")).toBe(3);
    expect(nextRovingIndex(2, "Home", 4, "vertical")).toBe(0);
    expect(nextRovingIndex(0, "End", 4, "vertical")).toBe(3);
    expect(nextRovingIndex(0, "ArrowDown", 3, "horizontal")).toBeNull();
    expect(nextRovingIndex(0, "Enter", 3, "vertical")).toBeNull();
    expect(nextRovingIndex(0, "ArrowDown", 0, "vertical")).toBeNull();
  });
});
