import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Clean integrity baseline (Phase 1 quality gate): runs alone on a freshly reset hrms_test (same guarded globalSetup)
// so negative-path fixtures from the main suite can never be present.
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["tests/baseline/**/*.test.ts"], exclude: ["**/node_modules/**"] },
});
