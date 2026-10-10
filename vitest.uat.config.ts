import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Business UAT Round 1 (synthetic data only): runs alone on a freshly reset hrms_test (same guarded globalSetup).
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["tests/uat/**/*.test.ts"], exclude: ["**/node_modules/**"] },
});
