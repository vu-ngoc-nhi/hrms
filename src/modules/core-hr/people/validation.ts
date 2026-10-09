// Shared validation for person fields, used by profile creation (S3) and profile editing (S4.3) so both paths apply
// exactly the same rules and messages.
import { getConfig } from "@/lib/config";
import { addDays } from "@/lib/dates";
import type { ErrorDetail } from "@/lib/http/errors";
import { hasControlChars, normalizePhone, normalizeText, PHONE_RE } from "@/lib/text";

type Issues = { errors: ErrorDetail[]; warnings: ErrorDetail[] };

export function validateFullName(raw: string, issues: Issues, field = "full_name"): string {
  const fullName = normalizeText(raw);
  if (fullName.length < 2 || fullName.length > 150 || hasControlChars(raw.replace(/[\t\n\r]/g, " "))) {
    issues.errors.push({ field, code: "INVALID", message: "Full name must be 2-150 characters." });
  } else if (/\d/.test(fullName)) {
    issues.warnings.push({ field, code: "NAME_CONTAINS_DIGIT", message: "Full name contains a digit; please review." });
  }
  return fullName;
}

export function validateDateOfBirth(value: string | null, today: string, issues: Issues, field = "personal.date_of_birth"): string | null {
  if (value && value > today) {
    issues.errors.push({ field, code: "INVALID", message: "Date of birth cannot be in the future." });
  } else if (value && value > addDays(today, -15 * 365)) {
    issues.warnings.push({ field, code: "AGE_REVIEW", message: "Age appears to be under about 15; HR review needed (not a legal conclusion)." });
  }
  return value;
}

export function validateMobilePhone(raw: string | null, issues: Issues, field = "personal.mobile_phone"): string | null {
  if (raw === null) return null;
  const phone = normalizePhone(raw);
  if (!PHONE_RE.test(phone)) {
    issues.errors.push({ field, code: "INVALID", message: "Mobile phone must be 0xxxxxxxxx or +84xxxxxxxxx." });
  }
  return phone;
}

export function normalizePersonalEmail(raw: string | null): string | null {
  return raw === null ? null : raw.trim().toLowerCase();
}

/** Work Email: lower-cased; must use a configured company domain. Never an identity key. */
export function validateWorkEmail(raw: string, issues: Issues, field = "employment.work_email"): string {
  const email = raw.trim().toLowerCase();
  const domains = getConfig().companyEmailDomains;
  if (domains.length && !domains.includes(email.split("@")[1])) {
    issues.errors.push({ field, code: "DOMAIN_NOT_ALLOWED", message: "Work email must use a company domain." });
  }
  return email;
}
