export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE_EMPLOYEE_CODE"
  | "DUPLICATE_CATALOG_CODE"
  | "WORK_EMAIL_IN_USE"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "BUSINESS_RULE_VIOLATION"
  | "OPERATIONAL_PROFILE_INCOMPLETE"
  | "EMPLOYMENT_PERIOD_READ_ONLY"
  | "REVISION_CONFLICT"
  | "PERIOD_OVERLAP"
  | "END_EFFECT_CHANGED"
  | "END_STATE_INCONSISTENT"
  | "END_ALREADY_REVERSED"
  | "LATER_PERIOD_EXISTS"
  | "LATER_ASSIGNMENT_EXISTS"
  | "ASSIGNMENT_CANCELLED"
  | "LATER_LIFECYCLE_EVENT"
  | "PROTECTED_FIELD_NOT_ENABLED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  // Phase 2A contracts (docs/api/contracts-api-draft.md §9)
  | "DUPLICATE_CONTRACT_NUMBER"
  | "CONTRACT_NOT_DRAFT"
  | "CONTRACT_STATE_CONFLICT"
  | "CONTRACT_READ_ONLY"
  | "DEPENDENT_CONTRACTS_EXIST"
  | "CONTRACT_NOT_READY"
  | "FINALIZE_CONFIRMATION_REQUIRED"
  | "INVALID_TERM"
  | "CONTRACT_TYPE_INACTIVE"
  | "EFFECTIVE_FROM_OUTSIDE_PERIOD"
  | "PERIOD_NOT_VALID"
  | "SIGNED_AT_IN_FUTURE"
  | "REASON_REQUIRED"
  // Slice 2A-5 (C-115)
  | "RENEWAL_EXISTS"
  | "PARENT_NOT_RENEWABLE"
  | "RENEWAL_STARTS_BEFORE_PARENT"
  | "NOT_UPCOMING";

export type ErrorDetail = {
  field?: string;
  code: string;
  message: string;
  related_contract_id?: string;
  /** Contract warnings only: presentation facts (see contracts evaluation `Finding`). */
  related_contract_number?: string | null;
  affected_from?: string;
  affected_to?: string | null;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
    /** Extra top-level body fields for a specific error (e.g. warning_fingerprint, M-19). */
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthenticated = (message = "Missing or invalid access token.") =>
  new ApiError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Resource not found.") => new ApiError(404, "NOT_FOUND", message);
export const validationError = (details: ErrorDetail[], message = "Invalid request data.") =>
  new ApiError(400, "VALIDATION_ERROR", message, details);
export const ruleViolation = (details: ErrorDetail[], message = "The request violates a business rule.") =>
  new ApiError(422, "BUSINESS_RULE_VIOLATION", message, details);
