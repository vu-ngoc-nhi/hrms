import { beforeAll, describe, expect, it } from "vitest";
import { POST as cancelRoute } from "@/app/api/v1/core-hr/employments/[id]/cancel-planned/route";
import { POST as endRoute } from "@/app/api/v1/core-hr/employments/[id]/end/route";
import { POST as rcRoute } from "@/app/api/v1/core-hr/employments/[id]/relationship-change/route";
import { POST as voidRoute } from "@/app/api/v1/core-hr/employments/[id]/void/route";
import { POST as initialRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { POST as rehireRoute } from "@/app/api/v1/core-hr/employees/[id]/rehire/route";
import { GET as detailRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeListSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key, type TestUser } from "../helpers";

// UI-2 Employee List additions (D-UI-4): Start Date column, Employee Type filter, Record Completeness filter.
// Start Date = start of the representative period of the row (C-76; cancelled/voided periods excluded); never a
// company hire/seniority date. Both filters match the values shown in the row (same rules as the profile).
let ids: Awaited<ReturnType<typeof catalogIds>>;
const today = todayInVietnam();
const PREFIX = "Test UI2";
let n = 0;
const name = (label: string) => {
  n += 1;
  return `${PREFIX} ${label} ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + Math.floor(n / 26))}`;
};

async function hire(label: string, o: { start: string; type?: string; email?: string; assignment?: boolean; manager?: string }) {
  const full = name(label);
  const r = await call(createRoute, {
    path: "/x",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("ui2") },
    body: {
      full_name: full,
      employment: {
        start_date: o.start,
        employee_type_id: o.type ?? ids.et.EMPLOYEE,
        ...(o.email ? { work_email: o.email } : {}),
        ...(o.assignment === false ? {} : { assignment: { department_id: ids.d.ENG, job_title_id: ids.j.SE, ...(o.manager ? { manager_person_id: o.manager } : {}) } }),
      },
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { personId: r.body.id as string, employmentId: r.body.employments[0].id as string, name: full };
}
async function profileOnly(label: string) {
  const full = name(label);
  const r = await call(createRoute, { path: "/x", method: "POST", user: "admin", headers: { "idempotency-key": key("ui2p") }, body: { full_name: full } });
  expect(r.status).toBe(201);
  return { personId: r.body.id as string, name: full };
}
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
const post = async (route: typeof endRoute, id: string, personId: string, body: Record<string, unknown>) =>
  call(route, { path: "/x", method: "POST", user: "admin", params: { id }, body: { expected_revision: await revision(personId), ...body }, headers: { "idempotency-key": key("op") } });
async function list(qs: string, user: TestUser = "editor") {
  const r = await call(listRoute, { path: `/api/v1/core-hr/employees?${qs}`, user });
  return r;
}
async function rowOf(fullName: string) {
  const r = await list(`search=${encodeURIComponent(fullName)}`);
  expect(r.status).toBe(200);
  const parsed = EmployeeListSchema.parse(r.body);
  expect(parsed.data).toHaveLength(1);
  return parsed.data[0];
}

beforeAll(async () => {
  ids = await catalogIds();
});

describe("Start Date column (representative period)", () => {
  it("Active, Pre-start and Ended rows show the start of the period they represent", async () => {
    const active = await hire("Active", { start: "2024-02-05", email: "ui2.active@example.test" });
    expect(await rowOf(active.name)).toMatchObject({ employment_status: "active", start_date: "2024-02-05" });
    const pre = await hire("Prestart", { start: addDays(today, 20), email: "ui2.pre@example.test" });
    expect(await rowOf(pre.name)).toMatchObject({ employment_status: "not_started", start_date: addDays(today, 20) });
    const ended = await hire("Ended", { start: "2022-01-03" });
    expect((await post(endRoute, ended.employmentId, ended.personId, { end_date: "2024-06-30", end_reason_code: "VOLUNTARY_RESIGNATION" })).status).toBe(201);
    expect(await rowOf(ended.name)).toMatchObject({ employment_status: "ended", start_date: "2022-01-03" });
    const none = await profileOnly("NoEmployment");
    expect(await rowOf(none.name)).toMatchObject({ employment_status: "no_employment", start_date: null });
  });

  it("Rehire: the active or upcoming rehire period is represented, never the first hire date", async () => {
    const p = await hire("RehireActive", { start: "2021-03-01" });
    await post(endRoute, p.employmentId, p.personId, { end_date: "2023-02-28", end_reason_code: "MUTUAL_AGREEMENT" });
    expect((await post(rehireRoute, p.personId, p.personId, { start_date: "2025-03-03", employee_type_id: ids.et.EMPLOYEE, reason: "Rehire" })).status).toBe(201);
    expect(await rowOf(p.name)).toMatchObject({ employment_status: "active", start_date: "2025-03-03" });

    const q = await hire("RehirePlanned", { start: "2020-05-04" });
    await post(endRoute, q.employmentId, q.personId, { end_date: "2024-12-31", end_reason_code: "MUTUAL_AGREEMENT" });
    await post(rehireRoute, q.personId, q.personId, { start_date: addDays(today, 40), employee_type_id: ids.et.EMPLOYEE, reason: "Planned rehire" });
    expect(await rowOf(q.name)).toMatchObject({ employment_status: "not_started", start_date: addDays(today, 40) });
  });

  it("an active period keeps representing the row while a later period is planned (Relationship Change)", async () => {
    const p = await hire("RCPlanned", { start: "2025-02-03", type: ids.et.SERVICE_CONTRACTOR });
    expect((await post(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 30), employee_type_id: ids.et.EMPLOYEE, reason: "Conversion" })).status).toBe(201);
    expect(await rowOf(p.name)).toMatchObject({ employment_status: "active", start_date: "2025-02-03", employee_type: { code: "SERVICE_CONTRACTOR" } });
  });

  it("cancelled and voided periods are excluded", async () => {
    const cancelledOnly = await hire("CancelledOnly", { start: addDays(today, 10) });
    expect((await post(cancelRoute, cancelledOnly.employmentId, cancelledOnly.personId, { reason: "Offer declined" })).status).toBe(201);
    expect(await rowOf(cancelledOnly.name)).toMatchObject({ employment_status: "no_employment", start_date: null, employee_type: null });

    const voidedRehire = await hire("VoidedRehire", { start: "2019-09-02" });
    await post(endRoute, voidedRehire.employmentId, voidedRehire.personId, { end_date: "2025-06-30", end_reason_code: "VOLUNTARY_RESIGNATION" });
    const rh = await post(rehireRoute, voidedRehire.personId, voidedRehire.personId, { start_date: today, employee_type_id: ids.et.EMPLOYEE, reason: "Rehire" });
    expect((await post(voidRoute, rh.body.employments[1].id, voidedRehire.personId, { reason: "Wrong person" })).status).toBe(201);
    expect(await rowOf(voidedRehire.name)).toMatchObject({ employment_status: "ended", start_date: "2019-09-02" });

    const voidedOnly = await hire("VoidedOnly", { start: today });
    expect((await post(voidRoute, voidedOnly.employmentId, voidedOnly.personId, { reason: "Wrong person" })).status).toBe(201);
    expect(await rowOf(voidedOnly.name)).toMatchObject({ employment_status: "no_employment", start_date: null });
    // A correct period after the void: the new period is represented.
    expect((await post(initialRoute, voidedOnly.personId, voidedOnly.personId, { start_date: today, employee_type_id: ids.et.INTERN })).status).toBe(201);
    expect(await rowOf(voidedOnly.name)).toMatchObject({ employment_status: "active", start_date: today, employee_type: { code: "INTERN" } });
  });
});

describe("Employee Type filter", () => {
  it("returns only rows whose shown Employee Type matches, for each supported type", async () => {
    const people = {
      EMPLOYEE: await hire("TypeEmp", { start: "2024-03-04", type: ids.et.EMPLOYEE }),
      SERVICE_CONTRACTOR: await hire("TypeSC", { start: "2024-03-04", type: ids.et.SERVICE_CONTRACTOR }),
      INTERN: await hire("TypeIntern", { start: "2024-03-04", type: ids.et.INTERN }),
    };
    for (const [code, p] of Object.entries(people)) {
      const r = await list(`search=${encodeURIComponent(`${PREFIX} Type`)}&employee_type_id=${ids.et[code]}&page_size=100`);
      expect(r.status).toBe(200);
      expect(r.body.data.map((x: { full_name: string }) => x.full_name)).toEqual([p.name]);
      expect(r.body.data[0].employee_type.code).toBe(code);
    }
  });

  it("uses the representative period's type (planned Relationship Change does not count yet)", async () => {
    const p = await hire("TypeRC", { start: "2025-05-05", type: ids.et.SERVICE_CONTRACTOR });
    await post(rcRoute, p.employmentId, p.personId, { start_date: addDays(today, 25), employee_type_id: ids.et.EMPLOYEE, reason: "Conversion" });
    const names = async (type: string) =>
      (await list(`search=${encodeURIComponent(p.name)}&employee_type_id=${ids.et[type]}`)).body.data.map((x: { full_name: string }) => x.full_name);
    expect(await names("SERVICE_CONTRACTOR")).toEqual([p.name]);
    expect(await names("EMPLOYEE")).toEqual([]);
  });

  it("combines with status and department filters; rejects malformed ids; unknown ids match nothing", async () => {
    const active = await hire("ComboActive", { start: "2024-01-08", type: ids.et.INTERN });
    const pre = await hire("ComboPre", { start: addDays(today, 12), type: ids.et.INTERN });
    const q = `search=${encodeURIComponent(`${PREFIX} Combo`)}&employee_type_id=${ids.et.INTERN}`;
    expect((await list(`${q}&employment_status=active`)).body.data.map((x: { full_name: string }) => x.full_name)).toEqual([active.name]);
    expect((await list(`${q}&employment_status=not_started`)).body.data.map((x: { full_name: string }) => x.full_name)).toEqual([pre.name]);
    expect((await list(`${q}&department_id=${ids.d.ENG}`)).body.total).toBe(2);
    expect((await list(`${q}&department_id=${ids.d.QA}`)).body.total).toBe(0);
    const bad = await list("employee_type_id=INTERN");
    expect(bad.status).toBe(400);
    expect((await list(`employee_type_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`)).body).toMatchObject({ total: 0, data: [] });
  });
});

describe("Record Completeness filter (same rule as the profile)", () => {
  it("Complete / Needs Attention follow the authoritative rule; manager absence alone never makes a record incomplete", async () => {
    const complete = await hire("ComplNoManager", { start: "2024-04-01", email: "ui2.complete@example.test" }); // no manager
    const missingEmail = await hire("ComplNoEmail", { start: "2024-04-01" }); // Employee requires a Work Email (C-10)
    const noAssignment = await hire("ComplNoAssign", { start: "2024-04-01", email: "ui2.noassign@example.test", assignment: false });
    const none = await profileOnly("ComplProfileOnly");
    const all = [complete, missingEmail, noAssignment, none];
    const q = `search=${encodeURIComponent(`${PREFIX} Compl`)}&page_size=100`;
    const names = async (status: string) =>
      (await list(`${q}&operational_completeness=${status}`)).body.data.map((x: { full_name: string }) => x.full_name).sort();
    expect(await names("complete")).toEqual([complete.name]);
    expect(await names("incomplete")).toEqual([missingEmail.name, noAssignment.name, none.name].sort());
    // Same value as the profile (detail) for every row.
    for (const p of all) {
      const detail = await call(detailRoute, { path: "/x", user: "editor", params: { id: p.personId } });
      expect((await rowOf(p.name)).operational_completeness, p.name).toBe(detail.body.completeness.operational.status);
    }
    expect((await list("operational_completeness=needs_attention")).status).toBe(400);
  });

  it("combines with other filters and keeps pagination consistent", async () => {
    const a = await hire("PageA", { start: "2024-05-06" });
    const b = await hire("PageB", { start: "2024-05-06" });
    const c = await hire("PageC", { start: "2024-05-06" });
    const q = `search=${encodeURIComponent(`${PREFIX} Page`)}&operational_completeness=incomplete&employment_status=active&employee_type_id=${ids.et.EMPLOYEE}&page_size=2`;
    const p1 = await list(`${q}&page=1`);
    const p2 = await list(`${q}&page=2`);
    expect([p1.body.total, p2.body.total]).toEqual([3, 3]);
    expect([...p1.body.data, ...p2.body.data].map((x: { full_name: string }) => x.full_name)).toEqual([a.name, b.name, c.name].sort());
    expect(p2.body.data).toHaveLength(1);
  });
});
