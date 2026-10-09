import { z } from "zod";
import { END_REASON_CODES, SELECTABLE_END_REASON_CODES } from "./end-reasons";

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
export { END_REASON_CODES, SELECTABLE_END_REASON_CODES };
export const EndReasonCodeSchema = z.enum(END_REASON_CODES);

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
          event_type: z.enum(["start", "suspend", "resume", "end", "end_reversed", "cancel_planned_start"]),
          effective_date: isoDate(),
          recorded_at: isoDateTime(),
          end_reason: z
            .object({ code: EndReasonCodeSchema, label: z.string() })
            .nullable()
            .describe("Structured End Reason of an end event (null otherwise or when none was recorded). Legal meaning: Pending Legal Review."),
        }),
      )
      .describe("Recorded employment events in chronological order. Free-text notes and reasons are never exposed here."),
    has_active_end_event: z
      .boolean()
      .describe("True when the period has an end event that has not been reversed (Active End Event). A legacy end date may exist without any event."),
    active_end_event: z
      .object({
        effective_date: isoDate(),
        end_reason: z.object({ code: EndReasonCodeSchema, label: z.string() }).nullable(),
        previous_end_date: isoDate().nullable().describe("End date before End Employment (null = the period was open). Reverse End Employment restores it."),
        closed_assignment: z
          .object({ id: z.uuid(), previous_effective_to: isoDate().nullable() })
          .nullable()
          .describe("Assignment End Employment closed and its exact previous effective_to (null = it was open-ended)."),
      })
      .nullable()
      .describe("The Active End Event (C-51) with the structural data a reversal restores; never notes or reasons."),
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
    work_email: z
      .email()
      .max(254)
      .nullable()
      .describe(
        "Company-issued email of this employment period. Not an identity key. null clears it: a data correction for an address that was wrong or should never have been recorded (HR_ADMIN, reason required). Account deprovisioning is never represented by clearing it (C-36).",
      ),
    reason: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe("Required when clearing the Work Email or when the period has ended (historical correction, HR_ADMIN only); optional otherwise."),
  }),
);

export const AssignmentChangeCreateSchema = reg(
  "AssignmentChangeCreate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
    effective_date: isoDate().describe(
      "First day of the new assignment. HR_EDITOR: today or later. A past date requires employment.correct (HR_ADMIN).",
    ),
    reason: z.string().min(1).max(1000).describe("Mandatory for every Assignment Change (C-23)."),
    department_id: z.uuid().optional(),
    job_title_id: z.uuid().optional(),
    job_level_id: z.uuid().nullable().optional().describe("null clears the level; omit to keep the current one."),
    manager_person_id: z.uuid().nullable().optional().describe("null clears the manager; omit to keep the current one."),
  }),
  "A genuine organizational change: closes the applicable assignment at effective_date and creates a new effective-dated assignment. Omitted fields keep their current values. Never changes Employee Type.",
);

export const InitialAssignmentCreateSchema = reg(
  "InitialAssignmentCreate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
    effective_date: isoDate().describe(
      "First day of the initial assignment; must fall within the employment period. A past date is allowed as Initial Data Capture (PV-19).",
    ),
    reason: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe("Required when effective_date is in the past (backdated Initial Data Capture); not required otherwise (C-41)."),
    department_id: z.uuid(),
    job_title_id: z.uuid(),
    job_level_id: z.uuid().nullable().optional(),
    manager_person_id: z.uuid().nullable().optional(),
  }),
  "Records the FIRST assignment of a non-cancelled employment period that has no assignment rows (C-41). Catalog values must be active.",
);

const correctionReason = () =>
  z.string().min(1).max(1000).describe("Mandatory correction reason (C-23). Stored in audit only; never shown in history.");

export const PeriodCorrectionCreateSchema = reg(
  "PeriodCorrectionCreate",
  z
    .strictObject({
      expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
      reason: correctionReason(),
      employee_type_id: z.uuid().optional().describe("Corrected Employee Type of this period. An existing inactive type is allowed (C-44)."),
      start_date: isoDate().optional().describe("Corrected first day of the period."),
      end_date: isoDate()
        .nullable()
        .optional()
        .describe(
          "Corrected last day (inclusive) of a period that already has an end date; a date on an open period is rejected with USE_END_EMPLOYMENT. null clears the end date only when the period has no Active End Event (C-58); otherwise USE_REVERSE_END_EMPLOYMENT.",
        ),
    })
    .refine((v) => v.employee_type_id !== undefined || v.start_date !== undefined || v.end_date !== undefined, {
      message: "Provide at least one of employee_type_id, start_date or end_date.",
    }),
  "Historical correction of a wrongly entered Employee Type, start date or end date on the same period (HR_ADMIN). Never creates or ends a period.",
);

export const AssignmentCorrectionCreateSchema = reg(
  "AssignmentCorrectionCreate",
  z
    .strictObject({
      expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
      reason: correctionReason(),
      effective_from: isoDate()
        .optional()
        .describe("Corrected first day of this row. For a non-first row, the previous row's effective_to moves to the same date (C-42)."),
      department_id: z.uuid().optional().describe("An existing inactive value is allowed (C-44)."),
      job_title_id: z.uuid().optional().describe("An existing inactive value is allowed (C-44)."),
      job_level_id: z.uuid().nullable().optional().describe("null clears the level. An existing inactive value is allowed (C-44)."),
      manager_person_id: z.uuid().nullable().optional().describe("null clears the manager."),
    })
    .refine(
      (v) =>
        v.effective_from !== undefined ||
        v.department_id !== undefined ||
        v.job_title_id !== undefined ||
        v.job_level_id !== undefined ||
        v.manager_person_id !== undefined,
      { message: "Provide at least one field to correct." },
    ),
  "Historical correction of a wrongly entered assignment row, edited in place (HR_ADMIN). effective_to is never edited directly.",
);

export const EndEmploymentCreateSchema = reg(
  "EndEmploymentCreate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
    end_date: isoDate().describe(
      "Last day of the period (inclusive). HR_EDITOR: today or later; a past date requires employment.correct (HR_ADMIN). With an existing future end date: the same or an earlier date only.",
    ),
    end_reason_code: EndReasonCodeSchema.describe("Structured End Reason (C-21). RELATIONSHIP_CHANGE is not selectable here (422)."),
    note: z.string().min(1).max(1000).optional().describe("Optional; mandatory when end_reason_code is OTHER. Stored on the end event, never shown in the generic history."),
  }),
  "End Employment (C-50): ends a non-cancelled period that has not ended and has no Active End Event.",
);

export const ReverseEndCreateSchema = reg(
  "ReverseEndCreate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
    reason: z.string().min(1).max(1000).describe("Mandatory reversal reason (not the End Reason). Stored on the end_reversed event and in audit; never shown in history."),
  }),
  "Reverse End Employment (C-54): exact reversal of the Active End Event or no reversal.",
);

const newPeriodFields = {
  expected_revision: z.int().min(1).describe("Revision of the person profile; stale values return 409 REVISION_CONFLICT."),
  start_date: isoDate().describe("First day of the new employment period."),
  end_date: isoDate()
    .optional()
    .describe("Optional initially known/planned last day (inclusive, ≥ start_date). It does not create an End Employment event."),
  employee_type_id: z.uuid().optional().describe("Employee Type of the new period (active). Never copied from earlier periods."),
  work_email: z
    .email()
    .max(254)
    .optional()
    .describe("Optional company-issued email. Never generated or copied from an earlier period; an earlier address may be reused explicitly if no other period holds it for overlapping dates."),
};

export const InitialEmploymentCreateSchema = reg(
  "InitialEmploymentCreate",
  z.strictObject({
    ...newPeriodFields,
    reason: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe("Required when start_date is in the past (Initial Data Capture on an existing person); not required otherwise (C-60)."),
  }),
  "Add Initial Employment Period (C-60): for a person with no non-cancelled employment period. No assignment is created (use Add Initial Assignment).",
);

export const RehireCreateSchema = reg(
  "RehireCreate",
  z.strictObject({
    ...newPeriodFields,
    reason: z.string().min(1).max(1000).describe("Mandatory Rehire reason (C-23)."),
  }),
  "Rehire (C-61): a NEW period after the latest non-cancelled period, which must have an end date. Nothing is copied from the previous relationship.",
);

export const RelationshipChangeCreateSchema = reg(
  "RelationshipChangeCreate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the person profile; stale values return 409 REVISION_CONFLICT."),
    start_date: isoDate().describe("First day of the new period (the transition date). The current period ends the day before."),
    employee_type_id: z.uuid().describe("New Employee Type (active); must differ from the current period's type."),
    end_date: isoDate().optional().describe("Optional planned last day of the NEW period (≥ start_date). It does not create an End event."),
    work_email: z
      .email()
      .max(254)
      .optional()
      .describe("Work Email of the new period, only when explicitly chosen (e.g. 'keep current'); never copied automatically."),
    reason: z.string().min(1).max(1000).describe("Mandatory Relationship Change reason; never shown in the generic history."),
    initial_assignment: z
      .strictObject({
        department_id: z.uuid(),
        job_title_id: z.uuid(),
        job_level_id: z.uuid().nullable().optional(),
        manager_person_id: z.uuid().nullable().optional(),
      })
      .optional()
      .describe("Optional explicitly confirmed Initial Assignment of the new period, effective from start_date. Omitted → none is created (never copied)."),
  }),
  "Relationship Change (C-63 to C-66): continuous transition of the latest period to a different Employee Type.",
);

export const CancelPlannedCreateSchema = reg(
  "CancelPlannedCreate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the person profile; stale values return 409 REVISION_CONFLICT."),
    reason: z.string().min(1).max(1000).describe("Mandatory cancellation reason; stored on the cancellation event and in audit, never shown in history."),
  }),
  "Cancel Planned Period (C-70): the future period will not take effect; it stays in history with all its data.",
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
  department_id: z
    .uuid()
    .optional()
    .describe(
      "Matches the Department shown in the row (C-76): active → assignment effective today; pre-start → first assignment of the upcoming period; ended → last assignment of the latest ended period. Combine with employment_status to restrict the lifecycle.",
    ),
  employment_status: EmploymentStatusSchema.optional(),
});

export type EmployeeCreateInput = z.infer<typeof EmployeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof EmployeeUpdateSchema>;
export type WorkEmailUpdateInput = z.infer<typeof WorkEmailUpdateSchema>;
export type AssignmentChangeInput = z.infer<typeof AssignmentChangeCreateSchema>;
export type InitialAssignmentInput = z.infer<typeof InitialAssignmentCreateSchema>;
export type PeriodCorrectionInput = z.infer<typeof PeriodCorrectionCreateSchema>;
export type EndEmploymentInput = z.infer<typeof EndEmploymentCreateSchema>;
export type ReverseEndInput = z.infer<typeof ReverseEndCreateSchema>;
export type InitialEmploymentInput = z.infer<typeof InitialEmploymentCreateSchema>;
export type RehireInput = z.infer<typeof RehireCreateSchema>;
export type RelationshipChangeInput = z.infer<typeof RelationshipChangeCreateSchema>;
export type CancelPlannedInput = z.infer<typeof CancelPlannedCreateSchema>;
export type AssignmentCorrectionInput = z.infer<typeof AssignmentCorrectionCreateSchema>;
export type EmployeeDetail = z.infer<typeof EmployeeDetailSchema>;
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;
