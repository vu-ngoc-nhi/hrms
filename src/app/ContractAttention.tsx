"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconContract } from "@/components/ui/icons";
import { formatDate, t } from "@/i18n";
import { api } from "@/lib/client/api";
import { ATTENTION_LINKS, endsInText, findingText, type ReminderItem, type Reminders } from "./contracts/contractModel";

// Slice 2A-4 Home — Contract Attention: ONE section with three actionable signals (Expiring soon — next 30 days,
// Awaiting signature, Needs review). Counts and lists come from GET /contract-reminders, computed by the same server
// predicates as the Contracts filters each "View all" opens; Home infers no contract rule. Loaded separately from the
// Core HR dashboard, so a failure here never hides the rest of Home. No charts, trends or renewal metrics.
type SignalKey = "expiring_soon" | "awaiting_signature" | "needs_review";
const SIGNALS: { key: SignalKey; title: Parameters<typeof t>[0]; action: Parameters<typeof t>[0] }[] = [
  { key: "expiring_soon", title: "home.contracts.expiringTitle", action: "home.contracts.expiringAction" },
  { key: "awaiting_signature", title: "home.contracts.awaitingTitle", action: "home.contracts.awaitingAction" },
  { key: "needs_review", title: "home.contracts.reviewTitle", action: "home.contracts.reviewAction" },
];
const SHOWN = 3;

function detail(key: SignalKey, i: ReminderItem): string {
  if (key === "expiring_soon") return `${endsInText(i.days_to_end)} · ${formatDate(i.effective_to)}`;
  if (key === "needs_review" && i.review_reason) return findingText({ code: i.review_reason, message: "" });
  return [i.contract_type, i.effective_from ? formatDate(i.effective_from) : null].filter(Boolean).join(" · ");
}

export function ContractAttention() {
  const [data, setData] = useState<Reminders | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Reminders>("/api/v1/core-hr/contract-reminders")
      .then((r) => !cancelled && setData(r.data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card home-panel home-contracts" aria-labelledby="home-contracts">
      <div className="home-panel-header">
        <span className="home-panel-icon">
          <IconContract />
        </span>
        <div className="home-panel-heading">
          <h2 id="home-contracts">{t("home.contracts.title")}</h2>
          <p className="home-panel-note">{t("home.contracts.note")}</p>
        </div>
      </div>
      {failed && <p className="muted small">{t("home.contracts.unavailable")}</p>}
      {!data && !failed && <p className="muted small">{t("app.loading")}</p>}
      {data && (
        <div className="home-signals">
          {SIGNALS.map((s) => {
            const signal = data[s.key];
            const title = t(s.title);
            return (
              <div key={s.key} className="home-signal" aria-labelledby={`home-signal-${s.key}`}>
                <h3 id={`home-signal-${s.key}`} className="home-signal-title">
                  {title}
                  <span className={signal.total > 0 ? "badge warning home-count" : "badge neutral home-count"}>{signal.total}</span>
                </h3>
                {signal.total === 0 ? (
                  <p className="muted small">{t("home.contracts.none")}</p>
                ) : (
                  <>
                    <p className="home-signal-action small">{t(s.action)}</p>
                    <ul className="home-list home-signal-list">
                      {signal.items.slice(0, SHOWN).map((i) => (
                        <li key={i.id}>
                          <Link href={`/contracts/${i.id}`} className="home-row">
                            <span className="home-row-main">
                              <span className="home-row-name">{i.contract_number ?? t("home.contracts.draft")}</span>
                              <span className="home-row-code">
                                {" "}
                                · {i.employee.full_name} · {i.employee.employee_code}
                              </span>
                              <span className="home-row-detail">{detail(s.key, i)}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link href={ATTENTION_LINKS[s.key]} className="home-panel-link" aria-label={t("home.contracts.viewAllLabel", { total: signal.total, title })}>
                      {t("home.contracts.viewAll")} →
                    </Link>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
