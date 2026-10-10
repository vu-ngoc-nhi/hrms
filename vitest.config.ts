import { config as loadEnv } from "dotenv";
import path from "node:path";
import { defineConfig } from "vitest/config";

const env = loadEnv({ path: ".env", quiet: true }).parsed ?? {};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false, // các file dùng chung một DB kiểm thử
    // The clean integrity baseline runs separately on its own fresh database (vitest.integrity-baseline.config.ts).
    exclude: ["**/node_modules/**", "tests/baseline/**", "tests/uat/**"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      ...env,
      APP_ENV: "test",
      NODE_ENV: "test",
      AUTH_MODE: "test",
      AUTH_TEST_ISSUER_ENABLED: "true",
      // Ứng dụng trong kiểm thử chạy bằng role hrms_app trên DB riêng hrms_test.
      DATABASE_URL: env.TEST_DATABASE_URL ?? "",
      MIGRATION_DATABASE_URL: env.TEST_MIGRATION_DATABASE_URL ?? "",
    },
  },
});
