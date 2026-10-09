import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/contracts/core-hr/openapi";
import { operations } from "@/contracts/core-hr/operations";

const doc = buildOpenApiDocument() as {
  paths: Record<string, Record<string, { operationId: string }>>;
};
const APP_DIR = path.resolve("src/app");
// Local-only endpoints, intentionally not published in the spec (they return 404 outside local/test).
const LOCAL_ONLY = new Set(["/api/v1/dev/test-tokens", "/api/v1/dev/test-users"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("OpenAPI 3.1 contract", () => {
  it("is valid against the official OpenAPI 3.1 JSON Schema", async () => {
    const validator = new Validator();
    const result = await validator.validate(doc as unknown as Parameters<Validator["validate"]>[0]);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(validator.version).toBe("3.1");
  });

  it("has a unique operationId on every operation", () => {
    const ids = Object.values(doc.paths).flatMap((methods) => Object.values(methods).map((o) => o.operationId));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every $ref resolves to an existing schema", () => {
    const text = JSON.stringify(doc);
    const refs = [...text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
    const schemas = (doc as unknown as { components: { schemas: Record<string, unknown> } }).components.schemas;
    expect(refs.filter((r) => !(r in schemas))).toEqual([]);
  });

  it("implemented routes match spec operations 1:1 (nothing missing, nothing extra)", async () => {
    const implemented: string[] = [];
    for (const file of routeFiles(APP_DIR)) {
      const rel = path.relative(APP_DIR, path.dirname(file)).split(path.sep).join("/");
      const apiPath = `/${rel}`.replace(/\[(\w+)\]/g, "{$1}");
      if (LOCAL_ONLY.has(apiPath)) continue;
      const mod = await import(file);
      for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
        if (mod[m]) implemented.push(`${m.toLowerCase()} ${apiPath}`);
      }
    }
    const declared = Object.values(operations).map((o) => `${o.method} ${o.path}`);
    expect(implemented.sort()).toEqual(declared.sort());
  });

  it("system text in the spec is English (no Vietnamese diacritics)", () => {
    expect(JSON.stringify(doc)).not.toMatch(/[ạảãáàâầấậẩẫăằắặẳẵđêềếệểễôồốộổỗơờớợởỡưừứựửữ]/i);
  });

  it("has no DELETE operations in this phase", () => {
    expect(JSON.stringify(doc.paths)).not.toContain('"delete"');
  });

  it("contracts/core-hr/openapi.json matches the spec generated from code", () => {
    const committed = JSON.parse(readFileSync("contracts/core-hr/openapi.json", "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it("contains no secrets, tokens or non-example email domains", () => {
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT
    expect(text).not.toMatch(/hrx_[A-Za-z0-9]/);
    expect(text).not.toMatch(/emesoftcloud\.com/);
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
      expect(m[1]).toMatch(/example\.(test|com)$/);
    }
  });
});
