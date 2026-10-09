// SYNTHETIC demo profiles. Realistic Vietnamese personal names are used on purpose (English-first does not mean
// translating names); all controlled values are English catalog entries. No real person is represented.
// Profiles are created through the createEmployee service (same validation, transaction and audit as the REST API).
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { addDays, toDbDate, todayInVietnam } from "../src/lib/dates";
import { createEmployee } from "../src/modules/core-hr/people/service";
import { permissionsForRoles } from "../src/modules/identity/permissions";
import { TEST_TENANT_ID } from "../src/modules/identity/token-verifiers";
import { DEV_USERS } from "./seed-data";

/** Expected operational completeness per demo profile; used by the seed compatibility test. */
export const DEMO_EXPECTATIONS: Record<string, { status: string; completeness: "complete" | "incomplete"; missing?: string[] }> = {
  "Nguyễn Minh Anh": { status: "active", completeness: "complete" },
  "Trần Quốc Bảo": { status: "active", completeness: "complete" },
  "Lê Thu Hà": { status: "active", completeness: "complete" },
  "Ngô Phương Thảo": { status: "active", completeness: "complete" },
  "Phạm Gia Huy": { status: "active", completeness: "complete" }, // Intern with a work email
  "Võ Thanh Tâm": { status: "active", completeness: "complete" }, // Service Contractor using a contact email
  "Đặng Hoàng Long": { status: "active", completeness: "incomplete", missing: ["work_email"] }, // Employee without work email
  "Bùi Ngọc Lan": { status: "not_started", completeness: "complete" }, // pre-start, contact email only
  "Hoàng Đức Minh": { status: "not_started", completeness: "incomplete", missing: ["employee_type"] },
  "Đỗ Khánh Linh": {
    status: "no_employment",
    completeness: "incomplete",
    missing: ["contact_email", "start_date", "employment_status", "department", "job_title", "employee_type"],
  },
  "Lý Văn Phúc": { status: "ended", completeness: "complete" },
  "Trịnh Hải Yến": { status: "active", completeness: "complete" }, // Service Contractor -> Employee (two periods)
};

export async function seedDemoProfiles(prisma: PrismaClient) {
  const admin = await prisma.appUser.findUniqueOrThrow({
    where: { entraTenantId_entraObjectId: { entraTenantId: TEST_TENANT_ID, entraObjectId: DEV_USERS.admin.oid } },
  });
  const principal = {
    userId: admin.id,
    displayName: admin.displayName,
    tenantId: TEST_TENANT_ID,
    objectId: admin.entraObjectId,
    issuerKind: "test" as const,
    roles: ["HR_ADMIN" as const],
    permissions: permissionsForRoles(["HR_ADMIN"]),
  };
  const ids = async <T extends { code: string; id: string }>(rows: Promise<T[]>) =>
    Object.fromEntries((await rows).map((r) => [r.code, r.id]));
  const dept = await ids(prisma.department.findMany());
  const title = await ids(prisma.jobTitle.findMany());
  const lvl = await ids(prisma.jobLevel.findMany());
  const type = await ids(prisma.employeeType.findMany());
  const today = todayInVietnam();
  const create = async (input: Parameters<typeof createEmployee>[1]) =>
    (await createEmployee(principal, input, `seed-${randomUUID()}`, "seed")).body;
  const email = (local: string) => `${local}@example.test`;

  const lead = await create({
    full_name: "Nguyễn Minh Anh",
    personal: { gender: "female", date_of_birth: "1988-03-15", mobile_phone: "0900000001" },
    employment: {
      start_date: "2019-06-03",
      employee_type_id: type.EMPLOYEE,
      work_email: email("anh.nguyen"),
      assignment: { department_id: dept.ENG, job_title_id: title.SE, job_level_id: lvl.L4 },
    },
  });
  const member = (
    name: string,
    o: { start: string; type?: string; work?: string; personal?: string; dept: string; title: string; level?: string; manager?: boolean },
  ) =>
    create({
      full_name: name,
      ...(o.personal ? { personal: { personal_email: email(o.personal) } } : {}),
      employment: {
        start_date: o.start,
        ...(o.type ? { employee_type_id: type[o.type] } : {}),
        ...(o.work ? { work_email: email(o.work) } : {}),
        assignment: {
          department_id: dept[o.dept],
          job_title_id: title[o.title],
          ...(o.level ? { job_level_id: lvl[o.level] } : {}),
          ...(o.manager ? { manager_person_id: lead.id } : {}),
        },
      },
    });

  await member("Trần Quốc Bảo", { start: "2021-04-05", type: "EMPLOYEE", work: "bao.tran", dept: "ENG", title: "SE", level: "L2", manager: true });
  await member("Lê Thu Hà", { start: "2020-09-14", type: "EMPLOYEE", work: "ha.le", dept: "QA", title: "QAE", level: "L3", manager: true });
  await member("Ngô Phương Thảo", { start: "2022-02-07", type: "EMPLOYEE", work: "thao.ngo", dept: "HRA", title: "HRX", level: "L2" });
  await member("Phạm Gia Huy", { start: "2026-07-01", type: "INTERN", work: "huy.pham", dept: "ENG", title: "SE", level: "L1", manager: true });
  await member("Võ Thanh Tâm", { start: "2025-11-03", type: "SERVICE_CONTRACTOR", personal: "tam.vo.contact", dept: "QA", title: "QAE" });
  await member("Đặng Hoàng Long", { start: "2024-05-06", type: "EMPLOYEE", personal: "long.dang.contact", dept: "ENG", title: "SE", level: "L2", manager: true });
  await member("Bùi Ngọc Lan", { start: addDays(today, 21), type: "EMPLOYEE", personal: "lan.bui.contact", dept: "QA", title: "QAE", level: "L1" });
  await member("Hoàng Đức Minh", { start: addDays(today, 35), personal: "minh.hoang.contact", dept: "ENG", title: "SE" });
  await create({ full_name: "Đỗ Khánh Linh" });

  // S3 has no API to end or reopen employment yet, so the seed writes these SYNTHETIC periods directly.
  const former = await create({ full_name: "Lý Văn Phúc" });
  const changed = await create({ full_name: "Trịnh Hải Yến", personal: { personal_email: email("yen.trinh.contact") } });
  await prisma.$transaction(async (tx) => {
    const ended = await tx.employment.create({
      data: {
        personId: former.id,
        startDate: toDbDate("2020-01-06"),
        endDate: toDbDate("2024-12-31"),
        employeeTypeId: type.EMPLOYEE,
        workEmail: email("phuc.ly"),
        createdBy: admin.id,
      },
    });
    await tx.jobAssignment.create({
      data: {
        employmentId: ended.id,
        effectiveFrom: toDbDate("2020-01-06"),
        effectiveTo: toDbDate("2025-01-01"),
        departmentId: dept.QA,
        jobTitleId: title.QAE,
        jobLevelId: lvl.L2,
        changeReason: "initial_assignment",
        createdBy: admin.id,
      },
    });
    // Relationship change Service Contractor -> Employee is traceable as two employment periods.
    const contractor = await tx.employment.create({
      data: {
        personId: changed.id,
        startDate: toDbDate("2021-03-01"),
        endDate: toDbDate("2023-02-28"),
        employeeTypeId: type.SERVICE_CONTRACTOR,
        createdBy: admin.id,
      },
    });
    await tx.jobAssignment.create({
      data: {
        employmentId: contractor.id,
        effectiveFrom: toDbDate("2021-03-01"),
        effectiveTo: toDbDate("2023-03-01"),
        departmentId: dept.ENG,
        jobTitleId: title.SE,
        changeReason: "initial_assignment",
        createdBy: admin.id,
      },
    });
    const employee = await tx.employment.create({
      data: {
        personId: changed.id,
        startDate: toDbDate("2023-03-01"),
        employeeTypeId: type.EMPLOYEE,
        workEmail: email("yen.trinh"),
        createdBy: admin.id,
      },
    });
    await tx.jobAssignment.create({
      data: {
        employmentId: employee.id,
        effectiveFrom: toDbDate("2023-03-01"),
        departmentId: dept.ENG,
        jobTitleId: title.SE,
        jobLevelId: lvl.L3,
        changeReason: "initial_assignment",
        createdBy: admin.id,
      },
    });
  });
}
