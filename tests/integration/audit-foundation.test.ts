import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordAudit, type StructuralAuditField } from "@/modules/audit/audit";
import { userId } from "../helpers";

// S4.1 (C-23, C-24): reason + old/new values for approved structural fields only.
let app: pg.Client;
let actor: string;

beforeAll(async () => {
  actor = await userId("admin");
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

async function expectSqlError(sql: string, params: unknown[], code: string) {
  try {
    await app.query(sql, params);
    throw new Error("expected failure");
  } catch (e) {
    expect((e as { code?: string }).code).toBe(code);
  }
}

describe("Minimal audit foundation", () => {
  it("stores a reason and approved structural old/new values in one audit event", async () => {
    const requestId = `req-${randomUUID()}`;
    await recordAudit({
      actorUserId: actor,
      action: "test.structural",
      outcome: "success",
      entityType: "employment",
      entityId: randomUUID(),
      requestId,
      changedFields: ["employee_type_id", "employment.start_date"],
      reason: "  Wrong type entered at onboarding  ",
      structuralChanges: [
        { field: "employee_type_id", oldValue: "a", newValue: "b" },
        { field: "employment.start_date", oldValue: "2026-01-05", newValue: "2026-01-06" },
        { field: "department_id", oldValue: "same", newValue: "same" }, // unchanged: not stored
      ],
    });
    const ev = await db().auditEvent.findFirstOrThrow({ where: { requestId }, include: { fieldChanges: true } });
    expect(ev.reason).toBe("Wrong type entered at onboarding");
    expect(ev.fieldChanges.map((c) => [c.field, c.oldValue, c.newValue]).sort()).toEqual([
      ["employee_type_id", "a", "b"],
      ["employment.start_date", "2026-01-05", "2026-01-06"],
    ]);
  });

  it("keeps reason optional and records personal fields by name only", async () => {
    const requestId = `req-${randomUUID()}`;
    await recordAudit({ actorUserId: actor, action: "test.personal", outcome: "success", entityType: "person", requestId, changedFields: ["personal.mobile_phone"] });
    const ev = await db().auditEvent.findFirstOrThrow({ where: { requestId }, include: { fieldChanges: true } });
    expect(ev.reason).toBeNull();
    expect(ev.fieldChanges).toEqual([]);
  });

  it("refuses unapproved fields in code and in the database", async () => {
    await expect(
      recordAudit({
        actorUserId: actor,
        action: "test.bad",
        outcome: "success",
        entityType: "person",
        requestId: `req-${randomUUID()}`,
        structuralChanges: [{ field: "full_name" as StructuralAuditField, oldValue: "x", newValue: "y" }],
      }),
    ).rejects.toThrow(/not approved/);
    const ev = await app.query(
      "INSERT INTO audit_event (actor_user_id, action, outcome, entity_type, request_id) VALUES ($1, 'test.db', 'success', 'person', $2) RETURNING id",
      [actor, `req-${randomUUID()}`],
    );
    for (const field of ["full_name", "date_of_birth", "personal_email", "work_email", "mobile_phone", "gender", "manager_employment_id"]) {
      await expectSqlError("INSERT INTO audit_field_change (audit_event_id, field, old_value, new_value) VALUES ($1, $2, 'x', 'y')", [ev.rows[0].id, field], "23514");
    }
  });

  it("is append-only for the application role", async () => {
    await expectSqlError("UPDATE audit_field_change SET new_value = 'z'", [], "42501");
    await expectSqlError("DELETE FROM audit_field_change", [], "42501");
    await expectSqlError("UPDATE audit_event SET reason = 'z'", [], "42501");
  });

  it("rolls back together with a failed business write", async () => {
    const requestId = `req-${randomUUID()}`;
    await expect(
      db().$transaction(async (tx) => {
        await recordAudit(
          {
            actorUserId: actor,
            action: "test.rollback",
            outcome: "success",
            entityType: "employment",
            requestId,
            reason: "should not persist",
            structuralChanges: [{ field: "job_title_id", oldValue: "a", newValue: "b" }],
          },
          tx,
        );
        throw new Error("business write failed");
      }),
    ).rejects.toThrow("business write failed");
    expect(await db().auditEvent.count({ where: { requestId } })).toBe(0);
    expect((await app.query("SELECT count(*)::int AS n FROM audit_field_change c JOIN audit_event e ON e.id = c.audit_event_id WHERE e.request_id = $1", [requestId])).rows[0].n).toBe(0);
  });
});
