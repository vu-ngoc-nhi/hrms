// C-28 / C-65 blocking message for End Employment and Relationship Change, with PV-29 guidance (BD-9): when every
// blocking assignment is still planned (starts after today), HR is pointed to Cancel Planned Assignment; otherwise
// (an assignment that already took effect) the historical correction remains the path. Nothing is changed or chained
// automatically.
import { fromDbDate } from "@/lib/dates";
import { rule } from "./command";

export function futureAssignmentBlock(
  field: "end_date" | "start_date",
  boundary: string,
  rows: readonly { id: string; effectiveFrom: Date }[],
  today: string,
  onOrAfter = false,
) {
  const planned = rows.every((a) => fromDbDate(a.effectiveFrom) > today);
  const starts = onOrAfter ? "starts on or after" : "starts after";
  const message = planned
    ? `A planned assignment ${starts} ${boundary}. If it is no longer going ahead, use Cancel Planned Assignment first; it is never changed automatically.`
    : onOrAfter
      ? "An assignment of the current period starts on or after the Relationship Change date. Correct it first; it is never changed automatically."
      : "An assignment starts after the requested end date. Correct that assignment first; it is never changed automatically.";
  return rule(
    "FUTURE_ASSIGNMENT_OUTSIDE_END",
    message,
    rows.map((a) => ({ field, code: "FUTURE_ASSIGNMENT_OUTSIDE_END", message: `Assignment ${a.id} starts on ${fromDbDate(a.effectiveFrom)}.` })),
  );
}
