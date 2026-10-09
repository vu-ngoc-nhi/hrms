// Recreates the local test database schema (hrms_test) from migrations.
// Guarded by assertSafeTestDatabaseReset: fails closed unless the target is positively identified as local test.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { assertSafeTestDatabaseReset, TEST_DATABASE_NAME, UnsafeDatabaseOperation } from "../src/lib/db-safety";

export async function resetTestDatabase(env: Record<string, string | undefined> = process.env) {
  const url = assertSafeTestDatabaseReset(env);
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    // Second check against the server itself, not only the connection string.
    const { rows } = await client.query<{ db: string }>("SELECT current_database() AS db");
    if (rows[0]?.db !== TEST_DATABASE_NAME) {
      throw new UnsafeDatabaseOperation(`connected database is '${rows[0]?.db}', expected '${TEST_DATABASE_NAME}'`);
    }
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, MIGRATION_DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetTestDatabase().then(
    () => console.log(`${TEST_DATABASE_NAME} reset and migrated`),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
