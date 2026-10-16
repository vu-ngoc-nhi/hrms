import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as remindersRoute } from "@/app/api/v1/core-hr/contract-reminders/route";
import { POST as confirmRoute } from "@/app/api/v1/core-hr/contracts/[id]/confirm-signed/route";
import { POST as finalizeRoute } from "@/app/api/v1/core-hr/contracts/[id]/finalize/route";
import { GET as getRoute } from "@/app/api/v1/core-hr/contracts/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/contracts/route";
import { ContractRemindersSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { call, key, type TestUser } from "../helpers";

// Slice 2A-4 Contract Attention (M-20 / PV-36): Expiring soon (own Effective To from today through today + 30, both
// inclusive, Asia/Ho_Chi_Minh), Awaiting signature, Needs review — and the guarantee that Home totals equal the
// filtered Contracts list. Synthetic data; every fixture number starts with "ATN-" so assertions are isolated.
let app: pg.Client;
let userId: string;
let typeA: string;
const today = todayInVietnam();
const PATH = "/api/v1/core-hr/contracts";

beforeAll(async () => {
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  userId = (await app.query("SELECT id FROM app_user ORDER BY display_name LIMIT 1")).rows[0].id;
  typeA = (await app.query("SELECT id FROM contract_type WHERE code = 'TEST_TYPE_A'")).rows[0].id;
});
afterAll(async () => {
  await app.end();
});

let seq = 0;
/** A person with one period (each fixture gets its own person, so no overlap warnings interfere). */
async function period(start: string, end: string | null = null): Promise<string> {
  seq += 1;
  const code = `ATN${String(seq).padStart(3, "0")}`;
  await app.query("BEGIN");
  const p = await app.query("INSERT INTO person (employee_code, full_name, created_by) VALUES ($1, 'Test Attention Person', $2) RETURNING id", [code, userId]);
  await app.query("INSERT INTO employee_code_registry (code, person_id, source, issued_by) VALUES ($1, $2, 'legacy', $3)", [code, p.rows[0].id, userId]);
  const e = await app.query("INSERT INTO employment (person_id, start_date, end_date, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [p.rows[0].id, start, end, userId]);
  await app.query("COMMIT");
  return e.rows[0].id;
}
const rev = async (id: string) => (await call(getRoute, { path: `${PATH}/${id}`, user: "editor", params: { id } })).body.revision as number;
async function draft(number: string, employmentId: string, from: string, to: string | null): Promise<string> {
  const r = await call(createRoute, {
    path: PATH,
    method: "POST",
    user: "editor",
    headers: { "idempotency-key": key("atn") },
    body: { employment_id: employmentId, contract_type_id: typeA, contract_number: number, effective_from: from, ...(to ? { effective_to: to } : { is_open_ended: true }) },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id;
}
async function finalize(id: string) {
  const first = await call(finalizeRoute, { path: `${PATH}/${id}/finalize`, method: "POST", user: "editor", params: { id }, body: { expected_revision: await rev(id) }, headers: { "idempotency-key": key("atf") } });
  if (first.status === 201) return;
  const second = await call(finalizeRoute, {
    path: `${PATH}/${id}/finalize`,
    method: "POST",
    user: "editor",
    params: { id },
    body: { expected_revision: await rev(id), confirmed_warning_fingerprint: first.body.warning_fingerprint },
    headers: { "idempotency-key": key("atf2") },
  });
  expect(second.status, JSON.stringify(second.body)).toBe(201);
}
async function finalized(number: string, from: string, to: string | null, end: string | null = null): Promise<string> {
  const id = await draft(number, await period(addDays(today, -365), end), from, to);
  await finalize(id);
  return id;
}
const numbers = async (qs: string, user: TestUser = "editor") =>
  ((await call(listRoute, { path: `${PATH}?search=ATN-&page_size=100&${qs}`, user })).body.data as { contract_number: string }[]).map((c) => c.contract_number).sort();

let ids: Record<string, string> = {};

beforeAll(async () => {
  const start = addDays(today, -300);
  ids = {
    today: await finalized("ATN-END-TODAY", start, today),
    t30: await finalized("ATN-END-T30", start, addDays(today, 30)),
    t31: await finalized("ATN-END-T31", start, addDays(today, 31)),
    t60: await finalized("ATN-END-T60", start, addDays(today, 60)),
    t90: await finalized("ATN-END-T90", start, addDays(today, 90)),
    t91: await finalized("ATN-END-T91", start, addDays(today, 91)),
    yesterday: await finalized("ATN-END-YESTERDAY", start, addDays(today, -1)),
    open: await finalized("ATN-OPEN", start, null),
    // A draft in the window is not an expiry reminder (no time state until Finalized).
    draft: await draft("ATN-DRAFT-T10", await period(addDays(today, -365)), start, addDays(today, 10)),
    // Ended with its period: the period ended yesterday although the contract's own end is in the window.
    periodEnded: await finalized("ATN-PERIOD-ENDED", start, addDays(today, 10), addDays(today, -1)),
  };
  // Signed contract in the window: still expiring; not awaiting signature.
  ids.signed = await finalized("ATN-SIGNED-T5", start, addDays(today, 5));
  await call(confirmRoute, { path: `${PATH}/${ids.signed}/confirm-signed`, method: "POST", user: "editor", params: { id: ids.signed }, body: { expected_revision: await rev(ids.signed), signed_at: today }, headers: { "idempotency-key": key("ats") } });
  // Voided contract in the window.
  ids.voided = await finalized("ATN-VOIDED-T5", start, addDays(today, 5));
  await app.query("UPDATE contract SET voided_at = now(), revision = revision + 1 WHERE id = $1", [ids.voided]);
  // Contracts of a cancelled and of a voided period: never a clean reminder, always Needs Review.
  for (const [k, marker] of [["cancelledPeriod", "cancelled_at"], ["voidedPeriod", "voided_at"]] as const) {
    const e = await period(addDays(today, -365));
    const id = await draft(`ATN-${k.toUpperCase()}`, e, start, addDays(today, 5));
    await finalize(id);
    await app.query(`UPDATE employment SET ${marker} = now() WHERE id = $1`, [e]);
    ids[k] = id;
  }
});

describe("Expiring soon — own Effective To from today through today + N (both inclusive)", () => {
  it("30 days: today and T+30 included; T+31, already ended, open-ended, drafts, voided and contracts of an ended/cancelled/voided period excluded", async () => {
    expect(await numbers("expiring_within=30")).toEqual(["ATN-END-T30", "ATN-END-TODAY", "ATN-SIGNED-T5"]);
  });
  it("60 and 90 days use the same rule", async () => {
    expect(await numbers("expiring_within=60")).toEqual(["ATN-END-T30", "ATN-END-T31", "ATN-END-T60", "ATN-END-TODAY", "ATN-SIGNED-T5"]);
    expect(await numbers("expiring_within=90")).toEqual(["ATN-END-T30", "ATN-END-T31", "ATN-END-T60", "ATN-END-T90", "ATN-END-TODAY", "ATN-SIGNED-T5"]);
  });
  it("only the canonical windows are accepted", async () => {
    expect((await call(listRoute, { path: `${PATH}?expiring_within=45`, user: "editor" })).status).toBe(400);
  });
});

describe("Awaiting signature — Finalized, not Signed, operational; no deadline", () => {
  it("includes finalized unsigned contracts whatever their dates; excludes signed, drafts, voided and contracts of cancelled/voided periods", async () => {
    const r = await numbers("awaiting_signature=true");
    expect(r).toContain("ATN-END-YESTERDAY"); // already ended but never confirmed signed: still a true open item
    expect(r).toContain("ATN-OPEN");
    for (const out of ["ATN-SIGNED-T5", "ATN-DRAFT-T10", "ATN-VOIDED-T5", "ATN-CANCELLEDPERIOD", "ATN-VOIDEDPERIOD"]) expect(r, out).not.toContain(out);
  });
});

describe("Needs review — the 2A-2 model, reused", () => {
  it("surfaces contracts of a cancelled or voided period (instead of a clean reminder) and the contract that ended with its period", async () => {
    const r = await numbers("needs_review=true");
    expect(r).toEqual(expect.arrayContaining(["ATN-CANCELLEDPERIOD", "ATN-VOIDEDPERIOD", "ATN-PERIOD-ENDED"]));
    expect(r).not.toContain("ATN-VOIDED-T5"); // a voided contract itself is history, not a review item
    const item = (await call(getRoute, { path: `${PATH}/${ids.cancelledPeriod}`, user: "editor", params: { id: ids.cancelledPeriod } })).body;
    expect(item.review.items.map((i: { code: string }) => i.code)).toEqual(["PERIOD_CANCELLED"]);
  });
});

describe("GET /contract-reminders — Home Contract Attention", () => {
  it("returns three bounded signals whose totals equal the canonical Contracts filters (same rules)", async () => {
    const r = await call(remindersRoute, { path: "/api/v1/core-hr/contract-reminders", user: "editor" });
    expect(r.status).toBe(200);
    const home = ContractRemindersSchema.parse(r.body);
    expect(home).toMatchObject({ as_of: today, window_days: 30 });
    const total = async (qs: string) => (await call(listRoute, { path: `${PATH}?page_size=1&${qs}`, user: "editor" })).body.total as number;
    expect(home.expiring_soon.total).toBe(await total("expiring_within=30"));
    expect(home.awaiting_signature.total).toBe(await total("awaiting_signature=true"));
    expect(home.needs_review.total).toBe(await total("needs_review=true"));
    for (const s of [home.expiring_soon, home.awaiting_signature, home.needs_review]) expect(s.items.length).toBeLessThanOrEqual(5);
  });

  it("orders Expiring soon by end date and gives days to the end; Needs review items carry their main condition", async () => {
    const home = (await call(remindersRoute, { path: "/api/v1/core-hr/contract-reminders", user: "editor" })).body;
    const ends = home.expiring_soon.items.map((i: { effective_to: string }) => i.effective_to);
    expect(ends).toEqual([...ends].sort());
    const endsToday = home.expiring_soon.items.find((i: { id: string }) => i.id === ids.today);
    if (endsToday) expect(endsToday.days_to_end).toBe(0);
    for (const i of home.needs_review.items) expect(typeof i.review_reason).toBe("string");
  });

  it("takes no parameters and is contracts.read only", async () => {
    expect((await call(remindersRoute, { path: "/api/v1/core-hr/contract-reminders?window=60", user: "editor" })).status).toBe(400);
    expect((await call(remindersRoute, { path: "/api/v1/core-hr/contract-reminders", user: "docs" })).status).toBe(403);
    expect((await call(remindersRoute, { path: "/api/v1/core-hr/contract-reminders", user: "noroles" })).status).toBe(403);
  });
});
