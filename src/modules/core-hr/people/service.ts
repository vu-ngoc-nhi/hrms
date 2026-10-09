import { randomUUID } from "node:crypto";
import type { EmployeeCreateInput, EmployeeDetail, EmployeeListItem } from "@/contracts/core-hr/schemas";
import { getConfig } from "@/lib/config";
import { addDays, fromDbDate, toDbDate, todayInVietnam } from "@/lib/dates";
import { db, pgErrorInfo, type Tx } from "@/lib/db";
import { ApiError, forbidden, notFound, type ErrorDetail } from "@/lib/http/errors";
import { normalizeText } from "@/lib/text";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";
import { claimIdempotencyKey, requestFingerprint } from "@/modules/idempotency/idempotency";
import {
  currentEmploymentWhere,
  futurePlannedEmploymentWhere,
  historyFlags,
  operationalEmploymentWhere,
  operationalPeriods,
} from "../employments/queries";
import { assignmentOn, employmentStatus, referenceDate, representativeEmployment } from "../employments/status";
import { completenessView, missingOperationalItems, type OperationalInput } from "./completeness";
import { normalizePersonalEmail, validateDateOfBirth, validateFullName, validateMobilePhone } from "./validation";

// ---------------- Protected fields that are not enabled ----------------
// These groups need encryption, keyed-HMAC lookup, dedicated permissions and legal review (Pending Legal Review).
const PROTECTED_FIELDS = new Set([
  "identity_number",
  "id_number",
  "citizen_id",
  "cccd",
  "identity_documents",
  "passport_number",
  "tax_code",
  "pit_number",
  "social_insurance_number",
  "si_number",
  "bank_account",
  "bank_account_number",
  "bank_name",
  "dependents",
  "children",
  "family_members",
  "health",
  "health_certificate",
  "salary",
  "salary_basic",
  "contract",
  "contracts",
  "documents",
  "attachments",
]);

export function rejectProtectedFields(raw: unknown) {
  const found: string[] = [];
  const scan = (value: unknown, prefix: string, depth: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (PROTECTED_FIELDS.has(k.toLowerCase())) found.push(path);
      else scan(v, path, depth + 1);
    }
  };
  scan(raw, "", 0);
  if (found.length) {
    throw new ApiError(
      422,
      "PROTECTED_FIELD_NOT_ENABLED",
      "This data group is not enabled in Core HR (it requires dedicated protection and a business/legal decision).",
      found.map((field) => ({ field, code: "PROTECTED_FIELD_NOT_ENABLED", message: "Field is not supported." })),
    );
  }
}

// ---------------- Create: preparation and validation ----------------
type Prepared = {
  fullName: string;
  legacyCode: string | null;
  personal: { gender: string | null; dateOfBirth: string | null; personalEmail: string | null; mobilePhone: string | null };
  employment: null | {
    startDate: string;
    workEmail: string | null;
    employeeType: null | { id: string; requiresWorkEmail: boolean };
    assignment: null | {
      departmentId: string;
      jobTitleId: string;
      jobLevelId: string | null;
      managerEmploymentId: string | null;
    };
  };
  changedFields: string[];
  warnings: ErrorDetail[];
};

const CODE_RE = /^[A-Za-z0-9._-]{1,20}$/;

async function checkActive(
  errors: ErrorDetail[],
  field: string,
  label: string,
  lookup: Promise<{ isActive: boolean } | null>,
) {
  const row = await lookup;
  if (!row?.isActive) errors.push({ field, code: "NOT_ACTIVE", message: `${label} does not exist or is inactive.` });
}

async function prepareCreate(principal: Principal, input: EmployeeCreateInput, today: string): Promise<Prepared> {
  const errors: ErrorDetail[] = [];
  const warnings: ErrorDetail[] = [];

  if (input.personal && Object.keys(input.personal).length && !principal.permissions.has("employees.write_personal")) {
    throw forbidden("You do not have permission to write personal information.");
  }
  if (input.employee_code !== undefined && !principal.permissions.has("employees.set_code")) {
    throw forbidden("You do not have permission to set a legacy employee code.");
  }

  const issues = { errors, warnings };
  const fullName = validateFullName(input.full_name, issues);

  let legacyCode: string | null = null;
  if (input.employee_code !== undefined) {
    const c = input.employee_code.trim();
    if (!CODE_RE.test(c)) {
      errors.push({ field: "employee_code", code: "INVALID", message: "Employee code may contain letters, digits, '.', '_' and '-' (max 20)." });
    } else legacyCode = c;
  }

  const p = input.personal ?? {};
  const dateOfBirth = validateDateOfBirth(p.date_of_birth ?? null, today, issues);
  const mobilePhone = validateMobilePhone(p.mobile_phone ?? null, issues);

  let employment: Prepared["employment"] = null;
  if (input.employment) {
    const e = input.employment;
    if (e.start_date < "2000-01-01" || e.start_date > addDays(today, 90)) {
      warnings.push({
        field: "employment.start_date",
        code: "UNUSUAL_DATE",
        message: "Start date is unusual (before 2000 or more than 90 days ahead); please review.",
      });
    }
    let workEmail: string | null = null;
    if (e.work_email) {
      workEmail = e.work_email.trim().toLowerCase();
      const domains = getConfig().companyEmailDomains;
      if (domains.length && !domains.includes(workEmail.split("@")[1])) {
        errors.push({ field: "employment.work_email", code: "DOMAIN_NOT_ALLOWED", message: "Work email must use a company domain." });
      }
    }
    let employeeType: NonNullable<Prepared["employment"]>["employeeType"] = null;
    if (e.employee_type_id) {
      const t = await db().employeeType.findUnique({ where: { id: e.employee_type_id } });
      if (!t?.isActive) {
        errors.push({ field: "employment.employee_type_id", code: "NOT_ACTIVE", message: "Employee type does not exist or is inactive." });
      } else employeeType = { id: t.id, requiresWorkEmail: t.requiresWorkEmail };
    }
    let assignment: NonNullable<Prepared["employment"]>["assignment"] = null;
    if (e.assignment) {
      const a = e.assignment;
      const f = "employment.assignment";
      await Promise.all([
        checkActive(errors, `${f}.department_id`, "Department", db().department.findUnique({ where: { id: a.department_id } })),
        checkActive(errors, `${f}.job_title_id`, "Job title", db().jobTitle.findUnique({ where: { id: a.job_title_id } })),
        a.job_level_id
          ? checkActive(errors, `${f}.job_level_id`, "Job level", db().jobLevel.findUnique({ where: { id: a.job_level_id } }))
          : null,
      ]);
      let managerEmploymentId: string | null = null;
      if (a.manager_person_id) {
        // The manager must have an employment period covering the assignment's effective date, not just "today".
        const onDate = toDbDate(e.start_date);
        const mgr = await db().employment.findFirst({
          where: currentEmploymentWhere(onDate, { personId: a.manager_person_id }),
        });
        if (!mgr) {
          errors.push({
            field: `${f}.manager_person_id`,
            code: "MANAGER_NOT_EMPLOYED_ON_DATE",
            message: "The manager has no employment period on the effective date.",
          });
        } else managerEmploymentId = mgr.id;
      }
      assignment = {
        departmentId: a.department_id,
        jobTitleId: a.job_title_id,
        jobLevelId: a.job_level_id ?? null,
        managerEmploymentId,
      };
    }
    employment = { startDate: e.start_date, workEmail, employeeType, assignment };
  }

  const personal = {
    gender: p.gender ?? null,
    dateOfBirth,
    personalEmail: normalizePersonalEmail(p.personal_email ?? null),
    mobilePhone,
  };

  if (errors.length) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "The request violates a business rule.", errors);

  if (input.require_operational_completeness) {
    const missing = missingOperationalItems({
      fullName,
      personalEmail: personal.personalEmail,
      employmentStatus: employment ? employmentStatus([{ startDate: employment.startDate, endDate: null }], today) : "no_employment",
      period: employment && {
        startDate: employment.startDate,
        workEmail: employment.workEmail,
        employeeType: employment.employeeType,
        departmentId: employment.assignment?.departmentId ?? null,
        jobTitleId: employment.assignment?.jobTitleId ?? null,
      },
    });
    if (missing.length) {
      throw new ApiError(
        422,
        "OPERATIONAL_PROFILE_INCOMPLETE",
        "The operational profile is incomplete. Save without requiring completeness to keep it as incomplete.",
        missing.map((item) => ({ field: item, code: "REQUIRED_FOR_OPERATIONAL_PROFILE", message: `Missing: ${item}` })),
      );
    }
  }

  const changedFields = ["full_name"];
  if (legacyCode) changedFields.push("employee_code");
  for (const [k, v] of Object.entries(input.personal ?? {})) if (v !== undefined) changedFields.push(`personal.${k}`);
  if (input.employment) {
    changedFields.push("employment.start_date");
    if (input.employment.employee_type_id) changedFields.push("employment.employee_type_id");
    if (input.employment.work_email) changedFields.push("employment.work_email");
    if (input.employment.assignment) changedFields.push("employment.assignment");
  }
  return { fullName, legacyCode, personal, employment, changedFields, warnings };
}

// ---------------- Employee code issuing ----------------
// A PostgreSQL sequence guarantees distinct numbers under concurrency; numbers already registered as legacy codes are skipped.
async function nextGeneratedCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 1000; i++) {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('employee_code_seq') AS n`;
    const candidate = `ES${String(n).padStart(4, "0")}`;
    const exists = await tx.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM employee_code_registry WHERE lower(code) = lower(${candidate}) LIMIT 1`;
    if (exists.length === 0) return candidate;
  }
  throw new Error("employee code space exhausted");
}

// ---------------- Create ----------------
export async function createEmployee(
  principal: Principal,
  input: EmployeeCreateInput,
  idempotencyKey: string,
  requestId: string,
): Promise<{ replayed: boolean; body: EmployeeDetail & { warnings: ErrorDetail[] } }> {
  const operation = "createEmployee";
  const requestHmac = requestFingerprint(operation, input);

  // Fast replay path: business validation is not re-run for an operation that already completed.
  const prior = await db().idempotencyRecord.findUnique({
    where: { actorUserId_operation_idempotencyKey: { actorUserId: principal.userId, operation, idempotencyKey } },
  });
  if (prior) return replay(principal, prior.requestHmac, requestHmac, prior.resourceId);

  const prepared = await prepareCreate(principal, input, todayInVietnam());
  if (prepared.legacyCode) {
    const taken = await db().$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM employee_code_registry WHERE lower(code) = lower(${prepared.legacyCode}) LIMIT 1`;
    if (taken.length) throw duplicateCode();
  }

  for (let attempt = 1; ; attempt++) {
    const personId = randomUUID();
    try {
      const outcome = await db().$transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, {
          actorUserId: principal.userId,
          operation,
          key: idempotencyKey,
          requestHmac,
          resourceId: personId,
        });
        if (!claim.claimed) return { kind: "replay" as const, claim };

        const code = prepared.legacyCode ?? (await nextGeneratedCode(tx));
        await tx.person.create({
          data: {
            id: personId,
            employeeCode: code,
            fullName: prepared.fullName,
            gender: prepared.personal.gender,
            dateOfBirth: prepared.personal.dateOfBirth ? toDbDate(prepared.personal.dateOfBirth) : null,
            personalEmail: prepared.personal.personalEmail,
            mobilePhone: prepared.personal.mobilePhone,
            createdBy: principal.userId,
          },
        });
        await tx.employeeCodeRegistry.create({
          data: { code, personId, source: prepared.legacyCode ? "legacy" : "generated", issuedBy: principal.userId },
        });
        if (prepared.employment) {
          const e = prepared.employment;
          const employment = await tx.employment.create({
            data: {
              personId,
              startDate: toDbDate(e.startDate),
              workEmail: e.workEmail,
              employeeTypeId: e.employeeType?.id ?? null,
              recordSource: "form",
              createdBy: principal.userId,
            },
          });
          await tx.employmentEvent.create({
            data: { employmentId: employment.id, eventType: "start", effectiveDate: toDbDate(e.startDate), recordedBy: principal.userId },
          });
          if (e.assignment) {
            // New hire: the first assignment starts on the start date (not applied to snapshot migrations, see R03).
            await tx.jobAssignment.create({
              data: {
                employmentId: employment.id,
                effectiveFrom: toDbDate(e.startDate),
                departmentId: e.assignment.departmentId,
                jobTitleId: e.assignment.jobTitleId,
                jobLevelId: e.assignment.jobLevelId,
                managerEmploymentId: e.assignment.managerEmploymentId,
                recordSource: "form",
                changeReason: "initial_assignment",
                createdBy: principal.userId,
              },
            });
          }
        }
        await recordAudit(
          {
            actorUserId: principal.userId,
            action: "employee.create",
            outcome: "success",
            entityType: "person",
            entityId: personId,
            requestId,
            changedFields: prepared.changedFields,
          },
          tx,
        );
        return { kind: "created" as const };
      });

      if (outcome.kind === "replay") return replay(principal, outcome.claim.requestHmac, requestHmac, outcome.claim.resourceId);
      const detail = await getEmployee(principal, personId);
      return { replayed: false, body: { ...detail, warnings: prepared.warnings } };
    } catch (error) {
      const info = pgErrorInfo(error);
      const isUnique = info.prismaCode === "P2002" || info.sqlState === "23505";
      if (isUnique && prepared.legacyCode) throw duplicateCode();
      if (isUnique && attempt < 3) continue; // rare race with a concurrently registered legacy code: retry the whole transaction
      if (info.sqlState === "23P01" && info.constraint === "employment_work_email_period_ex") {
        throw new ApiError(409, "WORK_EMAIL_IN_USE", "This work email is assigned to someone else for an overlapping period.", [
          { field: "employment.work_email", code: "IN_USE", message: "Work email already in use." },
        ]);
      }
      if (info.constraint === "job_assignment_within_employment") {
        throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "An assignment must fall within the employment period.");
      }
      throw error;
    }
  }
}

function duplicateCode() {
  return new ApiError(409, "DUPLICATE_EMPLOYEE_CODE", "This employee code already exists (case-insensitive) and cannot be reused.", [
    { field: "employee_code", code: "DUPLICATE", message: "Code already issued." },
  ]);
}

async function replay(principal: Principal, storedHmac: string, requestHmac: string, resourceId: string) {
  if (storedHmac !== requestHmac) {
    throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different payload.");
  }
  // Re-read current data with the caller's CURRENT permissions; never return a stored snapshot.
  const detail = await getEmployee(principal, resourceId);
  return { replayed: true, body: { ...detail, warnings: [] } };
}

// ---------------- Detail ----------------
const assignmentInclude = {
  department: true,
  jobTitle: true,
  jobLevel: true,
};
const detailInclude = {
  employments: {
    // History order: chronological by start date, then by record creation (a replacement after a cancellation).
    orderBy: [{ startDate: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      employeeType: true,
      events: { orderBy: [{ effectiveDate: "asc" as const }, { recordedAt: "asc" as const }] },
      assignments: {
        orderBy: { effectiveFrom: "asc" as const },
        include: { ...assignmentInclude, managerEmployment: { include: { person: true } } },
      },
    },
  },
};

type RefRow = { id: string; code: string; name: string } | null;
const ref = (r: RefRow) => (r ? { id: r.id, code: r.code, name: r.name } : null);
const jobTitleRef = (r: { id: string; code: string; nameEn: string; nameVi: string | null }) => ({
  id: r.id,
  code: r.code,
  name_en: r.nameEn,
  name_vi: r.nameVi,
});

export async function getEmployee(principal: Principal, id: string): Promise<EmployeeDetail> {
  if (!principal.permissions.has("employees.read")) throw forbidden();
  const person = await db().person.findUnique({ where: { id }, include: detailInclude });
  if (!person) throw notFound("Employee profile not found.");
  const today = todayInVietnam();
  const canSeePersonal = principal.permissions.has("employees.read_personal");

  // Employment history: every period, cancelled ones included and flagged.
  const toApiPeriod = (e: (typeof person.employments)[number]) => ({
    id: e.id,
    start_date: fromDbDate(e.startDate),
    end_date: fromDbDate(e.endDate),
    ...historyFlags(e),
    period_lifecycle: historyFlags(e).cancelled_at
      ? null
      : employmentStatus([{ startDate: fromDbDate(e.startDate), endDate: fromDbDate(e.endDate) }], today),
    events: e.events.map((ev) => ({
      event_type: ev.eventType as "start" | "suspend" | "resume" | "end" | "cancel_planned_start",
      effective_date: fromDbDate(ev.effectiveDate),
      recorded_at: ev.recordedAt.toISOString(),
    })),
    employee_type: ref(e.employeeType),
    work_email: e.workEmail,
    record_source: e.recordSource,
    assignments: e.assignments.map((a) => ({
      id: a.id,
      effective_from: fromDbDate(a.effectiveFrom),
      effective_to: fromDbDate(a.effectiveTo),
      department: ref(a.department)!,
      job_title: jobTitleRef(a.jobTitle),
      job_level: ref(a.jobLevel),
      manager: a.managerEmployment
        ? {
            person_id: a.managerEmployment.person.id,
            employee_code: a.managerEmployment.person.employeeCode,
            full_name: a.managerEmployment.person.fullName,
          }
        : null,
      record_source: a.recordSource,
    })),
  });
  const employments = person.employments.map(toApiPeriod);
  // Status, representative period, current assignment and completeness use operational periods only.
  const dates = operationalPeriods(person.employments)
    .map(toApiPeriod)
    .map((e) => ({ startDate: e.start_date, endDate: e.end_date, e }));
  const rep = representativeEmployment(dates, today);
  const repAssignment = rep
    ? assignmentOn(
        rep.e.assignments.map((a) => ({ effectiveFrom: a.effective_from, effectiveTo: a.effective_to, a })),
        referenceDate(rep, today),
      )?.a ?? null
    : null;

  const status = employmentStatus(dates, today);
  const repType = rep ? person.employments.find((e) => e.id === rep.e.id)?.employeeType ?? null : null;
  const facts: OperationalInput = {
    fullName: person.fullName,
    personalEmail: person.personalEmail,
    employmentStatus: status,
    period: rep && {
      startDate: rep.startDate,
      workEmail: rep.e.work_email,
      employeeType: repType && { requiresWorkEmail: repType.requiresWorkEmail },
      departmentId: repAssignment?.department.id ?? null,
      jobTitleId: repAssignment?.job_title.id ?? null,
    },
  };

  return {
    id: person.id,
    employee_code: person.employeeCode,
    full_name: person.fullName,
    employment_status: status,
    status_as_of: today,
    revision: person.revision,
    completeness: completenessView(facts),
    ...(canSeePersonal
      ? {
          personal: {
            gender: person.gender as "male" | "female" | "other" | null,
            date_of_birth: fromDbDate(person.dateOfBirth),
            personal_email: person.personalEmail,
            mobile_phone: person.mobilePhone,
          },
        }
      : {}),
    // The sensitive group is not implemented and is always restricted.
    restricted_field_groups: canSeePersonal ? ["sensitive"] : ["personal", "sensitive"],
    employments,
    created_at: person.createdAt.toISOString(),
    updated_at: person.updatedAt.toISOString(),
  };
}

// ---------------- List ----------------
type ListQuery = {
  page: number;
  page_size: number;
  search?: string;
  department_id?: string;
  employment_status?: "no_employment" | "not_started" | "active" | "ended";
};

export async function listEmployees(principal: Principal, q: ListQuery) {
  if (!principal.permissions.has("employees.read")) throw forbidden();
  const today = todayInVietnam();
  const t = toDbDate(today);
  const activeCond = currentEmploymentWhere(t);
  const anyOperational = operationalEmploymentWhere();
  const and: Record<string, unknown>[] = [];
  if (q.search) {
    const s = normalizeText(q.search);
    and.push({ OR: [{ employeeCode: { contains: s, mode: "insensitive" } }, { fullName: { contains: s, mode: "insensitive" } }] });
  }
  if (q.employment_status === "active") and.push({ employments: { some: activeCond } });
  if (q.employment_status === "not_started") {
    and.push({ employments: { none: activeCond } }, { employments: { some: futurePlannedEmploymentWhere(t) } });
  }
  if (q.employment_status === "ended") {
    and.push(
      { employments: { some: anyOperational } },
      { employments: { none: activeCond } },
      { employments: { none: futurePlannedEmploymentWhere(t) } },
    );
  }
  if (q.employment_status === "no_employment") and.push({ employments: { none: anyOperational } });
  if (q.department_id) {
    // Department of the assignment effective today, or the first assignment of someone who has not started yet.
    and.push({
      employments: {
        some: operationalEmploymentWhere({
          assignments: {
            some: {
              departmentId: q.department_id,
              OR: [
                { effectiveFrom: { lte: t }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: t } }] },
                { effectiveFrom: { gt: t }, employment: { startDate: { gt: t } } },
              ],
            },
          },
        }),
      },
    });
  }
  const where = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    db().person.findMany({
      where,
      orderBy: [{ employeeCode: "asc" }, { id: "asc" }],
      skip: (q.page - 1) * q.page_size,
      take: q.page_size,
      // List rows only need operational periods (cancelled periods have no operational effect).
      include: {
        employments: {
          where: operationalEmploymentWhere(),
          include: { employeeType: true, assignments: { include: assignmentInclude } },
        },
      },
    }),
    db().person.count({ where }),
  ]);

  const data: EmployeeListItem[] = rows.map((p) => {
    const dates = p.employments.map((e) => ({ startDate: fromDbDate(e.startDate), endDate: fromDbDate(e.endDate), e }));
    const rep = representativeEmployment(dates, today);
    const a = rep
      ? assignmentOn(
          rep.e.assignments.map((x) => ({ effectiveFrom: fromDbDate(x.effectiveFrom), effectiveTo: fromDbDate(x.effectiveTo), x })),
          referenceDate(rep, today),
        )?.x ?? null
      : null;
    const status = employmentStatus(dates, today);
    const type = rep?.e.employeeType ?? null;
    const facts: OperationalInput = {
      fullName: p.fullName,
      personalEmail: p.personalEmail,
      employmentStatus: status,
      period: rep && {
        startDate: rep.startDate,
        workEmail: rep.e.workEmail,
        employeeType: type && { requiresWorkEmail: type.requiresWorkEmail },
        departmentId: a?.departmentId ?? null,
        jobTitleId: a?.jobTitleId ?? null,
      },
    };
    return {
      id: p.id,
      employee_code: p.employeeCode,
      full_name: p.fullName,
      employment_status: status,
      operational_completeness: completenessView(facts).operational.status,
      department: a ? ref(a.department) : null,
      job_title: a ? jobTitleRef(a.jobTitle) : null,
      employee_type: ref(type),
      job_level: a ? ref(a.jobLevel) : null,
      work_email: rep?.e.workEmail ?? null,
    };
  });
  return { data, total, page: q.page, page_size: q.page_size, status_as_of: today };
}
