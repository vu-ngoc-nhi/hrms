import { z } from "zod";

// Single schema registry: route handlers validate with these schemas and OpenAPI is generated from them.
// Wire values (enums, codes) are stable English identifiers; display text lives in the UI message catalog.
export const schemaRegistry = z.registry<{ id: string; description?: string }>();
function reg<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  schemaRegistry.add(schema, { id, description });
  return schema;
}

const isoDate = () => z.iso.date();
const isoDateTime = () => z.iso.datetime({ offset: true });
const code = (max: number) => z.string().regex(new RegExp(`^[A-Za-z0-9._-]{1,${max}}$`));
const name = () => z.string().min(1).max(150);
const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), total: z.int(), page: z.int(), page_size: z.int() });

// ---------------- Common ----------------
export const ErrorDetailSchema = reg(
  "ErrorDetail",
  z.object({ field: z.string().optional(), code: z.string(), message: z.string() }),
);
export const ErrorResponseSchema = reg(
  "ErrorResponse",
  z.object({
    error: z.string(),
    message: z.string(),
    request_id: z.string(),
    details: z.array(ErrorDetailSchema).optional(),
  }),
);

const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
};
const boolQuery = z.enum(["true", "false"]).optional();

export const IdPathSchema = z.strictObject({ id: z.uuid() });

export const OpenApiDocumentSchema = reg(
  "OpenApiDocument",
  z.looseObject({ openapi: z.string(), info: z.looseObject({ title: z.string() }) }),
);

export const HealthSchema = reg("Health", z.object({ status: z.enum(["ok", "unavailable"]) }));

// ---------------- Identity ----------------
export const MeSchema = reg(
  "Me",
  z.object({
    user_id: z.uuid(),
    display_name: z.string(),
    tenant_id: z.uuid(),
    object_id: z.uuid(),
    auth_issuer: z.enum(["entra", "test"]),
    roles: z.array(z.string()),
  }),
);
export const MyPermissionsSchema = reg(
  "MyPermissions",
  z.object({
    permissions: z.array(z.string()),
    field_groups: z.object({ directory: z.boolean(), personal: z.boolean(), sensitive: z.boolean() }),
  }),
);

// ---------------- Catalogs (values are HR-managed data) ----------------
export const CatalogListQuerySchema = z.strictObject({
  ...pageFields,
  search: z.string().max(100).optional(),
  include_inactive: boolQuery,
});

const catalogBase = {
  id: z.uuid(),
  code: z.string(),
  is_active: z.boolean(),
  created_at: isoDateTime(),
  updated_at: isoDateTime(),
};
const nonEmpty = (v: object) => Object.keys(v).length > 0;
const NON_EMPTY_MESSAGE = "At least one field is required.";

export const DepartmentSchema = reg("Department", z.object({ ...catalogBase, name: z.string() }));
export const DepartmentCreateSchema = reg("DepartmentCreate", z.strictObject({ code: code(30), name: name() }));
export const DepartmentUpdateSchema = reg(
  "DepartmentUpdate",
  z.strictObject({ name: name().optional(), is_active: z.boolean().optional() }).refine(nonEmpty, NON_EMPTY_MESSAGE),
);
export const DepartmentListSchema = reg("DepartmentList", page(DepartmentSchema));

export const JobTitleSchema = reg(
  "JobTitle",
  z.object({
    ...catalogBase,
    name_en: z.string(),
    name_vi: z.string().nullable().describe("Optional Vietnamese name for official/legal documents."),
  }),
);
export const JobTitleCreateSchema = reg(
  "JobTitleCreate",
  z.strictObject({ code: code(30), name_en: name(), name_vi: name().optional() }),
);
export const JobTitleUpdateSchema = reg(
  "JobTitleUpdate",
  z
    .strictObject({ name_en: name().optional(), name_vi: name().nullable().optional(), is_active: z.boolean().optional() })
    .refine(nonEmpty, NON_EMPTY_MESSAGE),
);
export const JobTitleListSchema = reg("JobTitleList", page(JobTitleSchema));

export const JobLevelSchema = reg(
  "JobLevel",
  z.object({ ...catalogBase, name: z.string(), sort_order: z.int().nullable() }),
);
export const JobLevelCreateSchema = reg(
  "JobLevelCreate",
  z.strictObject({ code: code(30), name: name(), sort_order: z.int().min(0).max(1000).optional() }),
);
export const JobLevelUpdateSchema = reg(
  "JobLevelUpdate",
  z
    .strictObject({
      name: name().optional(),
      sort_order: z.int().min(0).max(1000).nullable().optional(),
      is_active: z.boolean().optional(),
    })
    .refine(nonEmpty, NON_EMPTY_MESSAGE),
);
export const JobLevelListSchema = reg("JobLevelList", page(JobLevelSchema));

const requiresWorkEmail = () =>
  z
    .boolean()
    .describe("Whether people of this type are expected to receive a company account; drives the operational email rule.");
export const EmployeeTypeSchema = reg(
  "EmployeeType",
  z.object({ ...catalogBase, name: z.string(), requires_work_email: requiresWorkEmail() }),
  "Nature of the working relationship (e.g. Employee, Service Contractor, Intern). HR-managed catalog data. Not a working arrangement (full-time/part-time) and not an employment stage (probation).",
);
export const EmployeeTypeCreateSchema = reg(
  "EmployeeTypeCreate",
  z.strictObject({ code: code(30), name: name(), requires_work_email: requiresWorkEmail().optional() }),
);
export const EmployeeTypeUpdateSchema = reg(
  "EmployeeTypeUpdate",
  z
    .strictObject({ name: name().optional(), requires_work_email: requiresWorkEmail().optional(), is_active: z.boolean().optional() })
    .refine(nonEmpty, NON_EMPTY_MESSAGE),
);
export const EmployeeTypeListSchema = reg("EmployeeTypeList", page(EmployeeTypeSchema));

// ---------------- Employees ----------------
export const EmploymentStatusSchema = z
  .enum(["no_employment", "not_started", "active", "ended"])
  .describe("Computed from employment periods at status_as_of. Value set is an MVP Decision.");
export const CompletenessStatusSchema = z.enum(["complete", "incomplete"]);

export const EmployeeCreateSchema = reg(
  "EmployeeCreate",
  z.strictObject({
    full_name: z.string().min(1).max(200),
    require_operational_completeness: z
      .boolean()
      .optional()
      .describe(
        "When true, the request is rejected (422) unless the Operational Profile rule is met. Default false: an incomplete profile is saved and reported as incomplete.",
      ),
    employee_code: z
      .string()
      .max(20)
      .optional()
      .describe("Legacy employee code to keep as-is. Requires employees.set_code. Omit to auto-issue."),
    personal: z
      .strictObject({
        gender: z.enum(["male", "female", "other"]).optional(),
        date_of_birth: isoDate().optional(),
        personal_email: z.email().max(254).optional().describe("Personal/contact email. Never used as an identity key."),
        mobile_phone: z.string().max(20).optional(),
      })
      .optional(),
    employment: z
      .strictObject({
        start_date: isoDate(),
        employee_type_id: z.uuid().optional().describe("Employee Type of this employment period. A genuine relationship change is a new period; a data-entry mistake is corrected on the same period (S4)."),
        work_email: z.email().max(254).optional().describe("Company-issued email. Separate from the personal/contact email."),
        assignment: z
          .strictObject({
            department_id: z.uuid(),
            job_title_id: z.uuid(),
            job_level_id: z.uuid().optional(),
            manager_person_id: z.uuid().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
);

const CatalogRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
const JobTitleRefSchema = z.object({ id: z.uuid(), code: z.string(), name_en: z.string(), name_vi: z.string().nullable() });
const PersonRefSchema = z.object({ person_id: z.uuid(), employee_code: z.string(), full_name: z.string() });

export const AssignmentSchema = reg(
  "Assignment",
  z.object({
    id: z.uuid(),
    effective_from: isoDate(),
    effective_to: isoDate().nullable().describe("Exclusive. null = end date not yet determined."),
    department: CatalogRefSchema,
    job_title: JobTitleRefSchema,
    job_level: CatalogRefSchema.nullable(),
    manager: PersonRefSchema.nullable(),
    record_source: z.string(),
  }),
);
export const EmploymentSchema = reg(
  "Employment",
  z.object({
    id: z.uuid(),
    start_date: isoDate(),
    end_date: isoDate().nullable().describe("Inclusive."),
    period_lifecycle: EmploymentStatusSchema.nullable().describe(
      "Computed lifecycle of this period at status_as_of (not_started/active/ended). null when the period was cancelled: Cancelled is a record disposition, not a lifecycle status.",
    ),
    events: z
      .array(
        z.object({
          event_type: z.enum(["start", "suspend", "resume", "end", "cancel_planned_start"]),
          effective_date: isoDate(),
          recorded_at: isoDateTime(),
        }),
      )
      .describe("Recorded employment events in chronological order. Free-text reasons are not exposed here."),
    cancelled_at: isoDateTime()
      .nullable()
      .describe("Set when this planned period was cancelled before it began. Cancelled periods stay in history but have no operational effect; Cancelled is not an employment status."),
    employee_type: CatalogRefSchema.nullable(),
    work_email: z.string().nullable(),
    record_source: z.string(),
    assignments: z.array(AssignmentSchema),
  }),
);
export const CompletenessSchema = reg(
  "ProfileCompleteness",
  z.object({
    operational: z.object({
      status: CompletenessStatusSchema,
      rule_version: z.string(),
      rule_status: z.enum(["mvp_decision", "confirmed"]),
      items: z.array(z.object({ code: z.string(), satisfied: z.boolean() })),
    }),
    hr: z.object({ status: z.literal("not_defined") }).describe("No approved HR completeness rule yet."),
    legal: z
      .object({ status: z.literal("pending_legal_review") })
      .describe("Legal/compliance completeness requires legal review before it can be evaluated."),
  }),
);
export const EmployeeDetailSchema = reg(
  "EmployeeDetail",
  z.object({
    id: z.uuid(),
    employee_code: z.string(),
    full_name: z.string(),
    employment_status: EmploymentStatusSchema,
    status_as_of: isoDate(),
    revision: z.int(),
    completeness: CompletenessSchema,
    personal: z
      .object({
        gender: z.enum(["male", "female", "other"]).nullable(),
        date_of_birth: isoDate().nullable(),
        personal_email: z.string().nullable(),
        mobile_phone: z.string().nullable(),
      })
      .optional()
      .describe("Present only when the caller has employees.read_personal."),
    restricted_field_groups: z.array(z.enum(["personal", "sensitive"])),
    employments: z.array(EmploymentSchema),
    created_at: isoDateTime(),
    updated_at: isoDateTime(),
  }),
);
export const EmployeeCreatedSchema = reg(
  "EmployeeCreated",
  EmployeeDetailSchema.extend({
    warnings: z.array(ErrorDetailSchema).describe("Items to review; they do not block creation."),
  }),
);

export const EmployeeUpdateSchema = reg(
  "EmployeeUpdate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("The revision the caller last read; a stale value returns 409 REVISION_CONFLICT."),
    reason: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe("Required when Full Name changes or a recorded Date of Birth is corrected or removed (C-23). Not required when a missing Date of Birth is filled in."),
    full_name: z.string().min(1).max(200).optional(),
    personal: z
      .strictObject({
        gender: z.enum(["male", "female", "other"]).nullable().optional(),
        date_of_birth: isoDate().nullable().optional(),
        mobile_phone: z.string().max(20).nullable().optional(),
        personal_email: z.email().max(254).nullable().optional().describe("Personal/contact email. Never an identity key."),
      })
      .optional()
      .describe("Requires employees.write_personal. null clears a value."),
  }),
  "Profile fields only. Employee code, employee type, employment dates, work email and assignments are not editable here.",
);
export const EmployeeUpdatedSchema = reg(
  "EmployeeUpdated",
  EmployeeDetailSchema.extend({
    warnings: z.array(ErrorDetailSchema).describe("Items to review; they do not block the update."),
  }),
);

export const WorkEmailUpdateSchema = reg(
  "WorkEmailUpdate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
    work_email: z.email().max(254).describe("Company-issued email of this employment period. Not an identity key."),
    reason: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe("Required when the period has ended (historical correction, HR_ADMIN only); optional otherwise."),
  }),
);

export const EmployeeListItemSchema = reg(
  "EmployeeListItem",
  z.object({
    id: z.uuid(),
    employee_code: z.string(),
    full_name: z.string(),
    employment_status: EmploymentStatusSchema,
    operational_completeness: CompletenessStatusSchema,
    department: CatalogRefSchema.nullable(),
    job_title: JobTitleRefSchema.nullable(),
    employee_type: CatalogRefSchema.nullable(),
    job_level: CatalogRefSchema.nullable(),
    work_email: z.string().nullable(),
  }),
);
export const EmployeeListSchema = reg(
  "EmployeeList",
  z.object({
    data: z.array(EmployeeListItemSchema),
    total: z.int(),
    page: z.int(),
    page_size: z.int(),
    status_as_of: isoDate(),
  }),
);
export const EmployeeListQuerySchema = z.strictObject({
  ...pageFields,
  search: z.string().max(100).optional(),
  department_id: z.uuid().optional(),
  employment_status: EmploymentStatusSchema.optional(),
});

export type EmployeeCreateInput = z.infer<typeof EmployeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof EmployeeUpdateSchema>;
export type WorkEmailUpdateInput = z.infer<typeof WorkEmailUpdateSchema>;
export type EmployeeDetail = z.infer<typeof EmployeeDetailSchema>;
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;
