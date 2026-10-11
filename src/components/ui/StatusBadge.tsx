// Semantic status badges (UI-0): red is the product accent, not the status colour. Labels come from the i18n catalogue;
// the mapping is keyed by stable API codes, never by display text.
import { tMaybe } from "@/i18n";

export type BadgeVariant = "success" | "info" | "neutral" | "warning" | "danger" | "primary";
export type StatusKind = "employment" | "completeness" | "disposition" | "catalog";

const VARIANTS: Record<StatusKind, Record<string, BadgeVariant>> = {
  // Computed employment status (C-16): Active / Pre-start / Ended / No Employment Record.
  employment: { active: "success", not_started: "info", ended: "neutral", no_employment: "neutral" },
  // Operational profile completeness (M-04).
  completeness: { complete: "success", incomplete: "warning" },
  // Record dispositions of a period (C-29, C-86): history only, not statuses.
  disposition: { cancelled: "neutral", voided: "neutral" },
  // Reference data (UI-10): inactive values stay on historical records; not deleted.
  catalog: { active: "success", inactive: "neutral" },
};

const LABEL_KEY: Record<StatusKind, (code: string) => string> = {
  employment: (c) => `employmentStatus.${c}`,
  completeness: (c) => `completeness.${c}`,
  disposition: (c) => `detail.${c}Badge`,
  catalog: (c) => `organization.statusValue.${c}`,
};

export function statusVariant(kind: StatusKind, code: string): BadgeVariant {
  return VARIANTS[kind][code] ?? "neutral";
}

export function StatusBadge({ kind, code, label }: { kind: StatusKind; code: string; label?: string }) {
  return <span className={`badge ${statusVariant(kind, code)}`}>{label ?? tMaybe(LABEL_KEY[kind](code)) ?? code}</span>;
}
