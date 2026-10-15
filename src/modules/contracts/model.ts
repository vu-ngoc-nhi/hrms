// Phase 2A Contract domain foundation (ADR-0005). Pure rules shared by the later lifecycle slices; the database
// enforces the structural invariants (migration 20261015000000_contract_foundation) and this module mirrors the
// value sets it needs, contract-tested against the database.
import { todayInVietnam } from "@/lib/dates";

/** Phase 2A admits renewal links only; amendment is gated (C-109) and added by a forward migration when approved. */
export const RELATIONSHIP_TYPES = ["renewal"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** Business history event types (ADR-0005 §12). Mirrors the contract_history_event CHECK. */
export const HISTORY_EVENT_TYPES = [
  "created",
  "discarded",
  "finalized",
  "returned_to_draft",
  "signed_confirmed",
  "renewal_created",
  "cancelled",
  "corrected",
  "voided",
] as const;
export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

/** Events whose reason is mandatory (C-107, C-109). Mirrors contract_history_event_reason_required_ck. */
export const REASON_REQUIRED_EVENTS: readonly HistoryEventType[] = ["returned_to_draft", "cancelled", "corrected", "voided"];

export const CONTRACT_NUMBER_MAX_LENGTH = 100;

/**
 * M-15 / M-18: a Contract Number is stored without surrounding whitespace; a value that is empty after trimming means
 * "no number". Case is kept as entered; uniqueness is case-insensitive in the database across every record,
 * whatever its disposition.
 */
export function normalizeContractNumber(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

export type DocumentState = "draft" | "finalized" | "signed";
export type Disposition = "cancelled" | "voided" | null;

type Markers = { finalizedAt: Date | null; signedAt: Date | null };

/** Document state is derived from the markers, never stored (ADR-0005 §4). */
export function documentState(c: Markers): DocumentState {
  if (c.signedAt) return "signed";
  return c.finalizedAt ? "finalized" : "draft";
}

/**
 * C-105 / C-109: `signed_at` is a business date that must not be in the future in Asia/Ho_Chi_Minh. Enforced by the
 * Confirm Signed and Correction services (2A-2, 2A-5), not by a database rule that would depend on the server's
 * time zone.
 */
export function isSignedDateAllowed(signedAt: string, today: string = todayInVietnam()): boolean {
  return signedAt <= today;
}
