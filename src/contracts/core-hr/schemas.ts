import { z } from "zod";
import { OPERATIONAL_ITEM_CODES } from "./completeness-codes";
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
  z.object({ field: z.string().optional(), code: z.string(), message: z.string(), related_contract_id: z.uuid().optional() }),
);
export const ErrorResponseSchema = reg(
  "ErrorResponse",
  z.object({
    error: z.string(),
    message: z.string(),
    request_id: z.string(),
    details: z.array(ErrorDetailSchema).optional(),
    warning_fingerprint: z.string().optional().describe("FINALIZE_CONFIRMATION_REQUIRED only (M-19): fingerprint of the warnings in details."),
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

// Phase 2A (C-104, ADR-0005): Contract Type is reference data for contract records — no business rules (fixed-term,
// salary, notice, renewal) live on it. The real catalog is pending (PV-31); development data is synthetic.
export const ContractTypeSchema = reg(
  "ContractType",
  z.object({
    ...catalogBase,
    name: z.string(),
    name_vi: z.string().nullable().describe("Optional Vietnamese name for official documents."),
  }),
  "Classification of contract records (reference data). Separate from Employee Type; carries no contract rules.",
);
export const ContractTypeCreateSchema = reg(
  "ContractTypeCreate",
  z.strictObject({ code: code(30), name: name(), name_vi: name().optional() }),
);
export const ContractTypeUpdateSchema = reg(
  "ContractTypeUpdate",
  z
    .strictObject({ name: name().optional(), name_vi: name().nullable().optional(), is_active: z.boolean().optional() })
    .refine(nonEmpty, NON_EMPTY_MESSAGE),
);
export const ContractTypeListSchema = reg("ContractTypeList", page(ContractTypeSchema));

// ---------------- Phase 2A contracts — slice 2A-2 core lifecycle (ADR-0005; M-15 … M-19; C-109 … C-111) ----------------
// The server is authoritative for document state, time state, Needs Review, Finalize readiness and allowed actions; the
// UI renders them and never re-derives lifecycle rules. Codes are machine values; labels live in the UI catalog.
const contractNumber = () =>
  z.string().max(100).describe("HR-entered; surrounding whitespace is trimmed and an empty value means no number. Unique case-insensitively across all contracts (M-18).");
const findingSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
  related_contract_id: z.uuid().optional(),
});
const actorSchema = z.object({ user_id: z.uuid(), display_name: z.string() }).nullable();
const actionSchema = z.object({ allowed: z.boolean(), reasons: z.array(z.string()) });

export const ContractDetailSchema = reg(
  "ContractDetail",
  z.object({
    id: z.uuid(),
    revision: z.int(),
    as_of: isoDate().describe("Business date (Asia/Ho_Chi_Minh) the computed fields refer to."),
    employee: z.object({ person_id: z.uuid(), employee_code: z.string(), full_name: z.string() }),
    employment: z.object({
      id: z.uuid(),
      start_date: isoDate(),
      end_date: isoDate().nullable(),
      disposition: z.enum(["cancelled", "voided"]).nullable(),
      employee_type: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    }),
    contract_type: z.object({ id: z.uuid(), code: z.string(), name: z.string(), name_vi: z.string().nullable(), is_active: z.boolean() }).nullable(),
    contract_number: z.string().nullable(),
    effective_from: isoDate().nullable(),
    effective_to: isoDate().nullable().describe("Inclusive last day of the term."),
    is_open_ended: z.boolean(),
    summary: z.string().nullable(),
    signed_at: isoDate().nullable().describe("Business date HR confirmed full execution by all required parties (C-105)."),
    relationship: z.object({
      type: z.enum(["renewal"]).nullable(),
      parent_id: z.uuid().nullable(),
      renewal_id: z.uuid().nullable(),
    }),
    state: z.object({
      document_state: z.enum(["draft", "finalized", "signed"]),
      disposition: z.enum(["cancelled", "voided"]).nullable(),
      operational: z.boolean().describe("Not Cancelled/Voided and the period is not Cancelled/Voided."),
      time_state: z.enum(["upcoming", "active", "expired"]).nullable().describe("Finalized/Signed operational contracts only."),
      time_state_detail: z.enum(["closed_by_employment_end", "replaced_by_renewal"]).nullable(),
      operational_end: isoDate().nullable(),
      days_to_operational_end: z.int().nullable(),
    }),
    review: z.object({ needs_review: z.boolean(), items: z.array(findingSchema) }).describe("Needs Review; confirming a warning at Finalize never resolves it."),
    finalize_check: z
      .object({
        ready: z.boolean(),
        blockers: z.array(findingSchema).describe("Never overridable (M-19)."),
        warnings: z.array(findingSchema).describe("Non-blocking; Finalize needs one explicit confirmation (M-19)."),
        warning_fingerprint: z.string().nullable().describe("Send as confirmed_warning_fingerprint with Finalize Anyway; null when there are no warnings."),
      })
      .nullable()
      .describe("Drafts only."),
    actions: z.object({ edit: actionSchema, discard: actionSchema, finalize: actionSchema, return_to_draft: actionSchema, confirm_signed: actionSchema }),
    finalized_at: isoDateTime().nullable(),
    finalized_by: actorSchema,
    created_at: isoDateTime(),
    created_by: actorSchema,
  }),
  "A contract record documenting terms of one Employment Period (ADR-0005). Contracts never change employment data.",
);
export type ContractDetail = z.infer<typeof ContractDetailSchema>;

const draftFields = {
  contract_type_id: z.uuid().nullable().optional(),
  contract_number: contractNumber().nullable().optional(),
  effective_from: isoDate().nullable().optional(),
  effective_to: isoDate().nullable().optional(),
  is_open_ended: z.boolean().optional(),
  summary: z.string().max(1000).nullable().optional(),
};
export const ContractCreateSchema = reg(
  "ContractCreate",
  z.strictObject({ employment_id: z.uuid().describe("Employment Period; must not be Cancelled or Voided."), ...draftFields }),
  "Create a Contract Draft. Missing fields are allowed in a Draft; objectively invalid values are refused.",
);
export type ContractCreateInput = z.infer<typeof ContractCreateSchema>;
export const ContractUpdateSchema = reg(
  "ContractUpdate",
  z.strictObject({ expected_revision: z.int().min(1).describe("Contract revision last read; stale → 409 REVISION_CONFLICT."), ...draftFields }),
  "Edit a Draft. null clears a field; the Employment Period cannot be changed (discard and re-create instead).",
);
export type ContractUpdateInput = z.infer<typeof ContractUpdateSchema>;
const contractRevision = () => z.int().min(1).describe("Contract revision last read; stale → 409 REVISION_CONFLICT.");
export const ContractDiscardSchema = reg(
  "ContractDiscard",
  z.strictObject({ expected_revision: contractRevision(), reason: z.string().max(1000).optional() }),
);
export type ContractDiscardInput = z.infer<typeof ContractDiscardSchema>;
export const ContractFinalizeSchema = reg(
  "ContractFinalize",
  z.strictObject({
    expected_revision: contractRevision(),
    confirmed_warning_fingerprint: z.string().max(200).optional().describe("The warning_fingerprint HR reviewed (Finalize Anyway, M-19)."),
  }),
);
export type ContractFinalizeInput = z.infer<typeof ContractFinalizeSchema>;
export const ContractReturnToDraftSchema = reg(
  "ContractReturnToDraft",
  z.strictObject({ expected_revision: contractRevision(), reason: z.string().min(1).max(1000).describe("Mandatory; shown on the contract history.") }),
);
export type ContractReturnToDraftInput = z.infer<typeof ContractReturnToDraftSchema>;
export const ContractConfirmSignedSchema = reg(
  "ContractConfirmSigned",
  z.strictObject({ expected_revision: contractRevision(), signed_at: isoDate().describe("Not a future business date in Asia/Ho_Chi_Minh.") }),
);
export type ContractConfirmSignedInput = z.infer<typeof ContractConfirmSignedSchema>;

// ---------------- Slice 2A-3: list / employee grouping (read models) ----------------
const contractStateSchema = () =>
  z.object({
    document_state: z.enum(["draft", "finalized", "signed"]),
    disposition: z.enum(["cancelled", "voided"]).nullable(),
    operational: z.boolean(),
    time_state: z.enum(["upcoming", "active", "expired"]).nullable(),
    time_state_detail: z.enum(["closed_by_employment_end", "replaced_by_renewal"]).nullable(),
    operational_end: isoDate().nullable(),
    days_to_operational_end: z.int().nullable(),
  });
export const ContractSummarySchema = reg(
  "ContractSummary",
  z.object({
    id: z.uuid(),
    revision: z.int(),
    employee: z.object({ person_id: z.uuid(), employee_code: z.string(), full_name: z.string() }),
    employment: z.object({
      id: z.uuid(),
      start_date: isoDate(),
      end_date: isoDate().nullable(),
      disposition: z.enum(["cancelled", "voided"]).nullable(),
      employee_type: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    }),
    contract_type: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
    contract_number: z.string().nullable(),
    effective_from: isoDate().nullable(),
    effective_to: isoDate().nullable(),
    is_open_ended: z.boolean(),
    signed_at: isoDate().nullable(),
    relationship: z.object({ type: z.enum(["renewal"]).nullable(), parent_id: z.uuid().nullable(), renewal_id: z.uuid().nullable() }),
    state: contractStateSchema(),
    review: z.object({ needs_review: z.boolean(), codes: z.array(z.string()) }),
  }),
  "List representation of a contract; all computed fields come from the server (same evaluation as the detail).",
);
export type ContractSummary = z.infer<typeof ContractSummarySchema>;

export const ContractListQuerySchema = z.strictObject({
  ...pageFields,
  search: z.string().max(100).optional().describe("Contract Number, employee name or Employee Code (case-insensitive, contains)."),
  contract_type_id: z.uuid().optional(),
  document_state: z.enum(["draft", "finalized", "signed"]).optional(),
  time_state: z.enum(["upcoming", "active", "expired"]).optional().describe("Computed for today (Asia/Ho_Chi_Minh); Drafts have none."),
  needs_review: boolQuery.describe("Computed Needs Review (overlap, gap, end after period end, period cancelled/voided…)."),
  effective_from_from: isoDate().optional(),
  effective_from_to: isoDate().optional(),
  expiring_within: z
    .enum(["30", "60", "90"])
    .optional()
    .describe("Finalized/Signed operational contracts whose own Effective To is from today through today + N days, both inclusive (Asia/Ho_Chi_Minh); open-ended, disposed and cancelled/voided-period contracts excluded. Home uses 30 (M-20)."),
  awaiting_signature: boolQuery.describe("Finalized, not Signed, operational (a cancelled/voided period shows under Needs Review instead). No deadline implied."),
  include_disposed: boolQuery.describe("Include discarded/cancelled and voided contracts (evidence). Default false."),
  sort: z.enum(["operational_end", "effective_from", "contract_number", "employee_code"]).optional().describe("Default operational_end (soonest end first, no end last)."),
});
export type ContractListQuery = z.infer<typeof ContractListQuerySchema>;
export const ContractListSchema = reg(
  "ContractList",
  z.object({ data: z.array(ContractSummarySchema), total: z.int(), page: z.int(), page_size: z.int(), as_of: isoDate() }),
);

export const EmployeeContractsSchema = reg(
  "EmployeeContracts",
  z.object({
    as_of: isoDate(),
    current: z.array(ContractSummarySchema).describe("Operational Finalized/Signed contracts in force today."),
    upcoming: z.array(ContractSummarySchema).describe("Operational Finalized/Signed contracts starting later."),
    drafts: z.array(ContractSummarySchema).describe("Operational Drafts."),
    history: z.array(ContractSummarySchema).describe("Operational contracts that have ended."),
    not_operational: z.array(ContractSummarySchema).describe("Discarded/cancelled/voided contracts and contracts of a cancelled/voided period."),
    create: z.object({
      allowed: z.boolean(),
      reasons: z.array(z.string()).describe("PERMISSION_REQUIRED, NO_VALID_EMPLOYMENT_PERIOD"),
      periods: z.array(
        z.object({ id: z.uuid(), start_date: isoDate(), end_date: isoDate().nullable(), employee_type: z.string().nullable(), is_default: z.boolean() }),
      ).describe("Employment Periods a new Draft may be linked to (not Cancelled/Voided)."),
    }),
  }),
  "Server-side grouping for the Employee Detail Contracts tab.",
);

// ---------------- Slice 2A-4: Home Contract Attention ----------------
const reminderItemSchema = z.object({
  id: z.uuid(),
  contract_number: z.string().nullable(),
  employee: z.object({ person_id: z.uuid(), employee_code: z.string(), full_name: z.string() }),
  contract_type: z.string().nullable(),
  effective_from: isoDate().nullable(),
  effective_to: isoDate().nullable(),
  document_state: z.enum(["draft", "finalized", "signed"]),
  days_to_end: z.int().nullable().describe("Days from today to Effective To (0 = ends today)."),
  review_reason: z.string().nullable().describe("Needs Review items only: the main condition (machine code; the UI shows plain words)."),
});
const reminderSignal = () => z.object({ total: z.int(), items: z.array(reminderItemSchema).max(5) });
export const ContractRemindersSchema = reg(
  "ContractReminders",
  z.object({
    as_of: isoDate(),
    window_days: z.literal(30).describe("Home expiry window (M-20): fixed 30 days in MVP."),
    expiring_soon: reminderSignal().describe("Same rule as GET /contracts?expiring_within=30."),
    awaiting_signature: reminderSignal().describe("Same rule as GET /contracts?awaiting_signature=true."),
    needs_review: reminderSignal().describe("Same rule as GET /contracts?needs_review=true."),
  }),
  "Home Contract Attention: three actionable signals with authoritative totals and at most five contracts each.",
);
export const ContractRemindersQuerySchema = z.strictObject({}).describe("No query parameters: the window is fixed (M-20).");

export const ContractHistorySchema = reg(
  "ContractHistory",
  z.object({
    data: z.array(
      z.object({
        event_type: z.string(),
        effective_date: isoDate().nullable(),
        recorded_at: isoDateTime(),
        recorded_by: actorSchema,
        reason: z.string().nullable().describe("Returned to Draft, Discarded, Cancelled, Corrected and Voided only."),
        related_contract_id: z.uuid().nullable(),
      }),
    ),
  }),
  "Business-readable contract history (C-108): action, effective date where applicable, recorded by / at, reason where relevant.",
);

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
    cancelled_at: isoDateTime()
      .nullable()
      .describe(
        "PV-29: set when this planned assignment was cancelled before it took effect. It stays in history unchanged but has no operational effect (never current, upcoming or representative). Reason and actor are kept in audit only.",
      ),
  }),
);
export { END_REASON_CODES, SELECTABLE_END_REASON_CODES };
export const EndReasonCodeSchema = z.enum(END_REASON_CODES);
export const EMPLOYMENT_EVENT_TYPES = ["start", "suspend", "resume", "end", "end_reversed", "cancel_planned_start", "employment_voided"] as const;
export type EmploymentEventType = (typeof EMPLOYMENT_EVENT_TYPES)[number];

export const EmploymentSchema = reg(
  "Employment",
  z.object({
    id: z.uuid(),
    start_date: isoDate(),
    end_date: isoDate().nullable().describe("Inclusive."),
    period_lifecycle: EmploymentStatusSchema.nullable().describe(
      "Computed lifecycle of this period at status_as_of (not_started/active/ended). null when the period was cancelled or voided: Cancelled and Voided are record dispositions, not lifecycle statuses.",
    ),
    events: z
      .array(
        z.object({
          id: z.uuid(),
          event_type: z
            .enum(EMPLOYMENT_EVENT_TYPES)
            .describe("employment_voided (PV-25) is the disposition of the whole period and is always listed last for its period."),
          effective_date: isoDate(),
          reverses_event_id: z.uuid().nullable().describe("end_reversed only: the end event it reverses (to pair them in history)."),
          recorded_at: isoDateTime(),
          end_reason: z
            .object({ code: EndReasonCodeSchema, label: z.string() })
            .nullable()
            .describe("Structured End Reason of an end event (null otherwise or when none was recorded). Legal meaning: Pending Legal Review."),
        }),
      )
      .describe(
        "Recorded employment events in chronological order (effective date, then recording time); an employment_voided event is listed after all other events of the period. Free-text notes and reasons are never exposed here.",
      ),
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
    voided_at: isoDateTime()
      .nullable()
      .describe(
        "PV-25: set when this effective period was voided because it was entered in error and the relationship never existed. Voided periods stay in history (all internal records kept) but have no operational effect; Voided is not an employment status.",
      ),
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

export const AssignmentCancelPlannedCreateSchema = reg(
  "AssignmentCancelPlannedCreate",
  z.strictObject({
    expected_revision: z.int().min(1).describe("Revision of the owning person profile; stale values return 409 REVISION_CONFLICT."),
    reason: z.string().min(1).max(1000).describe("Mandatory cancellation reason; stored in audit only, never returned or shown in history."),
  }),
  "Cancel Planned Assignment (PV-29): the latest planned assignment of a period will not take effect; it stays in history unchanged.",
);

export const AssignmentCancelledSchema = reg(
  "AssignmentCancelled",
  EmployeeDetailSchema.extend({
    warnings: z
      .array(ErrorDetailSchema)
      .describe("Items to review; they never block the cancellation (e.g. MANAGER_NOT_EMPLOYED_FOR_RESTORED_RANGE, C-73). Empty on an idempotent replay."),
  }),
);

export const VoidEmploymentCreateSchema = reg(
  "VoidEmploymentCreate",
  z.strictObject({
    expected_revision: z
      .int()
      .min(1)
      .describe("Revision of the person profile (e.g. evaluated_revision from the eligibility preview); stale values return 409 REVISION_CONFLICT."),
    reason: z
      .string()
      .min(1)
      .max(1000)
      .describe("Mandatory: HR's explicit confirmation of why the period was entered in error. Stored on the void event and in audit, never shown in history."),
  }),
  "Void Employment Period (PV-25): the effective period was entered in error and the relationship never existed in reality.",
);

const VoidReferenceSchema = z
  .object({
    employment_id: z.uuid().optional(),
    start_date: isoDate().optional(),
    end_date: isoDate().nullable().optional(),
    person_id: z.uuid().optional(),
    employee_code: z.string().optional(),
    full_name: z.string().optional(),
    assignment_id: z.uuid().optional(),
    effective_from: isoDate().optional(),
    effective_to: isoDate().nullable().optional().describe("Exclusive."),
  })
  .describe("The dependent record: a period (employment_id, dates) or another employee's assignment (person, assignment dates).");
const VoidFindingSchema = z.object({
  code: z
    .string()
    .describe(
      "Stable code. Blockers: EMPLOYMENT_PERIOD_READ_ONLY, PERIOD_NOT_EFFECTIVE, LATER_PERIOD_EXISTS, RELATIONSHIP_CHANGE_SUCCESSOR, MANAGER_DEPENDENCY, DEPENDENCY_CHECK_FAILED (fail closed), future module codes. Warnings: MANAGER_REFERENCE_WITHOUT_OVERLAP, RELATIONSHIP_CHANGE_PREDECESSOR.",
    ),
  message: z.string(),
  references: z.array(VoidReferenceSchema),
});
export const VOID_CONSEQUENCES = ["NO_OPERATIONAL_EFFECT", "WORK_EMAIL_RELEASED", "PERSON_HAS_NO_VALID_EMPLOYMENT", "PREVIOUS_PERIOD_UNCHANGED", "VOID_IS_PERMANENT"] as const;

export const VoidEligibilitySchema = reg(
  "VoidEligibility",
  z.object({
    employment_id: z.uuid(),
    evaluated_revision: z.int().describe("Person revision at evaluation time; send it as expected_revision so a change in between yields 409 REVISION_CONFLICT."),
    as_of: isoDate().describe("Business date of the evaluation (Asia/Ho_Chi_Minh)."),
    eligible: z.boolean().describe("True when no blocker exists. Informational only: the Void action re-evaluates everything."),
    period: z.object({
      start_date: isoDate(),
      end_date: isoDate().nullable(),
      employee_type: z.object({ code: z.string(), name: z.string() }).nullable(),
      period_lifecycle: EmploymentStatusSchema.nullable().describe("null when the period is cancelled or voided."),
    }),
    blockers: z.array(VoidFindingSchema),
    warnings: z.array(VoidFindingSchema),
    affected_internal_records: z
      .object({
        assignments: z.int(),
        lifecycle_events: z.array(z.object({ event_type: z.enum(EMPLOYMENT_EVENT_TYPES), effective_date: isoDate() })),
        has_active_end_event: z.boolean(),
        work_email: z.string().nullable(),
        planned_end_date: isoDate().nullable().describe("The period end date when it is after as_of."),
      })
      .describe("Records inside the period. They never block Void and are all kept unchanged as history."),
    consequences: z
      .array(z.enum(VOID_CONSEQUENCES))
      .describe("Stable codes the UI translates. PREVIOUS_PERIOD_UNCHANGED: an earlier period (and its End) is not touched; a wrong previous End needs a separate Reverse End Employment."),
  }),
  "Void eligibility preview (PV-25): read-only; blockers, warnings, internal records kept and consequences.",
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
    start_date: isoDate()
      .nullable()
      .describe(
        "Start date of the employment period this row represents (C-76 representative period, cancelled/voided periods excluded): the current period when Active, the upcoming period when Pre-start, the latest ended period when Ended; null without an employment period. Not a company hire/seniority date.",
      ),
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
  employee_type_id: z
    .uuid()
    .optional()
    .describe("Matches the Employee Type shown in the row, i.e. of the representative period (same rule as department_id)."),
  operational_completeness: CompletenessStatusSchema.optional().describe(
    "Matches the operational completeness shown in the row and on the profile (same versioned rule; UI label 'Needs Attention' = incomplete).",
  ),
});

// ---------------- UI-1 Home / Action Center (PV-30) ----------------
export const DashboardQuerySchema = z.strictObject({}).describe("No query parameters in Phase 1: the window (30 days) and the limits (5, 10) are fixed.");

const RequirementCodeSchema = z.enum(OPERATIONAL_ITEM_CODES).describe("Operational completeness item code (rule order). The UI maps it to a label.");
const DashboardCatalogRefSchema = z.object({ code: z.string(), name: z.string() });
const DashboardAssignmentSchema = z.object({
  department: DashboardCatalogRefSchema,
  job_title: z.object({ code: z.string(), name_en: z.string() }),
});
export const UPCOMING_EVENT_TYPES = ["employment_start", "new_employment_period_start", "relationship_change", "employment_end", "assignment_change"] as const;

export const CoreHrDashboardSchema = reg(
  "CoreHrDashboard",
  z.object({
    status_as_of: isoDate().describe("Asia/Ho_Chi_Minh business date used for every section."),
    snapshot: z
      .object({ active: z.int(), not_started: z.int(), ended: z.int() })
      .describe("People counted once by employment_status (the same computation as the Employee List). People without a valid Employment Period are not counted here."),
    needs_attention: z.object({
      total: z.int().describe("People whose operational completeness is incomplete, each counted once; equals the Employee List total for operational_completeness=incomplete."),
      rule_version: z.string(),
      by_requirement: z
        .array(z.object({ code: RequirementCodeSchema, count: z.int() }))
        .describe("People missing each item (only items with count > 0, rule order). A person missing several items appears in several rows, so the counts may add up to more than total."),
      records: z
        .array(
          z.object({
            person_id: z.uuid(),
            employee_code: z.string(),
            full_name: z.string(),
            employment_status: EmploymentStatusSchema,
            missing: z.array(RequirementCodeSchema),
          }),
        )
        .describe("At most 5: Active, then Pre-start (nearest start first), then no Employment Period, then Ended; then employee_code."),
    }),
    upcoming: z.object({
      window_days: z.literal(30),
      from: isoDate().describe("status_as_of. Planned ends count from this date (the last working day); other changes from the next day."),
      to: isoDate().describe("Last business date included (status_as_of + 30)."),
      total: z.int().describe("All upcoming changes in the window; items holds at most 10."),
      items: z
        .array(
          z.object({
            type: z.enum(UPCOMING_EVENT_TYPES),
            effective_date: isoDate().describe("Start date, the date an assignment takes effect, or the last day of employment (employment_end)."),
            person_id: z.uuid(),
            employee_code: z.string(),
            full_name: z.string(),
            employee_type: DashboardCatalogRefSchema.nullable().describe("Starts and relationship_change: the (new) period's Employee Type."),
            previous_employee_type: DashboardCatalogRefSchema.nullable().describe("relationship_change only."),
            assignment: DashboardAssignmentSchema.nullable().describe("Starts and relationship_change: the first assignment of the new period, if any; assignment_change: the assignment that takes effect."),
            previous_assignment: DashboardAssignmentSchema.nullable().describe("assignment_change: the assignment it replaces (null for a first assignment taking effect later)."),
          }),
        )
        .describe("Nearest first; same date: employment_end, relationship_change, starts, assignment_change; then employee_code."),
    }),
  }),
  "Home / Action Center (PV-30): Workforce Snapshot, Needs Attention and Upcoming — next 30 days. Machine codes only; no labels, personal data, reasons or audit data.",
);

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
export type VoidEmploymentInput = z.infer<typeof VoidEmploymentCreateSchema>;
export type VoidEligibility = z.infer<typeof VoidEligibilitySchema>;
export type AssignmentCorrectionInput = z.infer<typeof AssignmentCorrectionCreateSchema>;
export type AssignmentCancelPlannedInput = z.infer<typeof AssignmentCancelPlannedCreateSchema>;
export type EmployeeDetail = z.infer<typeof EmployeeDetailSchema>;
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;
export type CoreHrDashboard = z.infer<typeof CoreHrDashboardSchema>;
