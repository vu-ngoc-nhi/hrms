// Read-only integrity scan (H4) of a LOCAL database: `npm run integrity:scan` (DATABASE_URL from .env), or
// `INTEGRITY_DATABASE_URL=... npm run integrity:scan` for another local database such as hrms_test.
// Refuses non-loopback hosts and production-like variables; runs every check in a READ ONLY transaction and rolls back.
// Prints ids and dates only. Exit code 1 when an "error" finding exists.
import "dotenv/config";
import pg from "pg";
import { todayInVietnam } from "../src/lib/dates";
import { isLoopbackHost, productionCredentialVariables } from "../src/lib/db-safety";
import { INTEGRITY_CHECK_NAMES, runIntegrityChecks } from "./integrity-checks";

async function main() {
  const raw = process.env.INTEGRITY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  const url = new URL(raw);
  if (!isLoopbackHost(url)) throw new Error("Refusing to scan a non-local database.");
  const prod = productionCredentialVariables(process.env);
  if (prod.length) throw new Error(`Refusing to run with production-like variables present: ${prod.join(", ")}`);

  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query("SELECT current_database() AS db");
    const today = todayInVietnam();
    const findings = await runIntegrityChecks(client, today);
    await client.query("ROLLBACK");
    console.log(`Integrity scan of ${rows[0].db} (read-only) as of ${today}`);
    for (const name of INTEGRITY_CHECK_NAMES) {
      const hits = findings.filter((f) => f.check === name);
      const severity = hits[0]?.severity ?? "";
      console.log(`  ${hits.length ? (severity === "error" ? "ERROR  " : "WARNING") : "ok     "} ${name}: ${hits.length}`);
      for (const f of hits.slice(0, 5)) console.log(`           ${JSON.stringify(f.ids)}${f.detail ? ` — ${f.detail}` : ""}`);
      if (hits.length > 5) console.log(`           … ${hits.length - 5} more`);
    }
    const errors = findings.filter((f) => f.severity === "error").length;
    console.log(`Errors: ${errors} · Warnings: ${findings.length - errors}`);
    process.exitCode = errors ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
