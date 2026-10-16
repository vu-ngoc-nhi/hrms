import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// H7: database guarantees on hrms_test, which globalSetup rebuilt from zero with every committed migration
// (`prisma migrate deploy` under the fail-closed reset guard). Checked as the application role.
let app: pg.Client;
const q = async (sql: string, params: unknown[] = []) => (await app.query(sql, params)).rows;

beforeAll(async () => {
  app = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await app.connect();
});
afterAll(async () => {
  await app.end();
});

describe("Database guarantees (H7)", () => {
  it("every committed migration is applied, finished and not rolled back", async () => {
    const dir = path.join(process.cwd(), "prisma/migrations");
    const folders = readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isDirectory()).sort();
    // Prisma's bookkeeping table is normally not readable by the application role; the quality gate also runs
    // `prisma migrate status` as the owner. When readable, it must list exactly the committed folders.
    const visible = await q("SELECT has_table_privilege(current_user, '_prisma_migrations', 'SELECT') AS can").catch(() => [{ can: false }]);
    if (visible[0].can) {
      const rows = await q("SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name");
      expect(rows.map((r) => r.migration_name)).toEqual(folders);
      expect(rows.every((r) => r.finished_at !== null && r.rolled_back_at === null)).toBe(true);
    }
    // The newest migration's objects exist, which proves the full chain ran.
    expect(await q("SELECT count(*)::int AS n FROM end_reason")).toEqual([{ n: 7 }]);
    expect(await q("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'employment' AND column_name = 'voided_at'")).toEqual([{ n: 1 }]);
    expect(await q("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'job_assignment' AND column_name = 'cancelled_at'")).toEqual([{ n: 1 }]);
    expect(await q("SELECT to_regclass('public.access_audit_event') IS NOT NULL AS ok")).toEqual([{ ok: true }]); // not readable by the app role
    expect(await q("SELECT to_regclass('public.contract_history_event') IS NOT NULL AS ok")).toEqual([{ ok: true }]);
    expect(folders.at(-1)).toBe("20261017000000_contract_renewal_chains");
  });

  it("exclusion, CHECK and partial unique constraints exist (cancelled and voided periods excluded where approved)", async () => {
    const defs = Object.fromEntries(
      (await q("SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'public'::regnamespace")).map((r) => [r.conname, r.def]),
    );
    expect(defs.employment_no_overlap_ex).toContain("WHERE (((cancelled_at IS NULL) AND (voided_at IS NULL)))");
    expect(defs.employment_work_email_period_ex).toContain("cancelled_at IS NULL");
    expect(defs.employment_work_email_period_ex).toContain("voided_at IS NULL");
    expect(defs.employment_single_disposition_ck).toContain("(cancelled_at IS NULL) OR (voided_at IS NULL)");
    expect(defs.employment_event_event_type_check).toContain("employment_voided");
    expect(defs.job_assignment_no_overlap_ex).toContain("EXCLUDE USING gist");
    expect(defs.job_assignment_no_overlap_ex).toContain("WHERE ((cancelled_at IS NULL))"); // PV-29: cancelled planned assignments excluded
    expect(defs.job_assignment_dates_ck).toContain("effective_to > effective_from");
    for (const c of [
      "employment_event_event_type_check",
      "employment_event_end_metadata_ck",
      "employment_event_closed_assignment_ck",
      "employment_event_end_note_ck",
      "employment_event_other_needs_note_ck",
      "employment_event_reversal_link_ck",
      "audit_field_change_differs_ck",
      // Phase 2A contract foundation (ADR-0005)
      "contract_parent_same_period_fk",
      "contract_relationship_pair_ck",
      "contract_term_exclusive_ck",
      "contract_dates_ck",
      "contract_finalized_complete_ck",
      "contract_signed_requires_finalized_ck",
      "contract_single_disposition_ck",
      "contract_void_requires_finalized_ck",
      "contract_history_event_reason_required_ck",
    ]) {
      expect(defs[c], c).toBeDefined();
    }
    expect(defs.contract_relationship_type_check).toContain("'renewal'::text");
    expect(defs.contract_relationship_type_check).not.toContain("amendment"); // gated (C-109)
    const indexes = (await q("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'")).map((r) => r.indexname);
    for (const i of ["employment_event_one_start_uq", "employment_event_one_cancel_uq", "employment_event_one_reversal_uq", "employment_event_one_void_uq"]) expect(indexes).toContain(i);
    const idx = Object.fromEntries((await q("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'")).map((r) => [r.indexname, r.indexdef]));
    // M-18: no disposition is excluded from Contract Number uniqueness (no WHERE clause); ICU case folding.
    expect(idx.contract_number_ci_uq).toContain("UNIQUE INDEX");
    expect(idx.contract_number_ci_uq).toContain("und-x-icu");
    expect(idx.contract_number_ci_uq).not.toContain("WHERE");
    expect(idx.contract_one_nondisposed_renewal_uq).toContain("WHERE");
    expect(idx.contract_one_live_renewal_uq).toBeUndefined();
  });

  it("integrity and immutability triggers exist", async () => {
    const triggers = (await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")).map((r) => r.tgname);
    for (const t of [
      "job_assignment_within_employment_trg",
      "employment_contains_assignments_trg",
      "employment_cancelled_is_terminal_trg",
      "employment_event_date_correction_scope_trg",
      "employment_event_lifecycle_rules_trg",
      "job_assignment_manager_not_voided_trg",
      "job_assignment_cancelled_is_terminal_trg",
      "access_audit_event_no_update_delete_trg",
      "access_audit_event_no_truncate_trg",
      "contract_structural_rules_trg",
      "contract_disposition_is_terminal_trg",
      "contract_voided_parent_read_only_trg",
      "contract_parent_with_renewal_guard_trg",
    ]) {
      expect(triggers, t).toContain(t);
    }
  });

  it("the application role cannot delete HR history, rewrite audit or edit lifecycle events beyond effective_date", async () => {
    const priv = async (table: string, p: string) => (await q("SELECT has_table_privilege($1, $2) AS ok", [table, p]))[0].ok as boolean;
    for (const t of ["person", "employment", "job_assignment", "employment_event", "audit_event", "audit_field_change", "employee_code_registry", "end_reason", "contract_type", "contract", "contract_history_event"]) {
      expect(await priv(t, "DELETE"), `DELETE ${t}`).toBe(false);
    }
    for (const t of ["audit_event", "audit_field_change", "employee_code_registry", "end_reason", "contract_history_event"]) expect(await priv(t, "UPDATE"), `UPDATE ${t}`).toBe(false);
    expect(await priv("employment_event", "UPDATE")).toBe(false); // no table-level UPDATE …
    const cols = await q(
      "SELECT column_name FROM information_schema.column_privileges WHERE table_name = 'employment_event' AND privilege_type = 'UPDATE' AND grantee = current_user",
    );
    expect(cols.map((c) => c.column_name)).toEqual(["effective_date"]); // … only the approved column (C-43, C-53)
    expect(await priv("idempotency_record", "UPDATE")).toBe(false);
    // Access control (C-89, C-93 G): the runtime only reads accounts and roles; access administration data is off-limits.
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(await priv("app_user", p), `app_user ${p}`).toBe(false);
      expect(await priv("app_user_role", p), `app_user_role ${p}`).toBe(false);
    }
    expect(await priv("app_user", "SELECT")).toBe(true);
    for (const t of ["access_audit_event", "access_operator", "access_environment", "access_role_permission"]) expect(await priv(t, "SELECT"), t).toBe(false);
    await expect(app.query("TRUNCATE audit_event")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("ALTER TABLE person ADD COLUMN x int")).rejects.toMatchObject({ code: "42501" });
  });
});
