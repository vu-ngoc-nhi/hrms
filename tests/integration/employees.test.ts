import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as getEmployeeRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import {
  EmployeeCreatedSchema,
  EmployeeDetailSchema,
  EmployeeListSchema,
  ErrorResponseSchema,
} from "@/contracts/core-hr/schemas";
import { addDays, toDbDate, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { getEmployee } from "@/modules/core-hr/people/service";
import { call, catalogIds, key, principalWith, userId, type TestUser } from "../helpers";

let ids: Awaited<ReturnType<typeof catalogIds>>;
const today = todayInVietnam();

beforeAll(async () => {
  ids = await catalogIds();
});

async function create(body: unknown, opts: { user?: TestUser; idemKey?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.idemKey !== null) headers["idempotency-key"] = opts.idemKey ?? key();
  return call(createRoute, { path: "/api/v1/core-hr/employees", method: "POST", user: opts.user ?? "editor", body, headers });
}

function assignment(over: Record<string, unknown> = {}) {
  return { department_id: ids.d.ENG, job_title_id: ids.j.SE, job_level_id: ids.l.L2, ...over };
}

function employment(over: Record<string, unknown> = {}) {
  return { start_date: "2025-03-03", employee_type_id: ids.et.EMPLOYEE, assignment: assignment(), ...over };
}

function fullBody(suffix: string, over: Record<string, unknown> = {}) {
  return {
    full_name: `Test Employee ${suffix}`,
    personal: { gender: "male", date_of_birth: "1995-04-12", mobile_phone: "0900 000 123" },
    employment: employment({ work_email: `employee.${suffix.toLowerCase()}@example.test` }),
    ...over,
  };
}

const counts = async () => ({
  person: await db().person.count(),
  registry: await db().employeeCodeRegistry.count(),
  employment: await db().employment.count(),
  assignment: await db().jobAssignment.count(),
  audit: await db().auditEvent.count({ where: { action: "employee.create" } }),
});

describe("Create with a name only", () => {
  it("needs only a full name, auto-assigns a code and creates no placeholder employment", async () => {
    const before = await counts();
    const r = await create({ full_name: "  Test   Name   Only  " });
    expect(r.status).toBe(201);
    EmployeeCreatedSchema.parse(r.body);
    expect(r.body.full_name).toBe("Test Name Only");
    expect(r.body.employee_code).toMatch(/^ES\d{4,}$/);
    expect(r.body.employment_status).toBe("no_employment");
    expect(r.body.completeness.operational.status).toBe("incomplete");
    expect(r.body.employments).toEqual([]);
    expect(await counts()).toEqual({ ...before, person: before.person + 1, registry: before.registry + 1, audit: before.audit + 1 });
  });

  it("keeps Unicode (Vietnamese) names intact after NFC normalization", async () => {
    const r = await create({ full_name: "Nguyễn Thị Thử" });
    expect(r.status).toBe(201);
    expect(r.body.full_name).toBe("Nguyễn Thị Thử");
  });

  it("audits field names only, never values", async () => {
    const r = await create({ full_name: "Test Audit Subject" });
    const ev = await db().auditEvent.findFirstOrThrow({ where: { entityId: r.body.id } });
    expect(ev.changedFields).toEqual(["full_name"]);
    expect(JSON.stringify({ ...ev, id: String(ev.id) })).not.toContain("Audit Subject");
  });
});

describe("Operational profile completeness (MVP rule)", () => {
  it("writes person, employment, start event and assignment atomically; the profile is operationally complete", async () => {
    const r = await create(fullBody("Ca"));
    expect(r.status).toBe(201);
    EmployeeCreatedSchema.parse(r.body);
    expect(r.body.completeness.operational).toMatchObject({ status: "complete", rule_status: "mvp_decision" });
    expect(r.body.completeness.hr.status).toBe("not_defined");
    expect(r.body.completeness.legal.status).toBe("pending_legal_review");
    expect(r.body.employment_status).toBe("active");
    expect(r.body.personal.mobile_phone).toBe("0900000123");
    const [e] = r.body.employments;
    expect(e.employee_type).toMatchObject({ code: "EMPLOYEE" });
    expect(e.assignments[0]).toMatchObject({ effective_from: "2025-03-03", effective_to: null });
    expect(e.assignments[0]).not.toHaveProperty("employee_type");
    expect(await db().employmentEvent.count({ where: { employmentId: e.id, eventType: "start" } })).toBe(1);
  });

  const missingItems = (body: { completeness: { operational: { items: { code: string; satisfied: boolean }[] } } }) =>
    body.completeness.operational.items.filter((i) => !i.satisfied).map((i) => i.code);

  it("DOB, gender, level and personal details do NOT affect operational completeness", async () => {
    const r = await create({
      full_name: "Test Minimal Operational",
      employment: {
        start_date: "2025-01-06",
        employee_type_id: ids.et.EMPLOYEE,
        work_email: "minimal.operational@example.test",
        assignment: { department_id: ids.d.QA, job_title_id: ids.j.QAE },
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.completeness.operational.status).toBe("complete");
  });

  it("a missing employee type keeps the profile incomplete", async () => {
    const r = await create(fullBody("NoType", { employment: employment({ employee_type_id: undefined, work_email: "no.type@example.test" }) }));
    expect(r.status).toBe(201);
    expect(missingItems(r.body)).toEqual(["employee_type"]);
  });

  it("an active Employee without a work email is incomplete even with a contact email (work and contact email are separate)", async () => {
    const r = await create({
      full_name: "Test Active No Work Email",
      personal: { personal_email: "active.contact@example.test" },
      employment: employment(),
    });
    expect(r.status).toBe(201);
    expect(missingItems(r.body)).toEqual(["work_email"]);
  });

  it("a Service Contractor without a company account may use a contact email", async () => {
    const r = await create({
      full_name: "Test Contractor Contact",
      personal: { personal_email: "contractor.contact@example.test" },
      employment: employment({ employee_type_id: ids.et.SERVICE_CONTRACTOR }),
    });
    expect(r.status).toBe(201);
    expect(r.body.completeness.operational.status).toBe("complete");
  });

  it("before the start date a contact email is enough", async () => {
    const r = await create({
      full_name: "Test Pre Start Contact",
      personal: { personal_email: "prestart.contact@example.test" },
      employment: employment({ start_date: addDays(today, 14) }),
    });
    expect(r.status).toBe(201);
    expect(r.body.employment_status).toBe("not_started");
    expect(r.body.completeness.operational.status).toBe("complete");
  });

  it("employee type is part of the employment period, not the assignment", async () => {
    const r = await create(fullBody("TypeOnAssignment", { employment: { start_date: "2025-01-06", assignment: assignment({ employee_type_id: ids.et.EMPLOYEE }) } }));
    expect(r.status).toBe(400);
    expect(r.body.details[0].code).toBe("FIELD_NOT_ALLOWED");
  });

  it("an inactive or unknown employee type is rejected with 422", async () => {
    const r = await create(fullBody("BadType", { employment: employment({ employee_type_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }));
    expect(r.status).toBe(422);
    expect(r.body.details[0].field).toBe("employment.employee_type_id");
  });

  it("require_operational_completeness rejects an incomplete profile with 422 and writes nothing", async () => {
    const before = await counts();
    const r = await create({ full_name: "Test Required Complete", require_operational_completeness: true });
    expect(r.status).toBe(422);
    ErrorResponseSchema.parse(r.body);
    expect(r.body.error).toBe("OPERATIONAL_PROFILE_INCOMPLETE");
    expect(r.body.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(["contact_email", "start_date", "employment_status", "department", "job_title", "employee_type"]),
    );
    expect(await counts()).toEqual(before);
  });

  it("a future start date gives not_started", async () => {
    const r = await create(fullBody("Future", { employment: employment({ start_date: addDays(today, 30), assignment: assignment({ department_id: ids.d.QA }) }) }));
    expect(r.status).toBe(201);
    expect(r.body.employment_status).toBe("not_started");
  });

  it("an inactive department, or a manager not employed on the effective date, is rejected with 422", async () => {
    const r1 = await create(fullBody("Old", { employment: employment({ start_date: "2025-01-02", assignment: assignment({ department_id: ids.d.OLD }) }) }));
    expect(r1.status).toBe(422);
    const notEmployed = await create({ full_name: "Test Manager Not Hired" });
    const r2 = await create(
      fullBody("Mg", { employment: employment({ start_date: "2025-01-02", assignment: assignment({ manager_person_id: notEmployed.body.id }) }) }),
    );
    expect(r2.status).toBe(422);
    expect(r2.body.details[0].code).toBe("MANAGER_NOT_EMPLOYED_ON_DATE");
  });

  it("links a manager who is employed on the effective date", async () => {
    const mgr = await create(fullBody("Lead", { employment: employment({ start_date: "2020-01-02", assignment: assignment({ job_level_id: ids.l.L4 }) }) }));
    const r = await create(fullBody("Report", { employment: employment({ start_date: "2025-05-05", assignment: assignment({ manager_person_id: mgr.body.id }) }) }));
    expect(r.status).toBe(201);
    expect(r.body.employments[0].assignments[0].manager).toMatchObject({ person_id: mgr.body.id, employee_code: mgr.body.employee_code });
  });
});

describe("Input validation and protected fields", () => {
  it("rejects unknown fields (no mass assignment), including the retired profile_state", async () => {
    for (const extra of [{ revision: 9 }, { profile_state: "complete" }]) {
      const r = await create({ full_name: "Test Unknown Field", ...extra });
      expect(r.status).toBe(400);
      expect(r.body.details[0].code).toBe("FIELD_NOT_ALLOWED");
    }
  });
  it("legal ID / tax / bank / dependants are not enabled: 422 PROTECTED_FIELD_NOT_ENABLED", async () => {
    for (const body of [
      { full_name: "Test Protected", identity_number: "000000000000" },
      { full_name: "Test Protected", personal: { tax_code: "0000000000" } },
      { full_name: "Test Protected", bank_account: {} },
      { full_name: "Test Protected", dependents: [] },
    ]) {
      const r = await create(body);
      expect(r.status).toBe(422);
      expect(r.body.error).toBe("PROTECTED_FIELD_NOT_ENABLED");
    }
  });
  it("invalid phone, non-company work email and future date of birth: 422 with field details", async () => {
    const r = await create(
      fullBody("Bad", {
        personal: { gender: "female", date_of_birth: addDays(today, 1), mobile_phone: "12345" },
        employment: employment({ start_date: "2025-01-02", work_email: "someone@gmail.com" }),
      }),
    );
    expect(r.status).toBe(422);
    const fields = r.body.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["personal.mobile_phone", "employment.work_email", "personal.date_of_birth"]));
    expect(r.body.message).toMatch(/^[\x20-\x7E]+$/); // system messages are English (ASCII)
  });
  it("a digit in the name is only a warning; the name is not changed", async () => {
    const r = await create({ full_name: "Test Employee 2" });
    expect(r.status).toBe(201);
    expect(r.body.full_name).toBe("Test Employee 2");
    expect(r.body.warnings[0].code).toBe("NAME_CONTAINS_DIGIT");
  });
});

describe("Employee codes", () => {
  it("HR_ADMIN keeps a legacy code (leading zeros intact); a case-insensitive duplicate is 409; HR_EDITOR cannot set codes", async () => {
    const r = await create({ full_name: "Test Legacy Code", employee_code: "es00123" }, { user: "admin" });
    expect(r.status).toBe(201);
    expect(r.body.employee_code).toBe("es00123");
    const dup = await create({ full_name: "Test Other Person", employee_code: "ES00123" }, { user: "admin" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("DUPLICATE_EMPLOYEE_CODE");
    expect((await create({ full_name: "Test Other Person", employee_code: "LEG01" })).status).toBe(403);
  });

  it("auto-issued codes skip a number already registered as a legacy code", async () => {
    // The application role cannot read sequences; read it with the owner role (tests only).
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    const { rows } = await owner.query("SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS n FROM employee_code_seq");
    await owner.end();
    const next = `ES${String(rows[0].n).padStart(4, "0")}`;
    expect((await create({ full_name: "Test Legacy Blocks Next", employee_code: next }, { user: "admin" })).status).toBe(201);
    const auto = await create({ full_name: "Test Auto Code" });
    expect(auto.status).toBe(201);
    expect(auto.body.employee_code.toLowerCase()).not.toBe(next.toLowerCase());
  });

  it("10 concurrent creates receive 10 distinct codes", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => create({ full_name: `Test Concurrent ${"ABCDEFGHIJ"[i]}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.employee_code)).size).toBe(10);
  });
});

describe("Idempotency", () => {
  it("a missing Idempotency-Key is 400", async () => {
    const r = await create({ full_name: "Test No Key" }, { idemKey: null });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("the same key and payload returns the same profile without a second person or audit", async () => {
    const k = key("retry");
    const body = { full_name: "Test Retry" };
    const first = await create(body, { idemKey: k });
    const before = await counts();
    const second = await create(body, { idemKey: k });
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.body.id).toBe(first.body.id);
    expect(await counts()).toEqual(before);
  });

  it("the same key with a different payload is 409 and writes nothing", async () => {
    const k = key("reuse");
    await create({ full_name: "Test Key Reuse A" }, { idemKey: k });
    const before = await counts();
    const r = await create({ full_name: "Test Key Reuse B" }, { idemKey: k });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await counts()).toEqual(before);
  });

  it("5 concurrent requests with the same key create exactly 1 profile and 1 audit event", async () => {
    const k = key("race");
    const before = await counts();
    const results = await Promise.all(Array.from({ length: 5 }, () => create({ full_name: "Test Same Key Race" }, { idemKey: k })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    const after = await counts();
    expect(after.person).toBe(before.person + 1);
    expect(after.audit).toBe(before.audit + 1);
  });

  it("keys are scoped per caller", async () => {
    const k = key("scope");
    const a = await create({ full_name: "Test Key Scope" }, { idemKey: k, user: "editor" });
    const b = await create({ full_name: "Test Key Scope" }, { idemKey: k, user: "admin" });
    expect(a.body.id).not.toBe(b.body.id);
  });

  it("a replay re-checks current permissions: after the role is revoked it is 403", async () => {
    const k = key("revoke");
    const body = { full_name: "Test Revoked Replay" };
    expect((await create(body, { idemKey: k })).status).toBe(201);
    const uid = await userId("editor");
    await db().appUserRole.delete({ where: { userId_roleCode: { userId: uid, roleCode: "HR_EDITOR" } } });
    try {
      expect((await create(body, { idemKey: k })).status).toBe(403);
    } finally {
      await db().appUserRole.create({ data: { userId: uid, roleCode: "HR_EDITOR" } });
    }
  });
});

describe("Atomicity when a child write fails", () => {
  it("a work email assigned to someone else (including a future end date) is 409 and leaves no person, code or audit", async () => {
    const holder = await create(fullBody("Holder"));
    await db().$transaction([
      db().employment.update({ where: { id: holder.body.employments[0].id }, data: { endDate: toDbDate(addDays(today, 60)) } }),
      db().jobAssignment.updateMany({
        where: { employmentId: holder.body.employments[0].id },
        data: { effectiveTo: toDbDate(addDays(today, 61)) },
      }),
    ]);
    const before = await counts();
    const r = await create(
      fullBody("Clash", { employment: employment({ start_date: today, work_email: "EMPLOYEE.HOLDER@example.test" }) }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("WORK_EMAIL_IN_USE");
    expect(await counts()).toEqual(before);
  });

  it("the email can be reused after the previous assignment period ends", async () => {
    const r = await create(
      fullBody("After", { employment: employment({ start_date: addDays(today, 62), work_email: "employee.holder@example.test" }) }),
    );
    expect(r.status).toBe(201);
  });
});

describe("Detail and field-level permissions", () => {
  it("without employees.read_personal the JSON has no personal key (not null), and nothing personal leaks", async () => {
    const created = await create(fullBody("FieldLevel"));
    const directoryOnly = await principalWith("editor", ["employees.read"]);
    const d = await getEmployee(directoryOnly, created.body.id);
    EmployeeDetailSchema.parse(d);
    expect(d).not.toHaveProperty("personal");
    expect(JSON.stringify(d)).not.toContain("1995-04-12");
    expect(JSON.stringify(d)).not.toContain("0900000123");
    expect(d.restricted_field_groups).toEqual(["personal", "sensitive"]);
  });
  it("HR_EDITOR receives the personal group; the sensitive group is always restricted", async () => {
    const created = await create(fullBody("FieldLevel2"));
    const r = await call(getEmployeeRoute, { path: "/x", user: "editor", params: { id: created.body.id } });
    expect(r.status).toBe(200);
    EmployeeDetailSchema.parse(r.body);
    expect(r.body.personal.date_of_birth).toBe("1995-04-12");
    expect(r.body.restricted_field_groups).toEqual(["sensitive"]);
  });
  it("404 when missing, 400 when the id is not a UUID", async () => {
    expect((await call(getEmployeeRoute, { path: "/x", user: "editor", params: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } })).status).toBe(404);
    expect((await call(getEmployeeRoute, { path: "/x", user: "editor", params: { id: "123" } })).status).toBe(400);
  });
});

describe("List", () => {
  it("uses standard paging; page_size max 100", async () => {
    const r = await call(listRoute, { path: "/api/v1/core-hr/employees?page=1&page_size=5", user: "editor" });
    expect(r.status).toBe(200);
    EmployeeListSchema.parse(r.body);
    expect(r.body.data.length).toBeLessThanOrEqual(5);
    expect(r.body).toMatchObject({ page: 1, page_size: 5 });
    for (const qs of ["page_size=101", "page=0", "foo=1", "profile_state=draft"]) {
      expect((await call(listRoute, { path: `/api/v1/core-hr/employees?${qs}`, user: "editor" })).status).toBe(400);
    }
  });
  it("has a stable order by code and pages do not overlap", async () => {
    const all = await call(listRoute, { path: "/api/v1/core-hr/employees?page_size=100", user: "editor" });
    const codes = all.body.data.map((x: { employee_code: string }) => x.employee_code);
    const p1 = await call(listRoute, { path: "/api/v1/core-hr/employees?page=1&page_size=7", user: "editor" });
    const p2 = await call(listRoute, { path: "/api/v1/core-hr/employees?page=2&page_size=7", user: "editor" });
    expect([...p1.body.data, ...p2.body.data].map((x: { employee_code: string }) => x.employee_code)).toEqual(codes.slice(0, 14));
    expect(all.body.total).toBe(await db().person.count());
  });
  it("filters by employment status, department and search text; reports operational completeness", async () => {
    const ns = await call(listRoute, { path: "/api/v1/core-hr/employees?employment_status=not_started&page_size=100", user: "editor" });
    expect(ns.body.data.length).toBeGreaterThan(0);
    expect(ns.body.data.every((x: { employment_status: string }) => x.employment_status === "not_started")).toBe(true);
    const qa = await call(listRoute, { path: `/api/v1/core-hr/employees?department_id=${ids.d.QA}&page_size=100`, user: "editor" });
    expect(qa.body.data.length).toBeGreaterThan(0);
    expect(qa.body.data.every((x: { department: { code: string } }) => x.department.code === "QA")).toBe(true);
    const s = await call(listRoute, { path: `/api/v1/core-hr/employees?search=${encodeURIComponent("test retry")}`, user: "editor" });
    expect(s.body.data.map((x: { full_name: string }) => x.full_name)).toContain("Test Retry");
    const all = await call(listRoute, { path: "/api/v1/core-hr/employees?page_size=100", user: "editor" });
    const states = new Set(all.body.data.map((x: { operational_completeness: string }) => x.operational_completeness));
    expect(states).toEqual(new Set(["complete", "incomplete"]));
  });
  it("the list never contains the personal group", async () => {
    const text = JSON.stringify((await call(listRoute, { path: "/api/v1/core-hr/employees?page_size=100", user: "editor" })).body);
    expect(text).not.toContain("date_of_birth");
    expect(text).not.toContain("mobile_phone");
  });
});
