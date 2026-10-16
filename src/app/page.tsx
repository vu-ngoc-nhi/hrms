"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { initials, useSession } from "@/components/AppShell";
import { Button, EmptyState, StatusBadge } from "@/components/ui";
import { IconAttention, IconCalendar, IconUserCheck, IconUsers } from "@/components/ui/icons";
import { formatDate, formatDayMonth, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { ContractAttention } from "./ContractAttention";
import { departmentChart, employeeTypeChart, greeting, homeCapabilities, needsAttentionView, statusLinks, summaryCards, upcomingView, type Dashboard, type SummaryCard } from "./homeModel";
import { DepartmentDonut, EmployeeTypeColumns } from "./WorkforceCharts";

// UI-1 Home / Action Center (PV-30), visual refresh (owner-approved post-freeze refinement, 2026-10-12): greeting,
// summary cards, Needs Attention and Upcoming — next 30 days. One request; every number is decided by the server.
// Phase 2A slice 2A-4 (C-113): one Contract Attention section below the existing panels, only with contracts.read.
// Owner-approved Home dashboard refresh (C-119): Total Employees / Active / On Leave / Needs Attention cards, two
// Active-only workforce charts, then Needs Attention and Upcoming; Pre-start / Ended as subdued list links. "—" marks
// data that is not available yet (On Leave, trends, percentages) — never 0, arrows or filled rings.

const CARD_ICONS: Record<string, ReactNode> = {
  total: <IconUsers />,
  active: <IconUserCheck />,
  unavailable: <IconCalendar />,
  attention: <IconAttention />,
};

function cardLabel(c: SummaryCard): string | undefined {
  if (c.count === null) return undefined;
  if (c.key === "total") return t("home.card.totalLabel", { count: c.count });
  if (c.key === "active") return t("home.card.activeLabel", { count: c.count });
  return t("home.needsCardLabel", { count: c.count });
}

export default function HomePage() {
  const session = useSession();
  const caps = homeCapabilities((p) => Boolean(session?.can(p)));
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setData(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!caps.read) return;
    let cancelled = false;
    api<Dashboard>("/api/v1/core-hr/dashboard")
      .then((r) => !cancelled && setData(r.data))
      .catch((e) => !cancelled && setError(e as ApiCallError));
    return () => {
      cancelled = true;
    };
  }, [caps.read, attempt]);

  if (session && !caps.read) return <p className="alert warn">{t("home.noPermission")}</p>;

  const header = (
    <header className="home-hero">
      <div className="home-hero-text">
        <p className="home-eyebrow">{t("home.title")}</p>
        {/* The session exists only in the browser, so the prerendered page shows the neutral greeting and never disagrees with it. */}
        <h1>{greeting(session?.me.display_name, session ? new Date().getHours() : null)}</h1>
        <p className="home-hero-subtitle">{t("home.subtitle")}</p>
      </div>
      {data && (
        <p className="home-asof">
          <IconCalendar />
          <span>{t("home.statusAsOf", { date: formatDate(data.status_as_of) })}</span>
        </p>
      )}
    </header>
  );

  if (error) {
    return (
      <div className="home">
        {header}
        <div className="alert warn home-unavailable" role="alert">
          <p>{t("home.unavailable")}</p>
          {error.body?.request_id && error.body.request_id !== "-" && <p className="muted small">{t("errors.requestId", { id: error.body.request_id })}</p>}
          <Button size="small" onClick={retry}>
            {t("home.retry")}
          </Button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="home">
        {header}
        <p className="muted">{t("app.loading")}</p>
      </div>
    );
  }

  const cards = summaryCards(data);
  const others = statusLinks(data);
  const needs = needsAttentionView(data);
  const upcoming = upcomingView(data);
  const noRecords = data.snapshot.active + data.snapshot.not_started + data.snapshot.ended === 0 && needs.total === 0;

  return (
    <div className="home">
      {header}

      <section className="home-stats" aria-label={t("home.summaryLabel")}>
        <h2 className="sr-only">{t("home.summaryLabel")}</h2>
        {cards.map((c) => {
          const body = (
            <>
              <span className="home-stat-main">
                <span className="home-stat-top">
                  <span className="home-stat-label">{c.label}</span>
                  {/* Reserved trend slot: no trend data yet, so a neutral "—" (never an arrow or a percentage). */}
                  {c.count !== null && (
                    <span className="home-stat-trend" title={t("home.trendUnavailable")}>
                      —<span className="sr-only">{t("home.trendUnavailable")}</span>
                    </span>
                  )}
                </span>
                <span className={c.count === null ? "home-stat-count unavailable" : "home-stat-count"}>
                  {c.count ?? "—"}
                </span>
                <span className="home-stat-hint">
                  {c.hint}
                  {c.href && "\u00a0→"}
                </span>
              </span>
              <span className="home-stat-icon" aria-hidden="true">
                {CARD_ICONS[c.tone]}
              </span>
            </>
          );
          return c.href ? (
            <Link key={c.key} href={c.href} className={`home-stat ${c.tone}`} aria-label={cardLabel(c)}>
              {body}
            </Link>
          ) : (
            <div key={c.key} className={`home-stat ${c.tone}`}>
              {body}
            </div>
          );
        })}
      </section>
      <p className="home-status-links" aria-label={t("home.statusLinksLabel")}>
        {others.map((o, i) => (
          <span key={o.key}>
            {i > 0 && <span aria-hidden="true"> · </span>}
            <Link href={o.href} aria-label={t("home.snapshotLink", { label: o.label, count: o.count })}>
              {t("home.statusLink", { label: o.label, count: o.count })}
            </Link>
          </span>
        ))}
        <span className="home-unavailable-note">{t("home.unavailableNote")}</span>
      </p>

      {noRecords ? (
        <EmptyState
          title={t("home.noRecords")}
          action={
            caps.addEmployee ? (
              <Link className="button primary" href="/employees/new">
                + {t("employees.create")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="home-charts">
            <DepartmentDonut chart={departmentChart(data)} />
            <EmployeeTypeColumns chart={employeeTypeChart(data)} />
          </div>
          <div className="home-main">
            <section className="card home-panel" aria-labelledby="home-needs">
              <div className="home-panel-header">
                <span className="home-panel-icon attention">
                  <IconAttention />
                </span>
                <div className="home-panel-heading">
                  <h2 id="home-needs">
                    {t("home.needsTitle")}
                    {!needs.healthy && <span className="badge warning home-count">{needs.total}</span>}
                  </h2>
                  <p className="home-panel-note">{t("home.needsNote")}</p>
                </div>
                {needs.viewAll && (
                  <Link href={needs.viewAll} className="home-panel-link" aria-label={t("home.viewAllLabel", { total: needs.total })}>
                    {t("home.viewAll")} →
                  </Link>
                )}
              </div>
              {needs.healthy ? (
                <div className="home-healthy">
                  <p className="home-healthy-title">{t("home.needsHealthy")}</p>
                  <p className="muted small">{t("home.needsHealthyNote")}</p>
                </div>
              ) : (
                <>
                  <ul className="home-chips" aria-label={t("home.needsBreakdownLabel")}>
                    {needs.breakdown.map((b) => (
                      <li key={b.code}>
                        {b.label} <strong>{b.count}</strong>
                      </li>
                    ))}
                  </ul>
                  <ul className="home-list">
                    {needs.records.map((r) => (
                      <li key={r.personId}>
                        <Link href={r.href} className="home-row">
                          <span className="home-avatar" aria-hidden="true">
                            {initials(r.name)}
                          </span>
                          <span className="home-row-main">
                            <span className="home-row-name">{r.name}</span>
                            <span className="home-row-code"> · {r.code}</span>
                            <span className="home-row-detail">{t("home.missing", { items: r.missing })}</span>
                          </span>
                          <StatusBadge kind="employment" code={r.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="card home-panel" aria-labelledby="home-upcoming">
              <div className="home-panel-header">
                <span className="home-panel-icon info">
                  <IconCalendar />
                </span>
                <div className="home-panel-heading">
                  <h2 id="home-upcoming">{t("home.upcomingTitle")}</h2>
                  <p className="home-panel-note">{t("home.upcomingWindow")}</p>
                </div>
              </div>
              {upcoming.empty ? (
                <p className="muted home-empty">{t("home.upcoming.empty")}</p>
              ) : (
                <>
                  <ol className="home-timeline">
                    {upcoming.rows.map((u) => {
                      const dm = formatDayMonth(u.date);
                      return (
                        <li key={u.key}>
                          <Link href={u.href} className="home-timeline-row">
                            <time className="home-date" dateTime={u.date} aria-label={formatDate(u.date)}>
                              <span className="home-date-day">{dm.day}</span>
                              <span className="home-date-month">{dm.month}</span>
                            </time>
                            <span className="home-row-main">
                              <span className={`home-event ${u.type}`}>{u.title}</span>
                              <span className="home-row-name">{u.name}</span>
                              <span className="home-row-code"> · {u.code}</span>
                              {u.detail && <span className="home-row-detail">{u.detail}</span>}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                  {upcoming.overflow && <p className="muted small home-overflow">{upcoming.overflow}</p>}
                </>
              )}
            </section>
          </div>
        </>
      )}

      {session?.can("contracts.read") && <ContractAttention />}
    </div>
  );
}
