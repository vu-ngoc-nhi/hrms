// LOCAL DEVELOPMENT / TEST ONLY — owner-authority provisioning for access administration (C-89).
// Creates the development operator LOGIN role(s) with the PUBLIC development password, identifies the database
// environment and registers the operators through the owner-only routines. Staging/production are provisioned by IT
// with the runbook (docs/production/access-administration-runbook.md), never with this script.
import "dotenv/config";
import pg from "pg";
import { isLoopbackHost, productionCredentialVariables } from "../src/lib/db-safety";
import { TEST_TENANT_ID } from "../src/modules/identity/token-verifiers";

export const DEV_OPERATOR_PASSWORD = "hrms_local_dev_only"; // public, disposable development value (docker-compose.yml)
export type DevOperator = { login: string; objectId: string; name: string };
export const LOCAL_OPERATOR: DevOperator = { login: "hrms_local_operator", objectId: "00000000-0000-4000-8000-0000000000b0", name: "Local Development Operator" };
export const TEST_OPERATORS = {
  a: { login: "hrms_test_operator_a", objectId: "00000000-0000-4000-8000-0000000000b1", name: "Test Operator A" },
  b: { login: "hrms_test_operator_b", objectId: "00000000-0000-4000-8000-0000000000b2", name: "Test Operator B" },
} as const satisfies Record<string, DevOperator>;

/** Connection URL for a development operator login on the same server/database as `baseUrl`. */
export function operatorUrl(baseUrl: string, login: string): string {
  const u = new URL(baseUrl);
  u.username = login;
  u.password = DEV_OPERATOR_PASSWORD;
  return u.toString();
}

export async function provisionLocalAccess(
  ownerUrl: string,
  environment: "local" | "test",
  operators: readonly DevOperator[],
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const url = new URL(ownerUrl);
  const expectedDb = environment === "local" ? "/hrms_dev" : "/hrms_test";
  if (!isLoopbackHost(url) || url.pathname !== expectedDb) throw new Error(`Refusing: access provisioning for '${environment}' runs only on local ${expectedDb}`);
  if (env.APP_ENV !== "local" && env.APP_ENV !== "test") throw new Error("Refusing: APP_ENV must be local or test");
  if (env.NODE_ENV === "production" || productionCredentialVariables(env).length) throw new Error("Refusing: production-like environment");
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const db = (await client.query<{ db: string }>("SELECT current_database() AS db")).rows[0].db;
    if (`/${db}` !== expectedDb) throw new Error(`Refusing: connected to ${db}`);
    for (const op of operators) {
      const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [op.login])).rowCount;
      if (!exists) {
        await client.query(`CREATE ROLE ${op.login} LOGIN PASSWORD '${DEV_OPERATOR_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      }
      await client.query(`GRANT hrms_access_admin TO ${op.login}`);
      await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${op.login}`);
    }
    const current = (await client.query("SELECT environment, entra_tenant_id FROM public.access_environment")).rows[0];
    if (!current || current.environment !== environment || current.entra_tenant_id !== TEST_TENANT_ID) {
      await client.query("SELECT public.access_environment_configure($1, $2, $3)", [environment, TEST_TENANT_ID, `Local ${environment} provisioning`]);
    }
    for (const op of operators) {
      const reg = (await client.query("SELECT is_active, entra_object_id FROM public.access_operator WHERE db_login = $1", [op.login])).rows[0];
      if (!reg || !reg.is_active || reg.entra_object_id !== op.objectId) {
        await client.query("SELECT public.access_operator_register($1, $2, $3, $4, $5)", [op.login, TEST_TENANT_ID, op.objectId, op.name, `Local ${environment} provisioning`]);
      }
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  if (!ownerUrl) throw new Error("MIGRATION_DATABASE_URL is not set");
  provisionLocalAccess(ownerUrl, "local", [LOCAL_OPERATOR]).then(
    () => console.log("Local access administration provisioned (environment 'local', operator hrms_local_operator)."),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
