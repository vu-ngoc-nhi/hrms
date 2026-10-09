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
  | "LATER_LIFECYCLE_EVENT"
  | "PROTECTED_FIELD_NOT_ENABLED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type ErrorDetail = { field?: string; code: string; message: string };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
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
