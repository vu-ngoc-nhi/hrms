// UI-8 Add Employee wizard model (pure). The wizard is only a presentation of the existing single create operation
// (POST /employees): Person, Employee Code, the first Employment Period with its start event and the Initial Assignment
// are created in ONE database transaction with an Idempotency-Key — nothing is saved before Review → Save, and a
// failure saves nothing. Client checks here only mirror the request shape (required Full Name; Department and Job
// Title together; employment fields need a Start Date). Business rules stay on the server.
//
// Slice 2A-6 adds an OPTIONAL Contract step (only with contracts.manage). It is not part of the employee save: the
// Contract Draft is a second, independent request made only after the employee was created (see onboardingSubmit.ts).

export const STEPS = ["personal", "employment", "assignment", "contract", "review"] as const;
export type StepId = (typeof STEPS)[number];
/** The steps this user sees: the optional Contract step only with contracts.manage. */
export const stepsFor = (caps: { createContract: boolean }): readonly StepId[] => (caps.createContract ? STEPS : STEPS.filter((x) => x !== "contract"));

export type WizardValues = {
  full_name: string;
  employee_code: string;
  gender: string;
  date_of_birth: string;
  mobile_phone: string;
  personal_email: string;
  start_date: string;
  employee_type_id: string;
  work_email: string;
  department_id: string;
  job_title_id: string;
  job_level_id: string;
  manager_person_id: string;
};
export type FieldName = keyof WizardValues;

export const EMPTY_VALUES: WizardValues = {
  full_name: "",
  employee_code: "",
  gender: "",
  date_of_birth: "",
  mobile_phone: "",
  personal_email: "",
  start_date: "",
  employee_type_id: "",
  work_email: "",
  department_id: "",
  job_title_id: "",
  job_level_id: "",
  manager_person_id: "",
};

/** What the wizard may offer, from server capabilities (never role names). */
export function wizardCapabilities(can: (permission: string) => boolean) {
  return {
    create: can("employees.create"),
    /** Gender, Date of Birth, Mobile, Personal Email. */
    writePersonal: can("employees.write_personal"),
    /** Employee Code override instead of an auto-issued code (approved, permission-controlled). */
    setCode: can("employees.set_code"),
    /** Optional Contract Draft during onboarding (slice 2A-6). Never needed to create the employee. */
    createContract: can("contracts.manage"),
  };
}

export const FIELD_STEP: Record<FieldName, StepId> = {
  full_name: "personal",
  employee_code: "personal",
  gender: "personal",
  date_of_birth: "personal",
  mobile_phone: "personal",
  personal_email: "personal",
  start_date: "employment",
  employee_type_id: "employment",
  work_email: "employment",
  department_id: "assignment",
  job_title_id: "assignment",
  job_level_id: "assignment",
  manager_person_id: "assignment",
};

export const hasEmployment = (v: WizardValues) => v.start_date.trim() !== "";
export const hasAssignmentInput = (v: WizardValues) => [v.department_id, v.job_title_id, v.job_level_id, v.manager_person_id].some((x) => x !== "");

/** Request-shape checks for one step; message keys from the i18n catalogue. */
export function stepErrors(step: StepId, v: WizardValues): Partial<Record<FieldName, string>> {
  const e: Partial<Record<FieldName, string>> = {};
  if (step === "personal" || step === "review") {
    if (!v.full_name.trim()) e.full_name = "wizard.error.fullNameRequired";
  }
  if (step === "employment" || step === "review") {
    if (!hasEmployment(v) && (v.employee_type_id || v.work_email.trim())) e.start_date = "wizard.error.startDateNeeded";
  }
  if (step === "assignment" || step === "review") {
    if (hasAssignmentInput(v)) {
      if (!hasEmployment(v)) e.department_id = "wizard.error.assignmentNeedsEmployment";
      else {
        if (!v.department_id) e.department_id = "wizard.error.departmentRequired";
        if (!v.job_title_id) e.job_title_id = "wizard.error.jobTitleRequired";
      }
    }
  }
  return e;
}

/** The single create request. Empty optional values are omitted; nothing is sent the user may not write. */
export function buildPayload(v: WizardValues, caps: { writePersonal: boolean; setCode: boolean }) {
  // The API's optional require_operational_completeness flag is not used: incomplete records are a valid outcome.
  const payload: Record<string, unknown> = { full_name: v.full_name.trim() };
  if (caps.setCode && v.employee_code.trim()) payload.employee_code = v.employee_code.trim();
  if (caps.writePersonal) {
    const personal: Record<string, string> = {};
    if (v.gender) personal.gender = v.gender;
    if (v.date_of_birth) personal.date_of_birth = v.date_of_birth;
    if (v.mobile_phone.trim()) personal.mobile_phone = v.mobile_phone.trim();
    if (v.personal_email.trim()) personal.personal_email = v.personal_email.trim();
    if (Object.keys(personal).length) payload.personal = personal;
  }
  if (hasEmployment(v)) {
    const employment: Record<string, unknown> = { start_date: v.start_date };
    if (v.employee_type_id) employment.employee_type_id = v.employee_type_id;
    if (v.work_email.trim()) employment.work_email = v.work_email.trim();
    if (v.department_id && v.job_title_id) {
      const a: Record<string, string> = { department_id: v.department_id, job_title_id: v.job_title_id };
      if (v.job_level_id) a.job_level_id = v.job_level_id;
      if (v.manager_person_id) a.manager_person_id = v.manager_person_id;
      employment.assignment = a;
    }
    payload.employment = employment;
  }
  return payload;
}

/** Server field paths (422 details) → wizard field, so errors return HR to the right step. */
const SERVER_FIELDS: Record<string, FieldName> = {
  full_name: "full_name",
  employee_code: "employee_code",
  "personal.gender": "gender",
  "personal.date_of_birth": "date_of_birth",
  "personal.mobile_phone": "mobile_phone",
  "personal.personal_email": "personal_email",
  "employment.start_date": "start_date",
  "employment.employee_type_id": "employee_type_id",
  "employment.work_email": "work_email",
  "employment.assignment.department_id": "department_id",
  "employment.assignment.job_title_id": "job_title_id",
  "employment.assignment.job_level_id": "job_level_id",
  "employment.assignment.manager_person_id": "manager_person_id",
  "assignment.manager_person_id": "manager_person_id",
};

type ServerDetail = { field?: string; code: string; message: string };
export function mapServerErrors(details: ServerDetail[] | undefined) {
  const fields: Partial<Record<FieldName, string>> = {};
  const other: ServerDetail[] = [];
  for (const d of details ?? []) {
    const f = d.field ? SERVER_FIELDS[d.field] : undefined;
    if (f && !fields[f]) fields[f] = d.message;
    else other.push(d);
  }
  const firstStep = STEPS.find((s) => Object.keys(fields).some((f) => FIELD_STEP[f as FieldName] === s)) ?? null;
  return { fields, other, firstStep };
}

/** Guidance only, from the server-provided Employee Type flag (the completeness rule stays on the server). */
export const workEmailExpected = (types: { id: string; requires_work_email?: boolean }[], typeId: string) =>
  Boolean(types.find((t) => t.id === typeId)?.requires_work_email);

export const isDirty = (v: WizardValues, c: ContractStepValues = EMPTY_CONTRACT) => (Object.keys(EMPTY_VALUES) as FieldName[]).some((k) => v[k] !== EMPTY_VALUES[k]) || c.enabled;

// ---- Optional Contract Draft (slice 2A-6) --------------------------------------------------------------------------
/**
 * Phase 2A Draft fields only (no salary, ID, address, clauses, templates, documents or amendment data).
 * `effective_from: null` = follows the Employment Start Date (the default); `term: ""` = HR has not chosen yet — the
 * wizard never invents a duration from Employee Type or Contract Type. The Contract Number is never generated.
 */
export type ContractStepValues = {
  enabled: boolean;
  contract_type_id: string;
  contract_number: string;
  effective_from: string | null;
  term: "" | "fixed" | "open";
  effective_to: string;
  summary: string;
};
export type ContractField = Exclude<keyof ContractStepValues, "enabled"> | "enabled";
export const EMPTY_CONTRACT: ContractStepValues = { enabled: false, contract_type_id: "", contract_number: "", effective_from: null, term: "", effective_to: "", summary: "" };

/** Effective From shown and sent: HR's own date, otherwise the Employment Start Date. */
export const contractEffectiveFrom = (v: WizardValues, c: ContractStepValues) => c.effective_from ?? v.start_date;
export const contractRequested = (c: ContractStepValues) => c.enabled;
/** A Contract Draft request is made only with contracts.manage AND the checkbox on — never otherwise. */
export const wantsContractDraft = (caps: { createContract: boolean }, c: ContractStepValues) => caps.createContract && c.enabled;
/**
 * The Review's Contract Draft section: "hidden" without contracts.manage (the Phase 1 four-step Review, no contract
 * section at all); "none" when the optional Draft is off; "draft" when one will be created.
 */
export const contractReviewMode = (caps: { createContract: boolean }, c: ContractStepValues): "hidden" | "none" | "draft" =>
  !caps.createContract ? "hidden" : c.enabled ? "draft" : "none";

/** Convenience checks only (the Contract API re-validates against the period actually created). */
export function contractErrors(v: WizardValues, c: ContractStepValues): Partial<Record<ContractField, string>> {
  const e: Partial<Record<ContractField, string>> = {};
  if (!c.enabled) return e;
  if (!hasEmployment(v)) {
    e.enabled = "wizard.contract.error.needsEmployment";
    return e;
  }
  const from = contractEffectiveFrom(v, c);
  if (!from) e.effective_from = "wizard.contract.error.effectiveFromRequired";
  else if (from < v.start_date) e.effective_from = "wizard.contract.error.beforeStart";
  if (!c.term) e.term = "wizard.contract.error.termRequired";
  else if (c.term === "fixed") {
    if (!c.effective_to) e.effective_to = "wizard.contract.error.effectiveToRequired";
    else if (from && c.effective_to < from) e.effective_to = "contracts.form.error.effectiveTo";
  }
  return e;
}

/**
 * POST /contracts body. `employmentId` is ALWAYS the id returned by the employee create response — never a value from
 * the form, so the browser cannot point the draft at another employee or period.
 */
export function contractDraftBody(employmentId: string, v: WizardValues, c: ContractStepValues): Record<string, unknown> {
  const body: Record<string, unknown> = { employment_id: employmentId };
  if (c.contract_type_id) body.contract_type_id = c.contract_type_id;
  if (c.contract_number.trim()) body.contract_number = c.contract_number.trim();
  const from = contractEffectiveFrom(v, c);
  if (from) body.effective_from = from;
  if (c.term === "open") body.is_open_ended = true;
  else if (c.term === "fixed" && c.effective_to) body.effective_to = c.effective_to;
  if (c.summary.trim()) body.summary = c.summary.trim();
  return body;
}

// ---- Navigation and submission state ----------------------------------------------------------------------------
export type WizardState = { step: StepId; visited: StepId[]; values: WizardValues; contract: ContractStepValues; saving: boolean };
export type WizardAction =
  | { type: "set"; field: FieldName; value: string }
  | { type: "setContract"; patch: Partial<ContractStepValues> }
  | { type: "next"; steps?: readonly StepId[] }
  | { type: "back"; steps?: readonly StepId[] }
  | { type: "goto"; step: StepId }
  | { type: "saveStart" }
  | { type: "saveEnd" };

export const initialState = (): WizardState => ({ step: "personal", visited: ["personal"], values: EMPTY_VALUES, contract: EMPTY_CONTRACT, saving: false });

/** Values are kept across every navigation; nothing changes while saving (no double submit, no edits mid-save). */
export function wizardReducer(s: WizardState, a: WizardAction): WizardState {
  if (s.saving && a.type !== "saveEnd") return s;
  const steps = ("steps" in a && a.steps) || STEPS;
  const i = steps.indexOf(s.step);
  const visit = (step: StepId): WizardState => ({ ...s, step, visited: s.visited.includes(step) ? s.visited : [...s.visited, step] });
  switch (a.type) {
    case "set":
      return { ...s, values: { ...s.values, [a.field]: a.value } };
    case "setContract":
      return { ...s, contract: { ...s.contract, ...a.patch } };
    case "next":
      return i < steps.length - 1 ? visit(steps[i + 1]) : s;
    case "back":
      return i > 0 ? { ...s, step: steps[i - 1] } : s;
    case "goto":
      return s.visited.includes(a.step) ? { ...s, step: a.step } : s;
    case "saveStart":
      return { ...s, saving: true };
    case "saveEnd":
      return { ...s, saving: false };
  }
}

export const createdHref = (personId: string) => `/employees/${personId}?created=1`;
