import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// C-29 / PV-25 / PV-29 query design: only the shared employment query module may reference the disposition markers
// (period cancellation and void, assignment cancellation), so no service can forget the "operational periods" filter by writing its own.
// Phase 2A (ADR-0005 §6): contract dispositions use the same Prisma marker names and are owned by contracts/queries.ts,
// which reuses the employment predicate for the period part.
const ALLOWED = new Set([path.normalize("src/modules/core-hr/employments/queries.ts"), path.normalize("src/modules/contracts/queries.ts")]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("Employment query boundary", () => {
  it.each(["cancelledAt", "voidedAt"])("references the Prisma disposition marker %s only in employments/queries.ts", (marker) => {
    const pattern = new RegExp(`\\b${marker}\\b`);
    const offenders = files("src").filter((f) => !ALLOWED.has(path.normalize(f)) && pattern.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("keeps the operational predicate (cancelled_at IS NULL AND voided_at IS NULL) in one definition", () => {
    const source = readFileSync("src/modules/core-hr/employments/queries.ts", "utf8");
    expect(source).toContain("const OPERATIONAL: Prisma.EmploymentWhereInput = { cancelledAt: null, voidedAt: null };");
  });
  it("keeps the operational contract predicate (contract not Cancelled/Voided AND period operational) in one definition", () => {
    const source = readFileSync("src/modules/contracts/queries.ts", "utf8");
    expect(source).toContain("const OPERATIONAL_CONTRACT: Prisma.ContractWhereInput = { cancelledAt: null, voidedAt: null };");
    expect(source).toContain("{ employment: { is: operationalEmploymentWhere() } }");
    expect(source).not.toMatch(/employment\.(cancelledAt|voidedAt)/); // the period part is delegated, never re-implemented
  });
  it("keeps the operational assignment predicate (cancelled_at IS NULL, PV-29) in one definition", () => {
    const source = readFileSync("src/modules/core-hr/employments/queries.ts", "utf8");
    expect(source).toContain("const OPERATIONAL_ASSIGNMENT: Prisma.JobAssignmentWhereInput = { cancelledAt: null };");
    // Every lifecycle service that walks an assignment timeline uses the shared predicate.
    for (const f of ["assignment-change", "assignment-correction", "initial-assignment", "end-employment", "relationship-change", "period-correction", "reverse-end", "void-dependencies", "cancel-planned-assignment"]) {
      expect(readFileSync(`src/modules/core-hr/employments/${f}.ts`, "utf8"), f).toMatch(/operationalAssignmentWhere\(/);
    }
  });
});
