"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useSession } from "@/components/AppShell";
import { ErrorBox } from "@/components/ErrorBox";
import { Button, Field, InfoBox, PageHeader, Stepper, type FieldControlProps } from "@/components/ui";
import { formatDate, t, tMaybe } from "@/i18n";
import { api, ApiCallError } from "@/lib/client/api";
import { todayInVietnam } from "@/lib/dates";
import { contractTypeOptions, type ContractTypeRow } from "@/app/contracts/contractModel";
import { rememberedListHref } from "../listQuery";
import { ContractStepFields } from "./ContractStepFields";
import { OnboardingResult } from "./OnboardingResult";
import { createContractDraft, submitOnboarding, type ContractAttempt, type PostFn } from "./onboardingSubmit";
import {
  buildPayload,
  contractDraftBody,
  contractEffectiveFrom,
  contractErrors,
  createdHref,
  hasAssignmentInput,
  hasEmployment,
  initialState,
  isDirty,
  mapServerErrors,
  stepErrors,
  stepsFor,
  wizardCapabilities,
  wizardReducer,
  workEmailExpected,
  type ContractField,
  type ContractStepValues,
  type FieldName,
  type StepId,
} from "./wizardModel";

// UI-8 Add Employee: Personal → Employment → Assignment → (Contract, optional, slice 2A-6) → Review. Nothing is saved
// before "Save"; the employee save is the existing single create operation (one transaction, Idempotency-Key), so the
// record is either created complete or not at all. An optional Contract Draft is a SECOND, independent request made
// only after the employee exists (onboardingSubmit.ts). Labels match the Employee Detail tabs.

type Option = { id: string; label: string; requires_work_email?: boolean };
type Catalogs = { departments: Option[]; jobTitles: Option[]; levels: Option[]; employeeTypes: Option[]; managers: Option[] };
type CatalogState = { status: "loading" } | { status: "error"; error: ApiCallError } | { status: "ready"; data: Catalogs };
type Row = { id: string; code: string; name?: string; name_en?: string; is_active?: boolean; requires_work_email?: boolean };

const GENDERS = ["female", "male", "other"] as const;

function useCatalogs(enabled: boolean) {
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Only active values can be used for a new record (inactive ones are rejected by the server).
    const list = (path: string) =>
      api<{ data: Row[] }>(`/api/v1/core-hr/${path}?page_size=100`).then((r) =>
        r.data.data.filter((x) => x.is_active !== false).map((x) => ({ id: x.id, label: x.name ?? x.name_en ?? x.code, requires_work_email: x.requires_work_email })),
      );
    Promise.all([
      list("departments"),
      list("job-titles"),
      list("job-levels"),
      list("employee-types"),
      api<{ data: { id: string; employee_code: string; full_name: string }[] }>("/api/v1/core-hr/employees?employment_status=active&page_size=100").then((r) =>
        r.data.data.map((x) => ({ id: x.id, label: `${x.full_name} (${x.employee_code})` })),
      ),
    ])
      .then(([departments, jobTitles, levels, employeeTypes, managers]) => {
        if (!cancelled) setState({ status: "ready", data: { departments, jobTitles, levels, employeeTypes, managers } });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", error: e as ApiCallError });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);
  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };
  return { state, retry };
}

/** Active Contract Types for the optional Contract Draft (only with contracts.manage). */
function useContractTypes(enabled: boolean) {
  const [rows, setRows] = useState<ContractTypeRow[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    api<{ data: ContractTypeRow[] }>("/api/v1/core-hr/contract-types?page_size=100")
      .then((r) => setRows(r.data.data))
      .catch(() => setRows([]));
  }, [enabled]);
  return rows;
}

const post: PostFn = (path, body, idempotencyKey) => api(path, { method: "POST", body, headers: { "Idempotency-Key": idempotencyKey } }).then((r) => r.data);
type Result = { personId: string; employmentId: string | null; attempt: ContractAttempt };

export default function NewEmployeePage() {
  const session = useSession();
  const router = useRouter();
  const caps = wizardCapabilities((p) => Boolean(session?.can(p)));
  const steps = stepsFor(caps);
  const [s, dispatch] = useReducer(wizardReducer, undefined, initialState);
  const [cErrors, setCErrors] = useState<Partial<Record<ContractField, string>>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [retrying, setRetrying] = useState(false);
  const typeRows = useContractTypes(caps.createContract);
  const typeOptions = contractTypeOptions(typeRows ?? [], "new");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [saveError, setSaveError] = useState<{ error: ApiCallError | null; network: boolean } | null>(null);
  const [focusInvalid, setFocusInvalid] = useState(0);
  const catalogs = useCatalogs(caps.create);
  const [backHref] = useState(() => (typeof window === "undefined" ? "/employees" : rememberedListHref()));
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  // Separate idempotency scope for the Contract Draft: one key for this onboarding, reused by every retry, so an
  // uncertain earlier attempt is answered by the server (replay or IDEMPOTENCY_KEY_REUSED) instead of a duplicate.
  const contractKey = useRef<string | null>(null);
  const savingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const v = s.values;
  const c = s.contract;
  const dirty = isDirty(v, c) && !result;

  // Lightweight leave protection (no drafts): the browser asks before closing or reloading with unsaved input.
  useEffect(() => {
    if (!dirty || s.saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, s.saving]);

  // Each step change moves focus to the step heading; a validation failure moves it to the first invalid field.
  useEffect(() => {
    headingRef.current?.focus();
  }, [s.step]);
  useEffect(() => {
    if (focusInvalid) bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')?.focus();
  }, [focusInvalid]);

  if (session && !caps.create) return <p className="alert error">{t("form.noPermission")}</p>;

  const set = (field: FieldName) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    dispatch({ type: "set", field, value: e.target.value });
    if (errors[field])
      setErrors((e) => {
        const rest = { ...e };
        delete rest[field];
        return rest;
      });
  };
  const translate = <K extends string>(e: Partial<Record<K, string>>) => Object.fromEntries(Object.entries(e).map(([k, key]) => [k, t(key as Parameters<typeof t>[0])])) as Partial<Record<K, string>>;
  const checkContract = () => {
    const found = translate(caps.createContract ? contractErrors(v, c) : {});
    setCErrors(found);
    return Object.keys(found).length === 0;
  };
  const check = (step: StepId) => {
    const found = translate(stepErrors(step, v));
    setErrors(found);
    const contractOk = step === "contract" ? checkContract() : true;
    if (Object.keys(found).length || !contractOk) setFocusInvalid((n) => n + 1);
    return Object.keys(found).length === 0 && contractOk;
  };
  const next = () => {
    if (check(s.step)) dispatch({ type: "next", steps });
  };
  const setContract = (patch: Partial<ContractStepValues>) => {
    dispatch({ type: "setContract", patch });
    if (Object.keys(cErrors).length) setCErrors({});
  };
  const leave = (e: React.MouseEvent) => {
    if (dirty && !window.confirm(t("wizard.leaveConfirm"))) e.preventDefault();
  };

  async function save() {
    // Synchronous guard: a second click before React re-renders never sends a second request.
    if (savingRef.current) return;
    // Re-check every step; return HR to the first step with a problem.
    const all = stepErrors("review", v);
    const contractOk = checkContract();
    if (Object.keys(all).length || !contractOk) {
      setErrors(translate(all));
      dispatch({ type: "goto", step: steps.find((st) => (st === "contract" ? !contractOk : Object.keys(stepErrors(st, v)).length > 0)) ?? "personal" });
      setFocusInvalid((n) => n + 1);
      return;
    }
    const payloadText = JSON.stringify(buildPayload(v, caps));
    // The same content reuses the same Idempotency-Key, so saving again after a lost response never creates a duplicate.
    if (!attempt.current || attempt.current.payload !== payloadText) attempt.current = { key: crypto.randomUUID(), payload: payloadText };
    const wantsContract = caps.createContract && c.enabled;
    if (wantsContract && !contractKey.current) contractKey.current = crypto.randomUUID();
    savingRef.current = true;
    dispatch({ type: "saveStart" });
    setSaveError(null);
    const outcome = await submitOnboarding(post, {
      employeePayload: payloadText,
      employeeKey: attempt.current.key,
      startDate: v.start_date,
      contract: wantsContract ? { key: contractKey.current!, body: (employmentId) => contractDraftBody(employmentId, v, c) } : null,
    });
    if (outcome.kind === "employee_created") {
      // A: no Contract Draft requested → the Phase 1 result (the new record's Overview with its success notice).
      if (!outcome.contract) return void router.push(createdHref(outcome.personId));
      // B / C: an explicit result screen states both outcomes before HR leaves.
      dispatch({ type: "saveEnd" });
      setResult({ personId: outcome.personId, employmentId: outcome.employmentId, attempt: outcome.contract });
      return;
    }
    {
      const err = outcome.error;
      savingRef.current = false;
      dispatch({ type: "saveEnd" });
      if (!(err instanceof ApiCallError)) {
        setSaveError({ error: null, network: true });
        return;
      }
      const mapped = mapServerErrors(err.body?.details);
      setErrors(mapped.fields);
      setSaveError({ error: new ApiCallError(err.status, { ...err.body, details: mapped.other }), network: false });
      if (mapped.firstStep && mapped.firstStep !== "review") {
        dispatch({ type: "goto", step: mapped.firstStep });
        setFocusInvalid((n) => n + 1);
      }
    }
  }

  /** "Retry Contract Draft": repeats ONLY the Contract request, with the created period's id and the same contract key. */
  async function retryContract() {
    if (!result?.employmentId || retrying || !checkContract()) return;
    setRetrying(true);
    const attemptResult = await createContractDraft(post, contractDraftBody(result.employmentId, v, c), contractKey.current!);
    setRetrying(false);
    setResult({ ...result, attempt: attemptResult });
  }

  const ready = catalogs.state.status === "ready" ? catalogs.state.data : null;
  const field = (name: FieldName, label: string, control: (c: FieldControlProps) => ReactNode, opts: { required?: boolean; hint?: ReactNode } = {}) => (
    <Field label={label} required={opts.required} hint={opts.hint} error={errors[name]}>
      {control}
    </Field>
  );
  const select = (name: FieldName, options: Option[] | undefined, disabled = false) =>
    function SelectControl(c: FieldControlProps) {
      return (
    <select {...c} value={v[name] as string} onChange={set(name)} disabled={disabled || !options || options.length === 0}>
      <option value="">{!options ? t("wizard.loadingOptions") : options.length === 0 ? t("wizard.noOptions") : t("form.none")}</option>
      {(options ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
      );
    };
  const optionLabel = (options: Option[] | undefined, id: string) => (id ? (options?.find((o) => o.id === id)?.label ?? "—") : "—");
  const startText = v.start_date ? formatDate(v.start_date) : "";
  const catalogProblem =
    catalogs.state.status === "error" ? (
      <div>
        <ErrorBox error={catalogs.state.error} />
        <Button size="small" onClick={catalogs.retry}>
          {t("wizard.retry")}
        </Button>
      </div>
    ) : null;

  const personal = (
    <>
      <div className="form-grid">
        {field("full_name", t("personal.fullName"), (c) => <input {...c} value={v.full_name} onChange={set("full_name")} maxLength={200} autoComplete="off" />, { required: true })}
        {caps.writePersonal && (
          <>
            {field("date_of_birth", t("personal.dateOfBirth"), (c) => <input {...c} type="date" value={v.date_of_birth} onChange={set("date_of_birth")} />)}
            {field("gender", t("personal.gender"), (c) => (
              <select {...c} value={v.gender} onChange={set("gender")}>
                <option value="">{t("form.none")}</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {t(`gender.${g}`)}
                  </option>
                ))}
              </select>
            ))}
            {field("mobile_phone", t("personal.mobile"), (c) => <input {...c} value={v.mobile_phone} onChange={set("mobile_phone")} inputMode="tel" maxLength={20} autoComplete="off" />, {
              hint: t("personal.mobileHint"),
            })}
            {field("personal_email", t("personal.personalEmail"), (c) => <input {...c} type="email" value={v.personal_email} onChange={set("personal_email")} maxLength={254} autoComplete="off" />)}
          </>
        )}
      </div>
      {!caps.writePersonal && <p className="muted small">{t("wizard.personalNoAccess")}</p>}
      <p className="muted small">{t("wizard.codeAuto")}</p>
      {caps.setCode && (
        <details className="wizard-advanced" open={Boolean(v.employee_code) || Boolean(errors.employee_code)}>
          <summary>{t("wizard.legacyCodeSummary")}</summary>
          <div className="form-grid">
            {field("employee_code", t("wizard.legacyCode"), (c) => <input {...c} value={v.employee_code} onChange={set("employee_code")} maxLength={20} autoComplete="off" />, {
              hint: t("wizard.legacyCodeHint"),
            })}
          </div>
        </details>
      )}
    </>
  );

  const typeChosen = Boolean(v.employee_type_id);
  const expected = ready ? workEmailExpected(ready.employeeTypes, v.employee_type_id) : false;
  const employment = (
    <>
      {catalogProblem}
      <div className="form-grid">
        {field("start_date", t("employment.startDate"), (c) => <input {...c} type="date" value={v.start_date} onChange={set("start_date")} />, { hint: t("wizard.startDateHint") })}
        {field("employee_type_id", t("employment.employeeType"), select("employee_type_id", ready?.employeeTypes))}
        {field("work_email", t("employment.workEmail"), (c) => <input {...c} type="email" value={v.work_email} onChange={set("work_email")} maxLength={254} autoComplete="off" />, {
          hint: !typeChosen ? t("wizard.workEmailHint") : expected ? t("wizard.workEmailExpected") : t("wizard.workEmailOptional"),
        })}
      </div>
    </>
  );

  const assignmentEnabled = hasEmployment(v);
  const needsPair = hasAssignmentInput(v);
  const assignment = (
    <>
      {catalogProblem}
      {!assignmentEnabled && <InfoBox>{t("wizard.assignmentNeedsEmployment")}</InfoBox>}
      <div className="form-grid">
        {field("department_id", t("overview.department"), select("department_id", ready?.departments, !assignmentEnabled), { required: needsPair && assignmentEnabled })}
        {field("job_title_id", t("overview.jobTitle"), select("job_title_id", ready?.jobTitles, !assignmentEnabled), { required: needsPair && assignmentEnabled })}
        {field("job_level_id", t("overview.level"), select("job_level_id", ready?.levels, !assignmentEnabled))}
        {field("manager_person_id", t("overview.manager"), select("manager_person_id", ready?.managers, !assignmentEnabled), { hint: t("wizard.managerHint") })}
      </div>
      {assignmentEnabled && (
        <dl className="info-grid wizard-effective">
          <div>
            <dt>{t("assignmentTab.takesEffectOn")}</dt>
            <dd>{startText}</dd>
          </div>
        </dl>
      )}
      {assignmentEnabled && <p className="muted small">{t("wizard.assignmentEffectiveNote")}</p>}
      {assignmentEnabled && !needsPair && <p className="muted small">{t("wizard.assignmentSkipNote")}</p>}
    </>
  );

  const contractStep = (
    <>
      {!hasEmployment(v) && <InfoBox>{t("wizard.contract.needsEmployment")}</InfoBox>}
      <label className="checkbox-field contract-toggle">
        <input
          type="checkbox"
          checked={c.enabled}
          onChange={(e) => setContract({ enabled: e.target.checked })}
          disabled={!hasEmployment(v) && !c.enabled}
          aria-invalid={cErrors.enabled ? true : undefined}
          aria-describedby="contract-toggle-note"
        />
        <span>{t("wizard.contract.toggle")}</span>
      </label>
      <p id="contract-toggle-note" className={cErrors.enabled ? "field-error" : "muted small"}>
        {cErrors.enabled ?? t("wizard.contract.toggleHint")}
      </p>
      {c.enabled && hasEmployment(v) && (
        <ContractStepFields startDate={v.start_date} c={c} onChange={setContract} errors={cErrors} types={typeOptions} typesLoading={typeRows === null} />
      )}
      {!c.enabled && <p className="muted small">{t("wizard.contract.skipNote")}</p>}
    </>
  );

  const reviewSection = (step: StepId, title: string, rows: [string, ReactNode][], note?: string) => (
    <section className="card review-card" aria-labelledby={`review-${step}`}>
      <div className="card-header">
        <h3 id={`review-${step}`}>{title}</h3>
        {steps.includes(step) && (
          <Button size="small" variant="ghost" onClick={() => dispatch({ type: "goto", step })} aria-label={t("wizard.editSection", { section: title })} disabled={s.saving}>
            {t("wizard.edit")}
          </Button>
        )}
      </div>
      {note ? (
        <p className="muted">{note}</p>
      ) : (
        <dl className="info-grid">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
  const today = todayInVietnam();
  const review = (
    <>
      {reviewSection("personal", t("wizard.step.personal"), [
        [t("personal.fullName"), v.full_name.trim()],
        ...(caps.writePersonal
          ? ([
              [t("personal.dateOfBirth"), v.date_of_birth ? formatDate(v.date_of_birth) : ""],
              [t("personal.gender"), v.gender ? (tMaybe(`gender.${v.gender}`) ?? v.gender) : ""],
              [t("personal.mobile"), v.mobile_phone.trim()],
              [t("personal.personalEmail"), v.personal_email.trim()],
            ] as [string, ReactNode][])
          : []),
        [t("overview.employeeCode"), caps.setCode && v.employee_code.trim() ? v.employee_code.trim() : t("wizard.codeOnSave")],
      ])}
      {reviewSection(
        "employment",
        t("wizard.step.employment"),
        [
          [t("employment.employeeType"), optionLabel(ready?.employeeTypes, v.employee_type_id)],
          [t("employment.startDate"), v.start_date ? t(v.start_date > today ? "wizard.starts" : "wizard.started", { date: startText }) : ""],
          [t("employment.workEmail"), v.work_email.trim()],
        ],
        hasEmployment(v) ? undefined : t("wizard.noEmploymentReview"),
      )}
      {reviewSection(
        "assignment",
        t("wizard.step.assignment"),
        [
          [t("overview.department"), optionLabel(ready?.departments, v.department_id)],
          [t("overview.jobTitle"), optionLabel(ready?.jobTitles, v.job_title_id)],
          [t("overview.level"), optionLabel(ready?.levels, v.job_level_id)],
          [t("overview.manager"), optionLabel(ready?.managers, v.manager_person_id)],
          [t("assignmentTab.takesEffectOn"), startText],
        ],
        hasEmployment(v) && v.department_id && v.job_title_id ? undefined : t("wizard.noAssignmentReview"),
      )}
      {reviewSection(
        "contract",
        t("wizard.review.contractTitle"),
        [
          [t("wizard.review.contractWillCreate"), t("wizard.review.contractYes")],
          [t("contracts.fields.contractType"), c.contract_type_id ? (typeOptions.find((o) => o.id === c.contract_type_id)?.label ?? "—") : ""],
          [t("contracts.fields.contractNumber"), c.contract_number.trim() || t("wizard.review.notAssigned")],
          [t("contracts.fields.effectiveFrom"), contractEffectiveFrom(v, c) ? formatDate(contractEffectiveFrom(v, c)) : ""],
          [t("contracts.form.termLabel"), c.term === "open" ? t("contracts.openEnded") : c.effective_to ? formatDate(c.effective_to) : ""],
        ],
        !caps.createContract ? t("wizard.review.contractUnavailable") : !c.enabled ? t("wizard.review.contractNone") : undefined,
      )}
      <p className="muted small">{t("wizard.healthNote")}</p>
      <p className="muted small">{t("wizard.saveNote")}</p>
      {caps.createContract && c.enabled && <p className="muted small">{t("wizard.review.contractSeparate")}</p>}
    </>
  );

  const body: Record<StepId, ReactNode> = { personal, employment, assignment, contract: contractStep, review };
  const isReview = s.step === "review";

  if (result) {
    return (
      <>
        <PageHeader title={t("wizard.title")} subtitle={t("wizard.result.subtitle")} />
        <OnboardingResult
          fullName={v.full_name.trim()}
          personId={result.personId}
          attempt={result.attempt}
          retrying={retrying}
          onRetry={() => void retryContract()}
          startDate={v.start_date}
          contract={c}
          onContractChange={setContract}
          contractErrors={cErrors}
          types={typeOptions}
          typesLoading={typeRows === null}
        />
      </>
    );
  }

  return (
    <>
      <Link href={backHref} className="back-link" onClick={leave}>
        ← {t("detail.backToEmployees")}
      </Link>
      <PageHeader title={t("wizard.title")} subtitle={t("wizard.subtitle")} />
      <Stepper
        label={t("wizard.stepsLabel")}
        items={steps.map((id) => ({ id, label: t(`wizard.step.${id}`) }))}
        current={s.step}
        visited={s.visited}
        onSelect={(step) => !s.saving && dispatch({ type: "goto", step })}
      />
      <section className="card wizard-card" aria-labelledby="wizard-step-title">
        <h2 id="wizard-step-title" ref={headingRef} tabIndex={-1}>
          {t(`wizard.step.${s.step}`)}
        </h2>
        <p className="muted small">{t(`wizard.intro.${s.step}`)}</p>
        <div ref={bodyRef} className="wizard-body">
          {/* The save result stays visible on whichever step HR is sent back to. */}
          {saveError?.network && <InfoBox variant="warning">{t("wizard.networkError")}</InfoBox>}
          {saveError?.error && (
            <InfoBox variant="danger" title={t("wizard.nothingSaved")}>
              {Object.keys(errors).length > 0 && <div>{t("wizard.fixHighlighted")}</div>}
              {/* Errors that belong to no field (e.g. a conflict) are listed in words, never as codes. */}
              {(saveError.error.body?.details ?? []).map((d, i) => (
                <div key={i}>{d.message}</div>
              ))}
              {!Object.keys(errors).length && !saveError.error.body?.details?.length && (
                <div>{(saveError.error.body && tMaybe(`errors.${saveError.error.body.error}`)) ?? saveError.error.message}</div>
              )}
            </InfoBox>
          )}
          {body[s.step]}
        </div>
        <div className="wizard-actions">
          <Link href={backHref} className="button ghost" onClick={leave} aria-disabled={s.saving}>
            {t("profileEdit.cancel")}
          </Link>
          <div className="page-actions">
            {s.step !== "personal" && (
              <Button onClick={() => dispatch({ type: "back", steps })} disabled={s.saving}>
                {t("wizard.back")}
              </Button>
            )}
            {isReview ? (
              <Button variant="primary" onClick={() => void save()} disabled={s.saving} aria-busy={s.saving}>
                {s.saving ? t("wizard.saving") : t("form.save")}
              </Button>
            ) : (
              <Button variant="primary" onClick={next}>
                {t("wizard.next")}
              </Button>
            )}
          </div>
        </div>
        {s.saving && (
          <p className="muted small" role="status">
            {t("wizard.savingStatus")}
          </p>
        )}
      </section>
    </>
  );
}
