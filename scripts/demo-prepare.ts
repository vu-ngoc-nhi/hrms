// LOCAL PRODUCT DEMO ONLY — prepares fictional, synthetic demo records in the local hrms_dev database.
// docs/demo/core-hr-phase1-local-demo.md describes the demo. Not staging, not production, never real data.
//
//   npm run demo:prepare               # showcase records DEMO001-DEMO006 + live-action batch 1 (DEMO101-DEMO106)
//   npm run demo:prepare -- --run 2    # a fresh live-action batch for the next demo (DEMO201-DEMO206)
//
// Safety: refuses anything but the local hrms_dev database (loopback host, APP_ENV=local, no production-like variables).
// Non-destructive and idempotent: a record whose employee code already exists is skipped; nothing is deleted or reset.
// Every record is created through the same application services the UI uses (validation, history and audit included),
// acting as the local development HR_ADMIN test account.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { EmployeeDetail } from "../src/contracts/core-hr/schemas";
import { addDays, todayInVietnam } from "../src/lib/dates";
import { db, disconnectDb } from "../src/lib/db";
import { isLoopbackHost, productionCredentialVariables } from "../src/lib/db-safety";
import { createAssignmentChange } from "../src/modules/core-hr/employments/assignment-change";
import { createEndEmployment } from "../src/modules/core-hr/employments/end-employment";
import { createInitialAssignment } from "../src/modules/core-hr/employments/initial-assignment";
import { createRehire } from "../src/modules/core-hr/employments/new-period";
import { createRelationshipChange } from "../src/modules/core-hr/employments/relationship-change";
import { createReverseEnd } from "../src/modules/core-hr/employments/reverse-end";
import { createEmployee } from "../src/modules/core-hr/people/service";
import type { Principal } from "../src/modules/identity/authenticate";
import { isKnownRole, permissionsForRoles, type RoleCode } from "../src/modules/identity/permissions";
import { TEST_TENANT_ID } from "../src/modules/identity/token-verifiers";
import { DEV_USERS } from "./seed-data";

type Ids = { d: Record<string, string>; j: Record<string, string>; l: Record<string, string>; et: Record<string, string> };
type Ctx = { principal: Principal; ids: Ids; today: string; personIdByCode: (code: string) => Promise<string> };
type Detail = EmployeeDetail;
const k = () => randomUUID();
const rid = () => `demo-${randomUUID()}`;

function assertLocalDevDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
  if (!isLoopbackHost(url) || url.pathname !== "/hrms_dev") throw new Error("Refusing: demo preparation runs only against the local hrms_dev database");
  if (process.env.APP_ENV !== "local") throw new Error("Refusing: APP_ENV must be 'local'");
  if (process.env.NODE_ENV === "production" || productionCredentialVariables(process.env).length) throw new Error("Refusing: production-like environment");
}

async function context(): Promise<Ctx> {
  const [{ db: name }] = await db().$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (name !== "hrms_dev") throw new Error(`Refusing: connected to ${name}`);
  const user = await db().appUser.findUniqueOrThrow({
    where: { entraTenantId_entraObjectId: { entraTenantId: TEST_TENANT_ID, entraObjectId: DEV_USERS.admin.oid } },
    include: { roles: true },
  });
  const roles = user.roles.map((r) => r.roleCode).filter(isKnownRole) as RoleCode[];
  if (!user.isEnabled || !roles.includes("HR_ADMIN")) throw new Error("The local 'Test HR Admin' account must be enabled with HR_ADMIN");
  const principal: Principal = {
    userId: user.id,
    displayName: user.displayName,
    tenantId: TEST_TENANT_ID,
    objectId: DEV_USERS.admin.oid,
    issuerKind: "test",
    roles,
    permissions: permissionsForRoles(roles),
  };
  const map = async (rows: Promise<{ id: string; code: string }[]>) => Object.fromEntries((await rows).map((r) => [r.code, r.id]));
  const ids: Ids = {
    d: await map(db().department.findMany()),
    j: await map(db().jobTitle.findMany()),
    l: await map(db().jobLevel.findMany()),
    et: await map(db().employeeType.findMany()),
  };
  const personIdByCode = async (code: string) => (await db().person.findFirstOrThrow({ where: { employeeCode: code } })).id;
  return { principal, ids, today: todayInVietnam(), personIdByCode };
}

const exists = async (code: string) => Boolean(await db().person.findFirst({ where: { employeeCode: { equals: code, mode: "insensitive" } } }));
const latest = (d: Detail) => d.employments.at(-1)!;

type Hire = {
  code: string;
  name: string;
  start: string;
  type: string;
  email?: string;
  dept: string;
  title: string;
  level?: string;
  managerCode?: string;
  personal?: { gender?: "male" | "female" | "other"; date_of_birth?: string; mobile_phone?: string; personal_email?: string };
};

async function hire(ctx: Ctx, h: Hire): Promise<Detail> {
  const r = await createEmployee(
    ctx.principal,
    {
      full_name: h.name,
      employee_code: h.code,
      ...(h.personal ? { personal: h.personal } : {}),
      employment: {
        start_date: h.start,
        employee_type_id: ctx.ids.et[h.type],
        ...(h.email ? { work_email: h.email } : {}),
        assignment: {
          department_id: ctx.ids.d[h.dept],
          job_title_id: ctx.ids.j[h.title],
          ...(h.level ? { job_level_id: ctx.ids.l[h.level] } : {}),
          ...(h.managerCode ? { manager_person_id: await ctx.personIdByCode(h.managerCode) } : {}),
        },
      },
    } as Parameters<typeof createEmployee>[1],
    k(),
    rid(),
  );
  return r.body;
}

async function change(ctx: Ctx, d: Detail, effective: string, values: { dept?: string; title?: string; level?: string; managerCode?: string }, reason: string) {
  return (
    await createAssignmentChange(
      ctx.principal,
      latest(d).id,
      {
        expected_revision: d.revision,
        effective_date: effective,
        reason,
        ...(values.dept ? { department_id: ctx.ids.d[values.dept] } : {}),
        ...(values.title ? { job_title_id: ctx.ids.j[values.title] } : {}),
        ...(values.level ? { job_level_id: ctx.ids.l[values.level] } : {}),
        ...(values.managerCode ? { manager_person_id: await ctx.personIdByCode(values.managerCode) } : {}),
      } as Parameters<typeof createAssignmentChange>[2],
      k(),
      rid(),
    )
  ).body;
}

async function end(ctx: Ctx, d: Detail, date: string, reasonCode: string) {
  return (
    await createEndEmployment(ctx.principal, latest(d).id, { expected_revision: d.revision, end_date: date, end_reason_code: reasonCode } as Parameters<typeof createEndEmployment>[2], k(), rid())
  ).body;
}

async function rehire(ctx: Ctx, d: Detail, start: string, type: string, email: string, a: { dept: string; title: string; level?: string; managerCode?: string }) {
  let r = (
    await createRehire(ctx.principal, d.id, { expected_revision: d.revision, start_date: start, employee_type_id: ctx.ids.et[type], work_email: email, reason: "Returned to EmeSoft (demo data)" } as Parameters<typeof createRehire>[2], k(), rid())
  ).body;
  r = (
    await createInitialAssignment(
      ctx.principal,
      latest(r).id,
      {
        expected_revision: r.revision,
        effective_date: start,
        department_id: ctx.ids.d[a.dept],
        job_title_id: ctx.ids.j[a.title],
        ...(a.level ? { job_level_id: ctx.ids.l[a.level] } : {}),
        ...(a.managerCode ? { manager_person_id: await ctx.personIdByCode(a.managerCode) } : {}),
        reason: "Assignment of the new period (demo data)",
      } as Parameters<typeof createInitialAssignment>[2],
      k(),
      rid(),
    )
  ).body;
  return r;
}

// ---------------- Showcase records (viewed, not changed during the demo; fixed historical dates) ----------------
async function showcase(ctx: Ctx, log: (s: string) => void) {
  const steps: [string, () => Promise<unknown>][] = [
    [
      "DEMO001",
      async () => {
        // Active team lead; manager of several demo employees.
        await hire(ctx, {
          code: "DEMO001", name: "Phan Minh Khoa", start: "2020-03-02", type: "EMPLOYEE", email: "khoa.phan.demo@example.test",
          dept: "ENG", title: "SE", level: "L4",
          personal: { gender: "male", date_of_birth: "1988-05-14", mobile_phone: "0900000101", personal_email: "khoa.phan.home@example.test" },
        });
      },
    ],
    [
      "DEMO002",
      async () => {
        // Active employee with assignment history: QA Junior → QA Middle → move to Engineering under DEMO001.
        let d = await hire(ctx, { code: "DEMO002", name: "Vũ Hồng Nhung", start: "2023-03-06", type: "EMPLOYEE", email: "nhung.vu.demo@example.test", dept: "QA", title: "QAE", level: "L1" });
        d = await change(ctx, d, "2024-07-01", { level: "L2" }, "Annual promotion (demo data)");
        await change(ctx, d, "2026-04-01", { dept: "ENG", title: "SE", managerCode: "DEMO001" }, "Internal transfer to Engineering (demo data)");
      },
    ],
    [
      "DEMO003",
      async () => {
        // Ended employee: left at the end of 2025.
        const d = await hire(ctx, { code: "DEMO003", name: "Hà Mỹ Linh", start: "2022-02-07", type: "EMPLOYEE", email: "linh.ha.demo@example.test", dept: "HRA", title: "HRX", level: "L2" });
        await end(ctx, d, "2025-12-31", "VOLUNTARY_RESIGNATION");
      },
    ],
    [
      "DEMO004",
      async () => {
        // Rehired: first period 2021-2024, returned in 2025 (same person, same Employee Code, new period).
        let d = await hire(ctx, { code: "DEMO004", name: "Tô Gia Bảo", start: "2021-06-01", type: "EMPLOYEE", email: "bao.to.demo@example.test", dept: "QA", title: "QAE", level: "L2" });
        d = await end(ctx, d, "2024-05-31", "MUTUAL_AGREEMENT");
        await rehire(ctx, d, "2025-03-03", "EMPLOYEE", "bao.to.demo2@example.test", { dept: "ENG", title: "SE", level: "L3", managerCode: "DEMO001" });
      },
    ],
    [
      "DEMO005",
      async () => {
        // Relationship Change: Service Contractor → Employee (two periods, history kept).
        const d = await hire(ctx, { code: "DEMO005", name: "Lâm Khánh An", start: "2025-02-03", type: "SERVICE_CONTRACTOR", dept: "ENG", title: "SE", level: "L2" });
        await createRelationshipChange(
          ctx.principal,
          latest(d).id,
          {
            expected_revision: d.revision,
            start_date: "2026-01-05",
            employee_type_id: ctx.ids.et.EMPLOYEE,
            work_email: "an.lam.demo@example.test",
            reason: "Contractor converted to employee (demo data)",
            initial_assignment: { department_id: ctx.ids.d.ENG, job_title_id: ctx.ids.j.SE, job_level_id: ctx.ids.l.L2, manager_person_id: await ctx.personIdByCode("DEMO001") },
          } as Parameters<typeof createRelationshipChange>[2],
          k(),
          rid(),
        );
      },
    ],
    [
      "DEMO006",
      async () => {
        // History with a correction: an End entered by mistake, then reversed (both kept in history).
        const d = await hire(ctx, { code: "DEMO006", name: "Mai Xuân Trường", start: "2024-09-02", type: "EMPLOYEE", email: "truong.mai.demo@example.test", dept: "ENG", title: "SE", level: "L1", managerCode: "DEMO001" });
        const e = await end(ctx, d, "2026-12-31", "VOLUNTARY_RESIGNATION");
        await createReverseEnd(ctx.principal, latest(e).id, { expected_revision: e.revision, reason: "End recorded for the wrong employee (demo data)" } as Parameters<typeof createReverseEnd>[2], k(), rid());
      },
    ],
  ];
  for (const [code, step] of steps) {
    if (await exists(code)) {
      log(`skip  ${code} (exists)`);
      continue;
    }
    await step();
    log(`ready ${code}`);
  }
}

// ---------------- Live-action batch (changed during a demo run; one fresh batch per run) ----------------
async function liveBatch(ctx: Ctx, run: number, log: (s: string) => void) {
  const c = (n: number) => `DEMO${run}0${n}`;
  const mail = (n: number, who: string) => `${who}.demo${run}0${n}@example.test`;
  const t = ctx.today;
  const items: [string, () => Promise<unknown>][] = [
    // Scene 3 — pre-start employee starting in two weeks.
    [c(1), () => hire(ctx, { code: c(1), name: "Đinh Quang Vinh", start: addDays(t, 14), type: "EMPLOYEE", email: mail(1, "vinh.dinh"), dept: "HRA", title: "HRX", level: "L1" })],
    // Scene 4 — active employee whose assignment HR changes live.
    [c(2), () => hire(ctx, { code: c(2), name: "Quách Thảo Vy", start: "2025-09-01", type: "EMPLOYEE", email: mail(2, "vy.quach"), dept: "QA", title: "QAE", level: "L1", managerCode: "DEMO001" })],
    // Scene 5 — active employee who resigns (planned End recorded live).
    [c(3), () => hire(ctx, { code: c(3), name: "Kiều Đức Anh", start: "2024-01-08", type: "EMPLOYEE", email: mail(3, "anh.kieu"), dept: "ENG", title: "SE", level: "L2", managerCode: "DEMO001" })],
    // Scene 6 — former employee who comes back (Rehire done live).
    [
      c(4),
      async () => {
        const d = await hire(ctx, { code: c(4), name: "Lưu Ngọc Hân", start: "2023-04-03", type: "EMPLOYEE", email: mail(4, "han.luu"), dept: "QA", title: "QAE", level: "L2" });
        await end(ctx, d, "2026-06-30", "VOLUNTARY_RESIGNATION");
      },
    ],
    // Scene 7 — service contractor who becomes an employee (Relationship Change done live).
    [c(5), () => hire(ctx, { code: c(5), name: "Trương Bảo Châu", start: "2026-03-02", type: "SERVICE_CONTRACTOR", dept: "ENG", title: "SE", level: "L1" })],
    // Scene 9 — an employment period entered today by mistake (Void done live).
    [c(6), () => hire(ctx, { code: c(6), name: "Đoàn Hữu Phước", start: t, type: "EMPLOYEE", email: mail(6, "phuoc.doan"), dept: "ENG", title: "SE", level: "L1" })],
  ];
  for (const [code, step] of items) {
    if (await exists(code)) {
      log(`skip  ${code} (exists)`);
      continue;
    }
    await step();
    log(`ready ${code}`);
  }
}

async function main() {
  assertLocalDevDatabase();
  const runArg = process.argv.indexOf("--run");
  const run = runArg > 0 ? Number(process.argv[runArg + 1]) : 1;
  if (!Number.isInteger(run) || run < 1 || run > 9) throw new Error("--run must be an integer from 1 to 9");
  const ctx = await context();
  const log = (s: string) => console.log(s);
  console.log(`Local demo data (hrms_dev, business date ${ctx.today}) — showcase + live batch ${run}`);
  await showcase(ctx, log);
  await liveBatch(ctx, run, log);
  console.log("Done. Search 'DEMO' in the Employee List.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
