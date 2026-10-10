import { beforeAll, describe, expect, it } from "vitest";
import { POST as initialAssignmentRoute } from "@/app/api/v1/core-hr/employments/[id]/initial-assignment/route";
import { POST as initialEmploymentRoute } from "@/app/api/v1/core-hr/employees/[id]/initial-employment/route";
import { GET as detailRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { call, catalogIds, key } from "../helpers";

// C-78 (UAT Round 1, D-UAT-01): operational completeness of a Pre-start period requires an assignment that is ready on
// the Employment Start Date. Department display and filter keep C-76.
let ids: Awaited<ReturnType<typeof catalogIds>>;
const today = todayInVietnam();
const revision = async (personId: string) => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;

async function prestart(name: string, assignmentOffset: number) {
  const p = await call(createRoute, { path: "/x", method: "POST", user: "editor", headers: { "idempotency-key": key("pc") }, body: { full_name: name, personal: { personal_email: "prestart.contact@example.test" } } });
  const e = await call(initialEmploymentRoute, {
    path: "/x",
    method: "POST",
    user: "editor",
    params: { id: p.body.id },
    body: { expected_revision: p.body.revision, start_date: addDays(today, 10), employee_type_id: ids.et.EMPLOYEE },
    headers: { "idempotency-key": key("pce") },
  });
  const a = await call(initialAssignmentRoute, {
    path: "/x",
    method: "POST",
    user: "editor",
    params: { id: e.body.employments[0].id },
    body: { expected_revision: await revision(p.body.id), effective_date: addDays(today, 10 + assignmentOffset), department_id: ids.d.QA, job_title_id: ids.j.QAE },
    headers: { "idempotency-key": key("pca") },
  });
  expect(a.status).toBe(201);
  return p.body.id as string;
}
const items = async (personId: string) =>
  Object.fromEntries(
    (await call(detailRoute, { path: "/x", user: "editor", params: { id: personId } })).body.completeness.operational.items.map((i: { code: string; satisfied: boolean }) => [i.code, i.satisfied]),
  );
const row = async (name: string, qs = "") => (await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent(name)}${qs}`, user: "editor" })).body;

beforeAll(async () => {
  ids = await catalogIds();
});

describe("Pre-start operational completeness (C-78)", () => {
  it("a first assignment starting after the start date leaves the profile incomplete even before the start", async () => {
    const id = await prestart("Test Prestart Late Assignment", 5);
    const it_ = await items(id);
    expect([it_.department, it_.job_title]).toEqual([false, false]);
    const list = await row("Test Prestart Late Assignment");
    expect(list.data[0]).toMatchObject({ employment_status: "not_started", operational_completeness: "incomplete", department: { code: "QA" } });
    expect((await row("Test Prestart Late Assignment", `&department_id=${ids.d.QA}`)).total).toBe(1); // C-76 display/filter unchanged
  });

  it("an assignment ready on the start date satisfies Department and Job Title", async () => {
    const id = await prestart("Test Prestart Ready Assignment", 0);
    const it_ = await items(id);
    expect([it_.department, it_.job_title]).toEqual([true, true]);
    expect((await row("Test Prestart Ready Assignment")).data[0].operational_completeness).toBe("complete");
  });
});
