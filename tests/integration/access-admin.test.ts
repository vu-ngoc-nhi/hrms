import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listEmployees } from "@/app/api/v1/core-hr/employees/route";
import {
  type AccessChange,
  AccessAdminError,
  applyChange,
  callCreate,
  callRole,
  callSetEnabled,
  listUsers,
  policyDrift,
  stateOf,
} from "@/modules/identity/access-admin";
import { EXIT, runAccessCli } from "@/modules/identity/access-admin-cli";
import { ADMINISTRATIVE_PERMISSIONS, isAdministrative, permissionsForRoles, ROLE_PERMISSIONS } from "@/modules/identity/permissions";
import { TEST_TENANT_ID } from "@/modules/identity/token-verifiers";
import { DEV_OPERATOR_PASSWORD, operatorUrl, TEST_OPERATORS } from "../../scripts/access-provision-local";
import { TEST_USERS } from "../../scripts/seed-data";
import { call, tokenFor, withOwner } from "../helpers";

// Guarded access administration (C-89, C-93; docs/design/access-administration-command.md revision 2).
const ENV = "test";
const OP_A = TEST_OPERATORS.a; // Entra oid ...b1
const OP_B = TEST_OPERATORS.b; // Entra oid ...b2
const ADMIN_OID = TEST_USERS.admin.oid; // the seeded (only) active administrator
let owner: pg.Client;
let opA: pg.Client;
let opB: pg.Client;
let app: pg.Client;
let n = 0;
const oid = () => {
  n += 1;
  return `00000000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`;
};

const connect = async (url: string) => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
};
const userByOid = async (c: pg.Client, objectId: string) => (await listUsers(c)).find((u) => u.objectId === objectId)!;
const auditCount = async () => Number((await owner.query("SELECT count(*) AS n FROM access_audit_event")).rows[0].n);
const adminCount = async () => (await owner.query<{ n: number }>("SELECT public.access_admin_count() AS n")).rows[0].n;

async function create(c: pg.Client, objectId: string, roles: string[] = [], name = `Access Test ${objectId.slice(-4)}`) {
  return applyChange(c, { environment: ENV, tenantId: TEST_TENANT_ID, reason: "Access test", target: null, expected: null, change: { kind: "create", roles }, create: { objectId, displayName: name } });
}
async function change(c: pg.Client, objectId: string, ch: AccessChange, reason = "Access test") {
  const target = await userByOid(c, objectId);
  return applyChange(c, { environment: ENV, tenantId: TEST_TENANT_ID, reason, target, expected: await stateOf(c, target.id), change: ch });
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (e instanceof AccessAdminError) return e.code;
    const m = /^(ACCESS_[A-Z_]+):/.exec((e as Error)?.message ?? "");
    return m ? m[1] : ((e as { code?: string }).code ?? String(e));
  }
}
async function sqlState(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  }
}
async function ensureSeedAdminActive() {
  await withOwner((c) => c.query("UPDATE app_user SET is_enabled = true WHERE entra_tenant_id = $1 AND entra_object_id = $2", [TEST_TENANT_ID, ADMIN_OID]));
  const u = await userByOid(opA, ADMIN_OID);
  if (!u.roles.includes("HR_ADMIN")) await change(opA, ADMIN_OID, { kind: "assign", role: "HR_ADMIN" });
}

function cli(argv: string[], opts: { login?: string; url?: string; appEnv?: string; prompt?: (q: string) => Promise<string> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const env = { ACCESS_ADMIN_DATABASE_URL: opts.url ?? operatorUrl(process.env.DATABASE_URL!, opts.login ?? OP_A.login), APP_ENV: "appEnv" in opts ? opts.appEnv : "test" };
  return runAccessCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), prompt: opts.prompt }, env).then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

beforeAll(async () => {
  owner = await connect(process.env.MIGRATION_DATABASE_URL!);
  opA = await connect(operatorUrl(process.env.DATABASE_URL!, OP_A.login));
  opB = await connect(operatorUrl(process.env.DATABASE_URL!, OP_B.login));
  app = await connect(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await ensureSeedAdminActive();
  await Promise.all([owner.end(), opA.end(), opB.end(), app.end()]);
});

describe("Policy mirror and central administrative definition", () => {
  it("the database policy mirror equals the code model (role → permissions, administrative capabilities)", async () => {
    expect(await policyDrift(opA)).toEqual([]);
    const rows = (await owner.query("SELECT role_code, permission FROM access_role_permission")).rows;
    const fromDb = Object.fromEntries([...new Set(rows.map((r) => r.role_code))].map((r) => [r, rows.filter((x) => x.role_code === r).map((x) => x.permission).sort()]));
    expect(fromDb).toEqual(Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([r, p]) => [r, [...p].sort()])));
    expect((await owner.query("SELECT public.access_admin_permissions() AS p")).rows[0].p.sort()).toEqual([...ADMINISTRATIVE_PERMISSIONS].sort());
    expect(Object.keys(fromDb)).not.toContain("HR_VIEWER");
  });
  it("administrative = enabled AND every administrative capability; defined once, never by role name", () => {
    expect(isAdministrative({ enabled: true, permissions: permissionsForRoles(["HR_ADMIN"]) })).toBe(true);
    expect(isAdministrative({ enabled: false, permissions: permissionsForRoles(["HR_ADMIN"]) })).toBe(false);
    expect(isAdministrative({ enabled: true, permissions: permissionsForRoles(["HR_EDITOR", "API_DOCS_READER", "HR_VIEWER"]) })).toBe(false);
    for (const f of ["src/modules/identity/access-admin.ts", "src/modules/identity/access-admin-cli.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/HR_ADMIN|employment\.correct|catalogs\.manage|employees\.set_code/);
    }
  });
});

describe("SECURITY DEFINER hardening and privilege boundaries", () => {
  const MUTATIONS = [
    "access_user_create(text,uuid,uuid,text,text,uuid)",
    "access_user_set_enabled(text,uuid,boolean,jsonb,text,uuid)",
    "access_role_assign(text,uuid,text,jsonb,text,uuid)",
    "access_role_remove(text,uuid,text,jsonb,text,uuid)",
  ];
  const READS = ["access_admin_permissions()", "access_effective_permissions(uuid)", "access_admin_count()", "access_user_state(uuid)"];
  const INTERNAL = [
    "access_begin(text)",
    "access_reason(text)",
    "access_check_guards(uuid,integer,text[],uuid,uuid)",
    "access_write_audit(text,text,uuid,text,uuid,text,text,jsonb,jsonb,text,uuid)",
    "access_require_user(uuid,jsonb)",
  ];
  const OWNER_ONLY = ["access_environment_configure(text,uuid,text)", "access_operator_register(text,uuid,uuid,text,text)", "access_operator_deactivate(text,text)"];
  const ALL = [...MUTATIONS, ...READS, ...INTERNAL, ...OWNER_ONLY];
  const ACCESS_TABLES = ["app_user", "app_user_role", "access_audit_event", "access_operator", "access_environment", "access_role_permission"];
  const can = async (role: string, fn: string) =>
    (await owner.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, `public.${fn}`])).rows[0].ok as boolean;
  // Every table privilege actually granted to a role in schema public, as "table:PRIVILEGE" (table ACLs only).
  const tableGrants = async (role: string) =>
    (
      await owner.query(
        `SELECT c.relname || ':' || a.privilege_type AS g FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE ns.nspname = 'public' AND a.grantee = $1::regrole ORDER BY 1`,
        [role],
      )
    ).rows.map((r) => r.g);
  const columnGrants = async (role: string) =>
    (
      await owner.query(
        `SELECT c.relname || '.' || at.attname || ':' || a.privilege_type AS g FROM pg_attribute at
         JOIN pg_class c ON c.oid = at.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(at.attacl) a WHERE ns.nspname = 'public' AND a.grantee = $1::regrole ORDER BY 1`,
        [role],
      )
    ).rows.map((r) => r.g);

  it("SECURITY DEFINER owner: hrms_access_function_owner — NOLOGIN, NOSUPERUSER, no members, not an operator or app role", async () => {
    const { rows } = await owner.query(
      `SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
       JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname LIKE 'access\\_%' AND p.proname <> 'access_audit_event_append_only'`,
    );
    expect(rows.length).toBe(ALL.length);
    for (const r of rows) expect(r.owner, r.proname).toBe("hrms_access_function_owner"); // never the schema owner / superuser
    expect(rows.filter((r) => r.prosecdef).map((r) => r.proname).sort()).toEqual([
      "access_environment_configure", "access_operator_deactivate", "access_operator_register",
      "access_role_assign", "access_role_remove", "access_user_create", "access_user_set_enabled",
    ]);
    const role = (await owner.query("SELECT * FROM pg_roles WHERE rolname = 'hrms_access_function_owner'")).rows[0];
    expect({ login: role.rolcanlogin, superuser: role.rolsuper, createrole: role.rolcreaterole, createdb: role.rolcreatedb, bypassrls: role.rolbypassrls, replication: role.rolreplication })
      .toEqual({ login: false, superuser: false, createrole: false, createdb: false, bypassrls: false, replication: false });
    // Nobody can act as the owner: it has no members (locally the migration runs as superuser) and is not the operator/app role.
    expect((await owner.query("SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid = 'hrms_access_function_owner'::regrole")).rows[0].n).toBe(0);
    for (const r of ["hrms_access_admin", "hrms_app", OP_A.login, OP_B.login]) {
      expect((await owner.query("SELECT pg_has_role($1, 'hrms_access_function_owner', 'MEMBER') AS m", [r])).rows[0].m, r).toBe(false);
    }
    const u = new URL(process.env.DATABASE_URL!);
    u.username = "hrms_access_function_owner";
    u.password = DEV_OPERATOR_PASSWORD;
    await expect(connect(u.toString())).rejects.toBeTruthy(); // NOLOGIN
    expect(await sqlState(opA.query("SET ROLE hrms_access_function_owner"))).toBe("42501");
    expect(await sqlState(opA.query("SET ROLE hrms_owner"))).toBe("42501");
  });

  it("the function owner holds exactly the minimum privileges (no Core HR table, no CREATE/TEMP)", async () => {
    expect(await tableGrants("hrms_access_function_owner")).toEqual([
      "access_audit_event:INSERT",
      "access_environment:INSERT", "access_environment:SELECT", "access_environment:UPDATE",
      "access_operator:INSERT", "access_operator:SELECT", "access_operator:UPDATE",
      "access_role_permission:SELECT",
      "app_user:INSERT", "app_user:SELECT",
      "app_user_role:DELETE", "app_user_role:INSERT", "app_user_role:SELECT",
    ]);
    expect(await columnGrants("hrms_access_function_owner")).toEqual(["app_user.is_enabled:UPDATE", "app_user.updated_at:UPDATE"]);
    const p = (await owner.query(
      `SELECT has_schema_privilege('hrms_access_function_owner', 'public', 'USAGE') AS usage, has_schema_privilege('hrms_access_function_owner', 'public', 'CREATE') AS create,
              has_database_privilege('hrms_access_function_owner', current_database(), 'TEMP') AS temp, has_database_privilege('hrms_access_function_owner', current_database(), 'CREATE') AS dbcreate`,
    )).rows[0];
    expect(p).toEqual({ usage: true, create: false, temp: false, dbcreate: false });
  });

  it("EXECUTE: PUBLIC and hrms_app none; hrms_access_admin only the four mutations and read helpers; provisioning owner-only", async () => {
    for (const fn of ALL) {
      expect((await owner.query("SELECT bool_or(a.grantee = 0) AS public FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure", [`public.${fn}`])).rows[0].public ?? false, fn).toBe(false);
      expect(await can("hrms_app", fn), fn).toBe(false);
    }
    for (const fn of [...MUTATIONS, ...READS]) expect(await can("hrms_access_admin", fn), fn).toBe(true);
    for (const fn of [...INTERNAL, ...OWNER_ONLY]) expect(await can("hrms_access_admin", fn), fn).toBe(false);
    expect(await sqlState(app.query("SELECT public.access_user_create('test', $1, $2, 'X', 'r', NULL)", [TEST_TENANT_ID, oid()]))).toBe("42501");
    expect(await sqlState(opA.query("SELECT public.access_operator_register('x', $1, $2, 'x', 'r')", [TEST_TENANT_ID, oid()]))).toBe("42501");
  });

  it("A. operator privilege boundary: exactly SELECT on access-control tables, no DML, no TEMP/CREATE, no HR tables", async () => {
    expect(await tableGrants("hrms_access_admin")).toEqual(ACCESS_TABLES.map((t) => `${t}:SELECT`).sort());
    expect(await columnGrants("hrms_access_admin")).toEqual([]);
    for (const login of ["hrms_access_admin", OP_A.login, OP_B.login]) {
      const p = (await owner.query(
        `SELECT has_schema_privilege($1, 'public', 'CREATE') AS create, has_database_privilege($1, current_database(), 'TEMP') AS temp,
                has_database_privilege($1, current_database(), 'CREATE') AS dbcreate`,
        [login],
      )).rows[0];
      expect(p, login).toEqual({ create: false, temp: false, dbcreate: false });
      for (const t of ["person", "employment", "job_assignment", "employment_event", "audit_event", "employee_code_registry"]) {
        expect((await owner.query("SELECT has_table_privilege($1, $2, 'SELECT') AS ok", [login, t])).rows[0].ok, `${login} ${t}`).toBe(false);
      }
    }
    // Consequences, observed as an operator: no objects can be created, not even temporary ones.
    expect(await sqlState(opA.query("CREATE TABLE public.x_hijack (id int)"))).toBe("42501");
    expect(await sqlState(opA.query("CREATE OR REPLACE FUNCTION public.access_admin_count() RETURNS integer LANGUAGE sql AS 'SELECT 5'"))).toBe("42501");
    expect(await sqlState(opA.query("CREATE TEMP TABLE access_role_permission (role_code text, permission text)"))).toBe("42501");
  });

  it("B. SECURITY DEFINER safety: pinned function search_path and schema-qualified references", async () => {
    const { rows } = await owner.query(
      `SELECT p.proname, p.proconfig, p.prosrc FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname LIKE 'access\\_%' AND p.proname <> 'access_audit_event_append_only'`,
    );
    const objects = [...ACCESS_TABLES, ...rows.map((r) => r.proname)];
    for (const r of rows) {
      expect(r.proconfig, r.proname).toEqual(["search_path=pg_catalog, pg_temp"]); // public and caller paths excluded
      // Every reference to an access-control table or access routine is qualified with "public.".
      const unqualified = objects.filter((o) => o !== r.proname && new RegExp(`(?<![.\\w])${o}\\b(?!\\s*:=)`).test(r.prosrc.replace(/'[^']*'/g, "''")));
      expect(unqualified, r.proname).toEqual([]);
    }
  });

  it("B. a caller-controlled search_path and shadow objects in pg_temp do not change routine behaviour", async () => {
    // A dedicated test-only operator WITH the TEMP privilege (never granted in production) proves the function-level
    // protection independently of the privilege boundary above.
    await owner.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_test_operator_temp') THEN CREATE ROLE hrms_test_operator_temp LOGIN PASSWORD 'hrms_local_dev_only'; END IF; END $$");
    await owner.query("GRANT hrms_access_admin TO hrms_test_operator_temp");
    await owner.query("GRANT CONNECT, TEMPORARY ON DATABASE hrms_test TO hrms_test_operator_temp");
    await owner.query("SELECT public.access_operator_register('hrms_test_operator_temp', $1, $2, 'Test Operator TEMP', 'search_path test')", [TEST_TENANT_ID, oid()]);
    const opT = await connect(operatorUrl(process.env.DATABASE_URL!, "hrms_test_operator_temp"));
    try {
      const target = oid();
      await create(opB, target);
      const u = await userByOid(opT, target);
      // Shadow tables a naive routine would resolve: fake policy (HR_VIEWER supported, granting admin capabilities),
      // fake operator mapping and fake environment.
      await opT.query("CREATE TEMP TABLE access_role_permission (role_code text, permission text)");
      await opT.query("INSERT INTO access_role_permission VALUES ('HR_VIEWER', 'employment.correct'), ('HR_VIEWER', 'catalogs.manage'), ('HR_VIEWER', 'employees.set_code')");
      await opT.query("CREATE TEMP TABLE access_environment (singleton boolean, environment text, entra_tenant_id uuid)");
      await opT.query("INSERT INTO access_environment VALUES (true, 'production', $1)", [TEST_TENANT_ID]);
      await opT.query("SET search_path = pg_temp, public");
      const expected = (await stateOf(opT, u.id))!;
      const common = { reason: "search_path test", correlationId: crypto.randomUUID() };
      expect(await codeOf(inTxOn(opT, () => callRole(opT, "assign", { ...common, environment: ENV, userId: u.id, role: "HR_VIEWER", expected })))).toBe("ACCESS_ROLE_NOT_SUPPORTED");
      expect(await codeOf(inTxOn(opT, () => callRole(opT, "assign", { ...common, environment: "production", userId: u.id, role: "HR_EDITOR", expected })))).toBe("ACCESS_ENVIRONMENT_MISMATCH");
      expect(await codeOf(inTxOn(opT, () => callRole(opT, "assign", { ...common, environment: ENV, userId: u.id, role: "HR_EDITOR", expected })))).toBe("OK");
      expect(await adminCount()).toBe(1); // the shadow policy never made anyone administrative
    } finally {
      await opT.end();
      await owner.query("REVOKE TEMPORARY ON DATABASE hrms_test FROM hrms_test_operator_temp");
      await owner.query("SELECT public.access_operator_deactivate('hrms_test_operator_temp', 'search_path test done')");
    }
  });
});

describe("No raw DML bypass", () => {
  it("operators hold no INSERT/UPDATE/DELETE on any access-control table", async () => {
    const id = (await userByOid(opA, ADMIN_OID)).id;
    const attempts = [
      ["INSERT INTO app_user (entra_tenant_id, entra_object_id, display_name) VALUES ($1, $2, 'x')", [TEST_TENANT_ID, oid()]],
      ["UPDATE app_user SET is_enabled = false WHERE id = $1", [id]],
      ["DELETE FROM app_user WHERE id = $1", [id]],
      ["INSERT INTO app_user_role (user_id, role_code) VALUES ($1, 'HR_EDITOR')", [id]],
      ["UPDATE app_user_role SET role_code = 'HR_EDITOR' WHERE user_id = $1", [id]],
      ["DELETE FROM app_user_role WHERE user_id = $1", [id]],
      ["INSERT INTO access_audit_event (environment, operator_login, action, new_state, reason, correlation_id) VALUES ('test','x','environment_configured','{}','x',gen_random_uuid())", []],
      ["UPDATE access_audit_event SET reason = 'x'", []],
      ["DELETE FROM access_audit_event", []],
      ["INSERT INTO access_operator (db_login, entra_tenant_id, entra_object_id, display_name) VALUES ('evil_op', $1, $2, 'x')", [TEST_TENANT_ID, oid()]],
      ["UPDATE access_operator SET entra_object_id = $1", [oid()]],
      ["UPDATE access_environment SET environment = 'production'", []],
      ["INSERT INTO access_role_permission VALUES ('HR_VIEWER', 'employment.correct')", []],
    ] as const;
    for (const [sql, params] of attempts) expect(await sqlState(opA.query(sql, [...params])), sql).toBe("42501");
  });

  it("the runtime role hrms_app can read accounts but not change them or read access administration data", async () => {
    const id = (await userByOid(opA, ADMIN_OID)).id;
    expect((await app.query("SELECT count(*) FROM app_user")).rowCount).toBe(1);
    for (const [sql, params] of [
      ["INSERT INTO app_user (entra_tenant_id, entra_object_id, display_name) VALUES ($1, $2, 'x')", [TEST_TENANT_ID, oid()]],
      ["UPDATE app_user SET is_enabled = false WHERE id = $1", [id]],
      ["INSERT INTO app_user_role (user_id, role_code) VALUES ($1, 'HR_EDITOR')", [id]],
      ["DELETE FROM app_user_role WHERE user_id = $1", [id]],
      ["SELECT * FROM access_audit_event", []],
      ["SELECT * FROM access_operator", []],
    ] as const) {
      expect(await sqlState(app.query(sql, [...params])), sql).toBe("42501");
    }
  });

  it("the audit is append-only even for the owner (trigger), including TRUNCATE", async () => {
    expect(await sqlState(owner.query("UPDATE access_audit_event SET reason = 'tampered'"))).toBe("23514");
    expect(await sqlState(owner.query("DELETE FROM access_audit_event"))).toBe("23514");
    expect(await sqlState(owner.query("TRUNCATE access_audit_event"))).toBe("23514");
  });
});

describe("Trusted operator identity", () => {
  it("the audit actor comes from session_user and the protected mapping, not from a session variable", async () => {
    const target = oid();
    await opA.query(`SET hrms.operator_oid = '${TEST_OPERATORS.b.objectId}'`);
    try {
      await create(opA, target, ["HR_EDITOR"]);
    } finally {
      await opA.query("RESET hrms.operator_oid");
    }
    const { rows } = await owner.query(
      "SELECT operator_login, operator_entra_object_id FROM access_audit_event e JOIN app_user u ON u.id = e.target_user_id WHERE u.entra_object_id = $1",
      [target],
    );
    expect(rows).toEqual([
      { operator_login: OP_A.login, operator_entra_object_id: OP_A.objectId },
      { operator_login: OP_A.login, operator_entra_object_id: OP_A.objectId },
    ]);
  });

  it("an unregistered or deactivated login is refused; the CLI accepts no operator identity option", async () => {
    await owner.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_test_operator_c') THEN CREATE ROLE hrms_test_operator_c LOGIN PASSWORD 'hrms_local_dev_only'; END IF; END $$");
    await owner.query("GRANT hrms_access_admin TO hrms_test_operator_c");
    await owner.query("GRANT CONNECT ON DATABASE hrms_test TO hrms_test_operator_c");
    const opC = await connect(operatorUrl(process.env.DATABASE_URL!, "hrms_test_operator_c"));
    try {
      expect(await codeOf(create(opC, oid()))).toBe("ACCESS_OPERATOR_UNKNOWN");
      await owner.query("SELECT public.access_operator_register('hrms_test_operator_c', $1, $2, 'Test Operator C', 'test')", [TEST_TENANT_ID, oid()]);
      expect(await codeOf(create(opC, oid()))).toBe("OK");
      await owner.query("SELECT public.access_operator_deactivate('hrms_test_operator_c', 'test')");
      expect(await codeOf(create(opC, oid()))).toBe("ACCESS_OPERATOR_UNKNOWN");
      expect((await cli(["env", "--env", ENV], { login: "hrms_test_operator_c" })).code).toBe(EXIT.ENVIRONMENT);
    } finally {
      await opC.end();
    }
    expect((await cli(["user", "list", "--env", ENV, "--operator-oid", OP_B.objectId])).code).toBe(EXIT.USAGE);
  });

  it("operator registration requires a plain member of hrms_access_admin in the environment tenant", async () => {
    expect(await codeOf(owner.query("SELECT public.access_operator_register('hrms_app', $1, $2, 'x', 'test')", [TEST_TENANT_ID, oid()]).catch((e) => {
      throw new AccessAdminError(/^(ACCESS_[A-Z_]+)/.exec(e.message)?.[1] ?? "?", e.message);
    }))).toBe("ACCESS_INVALID_INPUT");
    expect(await codeOf(owner.query("SELECT public.access_operator_register($1, $2, $3, 'x', 'test')", [OP_A.login, "22222222-2222-4222-8222-222222222222", oid()]).catch((e) => {
      throw new AccessAdminError(/^(ACCESS_[A-Z_]+)/.exec(e.message)?.[1] ?? "?", e.message);
    }))).toBe("ACCESS_TENANT_MISMATCH");
  });
});

describe("Self-escalation guard (operator A = Entra oid ...b1)", () => {
  it("regression: operator X enabling their own disabled account whose retained role would restore HR permissions → rejected", async () => {
    await create(opB, OP_A.objectId, ["HR_EDITOR"], "Operator A as HR user"); // provisioned by ANOTHER operator
    await change(opB, OP_A.objectId, { kind: "disable" });
    const before = await auditCount();
    const u = await userByOid(opA, OP_A.objectId);
    expect([u.enabled, u.roles]).toEqual([false, ["HR_EDITOR"]]);
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "enable" }))).toBe("ACCESS_SELF_ESCALATION");
    const cliTry = await cli(["user", "enable", "--env", ENV, "--oid", OP_A.objectId, "--reason", "Self enable attempt", "--confirm", `${ENV}:${OP_A.objectId}`]);
    expect(cliTry.code).toBe(EXIT.GUARD);
    expect(cliTry.out).toContain("target is YOUR OWN Entra identity");
    expect(await userByOid(opA, OP_A.objectId)).toMatchObject({ enabled: false, roles: ["HR_EDITOR"] });
    expect(await auditCount()).toBe(before);
    // Another operator may enable it; that is not self-escalation.
    expect(await codeOf(change(opB, OP_A.objectId, { kind: "enable" }))).toBe("OK");
  });

  it("blocks any increase of the operator's own effective permissions (assign, re-enable)", async () => {
    expect((await userByOid(opA, OP_A.objectId)).roles).toEqual(["HR_EDITOR"]);
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "assign", role: "HR_ADMIN" }))).toBe("ACCESS_SELF_ESCALATION");
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "assign", role: "API_DOCS_READER" }))).toBe("ACCESS_SELF_ESCALATION");
    // While disabled an extra role adds no effective permission (allowed), but enabling is then refused.
    await change(opB, OP_A.objectId, { kind: "disable" });
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "assign", role: "API_DOCS_READER" }))).toBe("OK");
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "enable" }))).toBe("ACCESS_SELF_ESCALATION");
    await change(opB, OP_A.objectId, { kind: "enable" });
  });

  it("self-reducing actions (remove own role, disable own account) are allowed while another admin remains", async () => {
    await change(opB, OP_A.objectId, { kind: "assign", role: "HR_ADMIN" });
    expect(await adminCount()).toBe(2);
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "remove", role: "API_DOCS_READER" }))).toBe("OK");
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "remove", role: "HR_ADMIN" }))).toBe("OK"); // 2 → 1
    expect(await codeOf(change(opA, OP_A.objectId, { kind: "disable" }))).toBe("OK");
    expect(await adminCount()).toBe(1);
  });

  it("self-reduction is still subject to the last-admin rule", async () => {
    const bUser = OP_B.objectId;
    await create(opA, bUser, ["HR_ADMIN"], "Operator B as HR user");
    await withOwner((c) => c.query("UPDATE app_user SET is_enabled = false WHERE entra_tenant_id = $1 AND entra_object_id = $2", [TEST_TENANT_ID, ADMIN_OID]));
    try {
      expect(await adminCount()).toBe(1); // operator B's own account is the only administrator
      expect(await codeOf(change(opB, bUser, { kind: "disable" }))).toBe("ACCESS_LAST_ADMIN");
      expect(await codeOf(change(opB, bUser, { kind: "remove", role: "HR_ADMIN" }))).toBe("ACCESS_LAST_ADMIN");
    } finally {
      await ensureSeedAdminActive();
    }
    expect(await codeOf(change(opB, bUser, { kind: "disable" }))).toBe("OK");
  });
});

describe("Last-admin invariant (capability-based)", () => {
  it("1 → 0 is refused for disable and for removing the administrative role", async () => {
    expect(await adminCount()).toBe(1);
    const before = await auditCount();
    expect(await codeOf(change(opA, ADMIN_OID, { kind: "disable" }))).toBe("ACCESS_LAST_ADMIN");
    expect(await codeOf(change(opA, ADMIN_OID, { kind: "remove", role: "HR_ADMIN" }))).toBe("ACCESS_LAST_ADMIN");
    expect(await auditCount()).toBe(before);
    const u = await userByOid(opA, ADMIN_OID);
    expect([u.enabled, u.roles]).toEqual([true, ["HR_ADMIN"]]);
  });

  it("2 → 1 is allowed (with a warning in the CLI); a change that leaves another admin is allowed", async () => {
    const x = oid();
    await create(opA, x, ["HR_ADMIN", "HR_EDITOR"]);
    expect(await adminCount()).toBe(2);
    const r = await cli(["role", "remove", "--env", ENV, "--oid", x, "--role", "HR_ADMIN", "--reason", "Duty change", "--confirm", `${ENV}:${x}`]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.out).toContain("only ONE active administrator would remain");
    expect(await adminCount()).toBe(1);
    await change(opA, x, { kind: "assign", role: "HR_ADMIN" });
    expect((await change(opA, x, { kind: "disable" }))[0].admins_after).toBe(1);
  });

  it("0 → 1 bootstrap is allowed when the system has no active administrator", async () => {
    await withOwner((c) => c.query("UPDATE app_user SET is_enabled = false WHERE entra_tenant_id = $1 AND entra_object_id = $2", [TEST_TENANT_ID, ADMIN_OID]));
    try {
      expect(await adminCount()).toBe(0);
      const first = oid();
      const r = await cli(["user", "create", "--env", ENV, "--oid", first, "--name", "First Admin", "--role", "HR_ADMIN", "--reason", "Production bootstrap rehearsal", "--confirm", `${ENV}:${first}`]);
      expect(r.code, r.err).toBe(EXIT.OK);
      expect(await adminCount()).toBe(1);
      await ensureSeedAdminActive();
      await change(opA, first, { kind: "disable" });
    } finally {
      await ensureSeedAdminActive();
    }
  });
});

describe("Concurrency (global advisory lock, READ COMMITTED)", () => {
  async function overlapping(first: () => Promise<unknown>, second: () => Promise<unknown>, a: pg.Client, b: pg.Client) {
    // T1 holds the access lock (inside an open transaction) while T2 starts and must wait for it.
    await a.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await b.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    let r1: string;
    try {
      r1 = await codeOf(first());
    } catch (e) {
      r1 = String(e);
    }
    const p2 = codeOf(second());
    for (let i = 0; i < 50; i += 1) {
      const waiting = (await owner.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")).rows[0].n;
      if (waiting > 0) break;
      await new Promise((res) => setTimeout(res, 20));
    }
    await a.query(r1 === "OK" ? "COMMIT" : "ROLLBACK");
    const r2 = await p2;
    await b.query(r2 === "OK" ? "COMMIT" : "ROLLBACK");
    return [r1, r2];
  }
  const raw = async (c: pg.Client, objectId: string, ch: AccessChange) => {
    const u = await userByOid(c, objectId);
    const expected = (await stateOf(c, u.id))!;
    const common = { environment: ENV, reason: "Concurrent test", correlationId: crypto.randomUUID() };
    if (ch.kind === "disable") return callSetEnabled(c, { ...common, userId: u.id, enabled: false, expected });
    if (ch.kind === "remove") return callRole(c, "remove", { ...common, userId: u.id, role: ch.role, expected });
    throw new Error("unsupported");
  };

  it("two operators removing the last two administrators concurrently: exactly one succeeds (repeated)", async () => {
    for (let i = 0; i < 4; i += 1) {
      const z = oid();
      await create(opA, z, ["HR_ADMIN"]);
      expect(await adminCount()).toBe(2);
      const kinds: AccessChange[][] = [
        [{ kind: "disable" }, { kind: "disable" }],
        [{ kind: "remove", role: "HR_ADMIN" }, { kind: "remove", role: "HR_ADMIN" }],
        [{ kind: "disable" }, { kind: "remove", role: "HR_ADMIN" }],
        [{ kind: "remove", role: "HR_ADMIN" }, { kind: "disable" }],
      ];
      const [k1, k2] = kinds[i];
      const outcome = await overlapping(() => raw(opA, z, k1), () => raw(opB, ADMIN_OID, k2), opA, opB);
      expect(outcome).toEqual(["OK", "ACCESS_LAST_ADMIN"]);
      expect(await adminCount()).toBe(1);
      const zUser = await userByOid(opA, z);
      expect(zUser.enabled && zUser.roles.includes("HR_ADMIN")).toBe(false);
      const seed = await userByOid(opA, ADMIN_OID);
      expect([seed.enabled, seed.roles]).toEqual([true, ["HR_ADMIN"]]);
    }
  });

  it("uncoordinated races (both autocommit) never reach zero administrators", async () => {
    for (let i = 0; i < 5; i += 1) {
      const z = oid();
      await create(opA, z, ["HR_ADMIN"]);
      const results = await Promise.all([codeOf(change(opA, z, { kind: "disable" })), codeOf(change(opB, ADMIN_OID, { kind: "disable" }))]);
      expect(results.filter((x) => x === "OK")).toHaveLength(1);
      expect(results.filter((x) => x === "ACCESS_LAST_ADMIN")).toHaveLength(1);
      expect(await adminCount()).toBe(1);
      await ensureSeedAdminActive();
      if ((await userByOid(opA, z)).enabled) await change(opA, z, { kind: "disable" });
    }
  });

  it("concurrent bootstrap from zero administrators: final state has >= 1 administrator with consistent audit", async () => {
    for (let round = 0; round < 3; round += 1) {
      await withOwner((c) => c.query("UPDATE app_user SET is_enabled = false WHERE entra_tenant_id = $1 AND entra_object_id = $2", [TEST_TENANT_ID, ADMIN_OID]));
      try {
        expect(await adminCount()).toBe(0);
        const [p, q] = [oid(), oid()];
        const results = await Promise.all([codeOf(create(opA, p, ["HR_ADMIN"])), codeOf(create(opB, q, ["HR_ADMIN"]))]);
        expect(results).toEqual(["OK", "OK"]); // both may safely succeed
        expect(await adminCount()).toBeGreaterThanOrEqual(1);
        // Audit consistent with the final state: per new administrator exactly user_created + role_assigned(HR_ADMIN),
        // one correlation id, written by the operator who performed it.
        for (const [x, op] of [[p, OP_A], [q, OP_B]] as const) {
          const { rows } = await owner.query(
            `SELECT e.action, e.role_code, e.operator_login, e.correlation_id, e.new_state FROM access_audit_event e
             JOIN app_user u ON u.id = e.target_user_id WHERE u.entra_object_id = $1 ORDER BY e.id`,
            [x],
          );
          expect(rows.map((r) => [r.action, r.role_code, r.operator_login])).toEqual([["user_created", null, op.login], ["role_assigned", "HR_ADMIN", op.login]]);
          expect(new Set(rows.map((r) => r.correlation_id)).size).toBe(1);
          expect(rows.at(-1).new_state).toEqual({ enabled: true, roles: ["HR_ADMIN"] });
          expect(await userByOid(opA, x)).toMatchObject({ enabled: true, roles: ["HR_ADMIN"] });
        }
        // The same identity from two operators at once: exactly one account exists afterwards.
        const same = oid();
        expect((await Promise.all([codeOf(create(opA, same)), codeOf(create(opB, same))])).sort()).toEqual(["ACCESS_USER_EXISTS", "OK"]);
        expect((await listUsers(opA)).filter((u) => u.objectId === same)).toHaveLength(1);
        await ensureSeedAdminActive();
        await change(opA, p, { kind: "disable" });
        await change(opA, q, { kind: "disable" });
      } finally {
        await ensureSeedAdminActive();
      }
      expect(await adminCount()).toBe(1);
    }
  });

  it("a stale preview is refused (ACCESS_STATE_CHANGED) and REPEATABLE READ is refused (ACCESS_ISOLATION)", async () => {
    const x = oid();
    await create(opA, x, ["HR_EDITOR"]);
    const u = await userByOid(opA, x);
    const stale = (await stateOf(opA, u.id))!;
    await change(opB, x, { kind: "assign", role: "API_DOCS_READER" });
    expect(await codeOf(applyChange(opA, { environment: ENV, tenantId: TEST_TENANT_ID, reason: "x", target: u, expected: stale, change: { kind: "remove", role: "HR_EDITOR" } }))).toBe("ACCESS_STATE_CHANGED");
    await opA.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      expect(await codeOf(callRole(opA, "remove", { environment: ENV, userId: u.id, role: "HR_EDITOR", expected: (await stateOf(opA, u.id))!, reason: "x", correlationId: crypto.randomUUID() }))).toBe("ACCESS_ISOLATION");
    } finally {
      await opA.query("ROLLBACK");
    }
  });
});

describe("Operations, roles, reason and audit", () => {
  it("create with roles: one transaction, one correlation id, audit rows with trusted actor, environment and reason", async () => {
    const x = oid();
    const before = await auditCount();
    const r = await cli(["user", "create", "--env", ENV, "--oid", x, "--name", "Nguyễn Thị Lan", "--role", "HR_EDITOR", "--role", "API_DOCS_READER", "--reason", "HR request #12", "--confirm", `${ENV}:${x}`, "--json"]);
    expect(r.code, r.err).toBe(EXIT.OK);
    expect(JSON.parse(r.out)).toMatchObject({ result: "changed", new_state: { enabled: true, roles: ["API_DOCS_READER", "HR_EDITOR"] } });
    const rows = (await owner.query("SELECT * FROM access_audit_event WHERE id > (SELECT max(id) - 3 FROM access_audit_event) ORDER BY id")).rows;
    expect(await auditCount()).toBe(before + 3);
    expect(rows.map((a) => [a.action, a.role_code])).toEqual([["user_created", null], ["role_assigned", "HR_EDITOR"], ["role_assigned", "API_DOCS_READER"]]);
    expect(new Set(rows.map((a) => a.correlation_id)).size).toBe(1);
    for (const a of rows) {
      expect(a).toMatchObject({ environment: "test", operator_login: OP_A.login, operator_entra_object_id: OP_A.objectId, reason: "HR request #12" });
      expect(Object.keys(a.new_state).sort()).toEqual(["enabled", "roles"]); // access state only, no HR data
    }
    expect(rows[0].previous_state).toBeNull();
    expect(rows[2].previous_state).toEqual({ enabled: true, roles: ["HR_EDITOR"] });
  });

  it("duplicate user, unsupported/stale roles, malformed codes, missing reasons", async () => {
    const x = oid();
    await create(opA, x, ["HR_EDITOR"]);
    const before = await auditCount();
    expect(await codeOf(create(opA, x))).toBe("ACCESS_USER_EXISTS");
    for (const role of ["FOO", "HR_VIEWER", "hr_admin"]) expect(await codeOf(change(opA, x, { kind: "assign", role })), role).toBe("ACCESS_ROLE_NOT_SUPPORTED");
    expect(await codeOf(change(opA, x, { kind: "remove", role: "hr_admin" }))).toBe("ACCESS_INVALID_INPUT");
    const u = await userByOid(opA, x);
    const s = (await stateOf(opA, u.id))!;
    const c = { environment: ENV, correlationId: crypto.randomUUID() };
    for (const reason of ["", "   "]) {
      expect(await codeOf(inTx(() => callCreate(opA, { ...c, reason, tenantId: TEST_TENANT_ID, objectId: oid(), displayName: "x" })))).toBe("ACCESS_REASON_REQUIRED");
      expect(await codeOf(inTx(() => callSetEnabled(opA, { ...c, reason, userId: u.id, enabled: false, expected: s })))).toBe("ACCESS_REASON_REQUIRED");
      expect(await codeOf(inTx(() => callSetEnabled(opA, { ...c, reason, userId: u.id, enabled: true, expected: s })))).toBe("ACCESS_REASON_REQUIRED");
      expect(await codeOf(inTx(() => callRole(opA, "assign", { ...c, reason, userId: u.id, role: "API_DOCS_READER", expected: s })))).toBe("ACCESS_REASON_REQUIRED");
      expect(await codeOf(inTx(() => callRole(opA, "remove", { ...c, reason, userId: u.id, role: "HR_EDITOR", expected: s })))).toBe("ACCESS_REASON_REQUIRED");
    }
    expect((await cli(["role", "assign", "--env", ENV, "--oid", x, "--role", "HR_ADMIN", "--confirm", `${ENV}:${x}`])).code).toBe(EXIT.USAGE);
    expect(await auditCount()).toBe(before);

    // A stale HR_VIEWER row (test owner authority only) grants nothing and can be removed through the guarded path.
    await withOwner((o) => o.query("INSERT INTO app_user_role (user_id, role_code) VALUES ($1, 'HR_VIEWER')", [u.id]));
    expect((await owner.query("SELECT public.access_effective_permissions($1) AS p", [u.id])).rows[0].p.sort()).toEqual([...permissionsForRoles(["HR_EDITOR"])].sort());
    const shown = await cli(["user", "show", "--env", ENV, "--oid", x]);
    expect(shown.out).toContain("HR_VIEWER (unsupported — grants nothing)");
    expect((await change(opA, x, { kind: "remove", role: "HR_VIEWER" }))[0].result).toBe("changed");
    expect((await userByOid(opA, x)).roles).toEqual(["HR_EDITOR"]);
  });

  it("no-op changes write nothing; disable retains roles and enable reactivates them after a preview", async () => {
    const x = oid();
    await create(opA, x, ["HR_EDITOR"]);
    const before = await auditCount();
    expect((await change(opA, x, { kind: "assign", role: "HR_EDITOR" }))[0].result).toBe("no_change");
    expect((await change(opA, x, { kind: "enable" }))[0].result).toBe("no_change");
    expect((await change(opA, x, { kind: "remove", role: "API_DOCS_READER" }))[0].result).toBe("no_change");
    expect(await auditCount()).toBe(before);
    await change(opA, x, { kind: "disable" });
    expect(await userByOid(opA, x)).toMatchObject({ enabled: false, roles: ["HR_EDITOR"] });
    expect((await owner.query("SELECT public.access_effective_permissions(id) AS p FROM app_user WHERE entra_object_id = $1", [x])).rows[0].p).toEqual([]);
    const noConfirm = await cli(["user", "enable", "--env", ENV, "--oid", x, "--reason", "Back from leave"]);
    expect(noConfirm.code).toBe(EXIT.USAGE);
    expect(noConfirm.out).toContain("Retained    : roles reactivated on enable: HR_EDITOR");
    // HR_EDITOR's bundle includes the Phase 2A contract permissions (C-106: read, manage, finalize — never correct).
    expect(noConfirm.out).toContain("Permissions : + catalogs.read, contracts.finalize, contracts.manage, contracts.read, employees.create");
    expect(noConfirm.out).not.toContain("contracts.correct");
    expect((await userByOid(opA, x)).enabled).toBe(false);
    const prompts: string[] = [];
    const wrong = await cli(["user", "enable", "--env", ENV, "--oid", x, "--reason", "Back from leave"], { prompt: async (q) => (prompts.push(q), "nope") });
    expect(wrong.code).toBe(EXIT.USAGE);
    const ok = await cli(["user", "enable", "--env", ENV, "--oid", x, "--reason", "Back from leave"], { prompt: async (q) => (q.includes("environment") ? ENV : `Access Test ${x.slice(-4)}`) });
    expect(ok.code, ok.err).toBe(EXIT.OK);
    expect(await userByOid(opA, x)).toMatchObject({ enabled: true, roles: ["HR_EDITOR"] });
    expect(await auditCount()).toBe(before + 2);
  });

  it("mutation and audit are atomic: rollback and guard failures leave neither change nor audit", async () => {
    const x = oid();
    await create(opA, x);
    const u = await userByOid(opA, x);
    const before = await auditCount();
    await opA.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await callRole(opA, "assign", { environment: ENV, userId: u.id, role: "HR_EDITOR", expected: (await stateOf(opA, u.id))!, reason: "x", correlationId: crypto.randomUUID() });
    await opA.query("ROLLBACK");
    expect((await userByOid(opA, x)).roles).toEqual([]);
    expect(await auditCount()).toBe(before);
    // Guard failure after the write inside the routine (last admin) rolls back the write.
    expect(await codeOf(change(opA, ADMIN_OID, { kind: "disable" }))).toBe("ACCESS_LAST_ADMIN");
    expect((await userByOid(opA, ADMIN_OID)).enabled).toBe(true);
    expect(await auditCount()).toBe(before);
  });

  it("a disabled application user is denied by the API on the next request", async () => {
    const x = oid();
    await create(opA, x, ["HR_EDITOR"]);
    const token = await tokenFor("editor", { objectId: x });
    expect((await call(listEmployees, { path: "/api/v1/core-hr/employees", token })).status).toBe(200);
    await change(opA, x, { kind: "disable" });
    expect((await call(listEmployees, { path: "/api/v1/core-hr/employees", token })).status).toBe(403);
  });
});

describe("Environment guard and CLI", () => {
  it("routine and CLI refuse a different environment, foreign tenants and unsafe connections", async () => {
    const u = await userByOid(opA, ADMIN_OID);
    expect(await codeOf(applyChange(opA, { environment: "production", tenantId: TEST_TENANT_ID, reason: "x", target: u, expected: (await stateOf(opA, u.id))!, change: { kind: "assign", role: "HR_EDITOR" } }))).toBe("ACCESS_ENVIRONMENT_MISMATCH");
    expect(await codeOf(applyChange(opA, { environment: ENV, tenantId: "22222222-2222-4222-8222-222222222222", reason: "x", target: null, expected: null, change: { kind: "create", roles: [] }, create: { objectId: oid(), displayName: "x" } }))).toBe("ACCESS_TENANT_MISMATCH");
    expect(await sqlState(owner.query("SELECT public.access_environment_configure('production', $1, 'x')", [TEST_TENANT_ID]))).toBe("P0001");
    expect((await cli(["env"])).code).toBe(EXIT.USAGE); // --env is mandatory
    expect((await cli(["env", "--env", "staging"], { appEnv: undefined })).code).toBe(EXIT.ENVIRONMENT); // dev credentials
    expect((await cli(["env", "--env", "production"], { appEnv: "test" })).code).toBe(EXIT.ENVIRONMENT);
    expect((await cli(["env", "--env", "local"])).code).toBe(EXIT.ENVIRONMENT); // database says 'test'
    expect((await cli(["env", "--env", ENV], { url: process.env.MIGRATION_DATABASE_URL })).code).toBe(EXIT.ENVIRONMENT); // superuser/owner refused
    expect((await cli(["env", "--env", ENV], { url: "" })).code).toBe(EXIT.ENVIRONMENT);
    const ok = await cli(["env", "--env", ENV, "--json"]);
    expect(ok.code, ok.err).toBe(EXIT.OK);
    expect(JSON.parse(ok.out)).toMatchObject({ environment: "test", operator: { login: OP_A.login }, active_admins: 1, policy: "consistent" });
  });

  it("mutations need an exact confirmation; previews show environment, operator, target, roles, permission delta and admins; no HR data", async () => {
    const x = oid();
    const r1 = await cli(["user", "create", "--env", ENV, "--oid", x, "--name", "Preview User", "--reason", "Onboarding", "--confirm", `${ENV}:wrong`]);
    expect(r1.code).toBe(EXIT.USAGE);
    expect((await listUsers(opA)).some((u) => u.objectId === x)).toBe(false);
    const r2 = await cli(["user", "create", "--env", ENV, "--oid", x, "--name", "Preview User", "--role", "HR_EDITOR", "--reason", "Onboarding", "--confirm", `${ENV}:${x}`]);
    expect(r2.code, r2.err).toBe(EXIT.OK);
    for (const label of ["Environment : TEST", `Operator    : ${OP_A.login}`, `Target      : Preview User  oid ${x}  (new)`, "Enabled     : —  →  true", "Roles       : —  →  HR_EDITOR", "Permissions : + catalogs.read", "Admins after: 1"]) {
      expect(r2.out).toContain(label);
    }
    const list = await cli(["user", "list", "--env", ENV, "--json"]);
    const users = JSON.parse(list.out).users as { entra_object_id: string; effective_permissions: string[] }[];
    expect(users.find((u) => u.entra_object_id === x)?.effective_permissions).toEqual([...permissionsForRoles(["HR_EDITOR"])].sort());
    expect(list.out).not.toMatch(/employee_code|date_of_birth|personal_email|work_email/);
    const preview = await cli(["role", "preview", "--env", ENV, "--oid", x, "--add", "HR_ADMIN", "--json"]);
    expect(JSON.parse(preview.out).effective_permissions_after).toEqual([...permissionsForRoles(["HR_EDITOR", "HR_ADMIN"])].sort());
    expect((await userByOid(opA, x)).roles).toEqual(["HR_EDITOR"]); // preview writes nothing
  });
});

async function inTxOn<T>(c: pg.Client, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    const out = await fn();
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  await opA.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    const out = await fn();
    await opA.query("COMMIT");
    return out;
  } catch (e) {
    await opA.query("ROLLBACK");
    const m = /^(ACCESS_[A-Z_]+): (.*)$/s.exec((e as Error).message);
    throw m ? new AccessAdminError(m[1], m[2]) : e;
  }
}

