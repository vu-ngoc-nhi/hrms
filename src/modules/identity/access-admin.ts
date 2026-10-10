// Guarded access administration — client side (C-89, C-93; docs/design/access-administration-command.md).
// Security rules are enforced by the database routines access_user_create / access_user_set_enabled /
// access_role_assign / access_role_remove (SECURITY DEFINER, the only mutation path). This module only reads
// access-control data, builds previews from the code permission model and calls those routines in a READ COMMITTED
// transaction. It never touches HR tables (the operator login cannot read them).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ADMINISTRATIVE_PERMISSIONS, isAdministrative, isKnownRole, permissionsForRoles, ROLE_PERMISSIONS, type Permission } from "./permissions";

export const ACCESS_ENVIRONMENTS = ["local", "test", "staging", "production"] as const;
export type AccessEnvironment = (typeof ACCESS_ENVIRONMENTS)[number];

export class AccessAdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccessAdminError";
  }
}

export type AccessUser = { id: string; tenantId: string; objectId: string; displayName: string; enabled: boolean; roles: string[] };
export type AccessState = { enabled: boolean; roles: string[] };
export type AccessContext = {
  sessionUser: string;
  isSuperuser: boolean;
  environment: AccessEnvironment | null;
  tenantId: string | null;
  operator: { login: string; displayName: string; objectId: string } | null;
};

/** Maps a routine error ("ACCESS_CODE: message") to an AccessAdminError; other errors are rethrown unchanged. */
export function toAccessError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const m = /^(ACCESS_[A-Z_]+): (.*)$/s.exec(message);
  if (m) return new AccessAdminError(m[1], m[2]);
  if ((error as { code?: string })?.code === "42501") return new AccessAdminError("ACCESS_PERMISSION_DENIED", message);
  return error;
}

export async function readContext(client: pg.ClientBase): Promise<AccessContext> {
  const who = await client.query<{ s: string; su: boolean }>(
    "SELECT session_user::text AS s, COALESCE((SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = session_user), false) AS su",
  );
  const env = await client.query<{ environment: AccessEnvironment; entra_tenant_id: string }>(
    "SELECT environment, entra_tenant_id FROM public.access_environment",
  );
  const op = await client.query<{ db_login: string; display_name: string; entra_object_id: string }>(
    "SELECT db_login, display_name, entra_object_id FROM public.access_operator WHERE db_login = session_user::text AND is_active",
  );
  return {
    sessionUser: who.rows[0].s,
    isSuperuser: who.rows[0].su,
    environment: env.rows[0]?.environment ?? null,
    tenantId: env.rows[0]?.entra_tenant_id ?? null,
    operator: op.rows[0] ? { login: op.rows[0].db_login, displayName: op.rows[0].display_name, objectId: op.rows[0].entra_object_id } : null,
  };
}

/** Differences between the database policy mirror and the code permission model (empty = consistent). */
export async function policyDrift(client: pg.ClientBase): Promise<string[]> {
  const rows = (await client.query<{ role_code: string; permission: string }>("SELECT role_code, permission FROM public.access_role_permission")).rows;
  const db = new Set(rows.map((r) => `${r.role_code}:${r.permission}`));
  const code = new Set(Object.entries(ROLE_PERMISSIONS).flatMap(([role, perms]) => perms.map((p) => `${role}:${p}`)));
  const drift = [...[...code].filter((x) => !db.has(x)).map((x) => `missing in database: ${x}`), ...[...db].filter((x) => !code.has(x)).map((x) => `not in code: ${x}`)];
  const admin = (await client.query<{ p: string[] }>("SELECT public.access_admin_permissions() AS p")).rows[0].p;
  if ([...admin].sort().join() !== [...ADMINISTRATIVE_PERMISSIONS].sort().join()) drift.push("administrative capability set differs");
  return drift;
}

export async function listUsers(client: pg.ClientBase): Promise<AccessUser[]> {
  const { rows } = await client.query<{ id: string; entra_tenant_id: string; entra_object_id: string; display_name: string; is_enabled: boolean; roles: string[] }>(
    `SELECT u.id, u.entra_tenant_id, u.entra_object_id, u.display_name, u.is_enabled,
            COALESCE(array_agg(ur.role_code ORDER BY ur.role_code COLLATE "C") FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
     FROM public.app_user u LEFT JOIN public.app_user_role ur ON ur.user_id = u.id
     GROUP BY u.id ORDER BY u.display_name COLLATE "C", u.id`,
  );
  return rows.map((r) => ({ id: r.id, tenantId: r.entra_tenant_id, objectId: r.entra_object_id, displayName: r.display_name, enabled: r.is_enabled, roles: r.roles }));
}

export async function stateOf(client: pg.ClientBase, userId: string): Promise<AccessState | null> {
  const { rows } = await client.query<{ s: AccessState | null }>("SELECT public.access_user_state($1) AS s", [userId]);
  return rows[0]?.s ?? null;
}

export const effectivePermissions = (s: AccessState): Set<Permission> => (s.enabled ? permissionsForRoles(s.roles) : new Set());
export const ineffectiveRoles = (roles: readonly string[]) => roles.filter((r) => !isKnownRole(r));

export type AccessChange =
  | { kind: "create"; roles: string[] }
  | { kind: "enable" }
  | { kind: "disable" }
  | { kind: "assign"; role: string }
  | { kind: "remove"; role: string };

export type AccessPreview = {
  before: AccessState | null;
  after: AccessState;
  permissionsBefore: Permission[];
  permissionsAfter: Permission[];
  added: Permission[];
  removed: Permission[];
  adminsBefore: number;
  adminsAfter: number;
};

/** Expected outcome computed from the code permission model (the database re-checks everything). */
export function previewChange(users: AccessUser[], target: AccessUser | null, change: AccessChange): AccessPreview {
  const before: AccessState | null = target ? { enabled: target.enabled, roles: [...target.roles] } : null;
  const base: AccessState = before ?? { enabled: true, roles: [] };
  const after: AccessState =
    change.kind === "create"
      ? { enabled: true, roles: [...new Set(change.roles)].sort() }
      : change.kind === "enable"
        ? { ...base, enabled: true }
        : change.kind === "disable"
          ? { ...base, enabled: false }
          : change.kind === "assign"
            ? { ...base, roles: [...new Set([...base.roles, change.role])].sort() }
            : { ...base, roles: base.roles.filter((r) => r !== change.role) };
  const pb = before ? effectivePermissions(before) : new Set<Permission>();
  const pa = effectivePermissions(after);
  const admins = (states: AccessState[]) => states.filter((s) => isAdministrative({ enabled: s.enabled, permissions: effectivePermissions(s) })).length;
  const others = users.filter((u) => u.id !== target?.id).map((u) => ({ enabled: u.enabled, roles: u.roles }));
  return {
    before,
    after,
    permissionsBefore: [...pb].sort(),
    permissionsAfter: [...pa].sort(),
    added: [...pa].filter((p) => !pb.has(p)).sort(),
    removed: [...pb].filter((p) => !pa.has(p)).sort(),
    adminsBefore: admins([...others, ...(before ? [before] : [])]),
    adminsAfter: admins([...others, after]),
  };
}

export type RoutineResult = { result: "changed" | "no_change"; user_id: string; previous_state: AccessState | null; new_state: AccessState; admins_after: number };

/** Runs routine calls in ONE READ COMMITTED transaction (all or nothing). */
export async function inAccessTransaction<T>(client: pg.ClientBase, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw toAccessError(error);
  }
}

type Common = { environment: string; reason: string; correlationId: string };

export async function callCreate(client: pg.ClientBase, a: Common & { tenantId: string; objectId: string; displayName: string }): Promise<RoutineResult> {
  const { rows } = await client.query<{ r: RoutineResult }>("SELECT public.access_user_create($1, $2, $3, $4, $5, $6) AS r", [
    a.environment, a.tenantId, a.objectId, a.displayName, a.reason, a.correlationId,
  ]);
  return rows[0].r;
}

export async function callSetEnabled(client: pg.ClientBase, a: Common & { userId: string; enabled: boolean; expected: AccessState }): Promise<RoutineResult> {
  const { rows } = await client.query<{ r: RoutineResult }>("SELECT public.access_user_set_enabled($1, $2, $3, $4, $5, $6) AS r", [
    a.environment, a.userId, a.enabled, JSON.stringify(a.expected), a.reason, a.correlationId,
  ]);
  return rows[0].r;
}

export async function callRole(client: pg.ClientBase, op: "assign" | "remove", a: Common & { userId: string; role: string; expected: AccessState }): Promise<RoutineResult> {
  const fn = op === "assign" ? "public.access_role_assign" : "public.access_role_remove";
  const { rows } = await client.query<{ r: RoutineResult }>(`SELECT ${fn}($1, $2, $3, $4, $5, $6) AS r`, [
    a.environment, a.userId, a.role, JSON.stringify(a.expected), a.reason, a.correlationId,
  ]);
  return rows[0].r;
}

/** Applies a change through the guarded routines in one transaction. `expected` is the state shown in the preview. */
export async function applyChange(
  client: pg.ClientBase,
  args: { environment: string; tenantId: string; reason: string; target: AccessUser | null; expected: AccessState | null; change: AccessChange; create?: { objectId: string; displayName: string } },
): Promise<RoutineResult[]> {
  const correlationId = randomUUID();
  const common = { environment: args.environment, reason: args.reason, correlationId };
  return inAccessTransaction(client, async () => {
    const results: RoutineResult[] = [];
    const c = args.change;
    if (c.kind === "create") {
      let r = await callCreate(client, { ...common, tenantId: args.tenantId, objectId: args.create!.objectId, displayName: args.create!.displayName });
      results.push(r);
      for (const role of c.roles) {
        r = await callRole(client, "assign", { ...common, userId: r.user_id, role, expected: r.new_state });
        results.push(r);
      }
      return results;
    }
    const userId = args.target!.id;
    const expected = args.expected!;
    if (c.kind === "enable" || c.kind === "disable") results.push(await callSetEnabled(client, { ...common, userId, enabled: c.kind === "enable", expected }));
    else results.push(await callRole(client, c.kind, { ...common, userId, role: c.role, expected }));
    return results;
  });
}
