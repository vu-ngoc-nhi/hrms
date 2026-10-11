// Operational completeness item codes in rule order (rule operational-mvp-2026-10-08.2, PV-03, C-78). Stable machine
// values shared by the completeness rule, Employee Detail and the Home dashboard; the UI maps them to labels.
// The email item is either work_email or contact_email for a given person.
export const OPERATIONAL_ITEM_CODES = ["full_name", "work_email", "contact_email", "start_date", "employment_status", "department", "job_title", "employee_type"] as const;
export type OperationalItemCode = (typeof OPERATIONAL_ITEM_CODES)[number];
