import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HISTORY_EVENT_TYPES, RELATIONSHIP_TYPES } from "@/modules/contracts/model";

// Phase 2A slice 2A-1 (ADR-0005; C-104 … C-109, M-15 … M-18): contract structural invariants, checked directly as the
// application role hrms_app on hrms_test (rebuilt from zero with every committed migration). Synthetic data only.
let app: pg.Client;
let userId: string;
let typeA: string;
let seq = 0;

beforeAll(async () => {
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  userId = (await app.query("SELECT id FROM app_user ORDER BY display_name LIMIT 1")).rows[0].id;
  typeA = (await app.query("SELECT id FROM contract_type WHERE code = 'TEST_TYPE_A'")).rows[0].id;
});

afterAll(async () => {
  await app.end();
});

async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}
async function constraintOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { constraint?: string }).constraint;
  }
}

/** A synthetic person with one employment period. */
async function period(start: string, end: string | null = null): Promise<{ personId: string; employmentId: string }> {
  seq += 1;
  const code = `CTF${String(seq).padStart(4, "0")}`;
  await app.query("BEGIN");
  const person = await app.query(
    "INSERT INTO person (employee_code, full_name, created_by) VALUES ($1, 'Test Contract Person', $2) RETURNING id",
    [code, userId],
  );
  await app.query("INSERT INTO employee_code_registry (code, person_id, source, issued_by) VALUES ($1, $2, 'legacy', $3)", [code, person.rows[0].id, userId]);
  const e = await app.query("INSERT INTO employment (person_id, start_date, end_date, created_by) VALUES ($1, $2, $3, $4) RETURNING id", [
    person.rows[0].id,
    start,
    end,
    userId,
  ]);
  await app.query("COMMIT");
  return { personId: person.rows[0].id, employmentId: e.rows[0].id };
}

type Draft = Partial<{
  contract_type_id: string | null;
  contract_number: string | null;
  effective_from: string | null;
  effective_to: string | null;
  is_open_ended: boolean;
  parent_contract_id: string | null;
  relationship_type: string | null;
}>;

function insertContract(employmentId: string, d: Draft = {}) {
  return app.query(
    `INSERT INTO contract (employment_id, contract_type_id, contract_number, effective_from, effective_to, is_open_ended,
                           parent_contract_id, relationship_type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      employmentId,
      d.contract_type_id ?? null,
      d.contract_number ?? null,
      d.effective_from ?? null,
      d.effective_to ?? null,
      d.is_open_ended ?? false,
      d.parent_contract_id ?? null,
      d.relationship_type ?? null,
      userId,
    ],
  );
}
async function contract(employmentId: string, d: Draft = {}): Promise<string> {
  return (await insertContract(employmentId, d)).rows[0].id;
}
const finalize = (id: string) => app.query("UPDATE contract SET finalized_at = now(), finalized_by = $2 WHERE id = $1", [id, userId]);
/** A complete, finalized agreement. */
async function finalized(employmentId: string, number: string, from: string, to: string | null = null): Promise<string> {
  const id = await contract(employmentId, { contract_type_id: typeA, contract_number: number, effective_from: from, effective_to: to, is_open_ended: to === null });
  await finalize(id);
  return id;
}

describe("Contract Number (M-15, M-18)", () => {
  it("is optional while Draft: several drafts without a number coexist", async () => {
    const { employmentId } = await period("2026-01-01");
    await contract(employmentId);
    await contract(employmentId);
    expect((await app.query("SELECT count(*)::int AS n FROM contract WHERE employment_id = $1 AND contract_number IS NULL", [employmentId])).rows[0].n).toBe(2);
  });

  it("is stored trimmed: surrounding whitespace and empty values are refused by the database", async () => {
    const { employmentId } = await period("2026-01-01");
    for (const bad of [" N-TRIM-1", "N-TRIM-1 ", "\tN-TRIM-1", ""]) expect(await sqlState(insertContract(employmentId, { contract_number: bad })), JSON.stringify(bad)).toBe("23514");
    expect(await sqlState(insertContract(employmentId, { contract_number: "N TRIM 1" }))).toBeUndefined(); // inner spaces are content
  });

  it("is unique case-insensitively, including Vietnamese letters (ICU folding)", async () => {
    const { employmentId } = await period("2026-01-01");
    await contract(employmentId, { contract_number: "HĐLĐ-2026-001" });
    expect(await sqlState(insertContract(employmentId, { contract_number: "hđlđ-2026-001" }))).toBe("23505");
    expect(await sqlState(insertContract(employmentId, { contract_number: "HĐLĐ-2026-001" }))).toBe("23505");
    expect(await constraintOf(insertContract(employmentId, { contract_number: "Hđlđ-2026-001" }))).toBe("contract_number_ci_uq");
  });

  it("is unique across employees and periods (the whole register)", async () => {
    const a = await period("2026-01-01");
    const b = await period("2026-01-01");
    await contract(a.employmentId, { contract_number: "REG-ALL-1" });
    expect(await sqlState(insertContract(b.employmentId, { contract_number: "reg-all-1" }))).toBe("23505");
  });

  it("stays occupied by a Cancelled (discarded) Draft and by a Voided contract — no disposition frees a number", async () => {
    const { employmentId } = await period("2026-01-01");
    const discarded = await contract(employmentId, { contract_number: "OCC-DISCARD-1" });
    await app.query("UPDATE contract SET cancelled_at = now() WHERE id = $1", [discarded]);
    expect(await sqlState(insertContract(employmentId, { contract_number: "occ-discard-1" }))).toBe("23505");

    const voided = await finalized(employmentId, "OCC-VOID-1", "2026-01-01");
    await app.query("UPDATE contract SET voided_at = now() WHERE id = $1", [voided]);
    expect(await sqlState(insertContract(employmentId, { contract_number: "OCC-VOID-1" }))).toBe("23505");
  });

  it("a Draft may change or clear its current number; uniqueness concerns current numbers only (no reservation registry)", async () => {
    const { employmentId } = await period("2026-01-01");
    const id = await contract(employmentId, { contract_number: "CHG-1" });
    await app.query("UPDATE contract SET contract_number = 'CHG-2' WHERE id = $1", [id]);
    await app.query("UPDATE contract SET contract_number = NULL WHERE id = $1", [id]);
    expect(await sqlState(insertContract(employmentId, { contract_number: "chg-1" }))).toBeUndefined();
    expect(await sqlState(insertContract(employmentId, { contract_number: "CHG-2" }))).toBeUndefined();
  });
});

describe("Effective dates and the Employment Period (C-104 (4), C-109)", () => {
  it("Effective From must fall inside the linked period (start and end inclusive)", async () => {
    const { employmentId } = await period("2026-02-01", "2026-12-31");
    expect(await constraintOf(insertContract(employmentId, { effective_from: "2026-01-31" }))).toBe("contract_effective_from_within_period");
    expect(await constraintOf(insertContract(employmentId, { effective_from: "2027-01-01" }))).toBe("contract_effective_from_within_period");
    expect(await sqlState(insertContract(employmentId, { effective_from: "2026-02-01" }))).toBeUndefined();
    expect(await sqlState(insertContract(employmentId, { effective_from: "2026-12-31" }))).toBeUndefined();
    const id = await contract(employmentId, { effective_from: "2026-03-01" });
    expect(await constraintOf(app.query("UPDATE contract SET effective_from = '2025-12-01' WHERE id = $1", [id]))).toBe("contract_effective_from_within_period");
  });

  it("an Ended period does not invalidate the relationship; created / finalized / signed may precede the period start", async () => {
    const ended = await period("2024-01-01", "2024-12-31");
    const old = await finalized(ended.employmentId, "ENDED-OK-1", "2024-01-01", "2024-12-31");
    await app.query("UPDATE contract SET signed_at = '2023-12-20' WHERE id = $1", [old]); // signed before the period started
    const future = await period("2027-06-01");
    const planned = await finalized(future.employmentId, "PRESTART-OK-1", "2027-06-01"); // created + finalized before start
    await app.query("UPDATE contract SET signed_at = '2026-01-15' WHERE id = $1", [planned]);
    expect((await app.query("SELECT count(*)::int AS n FROM contract WHERE id = ANY($1) AND signed_at IS NOT NULL", [[old, planned]])).rows[0].n).toBe(2);
  });

  it("a later period correction is not blocked by a contract that then falls outside (C-107)", async () => {
    const { employmentId } = await period("2026-01-01");
    await finalized(employmentId, "CORR-OUTSIDE-1", "2026-01-01");
    expect(await sqlState(app.query("UPDATE employment SET start_date = '2026-03-01' WHERE id = $1", [employmentId]))).toBeUndefined();
  });

  it("new contracts and Finalize require a period that is neither Cancelled nor Voided; disposing contracts there stays possible", async () => {
    const { employmentId } = await period("2027-09-01");
    const draft = await contract(employmentId, { contract_type_id: typeA, contract_number: "CANC-PERIOD-1", effective_from: "2027-09-01", is_open_ended: true });
    await app.query("UPDATE employment SET cancelled_at = now() WHERE id = $1", [employmentId]);
    expect(await constraintOf(insertContract(employmentId))).toBe("contract_period_valid");
    expect(await constraintOf(finalize(draft))).toBe("contract_period_valid");
    expect(await sqlState(app.query("UPDATE contract SET cancelled_at = now() WHERE id = $1", [draft]))).toBeUndefined();
  });

  it("Effective To and Open-ended are exclusive, and Effective To never precedes Effective From", async () => {
    const { employmentId } = await period("2026-01-01");
    expect(await constraintOf(insertContract(employmentId, { effective_from: "2026-01-01", effective_to: "2026-12-31", is_open_ended: true }))).toBe(
      "contract_term_exclusive_ck",
    );
    expect(await constraintOf(insertContract(employmentId, { effective_from: "2026-06-01", effective_to: "2026-05-31" }))).toBe("contract_dates_ck");
    expect(await sqlState(insertContract(employmentId, { effective_from: "2026-06-01", effective_to: "2026-06-01" }))).toBeUndefined();
  });

  it("a Finalized record carries type, number, Effective From and Effective To OR Open-ended (M-16)", async () => {
    const { employmentId } = await period("2026-01-01");
    const cases: Draft[] = [
      { contract_number: "FIN-1", effective_from: "2026-01-01", is_open_ended: true },
      { contract_type_id: typeA, effective_from: "2026-01-01", is_open_ended: true },
      { contract_type_id: typeA, contract_number: "FIN-3", is_open_ended: true },
      { contract_type_id: typeA, contract_number: "FIN-4", effective_from: "2026-01-01" },
    ];
    for (const d of cases) {
      const id = await contract(employmentId, d);
      expect(await constraintOf(finalize(id)), JSON.stringify(d)).toBe("contract_finalized_complete_ck");
    }
    expect(await sqlState(finalize(await contract(employmentId, { contract_type_id: typeA, contract_number: "FIN-OK", effective_from: "2026-01-01", effective_to: "2026-12-31" })))).toBeUndefined();
    const lone = await contract(employmentId, { contract_type_id: typeA, contract_number: "FIN-BY", effective_from: "2026-01-01", is_open_ended: true });
    expect(await constraintOf(app.query("UPDATE contract SET finalized_at = now() WHERE id = $1", [lone]))).toBe("contract_finalized_by_ck");
  });

  it("signed_at requires a Finalized record; the period of a Finalized record is fixed", async () => {
    const a = await period("2026-01-01");
    const b = await period("2026-01-01");
    const draft = await contract(a.employmentId);
    expect(await constraintOf(app.query("UPDATE contract SET signed_at = '2026-01-01' WHERE id = $1", [draft]))).toBe("contract_signed_requires_finalized_ck");
    expect(await sqlState(app.query("UPDATE contract SET employment_id = $2 WHERE id = $1", [draft, b.employmentId]))).toBeUndefined(); // a Draft may move
    const fin = await finalized(a.employmentId, "FIXED-PERIOD-1", "2026-01-01");
    expect(await constraintOf(app.query("UPDATE contract SET employment_id = $2 WHERE id = $1", [fin, b.employmentId]))).toBe("contract_employment_fixed_after_finalize");
  });
});

describe("Renewal relationship (C-104, C-109)", () => {
  it("a normal agreement has no parent and no relationship type; the two are set together", async () => {
    const { employmentId } = await period("2026-01-01");
    const parent = await finalized(employmentId, "PAIR-1", "2026-01-01", "2026-06-30");
    expect(await constraintOf(insertContract(employmentId, { parent_contract_id: parent }))).toBe("contract_relationship_pair_ck");
    expect(await constraintOf(insertContract(employmentId, { relationship_type: "renewal" }))).toBe("contract_relationship_pair_ck");
  });

  it("only 'renewal' is admitted — amendment stays gated (PL-12 / PV-38)", async () => {
    const { employmentId } = await period("2026-01-01");
    const parent = await finalized(employmentId, "GATED-1", "2026-01-01", "2026-06-30");
    expect(await sqlState(insertContract(employmentId, { parent_contract_id: parent, relationship_type: "amendment" }))).toBe("23514");
  });

  it("the parent belongs to the same Employment Period", async () => {
    const a = await period("2026-01-01");
    const b = await period("2026-01-01");
    const parent = await finalized(a.employmentId, "SAME-PERIOD-1", "2026-01-01", "2026-06-30");
    expect(await constraintOf(insertContract(b.employmentId, { parent_contract_id: parent, relationship_type: "renewal" }))).toBe("contract_parent_same_period_fk");
    expect(await sqlState(insertContract(a.employmentId, { parent_contract_id: parent, relationship_type: "renewal" }))).toBeUndefined();
  });

  it("the parent is an agreement, never another renewal; the link cannot be changed afterwards", async () => {
    const { employmentId } = await period("2026-01-01");
    const root = await finalized(employmentId, "AGR-ROOT-1", "2026-01-01", "2026-06-30");
    const renewal = await contract(employmentId, { parent_contract_id: root, relationship_type: "renewal" });
    expect(await constraintOf(insertContract(employmentId, { parent_contract_id: renewal, relationship_type: "renewal" }))).toBe("contract_parent_is_agreement");
    const other = await finalized(employmentId, "AGR-OTHER-1", "2026-01-01", "2026-06-30");
    expect(await constraintOf(app.query("UPDATE contract SET parent_contract_id = $2 WHERE id = $1", [renewal, other]))).toBe("contract_link_immutable");
    expect(await constraintOf(app.query("UPDATE contract SET parent_contract_id = NULL, relationship_type = NULL WHERE id = $1", [renewal]))).toBe(
      "contract_link_immutable",
    );
  });

  it("at most one live renewal per agreement; a cancelled renewal frees the slot", async () => {
    const { employmentId } = await period("2026-01-01");
    const root = await finalized(employmentId, "ONE-LIVE-1", "2026-01-01", "2026-06-30");
    const first = await contract(employmentId, { parent_contract_id: root, relationship_type: "renewal" });
    expect(await constraintOf(insertContract(employmentId, { parent_contract_id: root, relationship_type: "renewal" }))).toBe("contract_one_live_renewal_uq");
    await app.query("UPDATE contract SET cancelled_at = now() WHERE id = $1", [first]);
    expect(await sqlState(insertContract(employmentId, { parent_contract_id: root, relationship_type: "renewal" }))).toBeUndefined();
  });
});

describe("Dispositions (ADR-0005 §6)", () => {
  it("Cancelled and Voided never both apply; Void needs a Finalized record", async () => {
    const { employmentId } = await period("2026-01-01");
    const draft = await contract(employmentId);
    expect(await constraintOf(app.query("UPDATE contract SET voided_at = now() WHERE id = $1", [draft]))).toBe("contract_void_requires_finalized_ck");
    const fin = await finalized(employmentId, "DISP-1", "2026-01-01");
    expect(await constraintOf(app.query("UPDATE contract SET cancelled_at = now(), voided_at = now() WHERE id = $1", [fin]))).toBe("contract_single_disposition_ck");
  });

  it("dispositions are terminal and keep the recorded content; nothing is created already disposed", async () => {
    const { employmentId } = await period("2026-01-01");
    const fin = await finalized(employmentId, "TERM-1", "2026-01-01");
    expect(await constraintOf(app.query("UPDATE contract SET voided_at = now(), contract_number = 'TERM-1X' WHERE id = $1", [fin]))).toBe(
      "contract_disposition_is_terminal",
    );
    await app.query("UPDATE contract SET voided_at = now(), revision = revision + 1 WHERE id = $1", [fin]);
    expect(await constraintOf(app.query("UPDATE contract SET voided_at = NULL WHERE id = $1", [fin]))).toBe("contract_disposition_is_terminal"); // no Unvoid
    expect(await constraintOf(app.query("UPDATE contract SET summary = 'x' WHERE id = $1", [fin]))).toBe("contract_disposition_is_terminal");
    expect(
      await constraintOf(
        app.query("INSERT INTO contract (employment_id, cancelled_at, created_by) VALUES ($1, now(), $2)", [employmentId, userId]),
      ),
    ).toBe("contract_disposition_is_terminal");
  });
});

describe("Code ↔ database value sets", () => {
  it("history event types and relationship types in code match the database CHECKs", async () => {
    const def = async (name: string) => (await app.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = $1", [name])).rows[0].d as string;
    const values = (d: string) => [...d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(values(await def("contract_history_event_event_type_check"))).toEqual([...HISTORY_EVENT_TYPES].sort());
    expect(values(await def("contract_relationship_type_check"))).toEqual([...RELATIONSHIP_TYPES].sort());
  });
});

describe("Contract history and privileges", () => {
  it("history is append-only for the application role; contracts and contract types are never deleted", async () => {
    const { employmentId } = await period("2026-01-01");
    const id = await contract(employmentId);
    await app.query("INSERT INTO contract_history_event (contract_id, event_type, recorded_by) VALUES ($1, 'created', $2)", [id, userId]);
    expect(await sqlState(app.query("UPDATE contract_history_event SET reason = 'x' WHERE contract_id = $1", [id]))).toBe("42501");
    expect(await sqlState(app.query("DELETE FROM contract_history_event WHERE contract_id = $1", [id]))).toBe("42501");
    expect(await sqlState(app.query("DELETE FROM contract WHERE id = $1", [id]))).toBe("42501");
    expect(await sqlState(app.query("DELETE FROM contract_type WHERE code = 'TEST_TYPE_A'"))).toBe("42501");
  });

  it("mandatory reasons and the renewal link are enforced on history rows", async () => {
    const { employmentId } = await period("2026-01-01");
    const id = await contract(employmentId);
    const ins = (type: string, reason: string | null, related: string | null = null) =>
      app.query("INSERT INTO contract_history_event (contract_id, event_type, recorded_by, reason, related_contract_id) VALUES ($1, $2, $3, $4, $5)", [
        id,
        type,
        userId,
        reason,
        related,
      ]);
    for (const type of ["returned_to_draft", "cancelled", "corrected", "voided"]) {
      expect(await constraintOf(ins(type, null)), type).toBe("contract_history_event_reason_required_ck");
    }
    expect(await constraintOf(ins("renewal_created", null))).toBe("contract_history_event_related_ck");
    expect(await sqlState(ins("amendment_created", null))).toBe("23514"); // amendment gated
    expect(await sqlState(ins("returned_to_draft", "Wrong end date before signing"))).toBeUndefined();
  });

  it("the audit allow-list accepts the approved contract fields and still refuses personal fields", async () => {
    const ev = await app.query(
      "INSERT INTO audit_event (actor_user_id, action, outcome, entity_type, request_id) VALUES ($1, 'contract.test', 'success', 'contract', 'req-ctf') RETURNING id",
      [userId],
    );
    const add = (field: string) => app.query("INSERT INTO audit_field_change (audit_event_id, field, old_value, new_value) VALUES ($1, $2, 'a', 'b')", [ev.rows[0].id, field]);
    for (const f of ["contract.contract_type_id", "contract.contract_number", "contract.effective_from", "contract.effective_to", "contract.is_open_ended", "contract.signed_at", "contract.finalized_at"]) {
      expect(await sqlState(add(f)), f).toBeUndefined();
    }
    for (const f of ["contract.summary", "full_name", "work_email"]) expect(await sqlState(add(f)), f).toBe("23514");
  });
});
