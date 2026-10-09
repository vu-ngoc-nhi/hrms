// SYNTHETIC data for development and tests only. No real personnel data; emails use the example.test domain.
// Catalog values:
//   - Employee Types (Employee, Service Contractor, Intern) are the CONFIRMED MVP set (decision register C-13, C-19);
//     their company-account defaults follow C-10, C-18 and C-20.
//   - Departments, Job Titles and Job Levels are English demo/reference data still pending HR validation (PV-06),
//     not the company's real catalogs.
import type { PrismaClient } from "../src/generated/prisma/client";
import { TEST_TENANT_ID } from "../src/modules/identity/token-verifiers";

type SeedUser = { oid: string; name: string; roles: readonly string[]; enabled: boolean };

// Accounts seeded in BOTH the development and the test database (MVP roles only; no HR_VIEWER).
export const DEV_USERS = {
  admin: { oid: "00000000-0000-4000-8000-0000000000a1", name: "Test HR Admin", roles: ["HR_ADMIN"], enabled: true },
  editor: { oid: "00000000-0000-4000-8000-0000000000a2", name: "Test HR Editor", roles: ["HR_EDITOR"], enabled: true },
  docs: { oid: "00000000-0000-4000-8000-0000000000a4", name: "Test Developer (API Docs)", roles: ["API_DOCS_READER"], enabled: true },
} as const satisfies Record<string, SeedUser>;

// Accounts that exist only to test negative paths; never seeded into the development database.
export const TEST_ONLY_USERS = {
  noroles: { oid: "00000000-0000-4000-8000-0000000000a5", name: "Test User Without Roles", roles: [], enabled: true },
  disabled: { oid: "00000000-0000-4000-8000-0000000000a6", name: "Test Disabled Account", roles: ["HR_ADMIN"], enabled: false },
} as const satisfies Record<string, SeedUser>;

export const TEST_USERS = { ...DEV_USERS, ...TEST_ONLY_USERS };

export const CATALOGS = {
  departments: [
    { code: "ENG", name: "Engineering", isActive: true },
    { code: "QA", name: "Quality Assurance", isActive: true },
    { code: "HRA", name: "HR & Administration", isActive: true },
    { code: "OLD", name: "Legacy Department (inactive)", isActive: false },
  ],
  jobTitles: [
    // name_vi is optional business data for official Vietnamese documents, not UI text.
    { code: "SE", nameEn: "Software Engineer", nameVi: "Kỹ sư phần mềm" },
    { code: "QAE", nameEn: "QA Engineer", nameVi: "Kỹ sư kiểm thử" },
    { code: "HRX", nameEn: "HR Executive", nameVi: null },
  ],
  jobLevels: [
    { code: "L1", name: "Junior", sortOrder: 10 },
    { code: "L2", name: "Middle", sortOrder: 20 },
    { code: "L3", name: "Senior", sortOrder: 30 },
    { code: "L4", name: "Lead", sortOrder: 40 },
  ],
  // Confirmed MVP Employee Types (C-13): nature of the working relationship, not working arrangement or probation.
  employeeTypes: [
    { code: "EMPLOYEE", name: "Employee", requiresWorkEmail: true },
    { code: "SERVICE_CONTRACTOR", name: "Service Contractor", requiresWorkEmail: false },
    { code: "INTERN", name: "Intern", requiresWorkEmail: true },
  ],
};

// Insert-only: creates missing rows, never updates or deletes existing ones.
export async function seedUsersAndCatalogs(prisma: PrismaClient, opts: { includeTestOnlyUsers: boolean }) {
  const users: SeedUser[] = Object.values(opts.includeTestOnlyUsers ? TEST_USERS : DEV_USERS);
  for (const u of users) {
    const user = await prisma.appUser.upsert({
      where: { entraTenantId_entraObjectId: { entraTenantId: TEST_TENANT_ID, entraObjectId: u.oid } },
      update: {},
      create: { entraTenantId: TEST_TENANT_ID, entraObjectId: u.oid, displayName: u.name, isEnabled: u.enabled },
    });
    for (const role of u.roles) {
      await prisma.appUserRole.upsert({
        where: { userId_roleCode: { userId: user.id, roleCode: role } },
        update: {},
        create: { userId: user.id, roleCode: role },
      });
    }
  }
  for (const d of CATALOGS.departments) {
    if (!(await prisma.department.findFirst({ where: { code: d.code } }))) await prisma.department.create({ data: d });
  }
  for (const j of CATALOGS.jobTitles) {
    if (!(await prisma.jobTitle.findFirst({ where: { code: j.code } }))) await prisma.jobTitle.create({ data: j });
  }
  for (const l of CATALOGS.jobLevels) {
    if (!(await prisma.jobLevel.findFirst({ where: { code: l.code } }))) await prisma.jobLevel.create({ data: l });
  }
  for (const t of CATALOGS.employeeTypes) {
    if (!(await prisma.employeeType.findFirst({ where: { code: t.code } }))) await prisma.employeeType.create({ data: t });
  }
}
