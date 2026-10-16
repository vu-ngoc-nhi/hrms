"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Card, EmptyState } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { ContractDraftForm, type PeriodOption } from "@/app/contracts/ContractDraftForm";
import { ContractStateBadges } from "@/app/contracts/ContractStateBadges";
import { contractTitle, explainedReasonForCreate, termText, type ContractSummary } from "@/app/contracts/contractModel";

// Slice 2A-3 Employee Detail → Contracts. The server groups the employee's contracts (GET /employees/{id}/contracts);
// this tab only renders the groups: Current · Upcoming & drafts · Contract history (with records that no longer have
// operational effect kept as muted evidence). Contracts never change employment data.
type Grouped = {
  as_of: string;
  current: ContractSummary[];
  upcoming: ContractSummary[];
  drafts: ContractSummary[];
  history: ContractSummary[];
  not_operational: ContractSummary[];
  create: { allowed: boolean; reasons: string[]; periods: PeriodOption[] };
};

function ContractRow({ c, muted = false }: { c: ContractSummary; muted?: boolean }) {
  return (
    <li className={muted ? "contract-row muted-row" : "contract-row"}>
      <div className="contract-row-main">
        <Link href={`/contracts/${c.id}`} className="contract-row-title">
          {contractTitle(c)}
        </Link>
        <div className="muted small">
          {[c.contract_type?.name, c.effective_from ? `${formatDate(c.effective_from)} → ${c.is_open_ended || c.effective_to ? termText(c) : "—"}` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {c.relationship?.parent_id && (
          <div className="muted small">
            {t("contracts.lineage.renews")} {c.relationship.parent_number ?? t("contracts.draftContract")}
          </div>
        )}
      </div>
      <div className="contract-row-badges">
        <ContractStateBadges state={c.state} needsReview={c.review.needs_review} compact />
      </div>
    </li>
  );
}

function Section({ title, items, empty, muted }: { title: string; items: ContractSummary[]; empty: string; muted?: ContractSummary[] }) {
  return (
    <Card title={title}>
      {items.length === 0 && !muted?.length && <p className="muted small">{empty}</p>}
      {items.length > 0 && (
        <ul className="contract-rows">
          {items.map((c) => (
            <ContractRow key={c.id} c={c} />
          ))}
        </ul>
      )}
      {muted && muted.length > 0 && (
        <>
          <h3 className="contract-subhead">{t("contracts.tab.notOperational")}</h3>
          <ul className="contract-rows">
            {muted.map((c) => (
              <ContractRow key={c.id} c={c} muted />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function ContractsTab({ personId }: { personId: string }) {
  const router = useRouter();
  const [g, setG] = useState<Grouped | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<Grouped>(`/api/v1/core-hr/employees/${personId}/contracts`)
      .then((r) => setG(r.data))
      .catch((e) => setError(e as ApiCallError));
  }, [personId]);

  if (error) return <ErrorBox error={error} />;
  if (!g) return <p className="muted">{t("app.loading")}</p>;

  const nothing = !g.current.length && !g.upcoming.length && !g.drafts.length && !g.history.length && !g.not_operational.length;
  const createNote = explainedReasonForCreate(g.create.reasons);
  const create = g.create.allowed && (
    <Button variant="primary" onClick={() => setCreating(true)}>
      + {t("contracts.actions.create")}
    </Button>
  );

  return (
    <div className="stack">
      {/* With no contract yet the empty state carries the explanation and the single Create action. */}
      {!nothing && (
        <div className="tab-toolbar">
          <p className="muted small">{t("contracts.tab.intro")}</p>
          {create}
        </div>
      )}
      {createNote && <p className="muted small">{createNote}</p>}
      {nothing ? (
        <div className="table-wrap">
          <EmptyState title={t("contracts.emptyTitle")} action={create || undefined}>
            {t("contracts.tab.intro")}
          </EmptyState>
        </div>
      ) : (
        <>
          <Section title={t("contracts.tab.current")} items={g.current} empty={t("contracts.tab.currentEmpty")} />
          <Section title={t("contracts.tab.upcomingDrafts")} items={[...g.upcoming, ...g.drafts]} empty={t("contracts.tab.upcomingDraftsEmpty")} />
          <Section title={t("contracts.tab.history")} items={g.history} empty={t("contracts.tab.historyEmpty")} muted={g.not_operational} />
        </>
      )}
      {creating && (
        <ContractDraftForm mode="create" periods={g.create.periods} onClose={() => setCreating(false)} onDone={(id) => router.push(`/contracts/${id}`)} />
      )}
    </div>
  );
}
