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
      "Pre-start or active (not ended) periods: adding or replacing the address is a normal update with employment.manage, no reason. Clearing it (work_email: null) is a data correction on any period and requires employment.correct (HR_ADMIN) and a reason; it never represents account deprovisioning. Ended periods: any change is a historical correction, requires employment.correct (HR_ADMIN) and a reason. Cancelled periods are read-only (409 EMPLOYMENT_PERIOD_READ_ONLY). Uses expected_revision of the owning person. Returns the owning employee profile with recalculated completeness. Audit records the field name and reason, never email values.",
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
      "Normal organizational business event on a pre-start or active (not ended, not cancelled) employment period. Closes the assignment applicable on effective_date and opens a new one; never rewrites history. Blocked when the period has no assignment yet (422 NO_ASSIGNMENT_YET — use Add Initial Assignment), when no assignment is in effect on effective_date (422 NO_ASSIGNMENT_IN_EFFECT), or when an assignment already starts on or after effective_date (correct it through the historical correction workflow). Requires a reason, expected_revision and an Idempotency-Key. Past effective dates need employment.correct (HR_ADMIN). Audit stores old/new department, job title, level and effective dates; manager changes are recorded by field name only.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.AssignmentChangeCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Owning employee profile after the change (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createInitialAssignment: {
    operationId: "createInitialAssignment",
    method: "post",
    path: "/api/v1/core-hr/employments/{id}/initial-assignment",
    summary: "Add the initial assignment of an employment period",
    description:
      "Only for a non-cancelled employment period with no assignment rows (otherwise 422 ASSIGNMENT_ALREADY_EXISTS; use Assignment Change or a historical correction). effective_date must fall within the period; a past date is allowed for HR_EDITOR and HR_ADMIN as Initial Data Capture and then requires a reason. Requires expected_revision and an Idempotency-Key. Audit action assignment.initial (or assignment.initial_data_capture when backdated) with old/new department, job title, level and effective dates; manager by field name only. No lifecycle event is created.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.InitialAssignmentCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Owning employee profile after the change (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createEndEmployment: {
    operationId: "createEndEmployment",
    method: "post",
    path: "/api/v1/core-hr/employments/{id}/end",
    summary: "End Employment",
    description:
      "Explicit business action (C-50) on a non-cancelled period that has not ended and has no Active End Event. Sets the end date of an open period, or shortens / confirms an existing future end date (a later date is a historical correction: 422 END_DATE_LATER_THAN_PLANNED). HR_EDITOR: today or later; a past end date requires employment.correct (HR_ADMIN). Requires a structured End Reason (RELATIONSHIP_CHANGE is not selectable; OTHER needs a note), expected_revision and an Idempotency-Key. Blocked when an assignment starts after the end date (422 FUTURE_ASSIGNMENT_OUTSIDE_END; it is never changed automatically). The assignment in effect on the end date is closed at end date + 1. The end event stores the previous end date, the closed assignment and its previous effective_to for a later safe reversal. Audit: employment.end and assignment.close, same request ID.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.EndEmploymentCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Owning employee profile after the action (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createInitialEmployment: {
    operationId: "createInitialEmployment",
    method: "post",
    path: "/api/v1/core-hr/employees/{id}/initial-employment",
    summary: "Add Initial Employment Period",
    description:
      "For a person with zero non-cancelled employment periods (profile-only, imported without employment data, or only cancelled planned periods); otherwise 422 EMPLOYMENT_ALREADY_EXISTS. HR_EDITOR and HR_ADMIN; Initial Data Capture allows a past start date, which then requires a reason. Creates the period (Employee Type, dates, optional planned end date, optional Work Email) and a start event; no assignment and no End event. expected_revision and Idempotency-Key required. Audit: employment.initial or employment.initial_data_capture.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.InitialEmploymentCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Employee profile after the action (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createRehire: {
    operationId: "createRehire",
    method: "post",
    path: "/api/v1/core-hr/employees/{id}/rehire",
    summary: "Rehire (new employment period after the latest one)",
    description:
      "Creates a NEW period for the same person and Employee Code after the latest non-cancelled period, which must have an end date (an end event is not required; 422 LATEST_PERIOD_HAS_NO_END / NO_PREVIOUS_EMPLOYMENT otherwise). start_date must be after that end date (422 REHIRE_START_NOT_AFTER_PREVIOUS_END); a planned Rehire before the previous end date is reached is allowed. HR_EDITOR today or later; a past start date requires employment.correct (HR_ADMIN). Reason, expected_revision and Idempotency-Key required. Nothing is copied from the previous period; no assignment and no End event are created; a start event is. Audit: employment.rehire. A Rehire after an End Employment keeps that End irreversible while the new period exists.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.RehireCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Employee profile after the action (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createRelationshipChange: {
    operationId: "createRelationshipChange",
    method: "post",
    path: "/api/v1/core-hr/employments/{id}/relationship-change",
    summary: "Relationship Change (continuous transition to a different Employee Type)",
    description:
      "Applies to the person's latest non-cancelled period (422 NOT_LATEST_PERIOD) without an Active End Event (422 ACTIVE_END_EVENT_EXISTS). The new Employee Type must differ (422 SAME_EMPLOYEE_TYPE). The current period ends on start_date − 1: an open end date is set, a future planned end date is replaced (earlier or later), an already-ended period only allows start_date = end date + 1 (422 GAP_USE_REHIRE / HISTORICAL_END_MISMATCH). Assignments starting on or after start_date block it (422 FUTURE_ASSIGNMENT_OUTSIDE_END); the applicable assignment closes at start_date. Writes an end event with the system End Reason RELATIONSHIP_CHANGE and reversal metadata, a new period (same person and Employee Code) with one start event, the submitted Work Email only, and an optional submitted Initial Assignment. HR_EDITOR today or later; backdated requires HR_ADMIN. Reason, expected_revision and Idempotency-Key required. No automatic reversal in Phase 1. Audit: employment.relationship_change (old and new period), assignment.close, assignment.initial — same request ID.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.RelationshipChangeCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Employee profile after the action (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createCancelPlanned: {
    operationId: "createCancelPlanned",
    method: "post",
    path: "/api/v1/core-hr/employments/{id}/cancel-planned",
    summary: "Cancel Planned Period",
    description:
      "A future period (start_date after today, Asia/Ho_Chi_Minh) will not take effect: 422 PERIOD_ALREADY_STARTED otherwise. Only the latest non-cancelled period (409 LATER_PERIOD_EXISTS) without an Active End Event (422 ACTIVE_END_EVENT_EXISTS — reverse the End first). HR_EDITOR and HR_ADMIN (employment.manage); reason, expected_revision and Idempotency-Key required. Sets cancelled_at and adds one cancel_planned_start event dated with the planned start; nothing is deleted or cleared (dates, Employee Type, Work Email, assignments and events stay as history; the Work Email is no longer reserved). Cancelled is a record disposition, not a status. Already cancelled: 409 EMPLOYMENT_PERIOD_READ_ONLY. Audit: employment.cancel_planned.",
    tag: "Employments",
    auth: true,
    permission: "employment.manage",
    pathParams: S.IdPathSchema,
    body: S.CancelPlannedCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Employee profile after the cancellation (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createReverseEnd: {
    operationId: "createReverseEnd",
    method: "post",
    path: "/api/v1/core-hr/employments/{id}/reverse-end",
    summary: "Reverse End Employment",
    description:
      "Exact reversal or no reversal (C-54): HR_ADMIN only (employment.correct), mandatory reversal reason, expected_revision and Idempotency-Key. Operates only on the Active End Event (422 NO_ACTIVE_END_EVENT otherwise, including legacy end dates without an event: use a period correction). Restores end_date to the End event's previous_end_date (open, a planned date, or a historical date) and the closed assignment's exact previous effective_to; adds an end_reversed event referencing the original end event, which stays unchanged. Blocked with 409 END_EFFECT_CHANGED when the closed assignment changed since, END_STATE_INCONSISTENT when the period no longer matches the End event, LATER_PERIOD_EXISTS / LATER_LIFECYCLE_EVENT when later history depends on it, END_ALREADY_REVERSED, PERIOD_OVERLAP or WORK_EMAIL_IN_USE. Audit: employment.end.reverse and assignment.restore, same request ID and reason.",
    tag: "Employments",
    auth: true,
    permission: "employment.correct",
    pathParams: S.IdPathSchema,
    body: S.ReverseEndCreateSchema,
    idempotencyKey: "required",
    success: { status: 201, description: "Owning employee profile after the reversal (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createPeriodCorrection: {
    operationId: "createPeriodCorrection",
    method: "post",
    path: "/api/v1/core-hr/employments/{id}/period-corrections",
    summary: "Correct the Employee Type, start date or end date of an employment period",
    description:
      "Historical correction (HR_ADMIN, employment.correct) of wrongly entered data on the same period; reason, expected_revision and Idempotency-Key required. An existing inactive Employee Type is allowed. end_date changes from one date to another; a date on an open period returns 422 USE_END_EMPLOYMENT. end_date null clears the end date only when the period has no Active End Event (legacy/imported periods, planned end dates entered in error); with an Active End Event it returns 422 USE_REVERSE_END_EMPLOYMENT. The first assignment moves with the start date only when it started on the old start date; the last assignment moves with the end date only when it ended with the old end date; otherwise assignments are never moved and the correction is blocked if they would fall outside the period (422 ASSIGNMENT_OUTSIDE_PERIOD). An existing start/end lifecycle event date is synced (no event is created). Overlap with another period: 409 PERIOD_OVERLAP; Work Email range conflict: 409 WORK_EMAIL_IN_USE. Audit: employment.correct on the period and assignment.correct on every moved assignment, same request ID and reason.",
    tag: "Employments",
    auth: true,
    permission: "employment.correct",
    pathParams: S.IdPathSchema,
    body: S.PeriodCorrectionCreateSchema,
    idempotencyKey: "required",
    success: { status: 200, description: "Owning employee profile after the correction (or replayed result)", schema: S.EmployeeDetailSchema },
    errors: [400, ...AUTH_ERRORS, 404, 409, 422],
  },
  createAssignmentCorrection: {
    operationId: "createAssignmentCorrection",
    method: "post",
    path: "/api/v1/core-hr/assignments/{id}/corrections",
    summary: "Correct an assignment row in place",
    description:
      "Historical correction (HR_ADMIN, employment.correct) of a wrongly entered assignment row, including future-dated rows; reason, expected_revision and Idempotency-Key required. Edits the existing row (no new row, no lifecycle event). Department, Job Title, Job Level (existing inactive values allowed), Manager and effective_from can be corrected; effective_to is never edited directly. Correcting effective_from of a non-first row moves the previous row's effective_to to the same date (C-42); unrelated rows never change. Blocked (422) when a row would become empty or leave the period, or when the previous row is not contiguous. Audit: assignment.correct on every modified row, same request ID and reason.",
    tag: "Employments",
    auth: true,
    permission: "employment.correct",
    pathParams: S.IdPathSchema,
    body: S.AssignmentCorrectionCreateSchema,
    idempotencyKey: "required",
    success: { status: 200, description: "Owning employee profile after the correction (or replayed result)", schema: S.EmployeeDetailSchema },
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
