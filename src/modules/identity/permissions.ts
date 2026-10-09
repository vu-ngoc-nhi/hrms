// Core HR permissions. Roles from Entra or the leave tool never grant these; only HRMS app_user_role does.
export const PERMISSIONS = [
  "employees.read", // directory group: code, name, status, department, job title, level, manager, work email
  "employees.read_personal", // personal group: gender, date of birth, personal email, mobile phone
  "employees.create",
  "employees.write_personal",
  "employees.set_code", // supply a legacy employee code instead of an auto-issued one
  "employees.read_sensitive", // sensitive group (legal ID, tax, social insurance...): NOT implemented, no role has it
  "catalogs.read",
  "catalogs.manage",
  "docs.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// MVP role model (MVP Decision, least privilege). HR_VIEWER was removed: no confirmed business case yet.
// Adding a role later only needs an entry here; role codes not listed grant nothing (fail closed).
export const ROLE_CODES = ["HR_ADMIN", "HR_EDITOR", "API_DOCS_READER"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  HR_ADMIN: [
    "employees.read",
    "employees.read_personal",
    "employees.create",
    "employees.write_personal",
    "employees.set_code",
    "catalogs.read",
    "catalogs.manage",
  ],
  HR_EDITOR: ["employees.read", "employees.read_personal", "employees.create", "employees.write_personal", "catalogs.read"],
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
