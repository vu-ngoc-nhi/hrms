import { db, pgErrorInfo, type Tx } from "@/lib/db";
import { ApiError, notFound } from "@/lib/http/errors";
import { normalizeText } from "@/lib/text";
import { recordAudit } from "@/modules/audit/audit";
import type { Principal } from "@/modules/identity/authenticate";

// Catalog values are HR-managed data identified by id/code; the application never depends on their display names.
// contract_type (Phase 2A, C-104) is reference data for contract records; it carries no business rules.
export type CatalogKind = "department" | "job_title" | "job_level" | "employee_type" | "contract_type";
type ListQuery = { page: number; page_size: number; search?: string; include_inactive?: "true" | "false" };
type Row = Record<string, unknown> & { id: string; code: string; isActive: boolean; createdAt: Date; updatedAt: Date };
type CatalogDelegate = {
  findMany(args: unknown): Promise<Row[]>;
  count(args: unknown): Promise<number>;
  findUnique(args: unknown): Promise<Row | null>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
};

function delegate(kind: CatalogKind, client: Tx | ReturnType<typeof db> = db()): CatalogDelegate {
  const map = {
    department: client.department,
    job_title: client.jobTitle,
    job_level: client.jobLevel,
    employee_type: client.employeeType,
    contract_type: client.contractType,
  };
  return map[kind] as unknown as CatalogDelegate;
}

const nameField: Record<CatalogKind, string> = {
  department: "name",
  job_title: "nameEn",
  job_level: "name",
  employee_type: "name",
  contract_type: "name",
};

function toApi(kind: CatalogKind, row: Row) {
  const base = {
    id: row.id,
    code: row.code,
    is_active: row.isActive,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
  if (kind === "job_title") return { ...base, name_en: row.nameEn as string, name_vi: (row.nameVi as string | null) ?? null };
  if (kind === "job_level") return { ...base, name: row.name as string, sort_order: (row.sortOrder as number | null) ?? null };
  if (kind === "employee_type") return { ...base, name: row.name as string, requires_work_email: row.requiresWorkEmail as boolean };
  if (kind === "contract_type") return { ...base, name: row.name as string, name_vi: (row.nameVi as string | null) ?? null };
  return { ...base, name: row.name as string };
}

export async function listCatalog(kind: CatalogKind, q: ListQuery) {
  const where: Record<string, unknown> = {};
  if (q.include_inactive !== "true") where.isActive = true;
  if (q.search) {
    where.OR = [
      { code: { contains: q.search, mode: "insensitive" } },
      { [nameField[kind]]: { contains: q.search, mode: "insensitive" } },
    ];
  }
  const d = delegate(kind);
  const orderBy =
    kind === "job_level" ? [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }] : [{ code: "asc" }, { id: "asc" }];
  const [rows, total] = await Promise.all([
    d.findMany({ where, orderBy, skip: (q.page - 1) * q.page_size, take: q.page_size }),
    d.count({ where }),
  ]);
  return { data: rows.map((r) => toApi(kind, r)), total, page: q.page, page_size: q.page_size };
}

function writeData(kind: CatalogKind, input: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (typeof input.code === "string") data.code = input.code.trim();
  if (typeof input.name === "string") data.name = normalizeText(input.name);
  if (typeof input.name_en === "string") data.nameEn = normalizeText(input.name_en);
  if ((kind === "job_title" || kind === "contract_type") && "name_vi" in input) {
    data.nameVi = typeof input.name_vi === "string" ? normalizeText(input.name_vi) : null;
  }
  if (kind === "job_level" && "sort_order" in input) data.sortOrder = input.sort_order ?? null;
  if (kind === "employee_type" && typeof input.requires_work_email === "boolean") data.requiresWorkEmail = input.requires_work_email;
  if (typeof input.is_active === "boolean") data.isActive = input.is_active;
  return data;
}

export async function createCatalogItem(
  kind: CatalogKind,
  principal: Principal,
  input: Record<string, unknown>,
  requestId: string,
) {
  try {
    const row = await db().$transaction(async (tx) => {
      const created = await delegate(kind, tx).create({ data: writeData(kind, input) });
      await recordAudit(
        {
          actorUserId: principal.userId,
          action: `${kind}.create`,
          outcome: "success",
          entityType: kind,
          entityId: created.id,
          requestId,
          changedFields: Object.keys(input),
        },
        tx,
      );
      return created;
    });
    return toApi(kind, row);
  } catch (e) {
    const info = pgErrorInfo(e);
    if (info.prismaCode === "P2002" || info.sqlState === "23505") {
      throw new ApiError(409, "DUPLICATE_CATALOG_CODE", "A catalog item with this code already exists (case-insensitive).", [
        { field: "code", code: "DUPLICATE", message: "Code already exists." },
      ]);
    }
    throw e;
  }
}

export async function updateCatalogItem(
  kind: CatalogKind,
  principal: Principal,
  id: string,
  input: Record<string, unknown>,
  requestId: string,
) {
  const row = await db().$transaction(async (tx) => {
    const d = delegate(kind, tx);
    if (!(await d.findUnique({ where: { id } }))) throw notFound();
    const updated = await d.update({ where: { id }, data: { ...writeData(kind, input), updatedAt: new Date() } });
    await recordAudit(
      {
        actorUserId: principal.userId,
        action: `${kind}.update`,
        outcome: "success",
        entityType: kind,
        entityId: id,
        requestId,
        changedFields: Object.keys(input),
      },
      tx,
    );
    return updated;
  });
  return toApi(kind, row);
}
