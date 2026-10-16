"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { ActionMenu, Button, Card, InfoBox } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { ContractDraftForm } from "../ContractDraftForm";
import { ContractStateBadges } from "../ContractStateBadges";
import {
  blockerText,
  contractTitle,
  dispositionCode,
  explainedReason,
  findingText,
  historyDateText,
  historyTitle,
  periodText,
  placeActions,
  renewalStateText,
  termText,
  type ActionKey,
  type ContractDetail,
  type Finding,
  type HistoryItem,
} from "../contractModel";
import { ConfirmSignedDialog, CorrectionDialog, DiscardDialog, FinalizeReviewDialog, ReasonActionDialog, requestFinalize, ReturnToDraftDialog } from "./LifecycleDialogs";

// Slice 2A-3 Contract Detail (/contracts/{id}): a first-class, directly navigable page reused by the Contracts list,
// the Employee Contracts tab and later Home reminders. Everything it shows — states, Needs Review, readiness, allowed
// actions — comes from GET /contracts/{id}; actions appear only when the server marks them allowed.
type Dialog =
  | { kind: "edit" }
  | { kind: "finalize"; warnings: Finding[]; fingerprint: string; changed: boolean }
  | { kind: "return" }
  | { kind: "signed" }
  | { kind: "discard" }
  | { kind: "renew" }
  | { kind: "cancel_planned" }
  | { kind: "correct" }
  | { kind: "void" };

const ACTION_LABEL: Record<ActionKey, Parameters<typeof t>[0]> = {
  edit: "contracts.actions.edit",
  finalize: "contracts.actions.finalize",
  return_to_draft: "contracts.actions.returnToDraft",
  confirm_signed: "contracts.actions.confirmSigned",
  discard: "contracts.actions.discard",
  renew: "contracts.actions.renew",
  cancel_planned: "contracts.actions.cancelPlanned",
  correct: "contracts.actions.correct",
  void: "contracts.actions.void",
};

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const router = useRouter();
  const [c, setC] = useState<ContractDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [actionError, setActionError] = useState<ApiCallError | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, hist] = await Promise.all([
        api<ContractDetail>(`/api/v1/core-hr/contracts/${id}`),
        api<{ data: HistoryItem[] }>(`/api/v1/core-hr/contracts/${id}/history`),
      ]);
      setC(detail.data);
      setHistory(hist.data.data);
      setError(null);
    } catch (e) {
      setError(e as ApiCallError);
    }
  }, [id]);

  useEffect(() => {
    // Initial load of this route's record (the fetch resolves asynchronously; state is set in its callbacks).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (session && !session.can("contracts.read")) return <p className="alert warn">{t("contracts.noPermission")}</p>;
  if (error) return <ErrorBox error={error} />;
  if (!c) return <p className="muted">{t("app.loading")}</p>;

  const placement = placeActions(c.actions);
  const reasonNote = explainedReason(c.actions);
  const finished = async (message: string) => {
    setDialog(null);
    setActionError(null);
    setNotice(message);
    await load();
  };
  const open = (kind: ActionKey) => {
    setNotice(null);
    setActionError(null);
    if (kind === "finalize") return void startFinalize();
    setDialog(kind === "return_to_draft" ? { kind: "return" } : kind === "confirm_signed" ? { kind: "signed" } : { kind });
  };
  // M-19: the first Finalize carries no fingerprint; warnings come back as a review dialog, never a silent finalize.
  async function startFinalize() {
    setBusy(true);
    const r = await requestFinalize(c!, null);
    setBusy(false);
    if (r.outcome.kind === "finalized") return void finished(t("contracts.done.finalized"));
    if (r.outcome.kind === "confirm") return setDialog({ kind: "finalize", warnings: r.outcome.warnings, fingerprint: r.outcome.fingerprint, changed: false });
    setActionError(r.error);
  }

  const disposition = dispositionCode(c.state);
  const periodDisposition = c.employment.disposition;
  const menu = placement.menu.map((k) => ({ type: "item" as const, label: t(ACTION_LABEL[k]), onSelect: () => open(k), danger: k === "discard" || k === "void" }));

  return (
    <>
      <header className="detail-header">
        <div className="detail-identity">
          <Link href="/contracts" className="back-link">
            ← {t("contracts.backToContracts")}
          </Link>
          <h1>{contractTitle(c)}</h1>
          <div className="detail-code">
            <Link href={`/employees/${c.employee.person_id}?tab=contracts`}>{c.employee.full_name}</Link> · {c.employee.employee_code}
            {c.contract_type && <> · {c.contract_type.name}</>}
          </div>
          <div className="detail-meta">
            <ContractStateBadges state={c.state} needsReview={c.review.needs_review} />
          </div>
          {(c.relationship.parent_id || c.relationship.renewal_id) && (
            <div className="contract-lineage small">
              {c.relationship.parent_id && (
                <span>
                  {t("contracts.lineage.renews")} <Link href={`/contracts/${c.relationship.parent_id}`}>{c.relationship.parent_number ?? t("contracts.draftContract")}</Link>
                </span>
              )}
              {c.relationship.renewal_id && (
                <span>
                  {t("contracts.lineage.renewedBy")} <Link href={`/contracts/${c.relationship.renewal_id}`}>{c.relationship.renewal_number ?? t("contracts.draftContract")}</Link> (
                  {renewalStateText(c.relationship.renewal_state)})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="page-actions detail-actions">
          {placement.secondary.map((k) => (
            <Button key={k} onClick={() => open(k)} disabled={busy}>
              {t(ACTION_LABEL[k])}
            </Button>
          ))}
          {placement.primary && (
            <Button variant="primary" onClick={() => open(placement.primary!)} disabled={busy}>
              {busy ? t("contracts.form.saving") : t(ACTION_LABEL[placement.primary])}
            </Button>
          )}
          {menu.length > 0 && <ActionMenu label={t("contracts.actions.more")} entries={menu} />}
        </div>
      </header>

      {notice && (
        <p className="alert ok-note small" role="status">
          {notice}
        </p>
      )}
      <ErrorBox error={actionError} />
      {disposition && <InfoBox variant="info">{t(`contracts.disposedNotice.${disposition}`)}</InfoBox>}
      {!disposition && periodDisposition && <InfoBox variant="info">{t(`contracts.periodNotice.${periodDisposition}`)}</InfoBox>}
      {!disposition && !periodDisposition && reasonNote && <p className="muted small">{reasonNote}</p>}

      {c.review.needs_review && (
        <InfoBox variant="warning" title={t("contracts.review.title")}>
          <ul className="finding-list">
            {c.review.items.map((i) => (
              <li key={`${i.code}-${i.related_contract_id ?? ""}`}>
                {findingText(i)}
                {i.related_contract_id && (
                  <>
                    {" "}
                    <Link href={`/contracts/${i.related_contract_id}`}>{t("contracts.openRelated")}</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
          {c.state.document_state !== "draft" && <div className="small">{t("contracts.review.body")}</div>}
        </InfoBox>
      )}

      {c.finalize_check && !c.finalize_check.ready && c.actions.edit.allowed && (
        <Card title={t("contracts.readiness.title")} className="contract-readiness">
          <ul className="finding-list">
            {c.finalize_check.blockers.map((b) => (
              <li key={`${b.code}-${b.field ?? ""}`}>{blockerText(b)}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="stack contract-sections">
        <Card title={t("contracts.details")}>
          <dl className="info-grid">
            <div>
              <dt>{t("contracts.fields.employee")}</dt>
              <dd>
                <Link href={`/employees/${c.employee.person_id}?tab=contracts`}>{c.employee.full_name}</Link> ({c.employee.employee_code})
              </dd>
            </div>
            <div>
              <dt>{t("contracts.fields.employmentPeriod")}</dt>
              <dd>
                {periodText(c.employment)}
                {periodDisposition && <> · {t(periodDisposition === "voided" ? "contracts.periodVoided" : "contracts.periodCancelled")}</>}
              </dd>
            </div>
            <div>
              <dt>{t("contracts.fields.contractType")}</dt>
              <dd>
                {c.contract_type?.name ?? "—"}
                {c.contract_type?.name_vi && <div className="muted small">{c.contract_type.name_vi}</div>}
              </dd>
            </div>
            <div>
              <dt>{t("contracts.fields.contractNumber")}</dt>
              <dd>{c.contract_number ?? <span className="muted">{t("contracts.noNumber")}</span>}</dd>
            </div>
            <div>
              <dt>{t("contracts.fields.effectiveFrom")}</dt>
              <dd>{formatDate(c.effective_from)}</dd>
            </div>
            <div>
              <dt>{t("contracts.fields.term")}</dt>
              <dd>
                {c.is_open_ended || c.effective_to ? termText(c) : "—"}
                {c.state.time_state_detail && <div className="muted small">{t(`contracts.timeStateDetail.${c.state.time_state_detail}`)}</div>}
              </dd>
            </div>
            {c.state.document_state !== "draft" && (
              <div>
                <dt>{t("contracts.fields.signedAt")}</dt>
                <dd>{c.signed_at ? formatDate(c.signed_at) : <span className="muted">{t("contracts.notSigned")}</span>}</dd>
              </div>
            )}
            {c.finalized_at && (
              <div>
                <dt>{t("contracts.fields.finalized")}</dt>
                <dd>{t("contracts.byOn", { date: formatDate(c.finalized_at.slice(0, 10)), name: c.finalized_by?.display_name ?? "—" })}</dd>
              </div>
            )}
            <div>
              <dt>{t("contracts.fields.created")}</dt>
              <dd>{t("contracts.byOn", { date: formatDate(c.created_at.slice(0, 10)), name: c.created_by?.display_name ?? "—" })}</dd>
            </div>
            <div className="info-wide">
              <dt>{t("contracts.fields.summary")}</dt>
              <dd className="pre-line">{c.summary ?? "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card title={t("contracts.history.title")}>
          {history && history.length === 0 && <p className="muted">{t("contracts.history.empty")}</p>}
          {history && history.length > 0 && (
            <ol className="contract-history">
              {[...history].reverse().map((h, i) => (
                <li key={`${h.recorded_at}-${i}`}>
                  <div className="contract-history-title">
                    <strong>{historyTitle(h)}</strong>
                    {historyDateText(h) && <span className="muted"> · {historyDateText(h)}</span>}
                  </div>
                  <div className="muted small">
                    {t("contracts.history.columns.recordedBy")}: {h.recorded_by?.display_name ?? "—"} · {t("contracts.history.columns.recordedAt")}:{" "}
                    {new Date(h.recorded_at).toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  {h.related_contract_id && (
                    <div className="small">
                      <Link href={`/contracts/${h.related_contract_id}`}>{t("contracts.history.openRenewal")}</Link>
                    </div>
                  )}
                  {h.reason && (
                    <div className="small">
                      {t("contracts.history.columns.reason")}: {h.reason}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {dialog?.kind === "edit" && <ContractDraftForm mode="edit" contract={c} onClose={() => setDialog(null)} onDone={() => void finished(t("contracts.form.saved"))} />}
      {dialog?.kind === "finalize" && (
        <FinalizeReviewDialog
          contract={c}
          warnings={dialog.warnings}
          fingerprint={dialog.fingerprint}
          changed={dialog.changed}
          onReviewed={(next) => setDialog({ kind: "finalize", ...next, changed: true })}
          onFinalized={() => void finished(t("contracts.done.finalized"))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "return" && <ReturnToDraftDialog contract={c} onClose={() => setDialog(null)} onDone={() => void finished(t("contracts.done.returned"))} />}
      {dialog?.kind === "signed" && <ConfirmSignedDialog contract={c} onClose={() => setDialog(null)} onDone={() => void finished(t("contracts.done.signed"))} />}
      {dialog?.kind === "discard" && <DiscardDialog contract={c} onClose={() => setDialog(null)} onDone={() => void finished(t("contracts.done.discarded"))} />}
      {dialog?.kind === "renew" && <ContractDraftForm mode="renew" parent={c} onClose={() => setDialog(null)} onDone={(newId) => router.push(`/contracts/${newId}`)} />}
      {dialog?.kind === "cancel_planned" && (
        <ReasonActionDialog contract={c} kind="cancelPlanned" onClose={() => setDialog(null)} onDone={() => void finished(t("contracts.done.cancelledPlanned"))} />
      )}
      {dialog?.kind === "void" && <ReasonActionDialog contract={c} kind="void" onClose={() => setDialog(null)} onDone={() => void finished(t("contracts.done.voided"))} />}
      {dialog?.kind === "correct" && <CorrectionDialog contract={c} onClose={() => setDialog(null)} onDone={() => void finished(t("contracts.done.corrected"))} />}
    </>
  );
}
