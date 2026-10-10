import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as cancelRoute } from "@/app/api/v1/core-hr/employments/[id]/cancel-planned/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as initialAssignmentRoute } from "@/app/api/v1/core-hr/employments/[id]/initial-assignment/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as reverseRoute } from "@/app/api/v1/core-hr/employments/[id]/reverse-end/route";
import { POST as voidRoute } from "@/app/api/v1/core-hr/employments/[id]/void/route";
import { POST as initialEmploymentRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { GET as detailRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeDetailSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, type TestUser } from "../helpers";

// Core HR Phase 1 — UAT Round 2 (focused re-test of the Round 1 resolutions). Synthetic data only, fresh hrms_test.
// No business rule is changed; evidence is written for docs/uat/phase1-uat-round2-results.md.
let ids: Awaited<ReturnType<typeof catalogIds>>;
const today = todayInVietnam();
const evidence: Record<string, unknown> = {};
type Route = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
async function send(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser) {
  return call(route, { path: "/x", method: "POST", user, params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("r2") } });
}
async function ok(route: Route, id: string, personId: string, body: Record<string, unknown>, user: TestUser) {
  const r = await send(route, id, personId, body, user);
  expect([200, 201], `${r.status} ${JSON.stringify(r.body)}`).toContain(r.status);
  return EmployeeDetailSchema.parse(r.body);
}
async function person(name: string, body: Record<string, unknown> = {}) {
  const r = await call(createRoute, { path: "/x", method: "POST", user: "editor", headers: { "idempotency-key": key("r2p") }, body: { full_name: name, ...body } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function hired(name: string, start: string, type: string, email?: string) {
  const id = await person(name);
  const d = await ok(initialEmploymentRoute, id, id, { start_date: start, employee_type_id: type, ...(email ? { work_email: email } : {}), ...(start < today ? { reason: "UAT R2 data" } : {}) }, "admin");
  const employmentId = d.employments[0].id;
  await ok(initialAssignmentRoute, employmentId, id, { effective_date: start, department_id: ids.d.ENG, job_title_id: ids.j.SE, ...(start < today ? { reason: "UAT R2 data" } : {}) }, "admin");
  return { personId: id, employmentId };
}
const detail = async (id: string) => EmployeeDetailSchema.parse((await call(detailRoute, { path: "/x", user: "editor", params: { id } })).body);

beforeAll(async () => {
  ids = await catalogIds();
});
afterAll(() => {
  if (process.env.UAT_EVIDENCE_FILE) writeFileSync(process.env.UAT_EVIDENCE_FILE, JSON.stringify(evidence, null, 2));
});

describe("UAT Round 2", () => {
  it("R2-01 pre-start: first assignment after the start date keeps Department / Job Title readiness incomplete", async () => {
    const d1 = addDays(today, 10);
    const d2 = addDays(today, 15);
    const id = await person("UAT R2 PreStart", { personal: { personal_email: "uat.r2.prestart@example.test" } });
    const e = await ok(initialEmploymentRoute, id, id, { start_date: d1, employee_type_id: ids.et.EMPLOYEE }, "editor");
    await ok(initialAssignmentRoute, e.employments[0].id, id, { effective_date: d2, department_id: ids.d.QA, job_title_id: ids.j.QAE }, "editor");
    const det = await detail(id);
    const items = Object.fromEntries(det.completeness.operational.items.map((i) => [i.code, i.satisfied]));
    const list = (await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent("UAT R2 PreStart")}`, user: "editor" })).body;
    const filtered = (await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent("UAT R2 PreStart")}&department_id=${ids.d.QA}`, user: "editor" })).body;
    evidence["R2-01"] = {
      D1: d1,
      D2: d2,
      status: det.employment_status,
      completeness: det.completeness.operational.status,
      department_item: items.department,
      job_title_item: items.job_title,
      list_department: list.data[0].department?.code,
      list_completeness: list.data[0].operational_completeness,
      qa_filter_total: filtered.total,
    };
    expect([det.employment_status, det.completeness.operational.status, items.department, items.job_title]).toEqual(["not_started", "incomplete", false, false]);
    expect([list.data[0].department?.code, list.data[0].operational_completeness, filtered.total]).toEqual(["QA", "incomplete", 1]);
  });

  it("R2-02 gap after a recorded End guides to Rehire; a continuous start guides to Reverse End then Relationship Change", async () => {
    const p = await hired("UAT R2 Gap Guidance", "2023-01-02", ids.et.SERVICE_CONTRACTOR);
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 20), end_reason_code: "PLANNED_TERM_COMPLETED" }, "editor");
    const gap = await send(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 45), employee_type_id: ids.et.EMPLOYEE, reason: "x" }, "editor");
    const next = await send(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 21), employee_type_id: ids.et.EMPLOYEE, reason: "x" }, "editor");
    evidence["R2-02"] = {
      gap: { status: gap.status, error: gap.body.error, code: gap.body.details[0].code, message: gap.body.details[0].message },
      continuous: { status: next.status, error: next.body.error, code: next.body.details[0].code, message: next.body.details[0].message },
    };
    expect([gap.status, gap.body.error, gap.body.details[0].code]).toEqual([422, "BUSINESS_RULE_VIOLATION", "ACTIVE_END_EVENT_EXISTS"]);
    expect(gap.body.details[0].message).toContain("use Rehire");
    expect(gap.body.details[0].message).not.toContain("Reverse End");
    expect(gap.body.details[0].message).not.toMatch(/\d{4}-\d{2}-\d{2}/); // F-2: human-readable date
    expect([next.status, next.body.details[0].code]).toEqual([422, "ACTIVE_END_EVENT_EXISTS"]);
    expect(next.body.details[0].message).toContain("Reverse End Employment first, then Relationship Change");
    expect(await db().employmentEvent.count({ where: { employmentId: p.employmentId, eventType: "end" } })).toBe(1);
  });

  it("R2-03 Start → End #1 → Reverse End #1 → End #2: pairing, reasons, hidden free text, deterministic order", async () => {
    const p = await hired("UAT R2 History", "2023-01-02", ids.et.EMPLOYEE);
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 15), end_reason_code: "VOLUNTARY_RESIGNATION", note: "UAT R2 secret note" }, "editor");
    await ok(reverseRoute, p.employmentId, p.personId, { reason: "UAT R2 secret reversal" }, "admin");
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 40), end_reason_code: "MUTUAL_AGREEMENT" }, "editor");
    const a = await detail(p.personId);
    const b = await detail(p.personId);
    const ev = a.employments[0].events;
    const end1 = ev.find((e) => e.event_type === "end" && e.end_reason?.code === "VOLUNTARY_RESIGNATION")!;
    const end2 = ev.find((e) => e.event_type === "end" && e.end_reason?.code === "MUTUAL_AGREEMENT")!;
    const rev = ev.find((e) => e.event_type === "end_reversed")!;
    evidence["R2-03"] = {
      order: ev.map((e) => `${e.event_type}@${e.effective_date}${e.end_reason ? `(${e.end_reason.code})` : ""}`),
      reversal_links_to_end1: rev.reverses_event_id === end1.id,
      end1_reversed: ev.some((e) => e.reverses_event_id === end1.id),
      end2_reversed: ev.some((e) => e.reverses_event_id === end2.id),
      has_active_end_event: a.employments[0].has_active_end_event,
      active_end_reason: a.employments[0].active_end_event?.end_reason?.code,
      free_text_exposed: JSON.stringify(a).includes("UAT R2 secret"),
      deterministic: JSON.stringify(a.employments[0].events) === JSON.stringify(b.employments[0].events),
    };
    expect(evidence["R2-03"]).toMatchObject({
      reversal_links_to_end1: true,
      end1_reversed: true,
      end2_reversed: false,
      has_active_end_event: true,
      active_end_reason: "MUTUAL_AGREEMENT",
      free_text_exposed: false,
      deterministic: true,
    });
    expect(ev.map((e) => e.event_type)).toEqual(["start", "end", "end_reversed", "end"]);
  });

  it("R2-05 planned Rehire before a future end: nothing copied", async () => {
    const p = await hired("UAT R2 Planned Rehire", "2023-01-02", ids.et.EMPLOYEE, "uat.r2.planned@example.test");
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, 20), end_reason_code: "PLANNED_TERM_COMPLETED" }, "editor");
    const d = await ok(rehireRoute, p.personId, p.personId, { start_date: addDays(today, 21), employee_type_id: ids.et.EMPLOYEE, reason: "Planned return" }, "editor");
    evidence["R2-05"] = { new_work_email: d.employments[1].work_email, new_assignments: d.employments[1].assignments.length, new_status: d.employments[1].period_lifecycle, old_status: d.employments[0].period_lifecycle };
    expect(evidence["R2-05"]).toEqual({ new_work_email: null, new_assignments: 0, new_status: "not_started", old_status: "active" });
  });

  // Round 2 recorded R2-07 as a KNOWN LIMITATION (no way to remove a mistaken effective period). PV-25 (2026-10-10)
  // resolves it with Void Employment Period: Cancel Planned still refuses effective periods and nothing is deleted, but
  // HR_ADMIN can now void the mistaken period (HR_EDITOR cannot).
  it("R2-07 period effective today entered by mistake: Cancel Planned refuses, no Reverse Rehire, no DELETE — resolved by Void (PV-25)", async () => {
    const id = await person("UAT R2 SameDay");
    const d = await ok(initialEmploymentRoute, id, id, { start_date: today, employee_type_id: ids.et.EMPLOYEE }, "editor");
    const c = await send(cancelRoute, d.employments[0].id, id, { reason: "Entered for the wrong person" }, "editor");
    const p = await hired("UAT R2 SameDay Rehire Base", "2022-01-03", ids.et.EMPLOYEE);
    await ok(endRoute, p.employmentId, p.personId, { end_date: addDays(today, -10), end_reason_code: "VOLUNTARY_RESIGNATION" }, "admin");
    const rh = await ok(rehireRoute, p.personId, p.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, reason: "Return" }, "editor");
    const c2 = await send(cancelRoute, rh.employments[1].id, p.personId, { reason: "Wrong person" }, "editor");
    const routeDirs = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? [path.join(dir, n), ...routeDirs(path.join(dir, n))] : []));
    const all = routeDirs(path.join(process.cwd(), "src/app/api")).map((d) => path.relative(process.cwd(), d));
    const deleteHandlers = all.filter((d) => existsSync(path.join(d, "route.ts")) && /export const DELETE|export async function DELETE/.test(readFileSync(path.join(d, "route.ts"), "utf8")));
    const editorVoid = await send(voidRoute, d.employments[0].id, id, { reason: "Entered for the wrong person" }, "editor");
    const v1 = await send(voidRoute, d.employments[0].id, id, { reason: "Entered for the wrong person" }, "admin");
    const v2 = await send(voidRoute, rh.employments[1].id, p.personId, { reason: "Wrong person" }, "admin");
    evidence["R2-07"] = {
      initial_today_cancel: { status: c.status, code: c.body.details?.[0]?.code },
      rehire_today_cancel: { status: c2.status, code: c2.body.details?.[0]?.code },
      reverse_rehire_routes: all.filter((d) => /reverse-rehire/i.test(d)),
      delete_handlers: deleteHandlers,
      void_by_hr_editor: editorVoid.status,
      void_initial_today: { status: v1.status, employment_status: v1.body.employment_status },
      void_rehire_today: { status: v2.status, employment_status: v2.body.employment_status },
    };
    expect([c.status, c.body.details[0].code, c2.status, c2.body.details[0].code]).toEqual([422, "PERIOD_ALREADY_STARTED", 422, "PERIOD_ALREADY_STARTED"]);
    expect(evidence["R2-07"]).toMatchObject({
      reverse_rehire_routes: [],
      delete_handlers: [],
      void_by_hr_editor: 403,
      void_initial_today: { status: 201, employment_status: "no_employment" },
      void_rehire_today: { status: 201, employment_status: "ended" },
    });
  });
});
