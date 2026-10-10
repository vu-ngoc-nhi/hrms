// Guarded access-administration command (C-89). Thin UX layer: environment pre-checks, preview, confirmation and
// exit codes. Every rule is re-enforced by the database routines; nothing here can bypass them (the operator login
// has no DML privilege). Output never contains Core HR data.
import { parseArgs } from "node:util";
import pg from "pg";
import {
  ACCESS_ENVIRONMENTS,
  AccessAdminError,
  type AccessChange,
  type AccessContext,
  type AccessEnvironment,
  type AccessUser,
  applyChange,
  effectivePermissions,
  ineffectiveRoles,
  listUsers,
  policyDrift,
  previewChange,
  readContext,
  stateOf,
} from "./access-admin";
import { isKnownRole, ROLE_CODES } from "./permissions";

export const EXIT = { OK: 0, USAGE: 1, GUARD: 2, ENVIRONMENT: 3, STATE_CHANGED: 4, INTERNAL: 5 } as const;

const EXIT_BY_CODE: Record<string, number> = {
  ACCESS_REASON_REQUIRED: EXIT.USAGE,
  ACCESS_ROLE_NOT_SUPPORTED: EXIT.USAGE,
  ACCESS_INVALID_INPUT: EXIT.USAGE,
  ACCESS_USER_NOT_FOUND: EXIT.USAGE,
  ACCESS_CONFIRMATION_REQUIRED: EXIT.USAGE,
  ACCESS_LAST_ADMIN: EXIT.GUARD,
  ACCESS_SELF_ESCALATION: EXIT.GUARD,
  ACCESS_USER_EXISTS: EXIT.GUARD,
  ACCESS_ENVIRONMENT_MISMATCH: EXIT.ENVIRONMENT,
  ACCESS_OPERATOR_UNKNOWN: EXIT.ENVIRONMENT,
  ACCESS_TENANT_MISMATCH: EXIT.ENVIRONMENT,
  ACCESS_UNSAFE_CONNECTION: EXIT.ENVIRONMENT,
  ACCESS_POLICY_DRIFT: EXIT.ENVIRONMENT,
  ACCESS_PERMISSION_DENIED: EXIT.ENVIRONMENT,
  ACCESS_ISOLATION: EXIT.INTERNAL,
  ACCESS_STATE_CHANGED: EXIT.STATE_CHANGED,
};

// Development/test connection markers that must never be used against staging or production.
const DEV_LOGINS = /^(hrms_owner|hrms_app|hrms_local_operator|hrms_test_operator_[a-z0-9_]+)$/;
const DEV_PASSWORD = "hrms_local_dev_only";

export type CliIo = { out: (line: string) => void; err: (line: string) => void; prompt?: (question: string) => Promise<string> };

const USAGE = `Usage: access <command> --env <local|test|staging|production> [options]
  env                                   show environment, operator and policy status
  user list                             list application users and roles
  user show    --oid <entra-oid> | --user <id>
  user create  --oid <entra-oid> --name "<display name>" [--role <ROLE> ...] --reason "<reason>"
  user enable  --oid <entra-oid> | --user <id> --reason "<reason>"
  user disable --oid <entra-oid> | --user <id> --reason "<reason>"
  role assign  --oid <entra-oid> | --user <id> --role <ROLE> --reason "<reason>"
  role remove  --oid <entra-oid> | --user <id> --role <ROLE> --reason "<reason>"
  role preview --oid <entra-oid> | --user <id> [--add <ROLE>] [--remove <ROLE>]
Options: --json  machine-readable output · --confirm <env>:<entra-oid>  non-interactive confirmation
Connection: ACCESS_ADMIN_DATABASE_URL (your personal operator login). Supported roles: ${ROLE_CODES.join(", ")}.`;

function fail(code: string, message: string): never {
  throw new AccessAdminError(code, message);
}

/** Refuses ambiguous or development connections before connecting (defence in depth; the database decides). */
export function checkConnection(url: string | undefined, env: AccessEnvironment, shellAppEnv: string | undefined): URL {
  if (!url) fail("ACCESS_UNSAFE_CONNECTION", "ACCESS_ADMIN_DATABASE_URL is not set (use your personal operator login)");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("ACCESS_UNSAFE_CONNECTION", "ACCESS_ADMIN_DATABASE_URL is not a valid URL");
  }
  if (env === "staging" || env === "production") {
    if (DEV_LOGINS.test(decodeURIComponent(parsed.username)) || decodeURIComponent(parsed.password) === DEV_PASSWORD) {
      fail("ACCESS_UNSAFE_CONNECTION", `development credentials cannot be used for ${env}`);
    }
    if (shellAppEnv === "local" || shellAppEnv === "test") {
      fail("ACCESS_UNSAFE_CONNECTION", `this shell is configured for APP_ENV=${shellAppEnv}; refusing a ${env} target`);
    }
  }
  return parsed;
}

const fmtRoles = (roles: string[]) =>
  roles.length ? roles.map((r) => (isKnownRole(r) ? r : `${r} (unsupported — grants nothing)`)).join(", ") : "(none)";

function describeUser(u: AccessUser) {
  return {
    user_id: u.id,
    entra_object_id: u.objectId,
    display_name: u.displayName,
    enabled: u.enabled,
    roles: u.roles,
    unsupported_roles: ineffectiveRoles(u.roles),
    effective_permissions: [...effectivePermissions(u)].sort(),
  };
}

export async function runAccessCli(argv: string[], io: CliIo, processEnv: Record<string, string | undefined> = process.env): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        env: { type: "string" },
        oid: { type: "string" },
        user: { type: "string" },
        name: { type: "string" },
        role: { type: "string", multiple: true },
        add: { type: "string" },
        remove: { type: "string" },
        reason: { type: "string" },
        confirm: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return EXIT.USAGE;
  }
  const { values: o, positionals } = parsed;
  const command = positionals.join(" ");
  if (o.help || !command) {
    io.out(USAGE);
    return o.help ? EXIT.OK : EXIT.USAGE;
  }
  const json = o.json;
  const print = (human: string[], data: unknown) => (json ? io.out(JSON.stringify(data, null, 2)) : human.forEach((l) => io.out(l)));

  let client: pg.Client | null = null;
  try {
    if (!o.env || !(ACCESS_ENVIRONMENTS as readonly string[]).includes(o.env)) {
      fail("ACCESS_INVALID_INPUT", "--env is required: local, test, staging or production");
    }
    const env = o.env as AccessEnvironment;
    const url = checkConnection(processEnv.ACCESS_ADMIN_DATABASE_URL, env, processEnv.APP_ENV);
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();

    const ctx = await readContext(client);
    assertContext(ctx, env);
    const drift = await policyDrift(client);
    if (drift.length) fail("ACCESS_POLICY_DRIFT", `database policy mirror differs from the code: ${drift.join("; ")}`);
    const users = await listUsers(client);
    const header = [
      `Environment : ${env.toUpperCase()}  (database identifier '${ctx.environment}', tenant ${ctx.tenantId})`,
      `Operator    : ${ctx.operator!.login}  (${ctx.operator!.displayName}, Entra oid ${ctx.operator!.objectId})`,
    ];

    if (command === "env") {
      const admins = previewChange(users, null, { kind: "create", roles: [] }).adminsBefore;
      print([...header, `Users       : ${users.length}`, `Admins      : ${admins}${admins === 1 ? "   ⚠ two are recommended" : ""}`, "Policy      : consistent with code"], {
        environment: ctx.environment,
        tenant_id: ctx.tenantId,
        operator: ctx.operator,
        users: users.length,
        active_admins: admins,
        policy: "consistent",
      });
      return EXIT.OK;
    }
    if (command === "user list") {
      const rows = users.map(describeUser);
      print(
        [...header, ...rows.map((u) => `${u.enabled ? "enabled " : "disabled"}  ${u.entra_object_id}  ${u.display_name}  [${fmtRoles(u.roles)}]`)],
        { environment: ctx.environment, users: rows },
      );
      return EXIT.OK;
    }

    const findTarget = (required: boolean): AccessUser | null => {
      if (o.user && o.oid) fail("ACCESS_INVALID_INPUT", "use either --oid or --user, not both");
      const t = o.user ? users.find((u) => u.id === o.user) : o.oid ? users.find((u) => u.tenantId === ctx.tenantId && u.objectId === o.oid!.toLowerCase()) : undefined;
      if (!t && required) fail("ACCESS_USER_NOT_FOUND", "no application user matches --oid/--user in this environment");
      return t ?? null;
    };

    if (command === "user show") {
      const t = findTarget(true)!;
      const d = describeUser(t);
      print([...header, `User        : ${t.displayName}  oid ${t.objectId}  ${t.enabled ? "enabled" : "disabled"}`, `Roles       : ${fmtRoles(t.roles)}`, `Permissions : ${d.effective_permissions.join(", ") || "(none)"}`], { environment: ctx.environment, user: d });
      return EXIT.OK;
    }

    if (command === "role preview") {
      const t = findTarget(true)!;
      let roles = [...t.roles];
      if (o.add) roles = [...new Set([...roles, o.add])].sort();
      if (o.remove) roles = roles.filter((r) => r !== o.remove);
      const before = [...effectivePermissions(t)].sort();
      const after = [...effectivePermissions({ enabled: t.enabled, roles })].sort();
      print([...header, `User        : ${t.displayName}  ${t.enabled ? "enabled" : "disabled"}`, `Roles       : ${fmtRoles(t.roles)}  →  ${fmtRoles(roles)}`, `Permissions : ${after.join(", ") || "(none)"}`], {
        environment: ctx.environment,
        user_id: t.id,
        roles_after: roles,
        effective_permissions_before: before,
        effective_permissions_after: after,
      });
      return EXIT.OK;
    }

    // ---------------- Mutations ----------------
    const reason = (o.reason ?? "").trim();
    if (!reason) fail("ACCESS_REASON_REQUIRED", "--reason is required for every access change");
    let change: AccessChange;
    let target: AccessUser | null = null;
    if (command === "user create") {
      if (!o.oid || !o.name) fail("ACCESS_INVALID_INPUT", "user create needs --oid and --name");
      const roles = o.role ?? [];
      for (const r of roles) if (!isKnownRole(r)) fail("ACCESS_ROLE_NOT_SUPPORTED", `role "${r}" is not supported (${ROLE_CODES.join(", ")})`);
      change = { kind: "create", roles };
    } else if (command === "user enable" || command === "user disable") {
      target = findTarget(true);
      change = { kind: command === "user enable" ? "enable" : "disable" };
    } else if (command === "role assign" || command === "role remove") {
      target = findTarget(true);
      const role = o.role?.length === 1 ? o.role[0] : fail("ACCESS_INVALID_INPUT", "exactly one --role is required");
      if (command === "role assign" && !isKnownRole(role)) fail("ACCESS_ROLE_NOT_SUPPORTED", `role "${role}" is not supported (${ROLE_CODES.join(", ")})`);
      change = { kind: command === "role assign" ? "assign" : "remove", role };
    } else {
      io.err(`Unknown command "${command}".\n${USAGE}`);
      return EXIT.USAGE;
    }

    const expected = target ? await stateOf(client, target.id) : null;
    const preview = previewChange(users, target, change);
    const objectId = (target?.objectId ?? o.oid!).toLowerCase();
    const displayName = target?.displayName ?? o.name!.trim();
    const lines = [
      ...header,
      `Target      : ${displayName}  oid ${objectId}${target ? "" : "  (new)"}`,
      `Enabled     : ${preview.before ? preview.before.enabled : "—"}  →  ${preview.after.enabled}`,
      `Roles       : ${preview.before ? fmtRoles(preview.before.roles) : "—"}  →  ${fmtRoles(preview.after.roles)}`,
      ...(change.kind === "enable" && preview.before ? [`Retained    : roles reactivated on enable: ${fmtRoles(preview.before.roles)}`] : []),
      `Permissions : + ${preview.added.join(", ") || "(none)"}   − ${preview.removed.join(", ") || "(none)"}`,
      `Admins after: ${preview.adminsAfter}${preview.adminsAfter === 1 ? "   ⚠ only ONE active administrator would remain — two are recommended" : ""}${preview.adminsAfter === 0 && preview.adminsBefore >= 1 ? "   ✖ would leave no administrator (will be refused)" : ""}`,
      ...(ctx.operator!.objectId === objectId ? ["Note        : target is YOUR OWN Entra identity — permission increases are refused"] : []),
    ];
    if (!json) lines.forEach((l) => io.out(l));

    // Confirmation for every state-changing action.
    const token = `${env}:${objectId}`;
    if (o.confirm !== undefined) {
      if (o.confirm !== token) fail("ACCESS_CONFIRMATION_REQUIRED", `--confirm must be exactly "${token}"`);
    } else if (io.prompt) {
      const typedEnv = (await io.prompt(`Type the environment name ("${env}") to confirm: `)).trim();
      const typedName = (await io.prompt(`Type the target display name ("${displayName}") to confirm: `)).trim();
      if (typedEnv !== env || typedName !== displayName) fail("ACCESS_CONFIRMATION_REQUIRED", "confirmation did not match; nothing was changed");
    } else {
      fail("ACCESS_CONFIRMATION_REQUIRED", `confirmation required: run interactively or pass --confirm "${token}"`);
    }

    const results = await applyChange(client, {
      environment: env,
      tenantId: ctx.tenantId!,
      reason,
      target,
      expected,
      change,
      create: change.kind === "create" ? { objectId, displayName } : undefined,
    });
    const last = results.at(-1)!;
    const changed = results.some((r) => r.result === "changed");
    const outLines = [`${changed ? "OK  changed" : "OK  no change"}  user ${last.user_id}  admins after ${last.admins_after}${last.admins_after === 1 ? " (⚠ two recommended)" : ""}`];
    print(outLines, { environment: env, result: changed ? "changed" : "no_change", user_id: last.user_id, new_state: last.new_state, admins_after: last.admins_after, preview });
    return EXIT.OK;
  } catch (error) {
    if (error instanceof AccessAdminError) {
      const exit = EXIT_BY_CODE[error.code] ?? EXIT.INTERNAL;
      if (json) io.out(JSON.stringify({ error: error.code, message: error.message, exit }));
      else io.err(`✖ ${error.code}: ${error.message}`);
      return exit;
    }
    io.err(`✖ internal error: ${(error as Error)?.name ?? "unknown"}`);
    return EXIT.INTERNAL;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

function assertContext(ctx: AccessContext, env: AccessEnvironment) {
  if (ctx.isSuperuser) fail("ACCESS_UNSAFE_CONNECTION", "refusing to run as a database superuser; use your personal operator login");
  if (!ctx.environment) fail("ACCESS_ENVIRONMENT_MISMATCH", "this database has no configured access environment");
  if (ctx.environment !== env) fail("ACCESS_ENVIRONMENT_MISMATCH", `target environment "${env}" does not match this database ("${ctx.environment}")`);
  if (!ctx.operator) fail("ACCESS_OPERATOR_UNKNOWN", `login "${ctx.sessionUser}" is not a registered active access operator`);
}
