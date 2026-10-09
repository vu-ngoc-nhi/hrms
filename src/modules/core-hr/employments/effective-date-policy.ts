// Shared effective-date / backdating policy (C-25, PV-19). Every S4 write that carries an effective date must call
// this before writing. "Today" is the business date in Asia/Ho_Chi_Minh.
import { todayInVietnam } from "@/lib/dates";
import { forbidden } from "@/lib/http/errors";
import type { Principal } from "@/modules/identity/authenticate";

export type EffectiveDateKind =
  /** Normal employment business event (assignment change, end, rehire, relationship change, cancel planned). */
  | "business_event"
  /** Historical correction of existing data (type, dates, assignments, ended-period work email). */
  | "historical_correction"
  /** First Employment Period of a person (initial profile capture or Add Initial Employment Period, C-32). */
  | "initial_data_capture";

export type EffectiveDateDecision = { allowed: true; backdated: boolean } | { allowed: false; reason: string };

export function evaluateEffectiveDate(
  principal: Pick<Principal, "permissions">,
  kind: EffectiveDateKind,
  effectiveDate: string,
  today: string = todayInVietnam(),
): EffectiveDateDecision {
  const backdated = effectiveDate < today;
  const can = (p: Parameters<Principal["permissions"]["has"]>[0]) => principal.permissions.has(p);
  switch (kind) {
    case "historical_correction":
      // HR_ADMIN only, no fixed time window (C-22, C-25).
      return can("employment.correct")
        ? { allowed: true, backdated }
        : { allowed: false, reason: "Historical corrections require the employment.correct permission." };
    case "initial_data_capture":
      // Exemption: a past start date is allowed for the first period only (PV-19, C-32).
      return can("employment.manage") || can("employees.create")
        ? { allowed: true, backdated }
        : { allowed: false, reason: "Recording an initial employment period requires employment.manage." };
    case "business_event":
      if (!can("employment.manage")) return { allowed: false, reason: "This action requires employment.manage." };
      if (backdated && !can("employment.correct")) {
        return { allowed: false, reason: "A business event effective in the past requires an HR administrator." };
      }
      return { allowed: true, backdated };
  }
}

/** Throws 403 when the effective date is not allowed for the caller. Returns whether the date is in the past. */
export function assertEffectiveDateAllowed(
  principal: Pick<Principal, "permissions">,
  kind: EffectiveDateKind,
  effectiveDate: string,
  today?: string,
): { backdated: boolean } {
  const decision = evaluateEffectiveDate(principal, kind, effectiveDate, today);
  if (!decision.allowed) throw forbidden(decision.reason);
  return { backdated: decision.backdated };
}
