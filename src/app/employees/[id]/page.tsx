"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { ActionMenu, Button, StatusBadge, Tabs } from "@/components/ui";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { rememberedListHref } from "../listQuery";
import { OverviewTab } from "./OverviewTab";
import { PersonalTab } from "./PersonalTab";
import { actionLabel, groupedMenu } from "./PeriodWorkflow";
import { WorkflowHost } from "./WorkflowHost";
import { openWorkflow, successTab, type DetailTab, type OpenWorkflow, type WorkflowTarget } from "./workflowModel";
import { HistoryTab } from "./HistoryTab";
import type { TabContext } from "./tabContext";
import { AssignmentTab } from "./AssignmentTab";
import { EmploymentTab } from "./EmploymentTab";
import { headerActions, latestPeriod, overview, type ActionId, type Detail } from "./detailModel";

// UI-3 Employee Detail shell: compact header with the primary assignment action and person-level More actions (UI-9),
// tabs, and one workflow surface. Documents is not shown: it has no function yet (roadmap only).
const TABS: readonly DetailTab[] = ["overview", "personal", "employment", "assignment", "history"];
type TabId = DetailTab;

function tabFromUrl(): TabId {
  if (typeof window === "undefined") return "overview";
  const v = new URLSearchParams(window.location.search).get("tab");
  return (TABS as readonly string[]).includes(v ?? "") ? (v as TabId) : "overview";
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);
  // UI-8: arriving from Add Employee (…?created=1) shows a success notice; the parameter is then dropped from the URL.
  const created = useSearchParams().get("created") === "1";
  const [notice, setNotice] = useState<string | null>(created ? t("wizard.created") : null);
  const [warning, setWarning] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (created) router.replace(`/employees/${id}`, { scroll: false });
  }, [created, id, router]);
  const [tab, setTab] = useState<TabId>(tabFromUrl);
  const [backHref] = useState(() => (typeof window === "undefined" ? "/employees" : rememberedListHref()));
  // UI-9: exactly one workflow (Drawer / Modal) at a time, opened from the header or a card.
  const [workflow, setWorkflow] = useState<OpenWorkflow | null>(null);
  const session = useSession();
  const can = (p: string) => Boolean(session?.can(p));

  useEffect(() => {
    api<Detail>(`/api/v1/core-hr/employees/${id}`)
      .then((r) => setD(r.data))
      .catch((e) => setError(e));
  }, [id]);

  // The selected tab is part of the address (shareable, survives reload); Overview is the bare URL.
  useEffect(() => {
    const url = `${window.location.pathname}${tab === "overview" ? "" : `?tab=${tab}`}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [tab]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <p className="muted">{t("app.loading")}</p>;

  const o = overview(d);
  const actions = headerActions(d, can);
  const target = actions.target;
  const latest = latestPeriod(d);
  const launch = (action: ActionId, wfTarget: WorkflowTarget = {}) => {
    setNotice(null);
    setWarning(null);
    setWorkflow((current) => openWorkflow(current, action, wfTarget));
  };
  // Success: refresh the record, close the workflow and show the most relevant tab with a short confirmation.
  const saved = (updated: Detail, message = t("detail.saved"), warning?: string) => {
    setD(updated);
    setNotice(message);
    setWarning(warning ?? null);
    setTab((current) => (workflow ? successTab(workflow.action) : current));
    setWorkflow(null);
  };

  const plannedRehire = Boolean(latest?.end_date && latest.end_date >= d.status_as_of);
  const label = (a: ActionId) => actionLabel(a, plannedRehire);
  const menu = groupedMenu(actions, (a) => launch(a), label);

  const ctx: TabContext = { d, can, targetId: target?.id ?? null, launch };
  const meta = [o.header.jobTitle, o.header.department, o.header.employeeType].filter(Boolean).join(" · ");

  return (
    <>
      <header className="detail-header">
        <div className="detail-identity">
          <Link href={backHref} className="back-link">
            ← {t("detail.backToEmployees")}
          </Link>
          <h1>{d.full_name}</h1>
          <div className="detail-code">{d.employee_code}</div>
          <div className="detail-meta">
            {meta && <span>{meta}</span>}
            <StatusBadge kind="employment" code={d.employment_status} />
          </div>
        </div>
        <div className="page-actions detail-actions">
          {actions.primary && (
            <Button variant="primary" onClick={() => launch(actions.primary!, { periodId: target?.id })}>
              {label(actions.primary)}
            </Button>
          )}
          <ActionMenu label={t("detail.moreActions")} entries={menu} />
        </div>
      </header>

      {notice && (
        <p className="alert ok-note small" role="status">
          {notice}
        </p>
      )}
      {/* A non-blocking item to review after a successful action (e.g. PV-29 manager coverage, C-73). */}
      {warning && (
        <p className="alert warn small" role="status">
          {warning}
        </p>
      )}

      {workflow && <WorkflowHost key={workflow.n} wf={workflow} d={d} can={can} onSaved={saved} onClose={() => setWorkflow(null)} />}

      <Tabs<TabId> idPrefix="employee" label={t("detail.sectionsLabel")} items={TABS.map((id) => ({ id, label: t(`detail.tabs.${id}`) }))} value={tab} onChange={setTab} />
      <div role="tabpanel" id={`panel-employee-${tab}`} aria-labelledby={`tab-employee-${tab}`} tabIndex={0} className="tab-panel">
        {tab === "overview" && <OverviewTab o={o} status={d.employment_status} statusAsOf={d.status_as_of} />}
        {tab === "personal" && <PersonalTab profile={d} can={can} onEdit={() => launch("edit_personal")} />}
        {tab === "employment" && <EmploymentTab ctx={ctx} />}
        {tab === "assignment" && <AssignmentTab ctx={ctx} />}
        {tab === "history" && <HistoryTab d={d} />}
      </div>
    </>
  );
}
