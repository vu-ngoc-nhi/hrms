// Shared lifecycle-event concepts (C-51). The single definition of an Active End Event: an `end` event of a period that
// has NOT been reversed by an `end_reversed` event (no event R with R.reverses_event_id = E.id). A period has at most
// one (also enforced by a DB trigger). Used by End Employment, the S4.6 end-date sync and later Reverse End Employment.
// Never match End events by date: a corrected or reversed history would make date matching ambiguous.
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/lib/db";

export function activeEndEventWhere(employmentId: string): Prisma.EmploymentEventWhereInput {
  return { employmentId, eventType: "end", reversedBy: { none: {} } };
}

export function findActiveEndEvent(client: Tx | Db, employmentId: string) {
  return client.employmentEvent.findFirst({ where: activeEndEventWhere(employmentId) });
}

/** Same rule over already-loaded events of ONE period (e.g. the history response). */
export function activeEndEventOf<E extends { id: string; eventType: string; reversesEventId: string | null }>(events: E[]): E | null {
  const reversed = new Set(events.filter((e) => e.eventType === "end_reversed").map((e) => e.reversesEventId));
  return events.find((e) => e.eventType === "end" && !reversed.has(e.id)) ?? null;
}

/**
 * History order of ONE period's events (already sorted by effective date, then recorded time): the PV-25
 * `employment_voided` event is the disposition of the whole period and is listed after every other event, regardless
 * of its effective date (= the period start). All other events keep their order.
 */
export function historyEventOrder<E extends { eventType: string }>(events: readonly E[]): E[] {
  return [...events.filter((e) => e.eventType !== "employment_voided"), ...events.filter((e) => e.eventType === "employment_voided")];
}
