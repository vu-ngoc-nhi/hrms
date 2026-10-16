import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as cancelPlannedRoute } from "@/app/api/v1/core-hr/contracts/[id]/cancel-planned/route";
import { POST as confirmRoute } from "@/app/api/v1/core-hr/contracts/[id]/confirm-signed/route";
import { POST as correctionRoute } from "@/app/api/v1/core-hr/contracts/[id]/corrections/route";
import { POST as discardRoute } from "@/app/api/v1/core-hr/contracts/[id]/discard/route";
import { POST as finalizeRoute } from "@/app/api/v1/core-hr/contracts/[id]/finalize/route";
import { GET as historyRoute } from "@/app/api/v1/core-hr/contracts/[id]/history/route";
import { POST as renewRoute } from "@/app/api/v1/core-hr/contracts/[id]/renewals/route";
import { POST as returnRoute } from "@/app/api/v1/core-hr/contracts/[id]/return-to-draft/route";
import { GET as getRoute } from "@/app/api/v1/core-hr/contracts/[id]/route";
import { POST as voidRoute } from "@/app/api/v1/core-hr/contracts/[id]/void/route";
import { GET as remindersRoute } from "@/app/api/v1/core-hr/contract-reminders/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/contracts/route";
import { ContractDetailSchema, ContractHistorySchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, key, type TestUser } from "../helpers";

// Slice 2A-5 renewal chains, Cancel planned, Correction and Void (C-115; gate rev. 3), driven through the route
// handlers as the application role on hrms_test. Synthetic data only.
let app: pg.Client;
let userId: string;
let typeA: string;
let typeB: string;
let seq = 0;
const today = todayInVietnam();
const PATH = "/api/v1/core-hr/contracts";

beforeAll(async () => {
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  userId = (await app.query("SELECT id FROM app_user ORDER BY display_name LIMIT 1")).rows[0].id;
  typeA = (await app.query("SELECT id FROM contract_type WHERE code = 'TEST_TYPE_A'")).rows[0].id;
  typeB = (await app.query("SELECT id FROM contract_type WHERE code = 'TEST_TYPE_B'")).rows[0].id;
});
afterAll(async () => {
  await app.end();
});

async function period(start: string, end: string | null = null): Promise<string> {
  seq += 1;
  const code = `CRN${String(seq).padStart(4, "0")}`;
  await app.query("BEGIN");
  const person = await app.query("INSERT INTO person (employee_code, full_name, created_by) VALUES ($1, 'Test Renewal Person', $2) RETURNING id", [code, userId]);
  await app.query("INSERT INTO employee_code_registry (code, person_id, source, issued_by) VALUES ($1, $2, 'legacy', $3)", [code, person.rows[0].id, userId]);
  const e = await app.query("INSERT INTO employment (person_id, start_date, end_date, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [person.rows[0].id, start, end, userId]);
  await app.query("COMMIT");
  return e.rows[0].id;
}

type Body = Record<string, unknown>;
const get = async (id: string, user: TestUser = "editor") => ContractDetailSchema.parse((await call(getRoute, { path: `${PATH}/${id}`, user, params: { id } })).body);
const action = (route: typeof finalizeRoute, name: string) => (id: string, body: Body, user: TestUser = "editor", idem = key(name)) =>
  call(route, { path: `${PATH}/${id}/${name}`, method: "POST", user, body, params: { id }, headers: { "idempotency-key": idem } });
const finalizeCall = action(finalizeRoute, "finalize");
const renew = action(renewRoute, "renewals");
const cancelPlanned = action(cancelPlannedRoute, "cancel-planned");
const correct = action(correctionRoute, "corrections");
const voidCall = action(voidRoute, "void");
const discard = action(discardRoute, "discard");
const returnToDraft = action(returnRoute, "return-to-draft");
const confirm = action(confirmRoute, "confirm-signed");
const rev = async (id: string) => (await db().contract.findUniqueOrThrow({ where: { id } })).revision;
const historyOf = async (id: string) => ContractHistorySchema.parse((await call(historyRoute, { path: `${PATH}/${id}/history`, user: "editor", params: { id } })).body).data;

let numberSeq = 0;
const nextNumber = () => `RN-${++numberSeq}`;
async function draft(employmentId: string, from: string, to: string | null = null): Promise<string> {
  const r = await call(createRoute, {
    path: PATH,
    method: "POST",
    user: "editor",
    body: { employment_id: employmentId, contract_type_id: typeA, contract_number: nextNumber(), effective_from: from, ...(to ? { effective_to: to } : { is_open_ended: true }) },
    headers: { "idempotency-key": key("rn-create") },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id;
}
/** Finalizes, confirming M-19 warnings (gap/overlap are warnings, never blockers). */
async function finalize(id: string): Promise<void> {
  let r = await finalizeCall(id, { expected_revision: await rev(id) });
  if (r.body.error === "FINALIZE_CONFIRMATION_REQUIRED") r = await finalizeCall(id, { expected_revision: await rev(id), confirmed_warning_fingerprint: r.body.warning_fingerprint });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}
async function finalized(employmentId: string, from: string, to: string | null = null): Promise<string> {
  const id = await draft(employmentId, from, to);
  await finalize(id);
  return id;
}
async function sign(id: string, date = today): Promise<void> {
  const r = await confirm(id, { expected_revision: await rev(id), signed_at: date });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}
/** Renews with a number so the renewal can later be finalized. */
async function renewed(parentId: string, body: Body = {}): Promise<string> {
  const r = await renew(parentId, { contract_number: nextNumber(), effective_to: addDays(today, 400), ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id;
}
const expiringSoon = async () => {
  const r = await call(remindersRoute, { path: "/api/v1/core-hr/contract-reminders", user: "editor" });
  return r.body;
};
const listIds = async (query: string) => {
  const r = await call(listRoute, { path: `${PATH}?${query}&page_size=100`, user: "editor" });
  return (r.body.data as { id: string }[]).map((c) => c.id);
};

describe("Renew (C-115)", () => {
  it("creates a Draft renewal in the same period, prefilled from the parent; parent and child show the lineage; history and audit recorded", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, "2026-01-01", "2026-06-30");
    const before = await get(parent);
    expect(before.actions.renew).toEqual({ allowed: true, reasons: [] });
    expect(before.renewal_defaults).toEqual({ contract_type_id: typeA, effective_from: "2026-07-01" });

    const r = await renew(parent, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const child = ContractDetailSchema.parse(r.body);
    expect(child).toMatchObject({
      employment: { id: e },
      contract_type: { id: typeA },
      contract_number: null, // never prefilled
      effective_from: "2026-07-01",
      state: { document_state: "draft" },
      relationship: { type: "renewal", parent_id: parent, parent_number: before.contract_number, renewal_id: null },
    });
    const after = await get(parent);
    expect(after.relationship).toMatchObject({ type: null, renewal_id: child.id, renewal_state: "draft" });
    expect(after.actions.renew.reasons).toEqual(["RENEWAL_EXISTS"]);
    expect(after.renewal_defaults).toBeNull();
    expect(after.effective_to).toBe("2026-06-30"); // the parent is never changed

    const ph = await historyOf(parent);
    expect(ph.at(-1)).toMatchObject({ event_type: "renewal_created", related_contract_id: child.id });
    expect((await historyOf(child.id)).map((h) => h.event_type)).toEqual(["created"]);
    const audit = await db().auditEvent.findFirst({ where: { action: "contract.renew", entityId: child.id } });
    expect(audit).toBeTruthy();
  });

  it("Contract Type is prefilled from the parent and may be changed; an inactive parent type is not prefilled", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, "2026-01-01", "2026-06-30");
    const child = ContractDetailSchema.parse((await renew(parent, { contract_type_id: typeB })).body);
    expect(child.contract_type?.id).toBe(typeB); // no same-type invariant
  });

  it("chains A → B → C; each agreement has at most one non-disposed direct renewal (no branching)", async () => {
    const e = await period("2026-01-01");
    const a = await finalized(e, "2026-01-01", "2026-06-30");
    const b = await renewed(a, { effective_to: "2026-12-31" });
    const second = await renew(a, {});
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("RENEWAL_EXISTS");
    expect(second.body.details[0].related_contract_id).toBe(b);
    expect((await renew(b, {})).body.error).toBe("PARENT_NOT_RENEWABLE"); // B is still a Draft
    await finalize(b);
    const c = await renewed(b);
    expect((await get(c)).relationship).toMatchObject({ parent_id: b });
    expect((await get(b)).relationship).toMatchObject({ parent_id: a, renewal_id: c });
  });

  it("a discarded, cancelled or voided renewal frees the parent for a new renewal; its number stays reserved", async () => {
    const e = await period("2026-01-01");
    const a = await finalized(e, "2026-01-01", "2026-06-30");
    const b1 = await renewed(a);
    expect((await discard(b1, { expected_revision: await rev(b1) })).status).toBe(201);
    const b2 = await renewed(a, { effective_from: addDays(today, 10) });
    await finalize(b2);
    expect((await cancelPlanned(b2, { expected_revision: await rev(b2), reason: "Not going ahead (synthetic)" })).status).toBe(201);
    const b3 = await renewed(a);
    await finalize(b3);
    expect((await voidCall(b3, { expected_revision: await rev(b3), reason: "Entered in error (synthetic)" }, "admin")).status).toBe(201);
    expect((await get(a)).actions.renew.allowed).toBe(true);
    const b2Number = (await get(b2)).contract_number;
    expect((await renew(a, { contract_number: b2Number })).body.error).toBe("DUPLICATE_CONTRACT_NUMBER");
  });

  it("open-ended, Draft, discarded and voided contracts cannot be renewed; an Expired contract can", async () => {
    const e = await period("2025-01-01");
    const open = await finalized(e, "2025-01-01");
    expect((await get(open)).actions.renew.reasons).toEqual(["OPEN_ENDED"]);
    expect((await get(open)).renewal_defaults).toBeNull();
    const r = await renew(open, {});
    expect([r.status, r.body.error]).toEqual([422, "PARENT_NOT_RENEWABLE"]);
    const d = await draft(e, "2025-02-01", "2025-03-31");
    expect((await renew(d, {})).body.error).toBe("PARENT_NOT_RENEWABLE");
    expect((await discard(d, { expected_revision: await rev(d) })).status).toBe(201);
    expect((await renew(d, {})).body.error).toBe("PARENT_NOT_RENEWABLE");
    const voided = await finalized(e, "2025-04-01", "2025-04-30");
    await voidCall(voided, { expected_revision: await rev(voided), reason: "Entered in error (synthetic)" }, "admin");
    expect((await renew(voided, {})).body.error).toBe("PARENT_NOT_RENEWABLE");

    const e2 = await period("2025-01-01");
    const expired = await finalized(e2, "2025-01-01", "2025-12-31");
    expect((await get(expired)).state.time_state).toBe("expired");
    expect((await renew(expired, {})).status).toBe(201);
  });

  it("stays in the parent's Employment Period: a renewal names no period, and a Cancelled or Voided period cannot renew", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, "2026-01-01", "2026-06-30");
    const other = await period("2026-01-01");
    expect((await renew(parent, { employment_id: other })).status).toBe(400); // strict body: no cross-period renewal
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [e]);
    expect((await get(parent)).actions.renew.reasons).toContain("PERIOD_CANCELLED");
    expect((await renew(parent, {})).body.error).toBe("PERIOD_NOT_VALID");
  });

  it("the renewal starts after its parent starts; gap and overlap are warnings that stay under Needs review", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, "2026-03-01", "2026-06-30");
    expect((await renew(parent, { effective_from: "2026-03-01" })).body.error).toBe("RENEWAL_STARTS_BEFORE_PARENT");

    const gap = await renewed(parent, { effective_from: "2026-07-15" });
    const gapFinalize = await finalizeCall(gap, { expected_revision: await rev(gap) });
    expect(gapFinalize.body.error).toBe("FINALIZE_CONFIRMATION_REQUIRED");
    expect(gapFinalize.body.details.map((d: { code: string }) => d.code)).toContain("GAP_AFTER_PREDECESSOR");
    await finalize(gap);
    expect((await get(gap)).review.items.map((i) => i.code)).toContain("GAP_AFTER_PREDECESSOR");

    const e2 = await period("2026-01-01");
    const p2 = await finalized(e2, "2026-03-01", "2026-06-30");
    const overlap = await renewed(p2, { effective_from: "2026-06-01" });
    const check = (await get(overlap)).finalize_check;
    expect(check?.blockers).toEqual([]);
    expect(check?.warnings.map((w) => w.code)).toContain("RENEWAL_OVERLAPS_PREDECESSOR");
    await finalize(overlap);
    expect((await get(overlap)).review.items.map((i) => i.code)).toContain("RENEWAL_OVERLAPS_PREDECESSOR");
  });
});

describe("Parent projection: only a Signed renewal is the confirmed successor (C-115)", () => {
  it("Draft and Finalized-unsigned renewals change nothing; a Signed renewal suppresses Expiring soon and ends the parent the day before; the stored Effective To is unchanged", async () => {
    const e = await period(addDays(today, -200));
    const parentEnd = addDays(today, 20);
    const parent = await finalized(e, addDays(today, -200), parentEnd);
    await sign(parent, addDays(today, -200));
    const inExpiring = async () => (await listIds("expiring_within=30")).includes(parent);
    expect(await inExpiring()).toBe(true);

    const renewalFrom = addDays(today, 15); // overlap: the derived end comes from the renewal start
    const child = await renewed(parent, { effective_from: renewalFrom });
    expect(await inExpiring()).toBe(true); // Draft renewal: no effect
    expect((await get(parent)).state).toMatchObject({ operational_end: parentEnd, time_state_detail: null });

    await finalize(child);
    expect(await inExpiring()).toBe(true); // Finalized, unsigned: no effect
    expect((await get(parent)).state.operational_end).toBe(parentEnd);

    await sign(child);
    expect(await inExpiring()).toBe(false);
    const p = await get(parent);
    expect(p.state.operational_end).toBe(addDays(renewalFrom, -1));
    expect(p.effective_to).toBe(parentEnd);
    expect((await db().contract.findUniqueOrThrow({ where: { id: parent } })).effectiveTo?.toISOString().slice(0, 10)).toBe(parentEnd);
    expect(p.relationship.renewal_state).toBe("signed");
    expect((await expiringSoon()).expiring_soon.items.map((i: { id: string }) => i.id)).not.toContain(parent);
  });

  it("a signed renewal that is later voided restores the parent's own projection", async () => {
    const e = await period(addDays(today, -200));
    const parent = await finalized(e, addDays(today, -200), addDays(today, 10));
    const child = await renewed(parent);
    await finalize(child);
    await sign(child);
    expect((await listIds("expiring_within=30")).includes(parent)).toBe(false);
    expect((await voidCall(child, { expected_revision: await rev(child), reason: "Entered in error (synthetic)" }, "admin")).status).toBe(201);
    expect((await listIds("expiring_within=30")).includes(parent)).toBe(true);
    expect((await get(parent)).state.operational_end).toBe(addDays(today, 10));
  });
});

describe("Cancel planned (contract-wide, C-107 / C-115)", () => {
  it("a Finalized, unsigned contract that has not started is cancelled with a reason; it stays as history and its number stays reserved", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, addDays(today, 5), addDays(today, 200));
    const view = await get(id);
    expect(view.actions.cancel_planned).toEqual({ allowed: true, reasons: [] });
    expect((await cancelPlanned(id, { expected_revision: view.revision, reason: "" })).status).toBe(400); // reason required
    const r = await cancelPlanned(id, { expected_revision: view.revision, reason: "Candidate declined (synthetic)" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.state).toMatchObject({ document_state: "finalized", disposition: "cancelled", operational: false, time_state: null });
    expect((await historyOf(id)).at(-1)).toMatchObject({ event_type: "cancelled", reason: "Candidate declined (synthetic)", effective_date: addDays(today, 5) });
    expect(await db().auditEvent.count({ where: { action: "contract.cancel_planned", entityId: id } })).toBe(1);
    expect((await renew(id, {})).body.error).toBe("PARENT_NOT_RENEWABLE");
    const dup = await call(createRoute, { path: PATH, method: "POST", user: "editor", body: { employment_id: e, contract_number: view.contract_number }, headers: { "idempotency-key": key("dup") } });
    expect(dup.body.error).toBe("DUPLICATE_CONTRACT_NUMBER");
  });

  it("is refused for a Signed contract, a contract that started today or earlier, and a Draft (Draft → Discard)", async () => {
    const e = await period("2026-01-01");
    const signed = await finalized(e, addDays(today, 5), addDays(today, 30));
    await sign(signed);
    expect((await get(signed)).actions.cancel_planned.reasons).toEqual(["ALREADY_SIGNED"]);
    expect((await cancelPlanned(signed, { expected_revision: await rev(signed), reason: "x" })).body.error).toBe("CONTRACT_STATE_CONFLICT");
    const started = await finalized(e, today, addDays(today, 4));
    expect((await get(started)).actions.cancel_planned.reasons).toEqual(["NOT_UPCOMING"]);
    const r = await cancelPlanned(started, { expected_revision: await rev(started), reason: "x" });
    expect([r.status, r.body.error]).toEqual([422, "NOT_UPCOMING"]);
    const d = await draft(e, addDays(today, 40), addDays(today, 50));
    expect((await get(d)).actions.cancel_planned.reasons).toContain("NOT_FINALIZED");
    expect((await get(d)).actions.discard.allowed).toBe(true);
  });

  it("applies to renewals too; a parent with a non-disposed renewal cannot be cancelled (no cascade)", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, addDays(today, 5), addDays(today, 60));
    const child = await renewed(parent);
    expect((await get(parent)).actions.cancel_planned.reasons).toEqual(["DEPENDENT_CONTRACTS_EXIST"]);
    const blocked = await cancelPlanned(parent, { expected_revision: await rev(parent), reason: "x" });
    expect([blocked.status, blocked.body.error, blocked.body.details[0].related_contract_id]).toEqual([409, "DEPENDENT_CONTRACTS_EXIST", child]);
    expect((await get(child)).state.disposition).toBeNull(); // nothing cascaded
    await finalize(child);
    expect((await cancelPlanned(child, { expected_revision: await rev(child), reason: "Renewal not needed (synthetic)" })).status).toBe(201);
    expect((await get(parent)).actions.cancel_planned.allowed).toBe(true);
  });
});

describe("Return to Draft with a renewal (C-115)", () => {
  it("a parent with a non-disposed renewal cannot return to Draft", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, "2026-01-01", "2026-06-30");
    await renewed(parent);
    expect((await get(parent)).actions.return_to_draft.reasons).toEqual(["DEPENDENT_CONTRACTS_EXIST"]);
    expect((await returnToDraft(parent, { expected_revision: await rev(parent), reason: "x" })).body.error).toBe("DEPENDENT_CONTRACTS_EXIST");
  });
});

describe("Correction of a Signed contract (contracts.correct)", () => {
  it("corrects data-entry errors with a reason; history and audit keep the old and new values; identity and lineage are kept", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, "2026-01-01", "2026-06-30");
    await sign(id, "2026-01-02");
    const view = await get(id, "admin");
    expect(view.actions.correct).toEqual({ allowed: true, reasons: [] });
    const r = await correct(id, { expected_revision: view.revision, reason: "Typo in the end date (synthetic)", effective_to: "2026-07-31", signed_at: "2026-01-03", contract_type_id: typeB }, "admin");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ id, effective_to: "2026-07-31", signed_at: "2026-01-03", contract_type: { id: typeB }, state: { document_state: "signed" } });
    expect((await historyOf(id)).at(-1)).toMatchObject({ event_type: "corrected", reason: "Typo in the end date (synthetic)" });
    const audit = await db().auditEvent.findFirst({ where: { action: "contract.correct", entityId: id }, include: { fieldChanges: true } });
    expect(audit?.fieldChanges.find((f) => f.field === "contract.effective_to")).toMatchObject({ oldValue: "2026-06-30", newValue: "2026-07-31" });
  });

  it("only Signed contracts; HR_EDITOR may not correct; no-op, future signed date, stale revision and missing reason are refused", async () => {
    const e = await period("2026-01-01");
    const fin = await finalized(e, "2026-01-01", "2026-06-30");
    expect((await get(fin, "admin")).actions.correct.reasons).toEqual(["NOT_SIGNED"]);
    expect((await correct(fin, { expected_revision: await rev(fin), reason: "x", effective_to: "2026-07-31" }, "admin")).body.error).toBe("CONTRACT_STATE_CONFLICT");
    await sign(fin);
    expect((await get(fin, "editor")).actions.correct.reasons).toEqual(["PERMISSION_REQUIRED"]);
    expect((await correct(fin, { expected_revision: await rev(fin), reason: "x", effective_to: "2026-07-31" }, "editor")).status).toBe(403);
    expect((await correct(fin, { expected_revision: await rev(fin), reason: "x", effective_to: "2026-06-30" }, "admin")).status).toBe(400); // unchanged
    expect((await correct(fin, { expected_revision: await rev(fin), reason: "x", signed_at: addDays(today, 1) }, "admin")).body.error).toBe("SIGNED_AT_IN_FUTURE");
    expect((await correct(fin, { expected_revision: (await rev(fin)) - 1, reason: "x", effective_to: "2026-07-31" }, "admin")).body.error).toBe("REVISION_CONFLICT");
    expect((await correct(fin, { expected_revision: await rev(fin), effective_to: "2026-07-31" }, "admin")).status).toBe(400);
    expect((await correct(fin, { expected_revision: await rev(fin), reason: "   ", effective_to: "2026-07-31" }, "admin")).body.error).toBe("REASON_REQUIRED");
  });

  it("cannot break the lineage: a renewed parent keeps a finite term and starts before its renewal", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, "2026-01-01", "2026-06-30");
    await sign(parent);
    await renewed(parent, { effective_from: "2026-05-01" }); // overlapping renewal (a warning)
    expect((await correct(parent, { expected_revision: await rev(parent), reason: "x", is_open_ended: true, effective_to: null }, "admin")).body.error).toBe("PARENT_NOT_RENEWABLE");
    expect((await correct(parent, { expected_revision: await rev(parent), reason: "x", effective_from: "2026-05-01" }, "admin")).body.error).toBe("RENEWAL_STARTS_BEFORE_PARENT");
  });
});

describe("Owner close-out checks for 2A-5", () => {
  it("A → B (Finalized, NOT signed) → C is intentionally allowed (C-115: a renewable parent is Finalized or Signed)", async () => {
    const e = await period("2026-01-01");
    const a = await finalized(e, "2026-01-01", "2026-06-30");
    const b = await renewed(a, { effective_from: "2026-07-01", effective_to: "2026-12-31" });
    await finalize(b);
    const bView = await get(b);
    expect([bView.state.document_state, bView.signed_at]).toEqual(["finalized", null]); // B is unsigned
    expect(bView.actions.renew).toEqual({ allowed: true, reasons: [] });
    expect(bView.renewal_defaults?.effective_from).toBe("2027-01-01");
    const c = await renewed(b);
    expect((await get(c)).relationship).toMatchObject({ type: "renewal", parent_id: b });
    expect((await get(b)).relationship).toMatchObject({ parent_id: a, renewal_id: c, renewal_state: "draft" });
    // B unsigned is not A's confirmed successor: A keeps its own operational end.
    expect((await get(a)).state.operational_end).toBe("2026-06-30");
  });

  it("Correction cannot change employment_id, parent_contract_id or relationship_type, nor otherwise rewrite lineage", async () => {
    const e = await period("2026-01-01");
    const other = await period("2026-01-01");
    const a = await finalized(e, "2026-01-01", "2026-06-30");
    const unrelated = await finalized(e, "2027-01-01", "2027-06-30");
    const b = await renewed(a, { effective_from: "2026-07-01", effective_to: "2026-12-31" });
    await finalize(b);
    await sign(b);
    const r0 = await rev(b);
    for (const field of [{ employment_id: other }, { parent_contract_id: unrelated }, { parent_contract_id: null }, { relationship_type: null }, { relationship_type: "amendment" }]) {
      const r = await correct(b, { expected_revision: r0, reason: "x", ...field }, "admin");
      expect([r.status, r.body.error, r.body.details?.[0]?.code], JSON.stringify(field)).toEqual([400, "VALIDATION_ERROR", "FIELD_NOT_ALLOWED"]);
    }
    // A permitted correction keeps the lineage; moving the renewal's start onto / before the parent's start is refused.
    expect((await correct(b, { expected_revision: r0, reason: "x", effective_from: "2026-01-01" }, "admin")).body.error).toBe("RENEWAL_STARTS_BEFORE_PARENT");
    const ok = await correct(b, { expected_revision: r0, reason: "Start entered one day late (synthetic)", effective_from: "2026-06-30" }, "admin");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ employment: { id: e }, relationship: { type: "renewal", parent_id: a } });
    expect(ok.body.review.items.map((i: { code: string }) => i.code)).toContain("RENEWAL_OVERLAPS_PREDECESSOR"); // a warning, not a rewrite
    const row = await db().contract.findUniqueOrThrow({ where: { id: b } });
    expect([row.employmentId, row.parentContractId, row.relationshipType]).toEqual([e, a, "renewal"]);
  });

  it("inactive Contract Type (C-44): a correction may retain or reference an existing inactive type; new business data may not", async () => {
    seq += 1;
    const retired = (await app.query("INSERT INTO contract_type (code, name, is_active) VALUES ($1, 'Retired Type (synthetic)', true) RETURNING id", [`TEST_RETIRED_${seq}`])).rows[0].id;
    const otherRetired = (await app.query("INSERT INTO contract_type (code, name, is_active) VALUES ($1, 'Other Retired Type (synthetic)', false) RETURNING id", [`TEST_RETIRED_B_${seq}`])).rows[0].id;
    const e = await period("2026-01-01");
    const created = await call(createRoute, {
      path: PATH,
      method: "POST",
      user: "editor",
      body: { employment_id: e, contract_type_id: retired, contract_number: nextNumber(), effective_from: "2026-01-01", effective_to: "2026-06-30" },
      headers: { "idempotency-key": key("rn-retired") },
    });
    const id = created.body.id as string;
    await finalize(id);
    await sign(id);
    await app.query("UPDATE contract_type SET is_active = false WHERE id = $1", [retired]);

    // Retain: correcting another field keeps the (now inactive) type of the record.
    const kept = await correct(id, { expected_revision: await rev(id), reason: "End date typo (synthetic)", effective_to: "2026-07-31" }, "admin");
    expect(kept.status, JSON.stringify(kept.body)).toBe(201);
    expect(kept.body.contract_type).toMatchObject({ id: retired, is_active: false });
    // Reference: correcting to another EXISTING inactive type is accepted to record historical truth (C-44) …
    const switched = await correct(id, { expected_revision: await rev(id), reason: "Signed under the other retired type (synthetic)", contract_type_id: otherRetired }, "admin");
    expect(switched.status, JSON.stringify(switched.body)).toBe(201);
    expect(switched.body.contract_type).toMatchObject({ id: otherRetired, is_active: false });
    const audit = await db().auditEvent.findFirst({ where: { action: "contract.correct", entityId: id }, orderBy: { id: "desc" }, include: { fieldChanges: true } });
    expect(audit?.fieldChanges.find((f) => f.field === "contract.contract_type_id")).toMatchObject({ oldValue: retired, newValue: otherRetired });
    // … a non-existent type never is.
    expect((await correct(id, { expected_revision: await rev(id), reason: "x", contract_type_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, "admin")).status).toBe(404);

    // New business data keeps requiring an active type: no Renew prefill, an explicit inactive type is refused.
    expect((await get(id)).renewal_defaults).toEqual({ contract_type_id: null, effective_from: "2026-08-01" });
    expect((await renew(id, { contract_type_id: otherRetired })).body.error).toBe("CONTRACT_TYPE_INACTIVE");
    const fresh = await call(createRoute, { path: PATH, method: "POST", user: "editor", body: { employment_id: e, contract_type_id: retired }, headers: { "idempotency-key": key("rn-retired-new") } });
    expect(fresh.body.error).toBe("CONTRACT_TYPE_INACTIVE");
    // The correction dialog does not offer inactive types as ordinary choices: only active types plus the record's current one.
    const dialog = readFileSync("src/app/contracts/[id]/LifecycleDialogs.tsx", "utf8");
    expect(dialog).toContain("types.filter((o) => o.is_active || o.id === contract.contract_type?.id)");
  });
});

describe("Void (erroneous records only; contracts.correct)", () => {
  it("voids a Finalized or Signed record with a reason; it keeps its content and dates and has no operational effect", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, "2026-01-01", "2026-12-31");
    await sign(id);
    expect((await get(id, "editor")).actions.void.reasons).toEqual(["PERMISSION_REQUIRED"]);
    expect((await voidCall(id, { expected_revision: await rev(id), reason: "x" }, "editor")).status).toBe(403);
    expect((await voidCall(id, { expected_revision: await rev(id), reason: "" }, "admin")).status).toBe(400);
    const r = await voidCall(id, { expected_revision: await rev(id), reason: "Duplicate record (synthetic)" }, "admin");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Void is not early termination: the stored term is untouched; the record simply leaves operations.
    expect(r.body).toMatchObject({ effective_to: "2026-12-31", state: { disposition: "voided", operational: false, time_state: null } });
    expect((await historyOf(id)).at(-1)).toMatchObject({ event_type: "voided", reason: "Duplicate record (synthetic)" });
    expect(await db().auditEvent.count({ where: { action: "contract.void", entityId: id } })).toBe(1);
    expect((await voidCall(id, { expected_revision: await rev(id), reason: "again" }, "admin")).body.error).toBe("CONTRACT_READ_ONLY");
  });

  it("a Draft is discarded, not voided; a parent with a non-disposed renewal cannot be voided", async () => {
    const e = await period("2026-01-01");
    const d = await draft(e, "2026-01-01", "2026-03-31");
    expect((await get(d, "admin")).actions.void.reasons).toContain("NOT_FINALIZED");
    const parent = await finalized(e, "2026-04-01", "2026-06-30");
    const child = await renewed(parent);
    expect((await get(parent, "admin")).actions.void.reasons).toEqual(["DEPENDENT_CONTRACTS_EXIST"]);
    expect((await voidCall(parent, { expected_revision: await rev(parent), reason: "x" }, "admin")).body.error).toBe("DEPENDENT_CONTRACTS_EXIST");
    expect((await discard(child, { expected_revision: await rev(child) })).status).toBe(201);
    expect((await voidCall(parent, { expected_revision: await rev(parent), reason: "Entered in error (synthetic)" }, "admin")).status).toBe(201);
  });
});

describe("Permissions, idempotency and concurrency", () => {
  it("Renew needs contracts.manage; Cancel planned needs contracts.finalize; API_DOCS_READER gets nothing", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, addDays(today, 3), addDays(today, 90));
    expect((await renew(parent, {}, "docs")).status).toBe(403);
    expect((await renew(parent, {}, "noroles")).status).toBe(403);
    expect((await cancelPlanned(parent, { expected_revision: await rev(parent), reason: "x" }, "docs")).status).toBe(403);
    expect((await cancelPlanned(parent, { expected_revision: await rev(parent), reason: "Synthetic" }, "editor")).status).toBe(201);
  });

  it("a replayed renewal returns the same Draft; concurrent renewals of one parent create exactly one", async () => {
    const e = await period("2026-01-01");
    const parent = await finalized(e, "2026-01-01", "2026-06-30");
    const idem = key("renew-replay");
    const a = await renew(parent, {}, "editor", idem);
    const b = await renew(parent, {}, "editor", idem);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(b.body.id).toBe(a.body.id);
    expect((await renew(parent, { summary: "different" }, "editor", idem)).body.error).toBe("IDEMPOTENCY_KEY_REUSED");

    const p2 = await finalized(e, "2026-07-01", "2026-09-30");
    const results = await Promise.all([renew(p2, {}), renew(p2, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db().contract.count({ where: { parentContractId: p2 } })).toBe(1);
  });

  it("stale revisions are refused on Cancel planned and Void", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, addDays(today, 3), addDays(today, 90));
    expect((await cancelPlanned(id, { expected_revision: 1, reason: "x" })).body.error).toBe("REVISION_CONFLICT");
    expect((await voidCall(id, { expected_revision: 1, reason: "x" }, "admin")).body.error).toBe("REVISION_CONFLICT");
  });
});
