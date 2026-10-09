import type { z } from "zod";
import type { Permission } from "@/modules/identity/permissions";
import * as S from "./schemas";

export type Operation = {
  operationId: string;
  method: "get" | "post" | "patch";
  path: string; // OpenAPI form, e.g. /api/v1/core-hr/employees/{id}
  summary: string;
  description?: string;
  tag: string;
  auth: boolean;
  permission: Permission | null;
  pathParams?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  idempotencyKey?: "required";
  success: { status: number; description: string; schema: z.ZodType };
  errors: number[];
};

const AUTH_ERRORS = [401, 403];

function catalogOperations<L extends z.ZodType, I extends z.ZodType, C extends z.ZodType, U extends z.ZodType>(cfg: {
  key: string;
  path: string;
  label: string;
  list: L;
  item: I;
  create: C;
  update: U;
}) {
  return {
    list: {
      operationId: `list${cfg.key}s`,
      method: "get" as const,
      path: cfg.path,
      summary: `List ${cfg.label}s`,
      tag: "Catalogs",
      auth: true as const,
      permission: "catalogs.read" as const,
      query: S.CatalogListQuerySchema,
      success: { status: 200, description: `A page of ${cfg.label}s`, schema: cfg.list },
      errors: [400, ...AUTH_ERRORS],
    },
    create: {
      operationId: `create${cfg.key}`,
      method: "post" as const,
      path: cfg.path,
      summary: `Create a ${cfg.label}`,
      tag: "Catalogs",
      auth: true as const,
      permission: "catalogs.manage" as const,
      body: cfg.create,
      success: { status: 201, description: "Created", schema: cfg.item },
      errors: [400, ...AUTH_ERRORS, 409],
    },
    update: {
      operationId: `update${cfg.key}`,
      method: "patch" as const,
      path: `${cfg.path}/{id}`,
      summary: `Rename or deactivate a ${cfg.label} (no delete)`,
      tag: "Catalogs",
      auth: true as const,
      permission: "catalogs.manage" as const,
      pathParams: S.IdPathSchema,
      body: cfg.update,
      success: { status: 200, description: "Updated", schema: cfg.item },
      errors: [400, ...AUTH_ERRORS, 404],
    },
  } satisfies Record<string, Operation>;
}

const departments = catalogOperations({
  key: "Department",
  path: "/api/v1/core-hr/departments",
  label: "department",
  list: S.DepartmentListSchema,
  item: S.DepartmentSchema,
  create: S.DepartmentCreateSchema,
  update: S.DepartmentUpdateSchema,
});
const jobTitles = catalogOperations({
  key: "JobTitle",
  path: "/api/v1/core-hr/job-titles",
  label: "job title",
  list: S.JobTitleListSchema,
  item: S.JobTitleSchema,
  create: S.JobTitleCreateSchema,
  update: S.JobTitleUpdateSchema,
});
const jobLevels = catalogOperations({
  key: "JobLevel",
  path: "/api/v1/core-hr/job-levels",
  label: "job level",
  list: S.JobLevelListSchema,
  item: S.JobLevelSchema,
  create: S.JobLevelCreateSchema,
  update: S.JobLevelUpdateSchema,
});
const employeeTypes = catalogOperations({
  key: "EmployeeType",
  path: "/api/v1/core-hr/employee-types",
  label: "employee type",
  list: S.EmployeeTypeListSchema,
  item: S.EmployeeTypeSchema,
  create: S.EmployeeTypeCreateSchema,
  update: S.EmployeeTypeUpdateSchema,
});

// Only IMPLEMENTED operations are listed. Planned work lives in docs/, not in the trial spec.
export const operations = {
  getHealth: {
    operationId: "getHealth",
    method: "get",
    path: "/health",
    summary: "Service health (public, minimal response)",
    tag: "System",
    auth: false,
    permission: null,
    success: { status: 200, description: "Service and database are available", schema: S.HealthSchema },
    errors: [503],
  },
  getMe: {
    operationId: "getMe",
    method: "get",
    path: "/api/v1/me",
    summary: "The caller's HRMS account",
    tag: "Identity",
    auth: true,
    permission: null,
    success: { status: 200, description: "Account", schema: S.MeSchema },
    errors: AUTH_ERRORS,
  },
  getMyCoreHrPermissions: {
    operationId: "getMyCoreHrPermissions",
    method: "get",
    path: "/api/v1/core-hr/me/permissions",
    summary: "The caller's effective Core HR permissions",
    tag: "Identity",
    auth: true,
    permission: null,
    success: { status: 200, description: "Permissions", schema: S.MyPermissionsSchema },
    errors: AUTH_ERRORS,
  },
  listEmployees: {
    operationId: "listEmployees",
    method: "get",
    path: "/api/v1/core-hr/employees",
    summary: "List employee profiles",
    description:
      "Stable order by employee_code then id. Employment status is computed for today in Asia/Ho_Chi_Minh and is never derived from login accounts.",
    tag: "Employees",
    auth: true,
    permission: "employees.read",
    query: S.EmployeeListQuerySchema,
    success: { status: 200, description: "A page of profiles", schema: S.EmployeeListSchema },
    errors: [400, ...AUTH_ERRORS],
  },
  createEmployee: {
    operationId: "createEmployee",
    method: "post",
    path: "/api/v1/core-hr/employees",
    summary: "Create an employee profile",
    description:
      "Written atomically in one transaction. Requires an Idempotency-Key header: the same key and payload return the existing profile (header Idempotent-Replayed: true) after re-checking permissions; the same key with a different payload returns 409. Legal ID, tax, social insurance, bank and dependant fields are not enabled and are rejected (422).",
    tag: "Employees",
    auth: true,
    permission: "employees.create",
    body: S.EmployeeCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Created profile (or replayed result)", schema: S.EmployeeCreatedSchema },
    errors: [400, ...AUTH_ERRORS, 409, 422],
  },
  getEmployee: {
    operationId: "getEmployee",
    method: "get",
    path: "/api/v1/core-hr/employees/{id}",
    summary: "Employee profile detail (field-level permissions applied)",
    tag: "Employees",
    auth: true,
    permission: "employees.read",
    pathParams: S.IdPathSchema,
    success: { status: 200, description: "Profile", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404],
  },
  updateEmployee: {
    operationId: "updateEmployee",
    method: "patch",
    path: "/api/v1/core-hr/employees/{id}",
    summary: "Edit employee profile fields",
    description:
      "Edits Full Name and personal/contact fields only. Requires expected_revision (409 REVISION_CONFLICT when stale). A reason is required when Full Name changes or a recorded Date of Birth is corrected or removed (filling in a missing Date of Birth needs none). Personal fields require employees.write_personal. Audit records changed field names and the reason; personal values are never stored in audit.",
    tag: "Employees",
    auth: true,
    permission: "employees.update",
    pathParams: S.IdPathSchema,
    body: S.EmployeeUpdateSchema,
    success: { status: 200, description: "Updated profile (unchanged if nothing differed)", schema: S.EmployeeUpdatedSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  updateEmploymentWorkEmail: {
    operationId: "updateEmploymentWorkEmail",
    method: "patch",
    path: "/api/v1/core-hr/employments/{id}/work-email",
    summary: "Update the Work Email of an employment period",
    description:
      "Pre-start or active (not ended) periods: normal update with employment.manage, no reason. Ended periods: historical correction, requires employment.correct (HR_ADMIN) and a reason. Cancelled periods are read-only (409 EMPLOYMENT_PERIOD_READ_ONLY). Uses expected_revision of the owning person. Returns the owning employee profile with recalculated completeness. Audit records the field name and reason, never email values.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.WorkEmailUpdateSchema,
    success: { status: 200, description: "Owning employee profile after the update", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createAssignmentChange: {
    operationId: "createAssignmentChange",
    method: "post",
    path: "/api/v1/core-hr/employments/{id}/assignment-changes",
    summary: "Record an Assignment Change (new effective-dated assignment)",
    description:
      "Normal organizational business event on a pre-start or active (not ended, not cancelled) employment period. Closes the assignment applicable on effective_date and opens a new one; never rewrites history. Blocked when an assignment already starts on or after effective_date (correct it through the historical correction workflow). Requires a reason, expected_revision and an Idempotency-Key. Past effective dates need employment.correct (HR_ADMIN). Audit stores old/new department, job title, level and effective dates; manager changes are recorded by field name only.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.AssignmentChangeCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Owning employee profile after the change (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  listDepartments: departments.list,
  createDepartment: departments.create,
  updateDepartment: departments.update,
  listJobTitles: jobTitles.list,
  createJobTitle: jobTitles.create,
  updateJobTitle: jobTitles.update,
  listJobLevels: jobLevels.list,
  createJobLevel: jobLevels.create,
  updateJobLevel: jobLevels.update,
  listEmployeeTypes: employeeTypes.list,
  createEmployeeType: employeeTypes.create,
  updateEmployeeType: employeeTypes.update,
  getInternalOpenApi: {
    operationId: "getInternalOpenApi",
    method: "get",
    path: "/api/v1/internal/openapi.json",
    summary: "Internal OpenAPI document for Core HR",
    tag: "Docs",
    auth: true,
    permission: "docs.read",
    success: { status: 200, description: "OpenAPI 3.1 document", schema: S.OpenApiDocumentSchema },
    errors: AUTH_ERRORS,
  },
} satisfies Record<string, Operation>;

export type OperationId = keyof typeof operations;
