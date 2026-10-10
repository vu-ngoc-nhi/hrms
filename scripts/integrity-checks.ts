// H4 read-only integrity checks for development/UAT (Phase 1 hardening). Pure SELECTs: the caller runs them inside a
// READ ONLY transaction. Findings carry ids and dates only — never names, emails or other personal values.
// Severity: "error" = a Phase 1 invariant is broken; "warning" = allowed by the rules but worth reviewing in UAT
// (e.g. C-73 manager references, legacy assignment gaps, periods cancelled outside the Cancel Planned action).
// Cancelled and voided periods are history only: operational checks consider valid periods (see VALID).
import type pg from "pg";

export type Finding = { check: string; severity: "error" | "warning"; ids: Record<string, string | null>; detail?: string };

type Check = { check: string; severity: Finding["severity"]; sql: string; detail?: (row: Record<string, unknown>) => string };

// $1 = today (Asia/Ho_Chi_Minh business date), $2 = optional person id filter (uuid[] or NULL).
const PERSON = (alias: string) => `($2::uuid[] IS NULL OR ${alias}.person_id = ANY($2::uuid[]))`;
const ACTIVE_END = `e.event_type = 'end' AND NOT EXISTS (SELECT 1 FROM employment_event r WHERE r.reverses_event_id = e.id)`;
// Operational ("valid") period: neither cancelled (C-29) nor voided (PV-25) — the SQL form of the shared query module.
const VALID = (alias: string) => `(${alias}.cancelled_at IS NULL AND ${alias}.voided_at IS NULL)`;

const CHECKS: Check[] = [
  {
    check: "period_overlap",
    severity: "error",
    sql: `SELECT a.person_id, a.id AS employment_id, b.id AS other_employment_id FROM employment a
          JOIN employment b ON a.person_id = b.person_id AND a.id < b.id
          WHERE ${VALID("a")} AND ${VALID("b")} AND ${PERSON("a")}
            AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]')`,
  },
  {
    check: "period_end_before_start",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id FROM employment p WHERE p.end_date < p.start_date AND ${PERSON("p")}`,
  },
  {
    check: "multiple_current_periods",
    severity: "error",
    sql: `SELECT p.person_id, count(*)::text AS periods FROM employment p
          WHERE ${VALID("p")} AND p.start_date <= $1::date AND (p.end_date IS NULL OR p.end_date >= $1::date) AND ${PERSON("p")}
          GROUP BY p.person_id HAVING count(*) > 1`,
  },
  {
    check: "assignment_overlap",
    severity: "error",
    sql: `SELECT p.person_id, a.employment_id, a.id AS assignment_id, b.id AS other_assignment_id FROM job_assignment a
          JOIN job_assignment b ON a.employment_id = b.employment_id AND a.id < b.id
          JOIN employment p ON p.id = a.employment_id
          WHERE daterange(a.effective_from, a.effective_to, '[)') && daterange(b.effective_from, b.effective_to, '[)') AND ${PERSON("p")}`,
  },
  {
    check: "assignment_outside_period",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, a.id AS assignment_id FROM job_assignment a JOIN employment p ON p.id = a.employment_id
          WHERE (a.effective_from < p.start_date OR (p.end_date IS NOT NULL AND (a.effective_to IS NULL OR a.effective_to > p.end_date + 1)))
            AND ${PERSON("p")}`,
  },
  {
    check: "assignment_gap_after_first",
    severity: "warning",
    sql: `SELECT p.person_id, p.id AS employment_id, x.id AS assignment_id, x.effective_to::text AS ends, x.next_from::text AS next_starts
          FROM (SELECT a.*, lead(a.effective_from) OVER (PARTITION BY a.employment_id ORDER BY a.effective_from) AS next_from FROM job_assignment a) x
          JOIN employment p ON p.id = x.employment_id
          WHERE ${VALID("p")} AND x.next_from IS NOT NULL AND x.effective_to IS DISTINCT FROM x.next_from AND ${PERSON("p")}`,
    detail: (r) => `ends ${r.ends}, next starts ${r.next_starts}`,
  },
  {
    check: "last_assignment_not_aligned_with_period_end",
    severity: "warning",
    sql: `SELECT p.person_id, p.id AS employment_id, x.id AS assignment_id, x.effective_to::text AS ends, p.end_date::text AS period_end
          FROM (SELECT a.*, row_number() OVER (PARTITION BY a.employment_id ORDER BY a.effective_from DESC) AS rn FROM job_assignment a) x
          JOIN employment p ON p.id = x.employment_id
          WHERE x.rn = 1 AND ${VALID("p")} AND ${PERSON("p")}
            AND ((p.end_date IS NULL AND x.effective_to IS NOT NULL) OR (p.end_date IS NOT NULL AND x.effective_to IS DISTINCT FROM p.end_date + 1))`,
    detail: (r) => `last assignment ends ${r.ends}, period ends ${r.period_end ?? "open"}`,
  },
  {
    check: "duplicate_operational_work_email",
    severity: "error",
    sql: `SELECT a.person_id, a.id AS employment_id, b.id AS other_employment_id FROM employment a
          JOIN employment b ON lower(a.work_email) = lower(b.work_email) AND a.id < b.id
          WHERE ${VALID("a")} AND ${VALID("b")} AND ${PERSON("a")}
            AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]')`,
  },
  {
    check: "multiple_active_end_events",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, count(*)::text AS active_end_events FROM employment_event e JOIN employment p ON p.id = e.employment_id
          WHERE ${ACTIVE_END} AND ${PERSON("p")} GROUP BY p.person_id, p.id HAVING count(*) > 1`,
  },
  {
    check: "active_end_event_date_differs_from_period_end",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id, e.effective_date::text AS event_date, p.end_date::text AS period_end
          FROM employment_event e JOIN employment p ON p.id = e.employment_id
          WHERE ${ACTIVE_END} AND e.effective_date IS DISTINCT FROM p.end_date AND ${PERSON("p")}`,
    detail: (r) => `End event ${r.event_date}, period end ${r.period_end ?? "open"}`,
  },
  {
    check: "start_event_date_differs_from_period_start",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id FROM employment_event e JOIN employment p ON p.id = e.employment_id
          WHERE e.event_type = 'start' AND e.effective_date <> p.start_date AND ${PERSON("p")}`,
  },
  {
    check: "end_effect_assignment_of_other_period",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id FROM employment_event e
          JOIN employment p ON p.id = e.employment_id JOIN job_assignment a ON a.id = e.closed_assignment_id
          WHERE a.employment_id <> e.employment_id AND ${PERSON("p")}`,
  },
  {
    check: "invalid_end_reversal_link",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, r.id AS event_id FROM employment_event r
          JOIN employment p ON p.id = r.employment_id LEFT JOIN employment_event t ON t.id = r.reverses_event_id
          WHERE r.event_type = 'end_reversed' AND (t.id IS NULL OR t.event_type <> 'end' OR t.employment_id <> r.employment_id) AND ${PERSON("p")}`,
  },
  {
    check: "cancel_event_on_non_cancelled_period",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id FROM employment_event e JOIN employment p ON p.id = e.employment_id
          WHERE e.event_type = 'cancel_planned_start' AND p.cancelled_at IS NULL AND ${PERSON("p")}`,
  },
  {
    check: "cancelled_period_with_active_end_event",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id FROM employment_event e JOIN employment p ON p.id = e.employment_id
          WHERE ${ACTIVE_END} AND p.cancelled_at IS NOT NULL AND ${PERSON("p")}`,
  },
  {
    check: "cancelled_period_without_cancel_event",
    severity: "warning",
    sql: `SELECT p.person_id, p.id AS employment_id FROM employment p
          WHERE p.cancelled_at IS NOT NULL AND ${PERSON("p")}
            AND NOT EXISTS (SELECT 1 FROM employment_event e WHERE e.employment_id = p.id AND e.event_type = 'cancel_planned_start')`,
  },
  {
    // C-73: current/future assignments whose referenced manager period is not valid on the relevant date.
    check: "manager_not_employed_on_date",
    severity: "warning",
    sql: `SELECT p.person_id, p.id AS employment_id, a.id AS assignment_id, m.id AS manager_employment_id,
                 greatest(a.effective_from, $1::date)::text AS on_date,
                 EXISTS (SELECT 1 FROM employment o WHERE o.person_id = m.person_id AND ${VALID("o")}
                           AND o.start_date <= greatest(a.effective_from, $1::date)
                           AND (o.end_date IS NULL OR o.end_date >= greatest(a.effective_from, $1::date))) AS manager_employed_via_other_period
          FROM job_assignment a JOIN employment p ON p.id = a.employment_id JOIN employment m ON m.id = a.manager_employment_id
          WHERE ${VALID("p")} AND (a.effective_to IS NULL OR a.effective_to > $1::date) AND ${PERSON("p")}
            AND (NOT ${VALID("m")} OR m.start_date > greatest(a.effective_from, $1::date)
                 OR (m.end_date IS NOT NULL AND m.end_date < greatest(a.effective_from, $1::date)))`,
    detail: (r) =>
      `manager period not valid on ${r.on_date}${r.manager_employed_via_other_period ? " (the manager is employed through another period)" : ""}`,
  },
  // ---------------- PV-25 Void Employment Period ----------------
  {
    check: "cancelled_and_voided",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id FROM employment p WHERE p.cancelled_at IS NOT NULL AND p.voided_at IS NOT NULL AND ${PERSON("p")}`,
  },
  {
    check: "voided_period_without_void_event",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id FROM employment p
          WHERE p.voided_at IS NOT NULL AND ${PERSON("p")}
            AND NOT EXISTS (SELECT 1 FROM employment_event e WHERE e.employment_id = p.id AND e.event_type = 'employment_voided')`,
  },
  {
    check: "void_event_on_non_voided_period",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id FROM employment_event e JOIN employment p ON p.id = e.employment_id
          WHERE e.event_type = 'employment_voided' AND p.voided_at IS NULL AND ${PERSON("p")}`,
  },
  {
    check: "void_event_date_differs_from_period_start",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id FROM employment_event e JOIN employment p ON p.id = e.employment_id
          WHERE e.event_type = 'employment_voided' AND e.effective_date <> p.start_date AND ${PERSON("p")}`,
  },
  {
    check: "event_recorded_after_void",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, e.id AS event_id FROM employment_event e
          JOIN employment p ON p.id = e.employment_id
          JOIN employment_event v ON v.employment_id = e.employment_id AND v.event_type = 'employment_voided'
          WHERE e.id <> v.id AND e.recorded_at > v.recorded_at AND ${PERSON("p")}`,
  },
  {
    // Design §4 — same semantics as the Void checker `manager_dependency` (void-dependencies.ts) and the trigger
    // job_assignment_manager_not_voided: the reference is to this exact period id, the dependent period is valid, and
    // [effective_from, effective_to) overlaps [start_date, end_date]. Non-overlapping references are not reported here.
    check: "voided_period_referenced_as_manager",
    severity: "error",
    sql: `SELECT p.person_id, p.id AS employment_id, a.id AS assignment_id, m.id AS manager_employment_id
          FROM job_assignment a JOIN employment p ON p.id = a.employment_id JOIN employment m ON m.id = a.manager_employment_id
          WHERE m.voided_at IS NOT NULL AND p.id <> m.id AND ${VALID("p")} AND ${PERSON("p")}
            AND daterange(a.effective_from, a.effective_to, '[)') && daterange(m.start_date, m.end_date, '[]')`,
  },
];

export async function runIntegrityChecks(client: pg.Client, today: string, personIds: string[] | null = null): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const c of CHECKS) {
    // Pass only the parameters a query uses (Postgres cannot type an unused positional parameter).
    const usesToday = c.sql.includes("$1");
    const sql = usesToday ? c.sql : c.sql.replaceAll("$2", "$1");
    const { rows } = await client.query(sql, usesToday ? [today, personIds] : [personIds]);
    for (const row of rows) {
      const ids: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(row)) if (k.endsWith("_id")) ids[k] = v === null ? null : String(v);
      findings.push({ check: c.check, severity: c.severity, ids, ...(c.detail ? { detail: c.detail(row) } : {}) });
    }
  }
  return findings;
}

export const INTEGRITY_CHECK_NAMES = CHECKS.map((c) => c.check);
