"use client";

import type { ActionMenuEntry } from "@/components/ui";
import { formatDate, t } from "@/i18n";
import { AssignmentChangeForm } from "./AssignmentChangeForm";
import { CancelPlannedForm } from "./CancelPlannedForm";
import { EndEmploymentForm } from "./EndEmploymentForm";
import { InitialAssignmentForm } from "./InitialAssignmentForm";
import { PeriodCorrectionForm } from "./PeriodCorrectionForm";
import { RelationshipChangeForm } from "./RelationshipChangeForm";
import { ReverseEndForm } from "./ReverseEndForm";
import { VoidPeriodForm } from "./VoidPeriodForm";
import { WorkEmailEditor } from "./WorkEmailEditor";
import { operationalPeriods, type ActionId, type Detail, type Period } from "./detailModel";

// The existing workflow forms of one Employment Period, opened in "launched" mode inside the single workflow surface
// (UI-9 Drawer / Modal). Props are exactly those the inline forms used before; form content is unchanged.

export const periodHeading = (d: Detail, e: Period) =>
  t("detail.periodHeading", {
    n: d.employments.indexOf(e) + 1,
    from: formatDate(e.start_date),
    to: e.end_date ? formatDate(e.end_date) : t("detail.periodOpenEnd"),
  });

export const cancelBlockedBy = (d: Detail, e: Period) =>
  e.has_active_end_event ? ("active_end" as const) : operationalPeriods(d).some((o) => o.start_date > e.start_date) ? ("later_period" as const) : null;

/** Menu / button wording of each action (form titles stay as they are). */
export function actionLabel(a: ActionId, plannedRehire = false): string {
  return {
    change_assignment: t("assignmentChange.open"),
    initial_assignment: t("initialAssignment.open"),
    edit_work_email: t("workEmail.edit"),
    end_employment: t("endEmployment.open"),
    relationship_change: t("detail.actionLabel.relationshipChange"),
    rehire: plannedRehire ? t("rehire.plan.open") : t("rehire.open"),
    initial_employment: t("initialEmployment.open"),
    correct_personal: t("personal.correct"),
    correct_period: t("detail.actionLabel.correctPeriod"),
    correct_work_email: t("workEmail.correct"),
    clear_work_email: t("workEmail.clear"),
    cancel_planned: t("cancelPlanned.open"),
    reverse_end: t("reverseEnd.open"),
    void_period: t("voidPeriod.open"),
    edit_personal: t("personal.edit"),
    correct_assignment: t("detail.actionLabel.correctAssignment"),
  }[a];
}

/** Menu entries: [items…] → Correct record → Advanced (destructive styling only for Advanced). */
export function groupedMenu(
  groups: { daily: ActionId[]; correction: ActionId[]; advanced: ActionId[] },
  onSelect: (a: ActionId) => void,
  label: (a: ActionId) => string = (a) => actionLabel(a),
  /** False when the menu button itself is labelled "Correct record". */
  correctionHeading = true,
): ActionMenuEntry[] {
  const item = (a: ActionId, danger = false): ActionMenuEntry => ({ type: "item", label: label(a), onSelect: () => onSelect(a), danger });
  return [
    ...groups.daily.map((a) => item(a)),
    ...(groups.correction.length
      ? [...(groups.daily.length ? [{ type: "separator" } as const] : []), ...(correctionHeading ? [{ type: "group", label: t("detail.actionGroup.correct") } as const] : []), ...groups.correction.map((a) => item(a))]
      : []),
    ...(groups.advanced.length
      ? [{ type: "separator" } as const, { type: "group", label: t("detail.actionGroup.advanced") } as const, ...groups.advanced.map((a) => item(a, true))]
      : []),
  ];
}

export function PeriodWorkflow({
  action,
  period: tp,
  d,
  can,
  onSaved,
  onClose,
}: {
  action: ActionId;
  period: Period;
  d: Detail;
  can: (permission: string) => boolean;
  onSaved: (updated: Detail, message?: string) => void;
  onClose: () => void;
}) {
  const lp = { onClose };
    switch (action) {
      case "change_assignment":
        return (
          <AssignmentChangeForm<Detail>
            employmentId={tp.id}
            personId={d.id}
            current={tp.assignments.at(-1) ?? null}
            revision={d.revision}
            minDate={can("employment.correct") ? undefined : d.status_as_of}
            onSaved={(u) => onSaved(u)}
            launched={lp}
          />
        );
      case "initial_assignment":
        return (
          <InitialAssignmentForm<Detail>
            employmentId={tp.id}
            personId={d.id}
            periodStart={tp.start_date}
            periodEnd={tp.end_date}
            today={d.status_as_of}
            revision={d.revision}
            onSaved={(u) => onSaved(u)}
            launched={lp}
          />
        );
      case "edit_work_email":
      case "correct_work_email":
      case "clear_work_email":
        return (
          <WorkEmailEditor<Detail>
            employmentId={tp.id}
            periodLabel={periodHeading(d, tp)}
            current={tp.work_email}
            ended={tp.period_lifecycle === "ended"}
            canEdit
            canClear={can("employment.correct")}
            revision={d.revision}
            onSaved={(u) => onSaved(u)}
            launched={{ onClose, mode: action === "clear_work_email" ? "clear" : "edit" }}
          />
        );
      case "end_employment":
        return (
          <EndEmploymentForm<Detail>
            employmentId={tp.id}
            employeeType={tp.employee_type?.name ?? null}
            startDate={tp.start_date}
            currentEnd={tp.end_date}
            assignments={tp.assignments}
            today={d.status_as_of}
            canBackdate={can("employment.correct")}
            revision={d.revision}
            onSaved={(u) => onSaved(u)}
            launched={lp}
          />
        );
      case "relationship_change":
        return tp.employee_type ? (
          <RelationshipChangeForm<Detail>
            employmentId={tp.id}
            personId={d.id}
            period={{ ...tp, employee_type: tp.employee_type }}
            today={d.status_as_of}
            canBackdate={can("employment.correct")}
            revision={d.revision}
            onSaved={(u) => onSaved(u)}
            launched={lp}
          />
        ) : null;
      case "correct_period":
        return (
          <PeriodCorrectionForm<Detail>
            employmentId={tp.id}
            current={{ start_date: tp.start_date, end_date: tp.end_date, employee_type: tp.employee_type }}
            hasActiveEndEvent={tp.has_active_end_event}
            revision={d.revision}
            onSaved={(u) => onSaved(u)}
            launched={lp}
          />
        );
      case "cancel_planned":
        return (
          <CancelPlannedForm<Detail>
            employmentId={tp.id}
            period={tp}
            blockedBy={cancelBlockedBy(d, tp)}
            revision={d.revision}
            onSaved={(u) => onSaved(u)}
            launched={lp}
          />
        );
      case "reverse_end":
        return tp.active_end_event ? (
          <ReverseEndForm<Detail>
            employmentId={tp.id}
            activeEnd={tp.active_end_event}
            currentEnd={tp.end_date}
            assignments={tp.assignments}
            today={d.status_as_of}
            revision={d.revision}
            onSaved={(u) => onSaved(u)}
            launched={lp}
          />
        ) : null;
      case "void_period":
        return <VoidPeriodForm<Detail> employmentId={tp.id} onSaved={(u) => onSaved(u, t("voidPeriod.voided"))} launched={lp} />;
    }
    return null;
}
