// Applies pending migrations to the configured LOCAL database only. Any non-local or production target is refused;
// those migrations must be run manually after explicit approval.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { assertSafeMigrationTarget } from "../src/lib/db-safety";

try {
  assertSafeMigrationTarget(process.env);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
