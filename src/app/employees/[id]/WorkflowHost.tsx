"use client";

import { useRef } from "react";
import { InfoBox, Modal } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { AssignmentCorrectionForm } from "./AssignmentCorrectionForm";
import { CancelPlannedAssignmentForm } from "./CancelPlannedAssignmentForm";
import { NewPeriodForm } from "./NewPeriodForm";
import { PersonalCorrectionForm, PersonalEditForm } from "./PersonalTab";
import { PeriodWorkflow, actionLabel } from "./PeriodWorkflow";
import { latestPeriod, liveAssignments, type Detail } from "./detailModel";
import { isDataCorrection, shouldClose, surfaceFor, type OpenWorkflow } from "./workflowModel";

// UI-9: the one place an Employee Detail workflow opens — a Drawer (multi-field workflows, long previews) or a Modal
// (short ones). It names the record it acts on (never an id), explains corrections, asks before discarding changed
// fields, and renders the existing workflow form unchanged. Only one is mounted at a time.

export function WorkflowHost({
  wf,
  d,
  can,
  onSaved,
  onClose,
}: {
  wf: OpenWorkflow;
  d: Detail;
  can: (permission: string) => boolean;
  onSaved: (updated: Detail, message?: string, warning?: string) => void;
  onClose: () => void;
}) {
  const dirty = useRef(false);
  const { action, target } = wf;
  const period = target.periodId ? (d.employments.find((p) => p.id === target.periodId) ?? null) : null;
  // The live timeline only (PV-29: a cancelled planned assignment is never a workflow target or a previous row).
  const rows = period ? [...liveAssignments(period)].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1)) : [];
  const rowIndex = rows.findIndex((r) => r.id === target.assignmentId);
  const row = rowIndex >= 0 ? rows[rowIndex] : null;
  const latest = latestPeriod(d);
  const plannedRehire = Boolean(latest?.end_date && latest.end_date >= d.status_as_of);
  const periodContext = (p: NonNullable<typeof period>) =>
    t("workflow.periodContext", { n: d.employments.indexOf(p) + 1, type: p.employee_type?.name ?? "—", start: formatDate(p.start_date) });

  let context: string;
  if (row) context = t("workflow.assignmentContext", { date: formatDate(row.effective_from), department: row.department.name, title: row.job_title.name_en });
  else if (period) context = periodContext(period);
  else context = t("workflow.personContext", { name: d.full_name, code: d.employee_code });

  const requestClose = () => {
    if (shouldClose(dirty.current, () => window.confirm(t("workflow.discardConfirm")))) onClose();
  };

  let content: React.ReactNode = null;
  switch (action) {
    case "edit_personal":
      content = <PersonalEditForm<Detail> profile={d} onSaved={(u) => onSaved(u, t("personal.saved"))} onCancel={onClose} />;
      break;
    case "correct_personal":
      content = <PersonalCorrectionForm<Detail> profile={d} can={can} onSaved={(u) => onSaved(u, t("personal.corrected"))} onCancel={onClose} />;
      break;
    case "initial_employment":
      content = (
        <NewPeriodForm<Detail>
          mode="initial"
          personId={d.id}
          hasCancelledPeriods={d.employments.length > 0}
          today={d.status_as_of}
          canBackdate
          revision={d.revision}
          onSaved={(u) => onSaved(u)}
          launched={{ onClose }}
        />
      );
      break;
    case "rehire":
      content = latest?.end_date ? (
        <NewPeriodForm<Detail>
          mode="rehire"
          personId={d.id}
          previous={{ ...latest, end_date: latest.end_date }}
          today={d.status_as_of}
          canBackdate={can("employment.correct")}
          revision={d.revision}
          onSaved={(u) => onSaved(u)}
          launched={{ onClose }}
        />
      ) : null;
      break;
    case "correct_assignment":
      content = row ? (
        <AssignmentCorrectionForm<Detail>
          row={row}
          previous={rowIndex > 0 ? rows[rowIndex - 1] : null}
          personId={d.id}
          revision={d.revision}
          onSaved={(u) => onSaved(u)}
          onClose={onClose}
        />
      ) : null;
      break;
    case "cancel_planned_assignment":
      content = row ? (
        <CancelPlannedAssignmentForm<Detail>
          row={row}
          predecessor={rowIndex > 0 ? rows[rowIndex - 1] : null}
          revision={d.revision}
          onSaved={(u, warnings) => onSaved(u, t("cancelPlannedAssignment.done"), warnings.length ? t("cancelPlannedAssignment.managerWarning") : undefined)}
          onClose={onClose}
        />
      ) : null;
      break;
    default:
      content = period ? <PeriodWorkflow action={action} period={period} d={d} can={can} onSaved={onSaved} onClose={onClose} /> : null;
  }

  return (
    <Modal variant={surfaceFor(action) === "drawer" ? "drawer" : "dialog"} title={actionLabel(action, plannedRehire)} description={context} onClose={requestClose}>
      {isDataCorrection(action) && <InfoBox variant="warning">{t("workflow.correctionNote")}</InfoBox>}
      {/* Any edit marks the workflow as changed, so closing with Escape or × asks first. */}
      <div className="workflow-body" onInput={() => (dirty.current = true)} onChange={() => (dirty.current = true)}>
        {content ?? <p className="muted">{t("workflow.unavailable")}</p>}
      </div>
    </Modal>
  );
}
