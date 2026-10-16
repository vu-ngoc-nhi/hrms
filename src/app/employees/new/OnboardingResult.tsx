"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, InfoBox } from "@/components/ui";
import { t } from "@/i18n";
import type { ContractTypeOption } from "@/app/contracts/contractModel";
import { ContractStepFields } from "./ContractStepFields";
import type { ContractAttempt } from "./onboardingSubmit";
import { createdHref, type ContractField, type ContractStepValues } from "./wizardModel";

// Slice 2A-6 result screen after the employee was created and a Contract Draft was requested. It states both outcomes
// separately so a partial success can never read as "employee creation failed". Retry repeats only the Contract
// request (same contract Idempotency-Key); the employee is never submitted again from here.
export function OnboardingResult({
  fullName,
  personId,
  attempt,
  retrying,
  onRetry,
  startDate,
  contract,
  onContractChange,
  contractErrors,
  types,
  typesLoading,
}: {
  fullName: string;
  personId: string;
  attempt: ContractAttempt;
  retrying: boolean;
  onRetry: () => void;
  startDate: string;
  contract: ContractStepValues;
  onContractChange: (patch: Partial<ContractStepValues>) => void;
  contractErrors: Partial<Record<ContractField, string>>;
  types: ContractTypeOption[];
  typesLoading: boolean;
}) {
  const [reviewing, setReviewing] = useState(false);
  const failed = attempt.status === "failed" ? attempt : null;
  // Retry is offered when repeating the request can help: a definite rejection (after review) or an unknown result.
  const canRetry = Boolean(failed && !failed.keyUsed);
  return (
    <section className="card wizard-card onboarding-result" aria-labelledby="onboarding-result-title">
      <h2 id="onboarding-result-title" tabIndex={-1}>
        {t("wizard.result.title")}
      </h2>
      <ul className="onboarding-outcomes">
        <li className="outcome ok" role="status">
          <span className="outcome-mark" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>{t("wizard.result.employeeCreated")}</strong>
            <div className="muted small">{fullName}</div>
          </div>
        </li>
        {attempt.status === "created" ? (
          <li className="outcome ok" role="status">
            <span className="outcome-mark" aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>{t("wizard.result.contractCreated")}</strong>
              <div className="muted small">{t("wizard.result.contractDraftNote")}</div>
            </div>
          </li>
        ) : (
          <li className="outcome warn" role="alert">
            <span className="outcome-mark" aria-hidden="true">
              !
            </span>
            <div>
              <strong>{t("wizard.result.contractFailed")}</strong>
              <div className="small">{t("wizard.result.employeeIntact")}</div>
            </div>
          </li>
        )}
      </ul>

      {attempt.status === "no_period" && <InfoBox variant="warning">{t("wizard.result.noPeriod")}</InfoBox>}
      {failed?.keyUsed && <InfoBox variant="warning">{t("wizard.result.keyUsed")}</InfoBox>}
      {failed && !failed.keyUsed && failed.uncertain && <InfoBox variant="warning">{t("wizard.result.uncertain")}</InfoBox>}
      {failed && !failed.keyUsed && !failed.uncertain && (
        <>
          <ErrorBox error={failed.error} />
          <p className="muted small">{t("wizard.result.reviewHint")}</p>
        </>
      )}

      {canRetry && reviewing && (
        <div className="onboarding-review">
          <h3>{t("wizard.result.reviewTitle")}</h3>
          <ContractStepFields startDate={startDate} c={contract} onChange={onContractChange} errors={contractErrors} types={types} typesLoading={typesLoading} disabled={retrying} />
        </div>
      )}

      <div className="wizard-actions onboarding-actions">
        <div className="page-actions">
          {attempt.status === "created" && (
            <Link href={`/contracts/${attempt.contractId}`} className="button">
              {t("wizard.result.openContract")}
            </Link>
          )}
          <Link href={attempt.status === "created" ? createdHref(personId) : `/employees/${personId}?tab=contracts`} className={attempt.status === "created" ? "button primary" : "button"}>
            {t("wizard.result.openEmployee")}
          </Link>
          {canRetry && !reviewing && (
            <Button onClick={() => setReviewing(true)} disabled={retrying}>
              {t("wizard.result.reviewDetails")}
            </Button>
          )}
          {canRetry && (
            <Button variant="primary" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
              {retrying ? t("wizard.saving") : t("wizard.result.retryContract")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
