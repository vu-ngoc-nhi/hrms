"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { homeCapabilities, needsAttentionView, snapshotView, upcomingView, type Dashboard } from "./homeModel";

// UI-1 Home / Action Center (PV-30): Workforce Snapshot, Needs Attention, Upcoming — next 30 days. One request, one
// result: the page is either complete, loading, unavailable (one message, never a partly empty dashboard) or not
// permitted. No charts, scores, scanner state or department breakdown (BD-H2 … BD-H4).

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

  const header = <PageHeader title={t("home.title")} subtitle={t("home.subtitle")} />;
  if (error) {
    return (
      <>
        {header}
        <div className="alert warn home-unavailable" role="alert">
          <p>{t("home.unavailable")}</p>
          {error.body?.request_id && error.body.request_id !== "-" && <p className="muted small">{t("errors.requestId", { id: error.body.request_id })}</p>}
          <Button size="small" onClick={retry}>
            {t("home.retry")}
          </Button>
        </div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <p className="muted">{t("app.loading")}</p>
      </>
    );
  }

  const snapshot = snapshotView(data);
  const needs = needsAttentionView(data);
  const upcoming = upcomingView(data);
  const noRecords = snapshot.every((m) => m.count === 0) && needs.total === 0;

  return (
    <div className="home">
      <PageHeader title={t("home.title")} subtitle={t("home.subtitle")} actions={<span className="muted small">{t("home.statusAsOf", { date: formatDate(data.status_as_of) })}</span>} />

      <section className="home-snapshot" aria-label={t("home.snapshotTitle")}>
        <h2 className="home-section-title">{t("home.snapshotTitle")}</h2>
        <div className="home-metrics">
          {snapshot.map((m) => (
            <Link key={m.status} href={m.href} className={`home-metric ${m.status}`} aria-label={t("home.snapshotLink", { label: m.label, count: m.count })}>
              <span className="home-metric-count">{m.count}</span>
              <StatusBadge kind="employment" code={m.status} />
            </Link>
          ))}
        </div>
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
          <section className="card home-card" aria-labelledby="home-needs">
            <div className="card-header">
              <h2 id="home-needs">
                {t("home.needsTitle")}
                {!needs.healthy && <span className="badge warning home-count">{needs.total}</span>}
              </h2>
              {needs.viewAll && (
                <Link href={needs.viewAll} className="small" aria-label={t("home.viewAllLabel", { total: needs.total })}>
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
                <ul className="home-breakdown" aria-label={t("home.needsBreakdownLabel")}>
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
                        <span className="home-row-main">
                          <span className="home-row-name">{r.name}</span>
                          <span className="muted small"> · {r.code}</span>
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

          <section className="card home-card" aria-labelledby="home-upcoming">
            <div className="card-header">
              <h2 id="home-upcoming">
                {t("home.upcomingTitle")} <span className="muted small home-window">{t("home.upcomingWindow")}</span>
              </h2>
            </div>
            {upcoming.empty ? (
              <p className="muted home-empty">{t("home.upcoming.empty")}</p>
            ) : (
              <>
                <ul className="home-list">
                  {upcoming.rows.map((u) => (
                    <li key={u.key}>
                      <Link href={u.href} className="home-row home-upcoming-row">
                        <span className="home-date">{formatDate(u.date)}</span>
                        <span className="home-row-main">
                          <span className="home-row-name">{u.name}</span>
                          <span className="muted small"> · {u.code}</span>
                          <span className="home-row-detail">
                            <strong>{u.title}</strong>
                            {u.detail && <> · {u.detail}</>}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {upcoming.overflow && <p className="muted small home-overflow">{upcoming.overflow}</p>}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
