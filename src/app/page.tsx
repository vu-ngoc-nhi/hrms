"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { initials, useSession } from "@/components/AppShell";
import { Button, EmptyState, StatusBadge } from "@/components/ui";
import { IconAttention, IconBars, IconCalendar, IconUserCheck, IconUserClock, IconUserMinus } from "@/components/ui/icons";
import { formatDate, formatDayMonth, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { ContractAttention } from "./ContractAttention";
import { greeting, homeCapabilities, needsAttentionView, snapshotView, summaryCards, upcomingView, type Dashboard } from "./homeModel";

// UI-1 Home / Action Center (PV-30), visual refresh (owner-approved post-freeze refinement, 2026-10-12): greeting,
// four summary cards, Needs Attention, Upcoming — next 30 days and a proportional Workforce Snapshot bar. Same single
// request and the same server-decided numbers; no new data, no department breakdown, no trends (BD-H2 … BD-H4).
// Phase 2A slice 2A-4 (C-113): one Contract Attention section below the existing panels, only with contracts.read.

const CARD_ICONS: Record<string, ReactNode> = {
  active: <IconUserCheck />,
  not_started: <IconUserClock />,
  ended: <IconUserMinus />,
  attention: <IconAttention />,
};

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
  const snapshot = snapshotView(data);
  const snapshotTotal = snapshot.reduce((sum, m) => sum + m.count, 0);
  const needs = needsAttentionView(data);
  const upcoming = upcomingView(data);
  const noRecords = snapshotTotal === 0 && needs.total === 0;

  return (
    <div className="home">
      {header}

      <section className="home-stats" aria-label={t("home.summaryLabel")}>
        <h2 className="sr-only">{t("home.summaryLabel")}</h2>
        {cards.map((c) => {
          const body = (
            <>
              <span className="home-stat-top">
                <span className="home-stat-icon">{CARD_ICONS[c.tone]}</span>
                <span className="home-stat-label">{c.label}</span>
              </span>
              <span className="home-stat-count">{c.count}</span>
              {c.href && <span className="home-stat-hint">{c.hint} →</span>}
            </>
          );
          const label = c.key === "needs_attention" ? t("home.needsCardLabel", { count: c.count }) : t("home.snapshotLink", { label: c.label, count: c.count });
          return c.href ? (
            <Link key={c.key} href={c.href} className={`home-stat ${c.tone}`} aria-label={label}>
              {body}
            </Link>
          ) : (
            <div key={c.key} className={`home-stat ${c.tone}`}>
              {body}
            </div>
          );
        })}
      </section>

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
        <div className="home-main">
          <div className="home-col">
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

            <section className="card home-panel" aria-labelledby="home-snapshot">
              <div className="home-panel-header">
                <span className="home-panel-icon">
                  <IconBars />
                </span>
                <div className="home-panel-heading">
                  <h2 id="home-snapshot">{t("home.snapshotTitle")}</h2>
                  <p className="home-panel-note">{t("home.snapshotNote")}</p>
                </div>
              </div>
              {snapshotTotal > 0 && (
                <div className="home-bar" role="img" aria-label={t("home.snapshotBarLabel", { items: snapshot.map((m) => `${m.label} ${m.count}`).join(", ") })}>
                  {snapshot
                    .filter((m) => m.count > 0)
                    .map((m) => (
                      <span key={m.status} className={`home-bar-segment ${m.status}`} style={{ flexGrow: m.count }} />
                    ))}
                </div>
              )}
              <ul className="home-legend">
                {snapshot.map((m) => (
                  <li key={m.status}>
                    <span className={`home-legend-dot ${m.status}`} aria-hidden="true" />
                    <span>{m.label}</span>
                    <strong>{m.count}</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>

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
      )}

      {session?.can("contracts.read") && <ContractAttention />}
    </div>
  );
}
