// UI-10 Organization: pure model over the existing catalog API (unchanged). Fields are exactly those the API has:
// every kind has a code (set once, never editable) and an active flag; Department, Level and Employee Type have a
// name; Job Title has an English name and an optional Vietnamese name; Level has an optional display order; Employee
// Type has `requires_work_email` (drives the operational email rule, PV-03; set at creation only in the UI, D-UI-17).
// There is no delete — values are deactivated.

export const KINDS = ["departments", "job-titles", "job-levels", "employee-types"] as const;
export type Kind = (typeof KINDS)[number];

export type CatalogRow = {
  id: string;
  code: string;
  is_active: boolean;
  name?: string;
  name_en?: string;
  name_vi?: string | null;
  sort_order?: number | null;
  requires_work_email?: boolean;
};

export type CatalogForm = { code: string; name: string; name_vi: string; sort_order: string; requires_work_email: boolean };
export const EMPTY_FORM: CatalogForm = { code: "", name: "", name_vi: "", sort_order: "", requires_work_email: true };

/** What the Organization page may offer, from server capabilities (never role names). */
export const organizationCapabilities = (can: (permission: string) => boolean) => ({ read: can("catalogs.read"), manage: can("catalogs.manage") });

export const kindFromQuery = (query: string): Kind => {
  const v = new URLSearchParams(query).get("tab");
  return (KINDS as readonly string[]).includes(v ?? "") ? (v as Kind) : "departments";
};

export const displayName = (r: CatalogRow) => r.name ?? r.name_en ?? r.code;

export function formFromRow(r: CatalogRow): CatalogForm {
  return {
    code: r.code,
    name: displayName(r),
    name_vi: r.name_vi ?? "",
    sort_order: r.sort_order == null ? "" : String(r.sort_order),
    requires_work_email: r.requires_work_email ?? true,
  };
}

const CODE_RE = /^[A-Za-z0-9._-]{1,30}$/;

/** Request-shape checks mirroring the contract (the server validates again). Message keys from the catalogue. */
export function formErrors(kind: Kind, f: CatalogForm, creating: boolean): Partial<Record<keyof CatalogForm, string>> {
  const e: Partial<Record<keyof CatalogForm, string>> = {};
  if (creating && !CODE_RE.test(f.code.trim())) e.code = "organization.error.code";
  if (!f.name.trim()) e.name = "organization.error.name";
  if (kind === "job-levels" && f.sort_order.trim() !== "") {
    const n = Number(f.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 1000) e.sort_order = "organization.error.sortOrder";
  }
  return e;
}

/** POST body for a new value. */
export function createBody(kind: Kind, f: CatalogForm): Record<string, unknown> {
  const body: Record<string, unknown> = { code: f.code.trim() };
  if (kind === "job-titles") {
    body.name_en = f.name.trim();
    if (f.name_vi.trim()) body.name_vi = f.name_vi.trim();
  } else body.name = f.name.trim();
  if (kind === "job-levels" && f.sort_order.trim() !== "") body.sort_order = Number(f.sort_order);
  if (kind === "employee-types") body.requires_work_email = f.requires_work_email;
  return body;
}

/** PATCH body with only the changed fields (the code is never sent); null when nothing changed. */
export function updateBody(kind: Kind, row: CatalogRow, f: CatalogForm): Record<string, unknown> | null {
  const start = formFromRow(row);
  const body: Record<string, unknown> = {};
  if (f.name.trim() !== start.name) body[kind === "job-titles" ? "name_en" : "name"] = f.name.trim();
  if (kind === "job-titles" && f.name_vi.trim() !== start.name_vi) body.name_vi = f.name_vi.trim() || null;
  if (kind === "job-levels" && f.sort_order.trim() !== start.sort_order) body.sort_order = f.sort_order.trim() === "" ? null : Number(f.sort_order);
  // D-UI-17: the Work Email policy of an existing Employee Type is never changed from the normal edit (it would change
  // Record Health of existing employees); it is set only when the type is created. The API capability stays.
  return Object.keys(body).length ? body : null;
}

/** Deactivate / Reactivate: the only status change; nothing is ever deleted. */
export const statusBody = (row: CatalogRow) => ({ is_active: !row.is_active });

export const counts = (rows: CatalogRow[]) => ({ active: rows.filter((r) => r.is_active).length, inactive: rows.filter((r) => !r.is_active).length });

/**
 * For new-record selectors: only active values (the server rejects inactive ones for new employees, assignment
 * changes and new periods). Historical corrections may still use inactive values (C-44) and existing records keep them.
 */
export const selectableForNewRecords = (rows: CatalogRow[]) => rows.filter((r) => r.is_active);
