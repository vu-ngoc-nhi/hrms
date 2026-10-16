import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as confirmRoute } from "@/app/api/v1/core-hr/contracts/[id]/confirm-signed/route";
import { POST as discardRoute } from "@/app/api/v1/core-hr/contracts/[id]/discard/route";
import { POST as finalizeRoute } from "@/app/api/v1/core-hr/contracts/[id]/finalize/route";
import { GET as historyRoute } from "@/app/api/v1/core-hr/contracts/[id]/history/route";
import { POST as returnRoute } from "@/app/api/v1/core-hr/contracts/[id]/return-to-draft/route";
import { GET as getRoute, PATCH as patchRoute } from "@/app/api/v1/core-hr/contracts/[id]/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/contracts/route";
import { ContractDetailSchema, ContractHistorySchema, ErrorResponseSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { getContract } from "@/modules/contracts/service";
import { call, key, principalWith, type TestUser } from "../helpers";

// Slice 2A-2 core contract lifecycle (ADR-0005; M-15 … M-19; C-109 … C-111), driven through the route handlers.
// Synthetic data only: people and periods are inserted directly as the application role.
let app: pg.Client;
let userId: string;
let typeA: string;
let typeInactive: string;
let seq = 0;
const today = todayInVietnam();
const PATH = "/api/v1/core-hr/contracts";

beforeAll(async () => {
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  userId = (await app.query("SELECT id FROM app_user ORDER BY display_name LIMIT 1")).rows[0].id;
  typeA = (await app.query("SELECT id FROM contract_type WHERE code = 'TEST_TYPE_A'")).rows[0].id;
  typeInactive = (await app.query("INSERT INTO contract_type (code, name, is_active) VALUES ('TEST_TYPE_OFF', 'Test Type Off (synthetic)', false) RETURNING id")).rows[0].id;
});
afterAll(async () => {
  await app.end();
});

async function period(start: string, end: string | null = null): Promise<string> {
  seq += 1;
  const code = `CTL${String(seq).padStart(4, "0")}`;
  await app.query("BEGIN");
  const person = await app.query("INSERT INTO person (employee_code, full_name, created_by) VALUES ($1, 'Test Lifecycle Person', $2) RETURNING id", [code, userId]);
  await app.query("INSERT INTO employee_code_registry (code, person_id, source, issued_by) VALUES ($1, $2, 'legacy', $3)", [code, person.rows[0].id, userId]);
  const e = await app.query("INSERT INTO employment (person_id, start_date, end_date, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [person.rows[0].id, start, end, userId]);
  await app.query("COMMIT");
  return e.rows[0].id;
}
/** A second period of the same person (non-overlapping), for person-wide overlap checks. */
async function samePersonPeriod(employmentId: string, start: string, end: string | null = null): Promise<string> {
  const p = (await app.query("SELECT person_id FROM employment WHERE id = $1", [employmentId])).rows[0].person_id;
  return (await app.query("INSERT INTO employment (person_id, start_date, end_date, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [p, start, end, userId])).rows[0].id;
}

type Body = Record<string, unknown>;
const create = (body: Body, user: TestUser = "editor", idem = key("cc")) => call(createRoute, { path: PATH, method: "POST", user, body, headers: { "idempotency-key": idem } });
const get = (id: string, user: TestUser = "editor") => call(getRoute, { path: `${PATH}/${id}`, user, params: { id } });
const patch = (id: string, body: Body, user: TestUser = "editor") => call(patchRoute, { path: `${PATH}/${id}`, method: "PATCH", user, body, params: { id } });
const action = (route: typeof finalizeRoute, name: string) => (id: string, body: Body, user: TestUser = "editor", idem = key(name)) =>
  call(route, { path: `${PATH}/${id}/${name}`, method: "POST", user, body, params: { id }, headers: { "idempotency-key": idem } });
const finalize = action(finalizeRoute, "finalize");
const discard = action(discardRoute, "discard");
const returnToDraft = action(returnRoute, "return-to-draft");
const confirm = action(confirmRoute, "confirm-signed");
const rev = async (id: string) => (await db().contract.findUniqueOrThrow({ where: { id } })).revision;

let numberSeq = 0;
const nextNumber = () => `TL-${++numberSeq}`;
/** A complete Draft (no blockers). */
async function draft(employmentId: string, from: string, to: string | null = null, extra: Body = {}): Promise<string> {
  const r = await create({ employment_id: employmentId, contract_type_id: typeA, contract_number: nextNumber(), effective_from: from, ...(to ? { effective_to: to } : { is_open_ended: true }), ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id;
}
async function finalized(employmentId: string, from: string, to: string | null = null): Promise<string> {
  const id = await draft(employmentId, from, to);
  const f = await finalize(id, { expected_revision: await rev(id) });
  expect(f.status, JSON.stringify(f.body)).toBe(201);
  return id;
}

describe("Create / read / edit / discard a Draft", () => {
  it("creates a Draft with only the period; the representation is server-authoritative", async () => {
    const e = await period("2026-01-01");
    const r = await create({ employment_id: e, contract_number: "  TL-READ-1  " });
    expect(r.status).toBe(201);
    const c = ContractDetailSchema.parse(r.body);
    expect(c).toMatchObject({ contract_number: "TL-READ-1", revision: 1, state: { document_state: "draft", disposition: null, operational: true, time_state: null } });
    expect(c.finalize_check?.ready).toBe(false);
    expect(c.finalize_check?.blockers.map((b) => `${b.field}:${b.code}`).sort()).toEqual(["contract_type_id:REQUIRED", "effective_from:REQUIRED", "effective_to:REQUIRED"]);
    expect(c.actions.edit.allowed).toBe(true);
    expect(c.actions.finalize).toEqual({ allowed: false, reasons: ["NOT_READY"] });
    expect(c.actions.return_to_draft.reasons).toContain("NOT_FINALIZED");
    const h = ContractHistorySchema.parse((await call(historyRoute, { path: `${PATH}/${c.id}/history`, user: "editor", params: { id: c.id } })).body);
    expect(h.data.map((x) => x.event_type)).toEqual(["created"]);
    expect(h.data[0].recorded_by?.user_id).toBeTruthy();
  });

  it("refuses objectively invalid values and maps database rules to API codes", async () => {
    const e = await period("2026-02-01", "2026-12-31");
    expect((await create({ employment_id: e, effective_from: "2026-01-31" })).body.error).toBe("EFFECTIVE_FROM_OUTSIDE_PERIOD");
    expect((await create({ employment_id: e, effective_from: "2026-03-01", effective_to: "2026-02-28" })).body.error).toBe("INVALID_TERM");
    expect((await create({ employment_id: e, effective_to: "2026-06-30", is_open_ended: true })).body.error).toBe("INVALID_TERM");
    expect((await create({ employment_id: e, contract_type_id: typeInactive })).body.error).toBe("CONTRACT_TYPE_INACTIVE");
    expect((await create({ employment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).status).toBe(404);
    await create({ employment_id: e, contract_number: "HĐ-DUP-1" });
    const dup = await create({ employment_id: e, contract_number: " hđ-dup-1 " });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("DUPLICATE_CONTRACT_NUMBER");
  });

  it("edits only Drafts with expected_revision; a no-op keeps the revision; the period cannot be changed", async () => {
    const e = await period("2026-01-01");
    const id = (await create({ employment_id: e })).body.id;
    const r = await patch(id, { expected_revision: 1, contract_type_id: typeA, effective_from: "2026-01-01", is_open_ended: true, summary: "  Synthetic note " });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ revision: 2, summary: "Synthetic note", is_open_ended: true });
    expect((await patch(id, { expected_revision: 2, summary: "Synthetic note" })).body.revision).toBe(2); // no-op
    const stale = await patch(id, { expected_revision: 1, summary: "x" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
    expect((await patch(id, { expected_revision: 2, employment_id: e })).status).toBe(400); // not editable
    const audit = await db().auditEvent.findFirst({ where: { action: "contract.update_draft", entityId: id }, include: { fieldChanges: true } });
    expect(audit?.fieldChanges.map((f) => f.field).sort()).toEqual(["contract.contract_type_id", "contract.effective_from", "contract.is_open_ended"]);
  });

  it("a Draft may change or clear its number; a discarded Draft keeps its number occupied (C-110)", async () => {
    const e = await period("2026-01-01");
    const id = (await create({ employment_id: e, contract_number: "TL-OCC-1" })).body.id;
    expect((await patch(id, { expected_revision: 1, contract_number: "   " })).body.contract_number).toBeNull();
    expect((await patch(id, { expected_revision: 2, contract_number: "TL-OCC-2" })).body.contract_number).toBe("TL-OCC-2");
    expect((await create({ employment_id: e, contract_number: "tl-occ-1" })).status).toBe(201); // freed by the edit
    const d = await discard(id, { expected_revision: 3, reason: "Created by mistake" });
    expect(d.status).toBe(201);
    expect(d.body.state).toMatchObject({ disposition: "cancelled", operational: false });
    expect(d.body.actions.edit.reasons).toEqual(["CONTRACT_CANCELLED"]);
    expect((await create({ employment_id: e, contract_number: "TL-OCC-2" })).body.error).toBe("DUPLICATE_CONTRACT_NUMBER");
    expect((await patch(id, { expected_revision: 4, summary: "x" })).body.error).toBe("CONTRACT_READ_ONLY");
  });
});

describe("Finalize (M-19 warning confirmation)", () => {
  it("normal Draft → Finalized when there are no warnings; history and audit recorded", async () => {
    const e = await period("2026-01-01", "2026-12-31");
    const id = await draft(e, "2026-01-01", "2026-12-31");
    const before = await get(id);
    expect(before.body.finalize_check).toMatchObject({ ready: true, warnings: [], warning_fingerprint: null });
    const f = await finalize(id, { expected_revision: 1 });
    expect(f.status).toBe(201);
    expect(f.body.state.document_state).toBe("finalized");
    expect(f.body.finalized_by?.display_name).toBe("Test HR Editor");
    expect(f.body.finalize_check).toBeNull();
    const events = await db().contractHistoryEvent.findMany({ where: { contractId: id }, orderBy: { recordedAt: "asc" } });
    expect(events.map((x) => x.eventType)).toEqual(["created", "finalized"]);
    expect(await db().auditEvent.count({ where: { action: "contract.finalize", entityId: id } })).toBe(1);
  });

  it("warnings → 409 FINALIZE_CONFIRMATION_REQUIRED with warnings and fingerprint, nothing changes; matching fingerprint → Finalized; the warning stays in Needs Review", async () => {
    const e = await period("2026-01-01");
    const first = await finalized(e, "2026-01-01", "2026-12-31");
    const id = await draft(e, "2026-06-01", "2027-05-31"); // overlaps `first`
    const preview = (await get(id)).body;
    expect(preview.finalize_check.ready).toBe(true);
    expect(preview.finalize_check.warnings.map((w: { code: string }) => w.code)).toEqual(["OVERLAPPING_CONTRACT"]);
    expect(preview.actions.finalize.allowed).toBe(true); // warnings never block

    const r1 = await finalize(id, { expected_revision: 1 });
    expect(r1.status).toBe(409);
    const err = ErrorResponseSchema.parse(r1.body);
    expect(err.error).toBe("FINALIZE_CONFIRMATION_REQUIRED");
    expect(err.details).toEqual([expect.objectContaining({ code: "OVERLAPPING_CONTRACT", related_contract_id: first })]);
    expect(err.warning_fingerprint).toBe(preview.finalize_check.warning_fingerprint);
    expect(await rev(id)).toBe(1);
    expect(await db().contractHistoryEvent.count({ where: { contractId: id, eventType: "finalized" } })).toBe(0);

    const r2 = await finalize(id, { expected_revision: 1, confirmed_warning_fingerprint: err.warning_fingerprint });
    expect(r2.status).toBe(201);
    expect(r2.body.state.document_state).toBe("finalized");
    expect(r2.body.review).toEqual({ needs_review: true, items: [expect.objectContaining({ code: "OVERLAPPING_CONTRACT", related_contract_id: first })] });
    expect((await get(first)).body.review.items.map((i: { code: string }) => i.code)).toEqual(["OVERLAPPING_CONTRACT"]);
    // No acknowledgement record: only the normal events.
    expect((await db().contractHistoryEvent.findMany({ where: { contractId: id } })).map((x) => x.eventType).sort()).toEqual(["created", "finalized"]);
  });

  it("a warning set that changed between review and confirmation (or a wrong fingerprint) requires review again and mutates nothing", async () => {
    const e = await period("2026-01-01");
    const id = await draft(e, "2026-03-01", "2026-09-30");
    const other = await draft(e, "2026-04-01", "2026-04-30"); // ANOTHER_OPEN_DRAFT_FOR_PERIOD for each other
    const reviewed = (await get(id)).body.finalize_check;
    expect(reviewed.warnings.map((w: { code: string }) => w.code)).toEqual(["ANOTHER_OPEN_DRAFT_FOR_PERIOD"]);

    // Between review and confirmation the other draft is finalized: the warning set changes.
    await finalize(other, { expected_revision: 1, confirmed_warning_fingerprint: (await get(other)).body.finalize_check.warning_fingerprint });
    const stale = await finalize(id, { expected_revision: 1, confirmed_warning_fingerprint: reviewed.warning_fingerprint });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("FINALIZE_CONFIRMATION_REQUIRED");
    expect(stale.body.message).toContain("changed");
    expect(stale.body.details.map((w: { code: string }) => w.code)).toEqual(["OVERLAPPING_CONTRACT"]);
    expect(stale.body.warning_fingerprint).not.toBe(reviewed.warning_fingerprint);
    expect(await rev(id)).toBe(1);

    expect((await finalize(id, { expected_revision: 1, confirmed_warning_fingerprint: "w1:not-the-current-set" })).body.error).toBe("FINALIZE_CONFIRMATION_REQUIRED");
    expect(await rev(id)).toBe(1);
    expect((await finalize(id, { expected_revision: 1, confirmed_warning_fingerprint: stale.body.warning_fingerprint })).status).toBe(201);
  });

  it("each warning has its own code: Effective To after the period end", async () => {
    const e = await period("2026-01-01", "2026-06-30");
    const id = await draft(e, "2026-01-01", "2026-12-31");
    const r = await finalize(id, { expected_revision: 1 });
    expect(r.body.details).toEqual([expect.objectContaining({ code: "CONTRACT_ENDS_AFTER_EMPLOYMENT_PERIOD", field: "effective_to" })]);
  });

  it("overlap compares operational ranges person-wide: a contract closed by its period end does not overlap the next period", async () => {
    const e1 = await period("2025-01-01", "2025-12-31");
    const old = await finalized(e1, "2025-01-01", "2025-12-31");
    const e2 = await samePersonPeriod(e1, "2026-01-01");
    const id = await draft(e2, "2026-01-01", "2026-12-31");
    expect((await get(id)).body.finalize_check.warnings).toEqual([]); // the old contract ended with its period
    await app.query("UPDATE contract SET effective_to = '2026-03-31' WHERE id = $1", [old]); // simulated data drift (bypasses the API)
    expect((await get(id)).body.finalize_check.warnings).toEqual([]); // operational end is still bounded by the period end
  });

  it("blockers are never overridable — a fingerprint does not help", async () => {
    const e = await period("2026-01-01");
    const id = (await create({ employment_id: e, contract_type_id: typeA, effective_from: "2026-01-01", is_open_ended: true })).body.id;
    const r = await finalize(id, { expected_revision: 1, confirmed_warning_fingerprint: "w1:anything" });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("CONTRACT_NOT_READY");
    expect(r.body.details).toEqual([expect.objectContaining({ field: "contract_number", code: "REQUIRED" })]);
    await app.query("UPDATE contract_type SET is_active = false WHERE id = $1", [typeA]);
    try {
      await patch(id, { expected_revision: 1, contract_number: nextNumber() });
      const inactive = await finalize(id, { expected_revision: 2 });
      expect(inactive.body.details).toEqual([expect.objectContaining({ code: "CONTRACT_TYPE_INACTIVE" })]);
    } finally {
      await app.query("UPDATE contract_type SET is_active = true WHERE id = $1", [typeA]);
    }
    expect((await finalize(id, { expected_revision: 1 })).body.error).toBe("REVISION_CONFLICT");
    const done = await finalize(id, { expected_revision: 2 });
    expect(done.status).toBe(201);
    expect((await finalize(id, { expected_revision: 3 })).body.error).toBe("CONTRACT_NOT_DRAFT");
  });
});

describe("Return to Draft (C-109)", () => {
  it("a Finalized, unsigned contract returns to Draft with a reason; number and content are kept", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, "2026-01-01");
    expect((await returnToDraft(id, { expected_revision: 2, reason: "   " })).body.error).toBe("REASON_REQUIRED");
    const r = await returnToDraft(id, { expected_revision: 2, reason: "Wrong end date before signing" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ revision: 3, state: { document_state: "draft", time_state: null }, finalized_at: null, finalized_by: null });
    expect(r.body.contract_number).toMatch(/^TL-/);
    const h = (await call(historyRoute, { path: `${PATH}/${id}/history`, user: "editor", params: { id } })).body.data;
    expect(h.map((x: { event_type: string }) => x.event_type)).toEqual(["created", "finalized", "returned_to_draft"]);
    expect(h[2].reason).toBe("Wrong end date before signing");
    expect(h[0].reason).toBeNull();
  });

  it("a Signed contract cannot return to Draft", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, "2026-01-01");
    await confirm(id, { expected_revision: 2, signed_at: "2026-01-01" });
    const r = await returnToDraft(id, { expected_revision: 3, reason: "Try" });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: "CONTRACT_STATE_CONFLICT", details: [expect.objectContaining({ code: "ALREADY_SIGNED" })] });
    expect((await get(id)).body.actions.return_to_draft).toEqual({ allowed: false, reasons: ["ALREADY_SIGNED"] });
  });

  it("an Ended Employment Period does not block it; a Cancelled or Voided period does", async () => {
    const ended = await period("2024-01-01", "2024-12-31");
    const old = await finalized(ended, "2024-01-01", "2024-12-31");
    const d = await get(old);
    expect(d.body.state).toMatchObject({ time_state: "expired", operational: true });
    expect((await returnToDraft(old, { expected_revision: 2, reason: "Correct before signing" })).status).toBe(201);

    for (const marker of ["cancelled_at", "voided_at"]) {
      const e = await period("2027-09-01");
      const id = await finalized(e, "2027-09-01");
      await app.query(`UPDATE employment SET ${marker} = now() WHERE id = $1`, [e]);
      const r = await returnToDraft(id, { expected_revision: 2, reason: "Try" });
      expect(r.status, marker).toBe(422);
      expect(r.body.error).toBe("PERIOD_NOT_VALID");
    }
  });
});

describe("Confirm Signed (C-105, C-109, C-111)", () => {
  it("accepts today and past dates — even before the period start — and refuses a future Vietnam business date", async () => {
    const e = await period(addDays(today, 60));
    const id = await finalized(e, addDays(today, 60));
    expect((await confirm(id, { expected_revision: 2, signed_at: addDays(today, 1) })).body.error).toBe("SIGNED_AT_IN_FUTURE");
    const r = await confirm(id, { expected_revision: 2, signed_at: addDays(today, -400) });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ signed_at: addDays(today, -400), state: { document_state: "signed", time_state: "upcoming" } });
    const ev = await db().contractHistoryEvent.findFirstOrThrow({ where: { contractId: id, eventType: "signed_confirmed" } });
    expect(ev.effectiveDate?.toISOString().slice(0, 10)).toBe(addDays(today, -400)); // business date
    expect(Date.now() - ev.recordedAt.getTime()).toBeLessThan(60_000); // when HR actually recorded it
    expect((await confirm(id, { expected_revision: 3, signed_at: today })).body.error).toBe("CONTRACT_STATE_CONFLICT");
  });

  it("is only for Finalized contracts", async () => {
    const e = await period("2026-01-01");
    const id = await draft(e, "2026-01-01");
    const r = await confirm(id, { expected_revision: 1, signed_at: today });
    expect(r.body).toMatchObject({ error: "CONTRACT_STATE_CONFLICT", details: [expect.objectContaining({ code: "NOT_FINALIZED" })] });
  });

  it("a Cancelled period allows recording the signature; the contract stays non-operational and in Needs Review", async () => {
    const e = await period("2027-10-01");
    const id = await finalized(e, "2027-10-01");
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [e]);
    const r = await confirm(id, { expected_revision: 2, signed_at: today });
    expect(r.status).toBe(201);
    expect(r.body.state).toMatchObject({ document_state: "signed", operational: false, time_state: null });
    expect(r.body.review.items.map((i: { code: string }) => i.code)).toEqual(["PERIOD_CANCELLED"]);
    expect((await db().employment.findUniqueOrThrow({ where: { id: e } })).endDate).toBeNull(); // employment untouched
  });

  it("a Voided period refuses it — in the service and in the database", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, "2026-01-01");
    await app.query("UPDATE employment SET voided_at = now() WHERE id = $1", [e]);
    const r = await confirm(id, { expected_revision: 2, signed_at: today });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: "PERIOD_NOT_VALID", details: [expect.objectContaining({ code: "PERIOD_VOIDED" })] });
    expect((await get(id)).body.actions.confirm_signed).toEqual({ allowed: false, reasons: ["PERIOD_VOIDED"] });
    const direct = await app.query("UPDATE contract SET signed_at = $2 WHERE id = $1", [id, today]).catch((x: { constraint?: string }) => x.constraint);
    expect(direct).toBe("contract_voided_parent_read_only");
  });
});

describe("Drafts under a Cancelled or Voided period", () => {
  it.each(["cancelled_at", "voided_at"])("with %s: readable with history; no edit, no Finalize; Discard allowed; nothing cascades", async (marker) => {
    const e = await period("2027-11-01");
    const id = await draft(e, "2027-11-01");
    await app.query(`UPDATE employment SET ${marker} = now() WHERE id = $1`, [e]);
    const code = marker === "voided_at" ? "PERIOD_VOIDED" : "PERIOD_CANCELLED";
    const read = await get(id);
    expect(read.status).toBe(200);
    expect(read.body.state).toMatchObject({ document_state: "draft", disposition: null, operational: false });
    expect(read.body.review.items.map((i: { code: string }) => i.code)).toEqual([code]);
    expect(read.body.actions.edit.reasons).toEqual([code]);
    expect(read.body.actions.finalize.reasons).toEqual([code]);
    expect(read.body.actions.discard.allowed).toBe(true);
    expect((await patch(id, { expected_revision: 1, summary: "x" })).body).toMatchObject({ error: "PERIOD_NOT_VALID", details: [expect.objectContaining({ code })] });
    expect((await finalize(id, { expected_revision: 1 })).body.error).toBe("PERIOD_NOT_VALID");
    expect((await call(historyRoute, { path: `${PATH}/${id}/history`, user: "editor", params: { id } })).status).toBe(200);
    expect((await discard(id, { expected_revision: 1 })).status).toBe(201);
    expect((await create({ employment_id: e })).body.error).toBe("PERIOD_NOT_VALID");
  });
});

describe("Concurrency and idempotency", () => {
  it("a replayed create returns the same contract; the same key with another payload is refused", async () => {
    const e = await period("2026-01-01");
    const idem = key("replay");
    const a = await create({ employment_id: e, summary: "one" }, "editor", idem);
    const b = await create({ employment_id: e, summary: "one" }, "editor", idem);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(b.body.id).toBe(a.body.id);
    expect(await db().contract.count({ where: { employmentId: e } })).toBe(1);
    expect((await create({ employment_id: e, summary: "two" }, "editor", idem)).body.error).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("a double Finalize click with one key finalizes once; a rejected confirmation leaves the key unused", async () => {
    const e = await period("2026-01-01");
    const id = await draft(e, "2026-01-01");
    const idem = key("double");
    const [x, y] = await Promise.all([finalize(id, { expected_revision: 1 }, "editor", idem), finalize(id, { expected_revision: 1 }, "editor", idem)]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(await db().contractHistoryEvent.count({ where: { contractId: id, eventType: "finalized" } })).toBe(1);

    const e2 = await period("2026-01-01");
    const first = await finalized(e2, "2026-01-01");
    const other = await draft(e2, "2026-02-01", "2026-03-31");
    const k2 = key("confirm-later");
    const needs = await finalize(other, { expected_revision: 1 }, "editor", k2);
    expect(needs.body.error).toBe("FINALIZE_CONFIRMATION_REQUIRED");
    expect(await db().idempotencyRecord.count({ where: { idempotencyKey: k2 } })).toBe(0);
    expect(first).toBeTruthy();
  });

  it("stale revisions are refused on every lifecycle action", async () => {
    const e = await period("2026-01-01");
    const id = await finalized(e, "2026-01-01");
    expect((await confirm(id, { expected_revision: 1, signed_at: today })).body.error).toBe("REVISION_CONFLICT");
    expect((await returnToDraft(id, { expected_revision: 1, reason: "x" })).body.error).toBe("REVISION_CONFLICT");
    expect((await discard(id, { expected_revision: 2 })).body.error).toBe("CONTRACT_NOT_DRAFT");
  });
});

describe("Allowed-action projection per caller (C-106)", () => {
  it("the same contract projects different actions for different permission sets", async () => {
    const e = await period("2026-01-01");
    const id = await draft(e, "2026-01-01");
    const readOnly = await getContract(await principalWith("editor", ["contracts.read"]), id);
    expect(readOnly.actions.edit).toEqual({ allowed: false, reasons: ["PERMISSION_REQUIRED"] });
    expect(readOnly.actions.finalize).toEqual({ allowed: false, reasons: ["PERMISSION_REQUIRED"] });
    const manager = await getContract(await principalWith("editor", ["contracts.read", "contracts.manage"]), id);
    expect(manager.actions.edit.allowed).toBe(true);
    expect(manager.actions.finalize.reasons).toEqual(["PERMISSION_REQUIRED"]);
    expect((await get(id, "editor")).body.actions.finalize.allowed).toBe(true); // HR_EDITOR may finalize (C-106)
  });

  it("server-side permissions: API_DOCS_READER and role-less users get nothing; HR_EDITOR may finalize and confirm", async () => {
    const e = await period("2026-01-01");
    const id = await draft(e, "2026-01-01");
    expect((await get(id, "docs")).status).toBe(403);
    expect((await create({ employment_id: e }, "noroles")).status).toBe(403);
    expect((await finalize(id, { expected_revision: 1 }, "docs")).status).toBe(403);
    expect((await finalize(id, { expected_revision: 1 }, "editor")).status).toBe(201);
    expect((await confirm(id, { expected_revision: 2, signed_at: today }, "editor")).status).toBe(201);
  });
});
