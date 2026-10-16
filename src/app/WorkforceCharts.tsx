"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatDate, t } from "@/i18n";
import { columnHeight, donutSegments, type ChartItem } from "./homeModel";

// Owner-approved Home refresh: two Active-only workforce charts. Every count comes from the server's `workforce`
// block (all people, same business date and projection as the Employee List); this file only draws them. Plain SVG /
// CSS — no chart library. Percentages are not available yet: the legend shows the count and a "—" in their place.
// Labels are always shown in full (they wrap; no hover-only truncation). A legend / column area that overflows is a
// keyboard-focusable, labelled scroll region with a visible hint, so every category is reachable by touch and keyboard.
type Chart = { total: number; asOf: string; items: ChartItem[] };

/** A scroll area that, when its content overflows, becomes a focusable labelled region and shows a hint. */
function ScrollRegion({ className, label, hint, children }: { className: string; label: string; hint: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="home-scroll-wrap">
      <div ref={ref} className={className} {...(overflows ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}>
        {children}
      </div>
      {overflows && <p className="home-chart-scroll-hint">{hint}</p>}
    </div>
  );
}

function ChartHeader({ id, title, asOf }: { id: string; title: string; asOf: string }) {
  return (
    <div className="home-panel-header home-chart-header">
      <div className="home-panel-heading">
        <h2 id={id}>{title}</h2>
        <p className="home-panel-note">{t("home.chart.asOf", { date: formatDate(asOf) })}</p>
      </div>
    </div>
  );
}

function ItemLabel({ item }: { item: ChartItem }) {
  const text = <span className="home-chart-name">{item.label}</span>;
  return item.href ? (
    <Link href={item.href} aria-label={t("home.chart.itemLink", { label: item.label, count: item.count })}>
      {text}
    </Link>
  ) : (
    text
  );
}

export function DepartmentDonut({ chart }: { chart: Chart }) {
  const segments = donutSegments(chart.items, chart.total);
  const summary = chart.items.map((i) => `${i.label} ${i.count}`).join(", ");
  return (
    <section className="card home-panel home-chart" aria-labelledby="home-chart-department">
      <ChartHeader id="home-chart-department" title={t("home.chart.departmentTitle")} asOf={chart.asOf} />
      {chart.total === 0 ? (
        <p className="muted home-empty">{t("home.chart.empty")}</p>
      ) : (
        <div className="home-donut-layout">
          <div className="home-donut" role="img" aria-label={t("home.chart.departmentSummary", { items: summary })}>
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="home-donut-track" cx="60" cy="60" r="46" pathLength={100} />
              {segments.map((s) => (
                <circle
                  key={s.key}
                  className={`home-donut-segment ${s.color}`}
                  cx="60"
                  cy="60"
                  r="46"
                  pathLength={100}
                  strokeDasharray={`${s.length} ${100 - s.length}`}
                  strokeDashoffset={-s.offset}
                />
              ))}
            </svg>
            <span className="home-donut-center">
              <strong>{chart.total}</strong>
              <span>{t("home.chart.centerLabel")}</span>
            </span>
          </div>
          <ScrollRegion
            className="home-chart-legend-scroll"
            label={t("home.chart.departmentLegend")}
            hint={t("home.chart.scrollDown", { count: chart.items.length })}
          >
          <ul className="home-chart-legend">
            {chart.items.map((i) => (
              <li key={i.key} className={i.unassigned ? "unassigned" : undefined}>
                <span className={`home-chart-dot ${i.color}`} aria-hidden="true" />
                <ItemLabel item={i} />
                <span className="home-chart-value">
                  <strong>{i.count}</strong>
                  <span className="home-chart-share" title={t("home.chart.shareUnavailable")}>
                    (—)<span className="sr-only">{t("home.chart.shareUnavailable")}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          </ScrollRegion>
        </div>
      )}
    </section>
  );
}

export function EmployeeTypeColumns({ chart }: { chart: Chart }) {
  const summary = chart.items.map((i) => `${i.label} ${i.count}`).join(", ");
  return (
    <section className="card home-panel home-chart" aria-labelledby="home-chart-type">
      <ChartHeader id="home-chart-type" title={t("home.chart.typeTitle")} asOf={chart.asOf} />
      {chart.total === 0 ? (
        <p className="muted home-empty">{t("home.chart.empty")}</p>
      ) : (
        <ScrollRegion className="home-columns-scroll" label={t("home.chart.typeColumns")} hint={t("home.chart.scrollSideways", { count: chart.items.length })}>
          <ol className="home-columns" aria-label={t("home.chart.typeSummary", { items: summary })} style={{ ["--columns" as string]: chart.items.length }}>
            {chart.items.map((i) => (
              <li key={i.key} className={i.unassigned ? "unassigned" : undefined}>
                <span className="home-column-plot">
                  <span className="home-column-bar" style={{ height: `${columnHeight(i.count, chart.items)}%` }}>
                    <span className="home-column-count">{i.count}</span>
                  </span>
                </span>
                <ItemLabel item={i} />
              </li>
            ))}
          </ol>
        </ScrollRegion>
      )}
    </section>
  );
}
