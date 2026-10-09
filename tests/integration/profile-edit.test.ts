import { beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchRoute } from "@/app/api/v1/core-hr/employees/[id]/route";
import { POST as createRoute } from "@/app/api/v1/core-hr/employees/route";
import { EmployeeUpdatedSchema } from "@/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db } from "@/lib/db";
import { updateEmployeeProfile } from "@/modules/core-hr/people/profile-edit";
import { call, key, principalWith, type TestUser } from "../helpers";

// S4.3: profile edit (Full Name + personal/contact fields), reasons (C-23), audit without personal values (C-24).
const ORIGINAL = {
  full_name: "Nguyễn Thị Mai",
  personal: { gender: "female", date_of_birth: "1993-07-21", mobile_phone: "0900000777", personal_email: "mai.nguyen.contact@example.test" },
};
let personId: string;

async function freshPerson() {
  const r = await call(createRoute, {
    path: "/api/v1/core-hr/employees",
    method: "POST",
    user: "admin",
    headers: { "idempotency-key": key("edit") },
    body: ORIGINAL,
  });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

const patch = (body: unknown, user: TestUser = "editor") =>
  call(patchRoute, { path: "/x", method: "PATCH", user, params: { id: personId }, body });

const revision = async () => (await db().person.findUniqueOrThrow({ where: { id: personId } })).revision;
const audits = () =>
  db().auditEvent.findMany({ where: { entityId: personId, action: "employee.update" }, include: { fieldChanges: true }, orderBy: { id: "asc" } });

beforeEach(async () => {
  personId = await freshPerson();
});

describe("Profile edit", () => {
  it("HR_EDITOR updates phone, contact email and gender without a reason; revision +1; audit names only", async () => {
    const r = await patch({
      expected_revision: 1,
      personal: { gender: "other", mobile_phone: "+84 912 345 678", personal_email: "MAI.NEW@example.test" },
    });
    expect(r.status).toBe(200);
    EmployeeUpdatedSchema.parse(r.body);
    expect(r.body.personal).toMatchObject({ gender: "other", mobile_phone: "+84912345678", personal_email: "mai.new@example.test" });
    expect(r.body.revision).toBe(2);
    const [ev] = await audits();
    expect(ev.changedFields.sort()).toEqual(["personal.gender", "personal.mobile_phone", "personal.personal_email"]);
    expect(ev.reason).toBeNull();
    expect(ev.fieldChanges).toEqual([]);
  });

  it("requires a reason for a Full Name change and records it without storing names", async () => {
    const noReason = await patch({ expected_revision: 1, full_name: "Nguyễn Thị Mai Anh" });
    expect(noReason.status).toBe(422);
    expect(noReason.body.details[0]).toMatchObject({ field: "reason", code: "REASON_REQUIRED" });
    expect(await revision()).toBe(1);
    const ok = await patch({ expected_revision: 1, full_name: "Nguyễn Thị Mai Anh", reason: "Legal name change (synthetic)" });
    expect(ok.status).toBe(200);
    expect(ok.body.full_name).toBe("Nguyễn Thị Mai Anh");
    const [ev] = await audits();
    expect(ev.changedFields).toEqual(["full_name"]);
    expect(ev.reason).toBe("Legal name change (synthetic)");
    const stored = JSON.stringify({ ...ev, id: String(ev.id), fieldChanges: ev.fieldChanges.map((c) => ({ ...c, id: String(c.id), auditEventId: String(c.auditEventId) })) });
    expect(stored).not.toContain("Mai Anh");
    expect(stored).not.toContain("Nguyễn Thị Mai\"");
  });

  it("fills in a missing Date of Birth without a reason (completion of missing data)", async () => {
    const r = await call(createRoute, {
      path: "/api/v1/core-hr/employees",
      method: "POST",
      user: "admin",
      headers: { "idempotency-key": key("dob") },
      body: { full_name: "Đinh Quốc Huy" },
    });
    personId = r.body.id;
    const ok = await patch({ expected_revision: 1, personal: { date_of_birth: "1996-03-04" } });
    expect(ok.status).toBe(200);
    expect(ok.body.personal.date_of_birth).toBe("1996-03-04");
    const [ev] = await audits();
    expect(ev.changedFields).toEqual(["personal.date_of_birth"]);
    expect(ev.reason).toBeNull();
  });

  it("requires a reason for correcting or removing a recorded Date of Birth", async () => {
    expect((await patch({ expected_revision: 1, personal: { date_of_birth: "1993-07-12" } })).status).toBe(422);
    expect((await patch({ expected_revision: 1, personal: { date_of_birth: null } })).status).toBe(422);
    const ok = await patch({ expected_revision: 1, personal: { date_of_birth: "1993-07-12" }, reason: "Typo at onboarding" });
    expect(ok.status).toBe(200);
    expect(ok.body.personal.date_of_birth).toBe("1993-07-12");
    const [ev] = await audits();
    expect(ev.changedFields).toEqual(["personal.date_of_birth"]);
    expect(JSON.stringify({ ...ev, id: String(ev.id) })).not.toContain("1993-07");
  });

  it("returns 409 REVISION_CONFLICT for a stale revision and changes nothing", async () => {
    expect((await patch({ expected_revision: 1, personal: { mobile_phone: "0900000888" } })).status).toBe(200);
    const stale = await patch({ expected_revision: 1, personal: { mobile_phone: "0900000999" } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REVISION_CONFLICT");
    const r = await db().person.findUniqueOrThrow({ where: { id: personId } });
    expect(r.mobilePhone).toBe("0900000888");
    expect(r.revision).toBe(2);
  });

  it("a request with no actual change keeps the revision and writes no audit", async () => {
    const r = await patch({ expected_revision: 1, full_name: "  Nguyễn   Thị Mai ", personal: { gender: "female" } });
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(1);
    expect(await audits()).toEqual([]);
  });

  it("validates fields with the same rules as profile creation", async () => {
    const bad = await patch({
      expected_revision: 1,
      reason: "x",
      personal: { mobile_phone: "12345", date_of_birth: addDays(todayInVietnam(), 1) },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(["personal.mobile_phone", "personal.date_of_birth"]),
    );
    expect((await patch({ expected_revision: 1, full_name: "A", reason: "x" })).status).toBe(422);
    expect((await patch({ expected_revision: 1, personal: { personal_email: "not-an-email" } })).status).toBe(400);
  });

  it("rejects fields that are not editable here (employee code, employment data, work email, profile_state)", async () => {
    for (const extra of [
      { employee_code: "X1" },
      { employment: { start_date: "2025-01-01" } },
      { work_email: "a@example.test" },
      { profile_state: "complete" },
      { personal: { employee_type_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    ]) {
      const r = await patch({ expected_revision: 1, ...extra });
      expect(r.status).toBe(400);
      expect(r.body.details[0].code).toBe("FIELD_NOT_ALLOWED");
    }
    const protectedField = await patch({ expected_revision: 1, personal: { tax_code: "0000000000" } });
    expect(protectedField.status).toBe(422);
    expect(protectedField.body.error).toBe("PROTECTED_FIELD_NOT_ENABLED");
  });

  it("enforces permissions on the server", async () => {
    expect((await patch({ expected_revision: 1, personal: { gender: "male" } }, "docs")).status).toBe(403);
    expect((await patch({ expected_revision: 1, personal: { gender: "male" } }, "noroles")).status).toBe(403);
    expect((await call(patchRoute, { path: "/x", method: "PATCH", params: { id: personId }, body: { expected_revision: 1 } })).status).toBe(401);
    // employees.update without employees.write_personal may change Full Name but not personal fields.
    const nameOnly = await principalWith("editor", ["employees.read", "employees.update"]);
    await expect(updateEmployeeProfile(nameOnly, personId, { expected_revision: 1, personal: { gender: "male" } }, "req-t")).rejects.toMatchObject({
      status: 403,
    });
    expect(await revision()).toBe(1);
  });

  it("returns 404 for an unknown profile", async () => {
    const r = await call(patchRoute, {
      path: "/x",
      method: "PATCH",
      user: "editor",
      params: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      body: { expected_revision: 1, personal: { gender: "male" } },
    });
    expect(r.status).toBe(404);
  });

  it("never stores raw personal values anywhere in audit for this person", async () => {
    await patch({ expected_revision: 1, personal: { mobile_phone: "0911111111", personal_email: "secret.contact@example.test" } });
    await patch({ expected_revision: 2, full_name: "Trần Bảo Châu", reason: "Correction" });
    const text = JSON.stringify(
      (await audits()).map((e) => ({ ...e, id: String(e.id), fieldChanges: e.fieldChanges.map((c) => ({ ...c, id: String(c.id), auditEventId: String(c.auditEventId) })) })),
    );
    for (const v of ["0911111111", "secret.contact", "Trần Bảo Châu", "0900000777", "mai.nguyen.contact"]) expect(text).not.toContain(v);
  });
});
