import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// C-29 query design: only the shared employment query module may reference the cancellation marker, so no service
// can forget the "operational periods" filter by writing its own.
const ALLOWED = new Set([path.normalize("src/modules/core-hr/employments/queries.ts")]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("Employment query boundary", () => {
  it("references the Prisma cancellation marker (cancelledAt) only in employments/queries.ts", () => {
    const offenders = files("src").filter((f) => !ALLOWED.has(path.normalize(f)) && /\bcancelledAt\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
