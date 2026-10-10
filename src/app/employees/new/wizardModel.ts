// UI-8 Add Employee wizard model (pure). The wizard is only a presentation of the existing single create operation
// (POST /employees): Person, Employee Code, the first Employment Period with its start event and the Initial Assignment
// are created in ONE database transaction with an Idempotency-Key — nothing is saved before Review → Save, and a
// failure saves nothing. Client checks here only mirror the request shape (required Full Name; Department and Job
// Title together; employment fields need a Start Date). Business rules stay on the server.

export const STEPS = ["personal", "employment", "assignment", "review"] as const;
export type StepId = (typeof STEPS)[number];

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

export const isDirty = (v: WizardValues) => (Object.keys(EMPTY_VALUES) as FieldName[]).some((k) => v[k] !== EMPTY_VALUES[k]);

// ---- Navigation and submission state ----------------------------------------------------------------------------
export type WizardState = { step: StepId; visited: StepId[]; values: WizardValues; saving: boolean };
export type WizardAction =
  | { type: "set"; field: FieldName; value: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: StepId }
  | { type: "saveStart" }
  | { type: "saveEnd" };

export const initialState = (): WizardState => ({ step: "personal", visited: ["personal"], values: EMPTY_VALUES, saving: false });

/** Values are kept across every navigation; nothing changes while saving (no double submit, no edits mid-save). */
export function wizardReducer(s: WizardState, a: WizardAction): WizardState {
  if (s.saving && a.type !== "saveEnd") return s;
  const i = STEPS.indexOf(s.step);
  const visit = (step: StepId): WizardState => ({ ...s, step, visited: s.visited.includes(step) ? s.visited : [...s.visited, step] });
  switch (a.type) {
    case "set":
      return { ...s, values: { ...s.values, [a.field]: a.value } };
    case "next":
      return i < STEPS.length - 1 ? visit(STEPS[i + 1]) : s;
    case "back":
      return i > 0 ? { ...s, step: STEPS[i - 1] } : s;
    case "goto":
      return s.visited.includes(a.step) ? { ...s, step: a.step } : s;
    case "saveStart":
      return { ...s, saving: true };
    case "saveEnd":
      return { ...s, saving: false };
  }
}

export const createdHref = (personId: string) => `/employees/${personId}?created=1`;
