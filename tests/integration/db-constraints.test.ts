import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Checks database permissions and constraints directly as the application role hrms_app (bypassing the API).
let app: pg.Client;
let fx: { userId: string; personId: string; deptId: string; posId: string };

beforeAll(async () => {
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
  const u = await app.query("SELECT id FROM app_user ORDER BY display_name LIMIT 1");
  const d = await app.query("SELECT id FROM department WHERE is_active LIMIT 1");
  const p = await app.query("SELECT id FROM job_title LIMIT 1");
  const userId = u.rows[0].id;
  await app.query("BEGIN");
  const person = await app.query(
    "INSERT INTO person (employee_code, full_name, profile_state, created_by) VALUES ('DBT0001', 'Test Constraint Person', 'draft', $1) RETURNING id",
    [userId],
  );
  await app.query("INSERT INTO employee_code_registry (code, person_id, source, issued_by) VALUES ('DBT0001', $1, 'legacy', $2)", [
    person.rows[0].id,
    userId,
  ]);
  await app.query("COMMIT");
  fx = { userId, personId: person.rows[0].id, deptId: d.rows[0].id, posId: p.rows[0].id };
});

afterAll(async () => {
  await app.end();
});

async function expectSqlError(sql: string, params: unknown[], code: string) {
  await app.query("BEGIN");
  try {
    await app.query(sql, params);
    await app.query("COMMIT");
    throw new Error("expected failure");
  } catch (e) {
    await app.query("ROLLBACK").catch(() => undefined);
    expect((e as { code?: string }).code).toBe(code);
  }
}

describe("Database permissions of the application role", () => {
  it("cannot UPDATE/DELETE audit_event", async () => {
    await expectSqlError("UPDATE audit_event SET action = 'x'", [], "42501");
    await expectSqlError("DELETE FROM audit_event", [], "42501");
  });
  it("cannot delete profiles or modify the employee-code registry (codes are never reused)", async () => {
    await expectSqlError("DELETE FROM person WHERE id = $1", [fx.personId], "42501");
    await expectSqlError("UPDATE employee_code_registry SET person_id = person_id", [], "42501");
    await expectSqlError("DELETE FROM employee_code_registry", [], "42501");
  });
  it("has no DDL rights", async () => {
    await expectSqlError("CREATE TABLE x_hack (id int)", [], "42501");
  });
});

describe("Data constraints", () => {
  it("a person must hold a registered code (deferred FK checked at commit)", async () => {
    await expectSqlError(
      "INSERT INTO person (employee_code, full_name, profile_state, created_by) VALUES ('NOREG01', 'Test Unregistered', 'draft', $1)",
      [fx.userId],
      "23503",
    );
  });
  it("one person's employment periods cannot overlap", async () => {
    await app.query("INSERT INTO employment (person_id, start_date, end_date, created_by) VALUES ($1, '2020-01-01', '2020-12-31', $2)", [
      fx.personId,
      fx.userId,
    ]);
    await expectSqlError(
      "INSERT INTO employment (person_id, start_date, created_by) VALUES ($1, '2020-12-31', $2)",
      [fx.personId, fx.userId],
      "23P01",
    );
  });
  it("assignments must stay within the employment period and cannot overlap", async () => {
    const e = await app.query("SELECT id FROM employment WHERE person_id = $1", [fx.personId]);
    const eid = e.rows[0].id;
    await expectSqlError(
      "INSERT INTO job_assignment (employment_id, effective_from, effective_to, department_id, job_title_id, change_reason, created_by) VALUES ($1, '2019-12-01', '2020-02-01', $2, $3, 't', $4)",
      [eid, fx.deptId, fx.posId, fx.userId],
      "23514",
    );
    // Employment ends 2020-12-31 (inclusive) => the assignment must close at 2021-01-01 (exclusive).
    await expectSqlError(
      "INSERT INTO job_assignment (employment_id, effective_from, department_id, job_title_id, change_reason, created_by) VALUES ($1, '2020-01-01', $2, $3, 't', $4)",
      [eid, fx.deptId, fx.posId, fx.userId],
      "23514",
    );
    await app.query(
      "INSERT INTO job_assignment (employment_id, effective_from, effective_to, department_id, job_title_id, change_reason, created_by) VALUES ($1, '2020-01-01', '2021-01-01', $2, $3, 't', $4)",
      [eid, fx.deptId, fx.posId, fx.userId],
    );
    await expectSqlError(
      "INSERT INTO job_assignment (employment_id, effective_from, effective_to, department_id, job_title_id, change_reason, created_by) VALUES ($1, '2020-06-01', '2020-07-01', $2, $3, 't', $4)",
      [eid, fx.deptId, fx.posId, fx.userId],
      "23P01",
    );
  });
  it("an assignment cannot be self-managed", async () => {
    const e = await app.query("SELECT id FROM employment WHERE person_id = $1", [fx.personId]);
    await expectSqlError(
      "UPDATE job_assignment SET manager_employment_id = employment_id WHERE employment_id = $1",
      [e.rows[0].id],
      "23514",
    );
  });
  it("an authorized data correction can fix a period's employee type in place, without a fake new period", async () => {
    const types = await app.query("SELECT id, code FROM employee_type WHERE code IN ('EMPLOYEE', 'SERVICE_CONTRACTOR')");
    const id = (c: string) => types.rows.find((r: { code: string }) => r.code === c).id;
    const e = await app.query("SELECT id FROM employment WHERE person_id = $1", [fx.personId]);
    const before = await app.query("SELECT count(*)::int AS n FROM employment WHERE person_id = $1", [fx.personId]);
    await app.query("UPDATE employment SET employee_type_id = $1 WHERE id = $2", [id("SERVICE_CONTRACTOR"), e.rows[0].id]);
    // Correction of a data-entry mistake: Service Contractor -> Employee on the SAME period (migration 20261009000000).
    await app.query("UPDATE employment SET employee_type_id = $1 WHERE id = $2", [id("EMPLOYEE"), e.rows[0].id]);
    const after = await app.query("SELECT employee_type_id FROM employment WHERE id = $1", [e.rows[0].id]);
    expect(after.rows[0].employee_type_id).toBe(id("EMPLOYEE"));
    expect((await app.query("SELECT count(*)::int AS n FROM employment WHERE person_id = $1", [fx.personId])).rows[0].n).toBe(before.rows[0].n);
    // The value must still reference an existing employee type.
    await expectSqlError(
      "UPDATE employment SET employee_type_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE id = $1",
      [e.rows[0].id],
      "23503",
    );
  });
  it("employee codes differing only by case are rejected", async () => {
    await expectSqlError(
      "INSERT INTO employee_code_registry (code, person_id, source, issued_by) VALUES ('dbt0001', $1, 'legacy', $2)",
      [fx.personId, fx.userId],
      "23505",
    );
  });
});
