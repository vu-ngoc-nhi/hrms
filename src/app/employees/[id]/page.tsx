"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { ActionMenu, Button, StatusBadge, Tabs } from "@/components/ui";
import { t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { rememberedListHref } from "../listQuery";
import { NewPeriodForm } from "./NewPeriodForm";
import { OverviewTab } from "./OverviewTab";
import { PersonalCorrectionForm, PersonalTab } from "./PersonalTab";
import { PeriodWorkflow, actionLabel, groupedMenu } from "./PeriodWorkflow";
import { HistoryTab, type TabContext } from "./RecordTabs";
import { AssignmentTab } from "./AssignmentTab";
import { EmploymentTab } from "./EmploymentTab";
import { headerActions, latestPeriod, overview, type ActionId, type Detail } from "./detailModel";

// UI-3 Employee Detail shell: compact header, one primary action, a More actions menu (daily → Correct record →
// Advanced), and tabs. Documents is not shown: it has no function yet (roadmap only).
const TABS = ["overview", "personal", "employment", "assignment", "history"] as const;
type TabId = (typeof TABS)[number];

function tabFromUrl(): TabId {
  if (typeof window === "undefined") return "overview";
  const v = new URLSearchParams(window.location.search).get("tab");
  return (TABS as readonly string[]).includes(v ?? "") ? (v as TabId) : "overview";
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(tabFromUrl);
  const [backHref] = useState(() => (typeof window === "undefined" ? "/employees" : rememberedListHref()));
  // The workflow opened from the header; `launch` remounts the form for every opening.
  const [launched, setLaunched] = useState<{ action: ActionId; launch: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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

  // Move focus into an opened workflow so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!launched || !panelRef.current) return;
    panelRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    const field = panelRef.current.querySelector<HTMLElement>("input, select, textarea");
    (field ?? panelRef.current).focus({ preventScroll: true });
  }, [launched]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <p className="muted">{t("app.loading")}</p>;

  const o = overview(d);
  const actions = headerActions(d, can);
  const target = actions.target;
  const latest = latestPeriod(d);
  const close = () => setLaunched(null);
  const saved = (updated: Detail, message = t("detail.saved")) => {
    setD(updated);
    setNotice(message);
    setLaunched(null);
  };
  const launch = (action: ActionId) => {
    setNotice(null);
    setLaunched((l) => ({ action, launch: (l?.launch ?? 0) + 1 }));
  };

  const plannedRehire = Boolean(latest?.end_date && latest.end_date >= d.status_as_of);
  const label = (a: ActionId) => actionLabel(a, plannedRehire);
  const menu = groupedMenu(actions, launch, label);

  const workflow = (action: ActionId) => {
    const lp = { onClose: close };
    const tp = target;
    switch (action) {
      case "correct_personal":
        return <PersonalCorrectionForm<Detail> profile={d} can={can} onSaved={(u) => saved(u, t("personal.corrected"))} onCancel={close} />;
      case "initial_employment":
        return (
          <NewPeriodForm<Detail>
            mode="initial"
            personId={d.id}
            hasCancelledPeriods={d.employments.length > 0}
            today={d.status_as_of}
            canBackdate
            revision={d.revision}
            onSaved={(u) => saved(u)}
            launched={lp}
          />
        );
      case "rehire":
        return latest?.end_date ? (
          <NewPeriodForm<Detail>
            mode="rehire"
            personId={d.id}
            previous={{ ...latest, end_date: latest.end_date }}
            today={d.status_as_of}
            canBackdate={can("employment.correct")}
            revision={d.revision}
            onSaved={(u) => saved(u)}
            launched={lp}
          />
        ) : null;
    }
    if (!tp) return null;
    return <PeriodWorkflow action={action} period={tp} d={d} can={can} onSaved={saved} onClose={close} />;
  };

  const ctx: TabContext = { d, can, targetId: target?.id ?? null, onSaved: (u, message) => saved(u, message) };
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
            <Button variant="primary" onClick={() => launch(actions.primary!)}>
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

      {launched && (
        <div ref={panelRef} className="workflow-panel" tabIndex={-1} role="region" aria-label={t("detail.selectedAction")}>
          <div key={launched.launch}>{workflow(launched.action)}</div>
        </div>
      )}

      <Tabs<TabId> idPrefix="employee" label={t("detail.sectionsLabel")} items={TABS.map((id) => ({ id, label: t(`detail.tabs.${id}`) }))} value={tab} onChange={setTab} />
      <div role="tabpanel" id={`panel-employee-${tab}`} aria-labelledby={`tab-employee-${tab}`} tabIndex={0} className="tab-panel">
        {tab === "overview" && <OverviewTab o={o} status={d.employment_status} statusAsOf={d.status_as_of} />}
        {tab === "personal" && <PersonalTab<Detail> profile={d} can={can} onSaved={(u) => saved(u, t("personal.saved"))} />}
        {tab === "employment" && <EmploymentTab ctx={ctx} />}
        {tab === "assignment" && <AssignmentTab ctx={ctx} />}
        {tab === "history" && <HistoryTab d={d} />}
      </div>
    </>
  );
}
