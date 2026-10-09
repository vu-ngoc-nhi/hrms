// C-21 End Reason codes (system reference data `end_reason`; a test keeps this list equal to the database).
// Kept free of schema/registry imports so client components can use it.
export const END_REASON_CODES = [
  "VOLUNTARY_RESIGNATION",
  "EMPLOYER_INITIATED_END",
  "PLANNED_TERM_COMPLETED",
  "MUTUAL_AGREEMENT",
  "PROBATION_NOT_PASSED",
  "OTHER",
  "RELATIONSHIP_CHANGE",
] as const;
export type EndReasonCode = (typeof END_REASON_CODES)[number];

/** Selectable in End Employment. RELATIONSHIP_CHANGE is set only by the Relationship Change action. */
export const SELECTABLE_END_REASON_CODES = END_REASON_CODES.filter((c) => c !== "RELATIONSHIP_CHANGE");
