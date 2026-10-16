import { StatusBadge } from "@/components/ui";
import { IconAttention } from "@/components/ui/icons";
import { t } from "@/i18n";
import type { ContractState } from "./contractModel";

// Slice 2A-3: one presentation of contract state, used by the list, the detail and the Employee Contracts tab.
// Document status (Draft / Finalized / Signed) and Time status (Upcoming / Active / Expired) are separate concepts and
// are always shown with their own label — Finalized ≠ Signed, Active ≠ Signed. A discarded or voided record shows only
// its disposition: it is history, never presented as an operational (e.g. Active) contract. Every value comes from the
// server projection.
export function ContractStateBadges({ state, needsReview, compact = false }: { state: ContractState; needsReview: boolean; compact?: boolean }) {
  return (
    <span className={compact ? "contract-states compact" : "contract-states"}>
      {state.disposition ? (
        <span className="state-pair">
          <span className="state-label">{t("contracts.stateLabel.record")}</span>
          <StatusBadge kind="contractDisposition" code={state.disposition} />
        </span>
      ) : (
        <>
          <span className="state-pair">
            <span className="state-label">{t("contracts.stateLabel.document")}</span>
            <StatusBadge kind="contractDocument" code={state.document_state} />
          </span>
          {state.time_state && (
            <span className="state-pair">
              <span className="state-label">{t("contracts.stateLabel.time")}</span>
              <StatusBadge kind="contractTime" code={state.time_state} />
            </span>
          )}
        </>
      )}
      {needsReview && (
        <span className="badge warning review-flag" title={t("contracts.needsReviewHint")}>
          <IconAttention />
          {t("contracts.needsReview")}
        </span>
      )}
    </span>
  );
}
