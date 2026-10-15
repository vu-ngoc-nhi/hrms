"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import {
  EMPTY_FORM,
  KINDS,
  counts,
  createBody,
  displayName,
  formErrors,
  formFromRow,
  hasNameVi,
  kindFromQuery,
  organizationCapabilities,
  statusBody,
  updateBody,
  type CatalogForm,
  type CatalogRow,
  type Kind,
} from "./organizationModel";

// UI-10 Organization: the reference data used in employee records (Departments, Job Titles, Levels, Employee Types)
// and, since Phase 2A (C-104), Contract Types for contract records, over the catalog API (route stays /catalogs). Values are deactivated, never deleted; mutation controls
// appear only with catalogs.manage.

type Dialog = { mode: "create" } | { mode: "edit"; row: CatalogRow } | { mode: "deactivate"; row: CatalogRow };

function CatalogDialog({
  kind,
  dialog,
  onClose,
  onDone,
}: {
  kind: Kind;
  dialog: Exclude<Dialog, { mode: "deactivate" }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const creating = dialog.mode === "create";
  const [form, setForm] = useState<CatalogForm>(creating ? EMPTY_FORM : formFromRow(dialog.row));
  const [errors, setErrors] = useState<Partial<Record<keyof CatalogForm, string>>>({});
  const [error, setError] = useState<ApiCallError | null>(null);
  const [busy, setBusy] = useState(false);
  const body = creating ? createBody(kind, form) : updateBody(kind, dialog.row, form);
  const set = (k: keyof CatalogForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found = formErrors(kind, form, creating);
    setErrors(Object.fromEntries(Object.entries(found).map(([k, key]) => [k, t(key as Parameters<typeof t>[0])])));
    if (Object.keys(found).length || !body) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) await api(`/api/v1/core-hr/${kind}`, { method: "POST", body: JSON.stringify(body) });
      else await api(`/api/v1/core-hr/${kind}/${dialog.row.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onDone(t(creating ? "organization.created" : "organization.saved"));
    } catch (err) {
      const e2 = err as ApiCallError;
      // A duplicate code is shown on the Code field in plain words.
      if (e2.body?.error === "DUPLICATE_CATALOG_CODE") setErrors({ code: t("organization.error.duplicateCode") });
      else setError(e2);
    } finally {
      setBusy(false);
    }
  }

  const title = t(`organization.${creating ? "addTitle" : "editTitle"}.${kind}`);
  return (
    <Modal title={title} description={creating ? undefined : `${t("organization.code")}: ${dialog.row.code}`} onClose={onClose} busy={busy}>
      <form onSubmit={save} className="organization-form" noValidate>
        {creating && (
          <Field label={t("organization.code")} required hint={t("organization.codeHint")} error={errors.code}>
            {(c) => <input {...c} value={form.code} onChange={set("code")} maxLength={30} autoComplete="off" />}
          </Field>
        )}
        <Field label={t(`organization.nameLabel.${kind}`)} required error={errors.name}>
          {(c) => <input {...c} value={form.name} onChange={set("name")} maxLength={150} autoComplete="off" />}
        </Field>
        {hasNameVi(kind) && (
          <Field label={t("organization.nameVi")} hint={t("organization.nameViHint")}>
            {(c) => <input {...c} value={form.name_vi} onChange={set("name_vi")} maxLength={150} autoComplete="off" />}
          </Field>
        )}
        {kind === "job-levels" && (
          <Field label={t("organization.sortOrder")} hint={t("organization.sortOrderHint")} error={errors.sort_order}>
            {(c) => <input {...c} type="number" min={0} max={1000} value={form.sort_order} onChange={set("sort_order")} />}
          </Field>
        )}
        {kind === "employee-types" &&
          (creating ? (
            <div className="field">
              <label className="checkbox-field">
                <input type="checkbox" checked={form.requires_work_email} onChange={set("requires_work_email")} />
                <span>{t("organization.workEmailExpected")}</span>
              </label>
              <span className="field-hint">{t("organization.workEmailExpectedHint")}</span>
            </div>
          ) : (
            // D-UI-17: policy-affecting, shown read-only after creation.
            <dl className="info-grid organization-policy">
              <div>
                <dt>{t("organization.workEmailExpected")}</dt>
                <dd>{dialog.row.requires_work_email ? t("organization.expected") : t("organization.notExpected")}</dd>
                <dd className="field-hint">{t("organization.workEmailLocked")}</dd>
              </div>
            </dl>
          ))}
        <ErrorBox error={error} />
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={busy || !body}>
            {busy ? t("form.saving") : t(creating ? "organization.add" : "organization.save")}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {t("profileEdit.cancel")}
          </Button>
          {!creating && !body && <span className="muted small">{t("profileEdit.noChanges")}</span>}
        </div>
      </form>
    </Modal>
  );
}

function DeactivateDialog({ kind, row, onClose, onDone }: { kind: Kind; row: CatalogRow; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/core-hr/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify(statusBody(row)) });
      onDone(t("organization.deactivated", { name: displayName(row) }));
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("organization.deactivateTitle", { name: displayName(row) })}
      description={`${t("organization.code")}: ${row.code}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("profileEdit.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("form.saving") : t("organization.deactivate")}
          </Button>
        </>
      }
    >
      <p>{t(kind === "contract-types" ? "organization.deactivateBodyContractTypes" : "organization.deactivateBody")}</p>
      <ErrorBox error={error} />
    </Modal>
  );
}

export default function OrganizationPage() {
  const session = useSession();
  const caps = organizationCapabilities((p) => Boolean(session?.can(p)));
  const [kind, setKind] = useState<Kind>(() => (typeof window === "undefined" ? "departments" : kindFromQuery(window.location.search)));
  // Rows are kept with the tab they belong to, so a new tab never shows the previous tab's rows under its columns.
  const [loaded, setLoaded] = useState<{ kind: Kind; rows: CatalogRow[] } | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!caps.read) return;
    let cancelled = false;
    const url = `${window.location.pathname}${kind === "departments" ? "" : `?tab=${kind}`}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
    // Inactive values are listed too: they remain on historical records.
    api<{ data: CatalogRow[] }>(`/api/v1/core-hr/${kind}?page_size=100&include_inactive=true`)
      .then((r) => {
        if (cancelled) return;
        setLoaded({ kind, rows: r.data.data });
        setError(null);
      })
      .catch((e) => !cancelled && setError(e as ApiCallError));
    return () => {
      cancelled = true;
    };
  }, [kind, version, caps.read]);

  if (session && !caps.read) return <p className="alert warn">{t("organization.noPermission")}</p>;

  const shown = loaded?.kind === kind ? loaded.rows : null;
  const done = (message: string) => {
    setDialog(null);
    setNotice(message);
    setVersion((n) => n + 1);
  };
  const reactivate = async (row: CatalogRow) => {
    setNotice(null);
    try {
      await api(`/api/v1/core-hr/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify(statusBody(row)) });
      done(t("organization.reactivated", { name: displayName(row) }));
    } catch (err) {
      setError(err as ApiCallError);
    }
  };
  const open = (next: Dialog) => {
    setNotice(null);
    setDialog(next);
  };
  const c = shown ? counts(shown) : null;
  const add = caps.manage && (
    <Button variant="primary" onClick={() => open({ mode: "create" })}>
      + {t(`organization.addAction.${kind}`)}
    </Button>
  );

  return (
    <>
      <PageHeader title={t("organization.title")} subtitle={t("organization.subtitle")} actions={add} />
      <Tabs<Kind>
        idPrefix="organization"
        label={t("organization.tabsLabel")}
        items={KINDS.map((k) => ({ id: k, label: t(`organization.tabs.${k}`) }))}
        value={kind}
        onChange={(k) => {
          setNotice(null);
          setKind(k);
        }}
      />
      <div role="tabpanel" id={`panel-organization-${kind}`} aria-labelledby={`tab-organization-${kind}`} tabIndex={0} className="tab-panel">
        {notice && (
          <p className="alert ok-note small" role="status">
            {notice}
          </p>
        )}
        <ErrorBox error={error} />
        {!shown && !error && <p className="muted">{t("app.loading")}</p>}
        {shown && shown.length === 0 && (
          <div className="table-wrap">
            <EmptyState title={t(`organization.empty.${kind}`)} action={add || undefined}>
              {caps.manage ? t("organization.emptyManage") : t("organization.emptyRead")}
            </EmptyState>
          </div>
        )}
        {shown && shown.length > 0 && (
          <>
            <p className="list-meta">{t("organization.count", { active: c!.active, inactive: c!.inactive })}</p>
            <div className="table-wrap organization-table">
              <table>
                <thead>
                  <tr>
                    <th>{t(`organization.nameLabel.${kind}`)}</th>
                    <th>{t("organization.code")}</th>
                    {hasNameVi(kind) && <th>{t("organization.nameVi")}</th>}
                    {kind === "job-levels" && <th>{t("organization.sortOrder")}</th>}
                    {kind === "employee-types" && <th>{t("organization.workEmailColumn")}</th>}
                    <th>{t("organization.status")}</th>
                    {caps.manage && <th className="col-actions">{t("organization.actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className={r.is_active ? undefined : "inactive-row"}>
                      <td className="col-name">{displayName(r)}</td>
                      <td className="col-code">{r.code}</td>
                      {hasNameVi(kind) && <td>{r.name_vi ?? "—"}</td>}
                      {kind === "job-levels" && <td>{r.sort_order ?? "—"}</td>}
                      {kind === "employee-types" && <td>{r.requires_work_email ? t("organization.expected") : t("organization.notExpected")}</td>}
                      <td>
                        <StatusBadge kind="catalog" code={r.is_active ? "active" : "inactive"} />
                      </td>
                      {caps.manage && (
                        <td className="col-actions">
                          <Button size="small" variant="ghost" onClick={() => open({ mode: "edit", row: r })} aria-label={t("organization.editFor", { name: displayName(r) })}>
                            {t("organization.edit")}
                          </Button>
                          {r.is_active ? (
                            <Button size="small" variant="ghost" onClick={() => open({ mode: "deactivate", row: r })} aria-label={t("organization.deactivateFor", { name: displayName(r) })}>
                              {t("organization.deactivate")}
                            </Button>
                          ) : (
                            <Button size="small" variant="ghost" onClick={() => void reactivate(r)} aria-label={t("organization.reactivateFor", { name: displayName(r) })}>
                              {t("organization.reactivate")}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="muted small">{t(kind === "contract-types" ? "organization.inactiveNoteContractTypes" : "organization.inactiveNote")}</p>
        {kind === "employee-types" && <p className="muted small">{t("organization.employeeTypeNote")}</p>}
        {kind === "contract-types" && <p className="muted small">{t("organization.contractTypeNote")}</p>}
      </div>
      {dialog && dialog.mode !== "deactivate" && <CatalogDialog kind={kind} dialog={dialog} onClose={() => setDialog(null)} onDone={done} />}
      {dialog && dialog.mode === "deactivate" && <DeactivateDialog kind={kind} row={dialog.row} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}
