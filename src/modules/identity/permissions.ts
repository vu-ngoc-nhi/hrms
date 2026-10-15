// Core HR permissions. Roles from Entra or the leave tool never grant these; only HRMS app_user_role does.
export const PERMISSIONS = [
  "employees.read", // directory group: code, name, status, department, job title, level, manager, work email
  "employees.read_personal", // personal group: gender, date of birth, personal email, mobile phone
  "employees.create",
  "employees.write_personal",
  "employees.set_code", // supply a legacy employee code instead of an auto-issued one
  "employees.update", // edit profile fields (S4)
  "employees.read_sensitive", // sensitive group (legal ID, tax, social insurance...): NOT implemented, no role has it
  "employment.manage", // normal employment business events effective today or later (S4, C-25)
  "employment.correct", // historical corrections and past-dated business events: HR_ADMIN only (C-22, C-25)
  "catalogs.read",
  "catalogs.manage", // includes the Contract Type catalog (reference data, C-104)
  // Phase 2A contracts (C-106, ADR-0005 §9). Contract content never comes with employees.read or access administration.
  "contracts.read", // view contract records, history, lists and reminders
  "contracts.manage", // prepare working records: Draft create/edit/discard, renewal Drafts
  "contracts.finalize", // make, reverse or certify the official record: Finalize, Return to Draft, Confirm signed, Cancel planned
  "contracts.correct", // change protected history: correct Signed data, Void
  "docs.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// MVP role model (MVP Decision, least privilege). HR_VIEWER was removed: no confirmed business case yet.
// Adding a role later only needs an entry here; role codes not listed grant nothing (fail closed).
export const ROLE_CODES = ["HR_ADMIN", "HR_EDITOR", "API_DOCS_READER"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

// Mirrored for database enforcement of access administration by the migration-controlled table
// access_role_permission (contract-tested); change both together through a migration.
export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  HR_ADMIN: [
    "employees.read",
    "employees.read_personal",
    "employees.create",
    "employees.write_personal",
    "employees.set_code",
    "employees.update",
    "employment.manage",
    "employment.correct",
    "catalogs.read",
    "catalogs.manage",
    "contracts.read",
    "contracts.manage",
    "contracts.finalize",
    "contracts.correct",
  ],
  // HR_EDITOR never receives employment.correct (C-22) or contracts.correct (C-106); it may finalize contracts.
  HR_EDITOR: [
    "employees.read",
    "employees.read_personal",
    "employees.create",
    "employees.write_personal",
    "employees.update",
    "employment.manage",
    "catalogs.read",
    "contracts.read",
    "contracts.manage",
    "contracts.finalize",
  ],
  // Technical role for developers: API documentation only, no HR data.
  API_DOCS_READER: ["docs.read"],
};

export function isKnownRole(role: string): role is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(role);
}

export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) if (isKnownRole(role)) ROLE_PERMISSIONS[role].forEach((p) => out.add(p));
  return out;
}

// ---------------- Administrative capability (C-93 B) ----------------
// The ONLY definition of an administrative user: enabled AND effective permissions contain every capability below.
// Never decided by role name. Mirrored by the database function access_admin_permissions() for the race-safe
// last-admin guard of the access-administration routines (contract-tested).
export const ADMINISTRATIVE_PERMISSIONS = ["employment.correct", "catalogs.manage", "employees.set_code"] as const satisfies readonly Permission[];

export function isAdministrative(user: { enabled: boolean; permissions: ReadonlySet<Permission> }): boolean {
  return user.enabled && ADMINISTRATIVE_PERMISSIONS.every((p) => user.permissions.has(p));
}

