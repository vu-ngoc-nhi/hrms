import pg from "pg";
import { operatorUrl, TEST_OPERATORS } from "../scripts/access-provision-local";
import { type AccessChange, applyChange, listUsers, stateOf } from "@/modules/identity/access-admin";
import { resetConfigForTests } from "@/lib/config";
import { db } from "@/lib/db";
import { resetVerifierForTests, type Principal } from "@/modules/identity/authenticate";
import type { Permission } from "@/modules/identity/permissions";
import { mintTestToken, TEST_TENANT_ID } from "@/modules/identity/token-verifiers";
import { TEST_USERS } from "../scripts/seed-data";

export type TestUser = keyof typeof TEST_USERS;

export function secret() {
  return process.env.AUTH_TEST_ISSUER_SECRET!;
}

export async function tokenFor(user: TestUser, overrides: Parameters<typeof mintTestToken>[1] extends infer T ? Partial<T> : never = {}) {
  return mintTestToken(secret(), { objectId: TEST_USERS[user].oid, ...overrides });
}

type RouteFn = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(
  fn: RouteFn,
  opts: {
    path: string;
    method?: string;
    token?: string | null;
    user?: TestUser;
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const token = opts.token !== undefined ? opts.token : opts.user ? await tokenFor(opts.user) : null;
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost${opts.path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await fn(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

export async function userId(user: TestUser) {
  const u = await db().appUser.findUniqueOrThrow({
    where: { entraTenantId_entraObjectId: { entraTenantId: TEST_TENANT_ID, entraObjectId: TEST_USERS[user].oid } },
  });
  return u.id;
}

export async function catalogIds() {
  const d = Object.fromEntries((await db().department.findMany()).map((x) => [x.code, x.id]));
  const j = Object.fromEntries((await db().jobTitle.findMany()).map((x) => [x.code, x.id]));
  const l = Object.fromEntries((await db().jobLevel.findMany()).map((x) => [x.code, x.id]));
  const et = Object.fromEntries((await db().employeeType.findMany()).map((x) => [x.code, x.id]));
  return { d, j, l, et };
}

/** Builds a principal with an explicit permission set, e.g. to exercise field-level rules without a dedicated role. */
export async function principalWith(user: TestUser, permissions: Permission[]): Promise<Principal> {
  return {
    userId: await userId(user),
    displayName: TEST_USERS[user].name,
    tenantId: TEST_TENANT_ID,
    objectId: TEST_USERS[user].oid,
    issuerKind: "test",
    roles: [],
    permissions: new Set(permissions),
  };
}

export function resetAuthState() {
  resetConfigForTests();
  resetVerifierForTests();
}

let counter = 0;
export function key(prefix = "k") {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------- Access administration fixtures (C-89) ----------------
// The application role can no longer write accounts. Normal account changes in tests go through the guarded routines
// as a test operator; states the guarded path deliberately forbids (e.g. a stale HR_VIEWER row) are set up with the
// explicit test owner authority on hrms_test only.
export async function withOwner<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function withOperator<T>(fn: (client: pg.Client) => Promise<T>, operator: { login: string } = TEST_OPERATORS.a): Promise<T> {
  const client = new pg.Client({ connectionString: operatorUrl(process.env.DATABASE_URL!, operator.login) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Applies an access change to a seeded test account through the guarded routines. */
export async function changeAccess(user: TestUser, change: AccessChange, reason = "Test fixture") {
  return withOperator(async (client) => {
    const target = (await listUsers(client)).find((u) => u.objectId === TEST_USERS[user].oid)!;
    return applyChange(client, { environment: "test", tenantId: TEST_TENANT_ID, reason, target, expected: await stateOf(client, target.id), change });
  });
}
