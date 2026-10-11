"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ErrorBox";
import { formatDate, t } from "@/i18n";
import { addDays } from "@/lib/dates";
import { api, ApiCallError } from "@/lib/client/api";
import { useAssignmentOptions, type Option } from "./useAssignmentOptions";
import { useFormOpen, type Launched } from "./launch";

type Row = {
  id: string;
  effective_from: string;
  effective_to: string | null;
  department: { id: string; name: string };
  job_title: { id: string; name_en: string };
  job_level: { id: string; name: string } | null;
  manager: { person_id: string; full_name: string } | null;
};

// S4.9 Relationship Change (C-63 to C-67): continuous transition of the latest period to a different Employee Type.
// Nothing is carried forward implicitly: the Initial Assignment suggestion and the Work Email are explicit choices.
export function RelationshipChangeForm<T>({
  employmentId,
  personId,
  period,
  today,
  canBackdate,
  revision,
  onSaved,
  launched,
}: {
  employmentId: string;
  personId: string;
  period: { start_date: string; end_date: string | null; employee_type: { id: string; name: string }; work_email: string | null; assignments: Row[] };
  today: string;
  canBackdate: boolean;
  revision: number;
  onSaved: (updated: T) => void;
  /** UI-3: opened from the Employee header instead of its own button. */
  launched?: Launched;
}) {
  const ended = period.end_date !== null && period.end_date < today;
  const fixedStart = ended ? addDays(period.end_date!, 1) : null;
  const [open, setOpen] = useFormOpen(launched);
  const [types, setTypes] = useState<Option[]>([]);
  const [form, setForm] = useState({
    start_date: fixedStart ?? (addDays(period.start_date, 1) > today ? addDays(period.start_date, 1) : today),
    employee_type_id: "",
    end_date: "",
    email_choice: "none" as "keep" | "different" | "none",
    work_email: "",
    with_assignment: false,
    department_id: "",
    job_title_id: "",
    job_level_id: "",
    manager_person_id: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const opts = useAssignmentOptions(open && form.with_assignment, personId, setError);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ data: { id: string; code: string; name: string }[] }>("/api/v1/core-hr/employee-types?page_size=100")
      .then((r) => {
        if (!cancelled) setTypes(r.data.data.filter((x) => x.id !== period.employee_type.id).map((x) => ({ id: x.id, label: `${x.name} (${x.code})` })));
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [open, period.employee_type.id]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {t("relationshipChange.open")}
      </button>
    );
  }

  const start = form.start_date;
  const oldEnd = start ? addDays(start, -1) : "";
  const blocking = start ? period.assignments.filter((a) => a.effective_from >= start) : [];
  const suggestion = start ? [...period.assignments].reverse().find((a) => a.effective_from < start) : undefined;
  const replacesPlanned = !ended && period.end_date !== null && period.end_date !== oldEnd;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  function toggleAssignment(checked: boolean) {
    // The suggestion is only a starting point that HR reviews; it is never submitted unless confirmed here.
    setForm((f) => ({
      ...f,
      with_assignment: checked,
      department_id: checked && suggestion ? suggestion.department.id : "",
      job_title_id: checked && suggestion ? suggestion.job_title.id : "",
      job_level_id: checked && suggestion?.job_level ? suggestion.job_level.id : "",
      manager_person_id: checked && suggestion?.manager ? suggestion.manager.person_id : "",
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      expected_revision: revision,
      start_date: form.start_date,
      employee_type_id: form.employee_type_id,
      reason: form.reason.trim(),
    };
    if (form.end_date) body.end_date = form.end_date;
    if (form.email_choice === "keep" && period.work_email) body.work_email = period.work_email;
    if (form.email_choice === "different" && form.work_email.trim()) body.work_email = form.work_email.trim();
    if (form.with_assignment) {
      body.initial_assignment = {
        department_id: form.department_id,
        job_title_id: form.job_title_id,
        ...(form.job_level_id ? { job_level_id: form.job_level_id } : {}),
        ...(form.manager_person_id ? { manager_person_id: form.manager_person_id } : {}),
      };
    }
    const payload = JSON.stringify(body);
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    setBusy(true);
    setError(null);
    try {
      const r = await api<T>(`/api/v1/core-hr/employments/${employmentId}/relationship-change`, {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": attempt.current.key },
      });
      setOpen(false);
      onSaved(r.data);
    } catch (err) {
      setError(err as ApiCallError);
    } finally {
      setBusy(false);
    }
  }

  const select = (k: "department_id" | "job_title_id" | "job_level_id" | "manager_person_id", text: string, list: Option[], optional: boolean) => (
    <label>
      {text}
      {optional ? "" : " *"}
      <select value={form[k]} onChange={set(k)} required={!optional}>
        <option value="">{t("form.none")}</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const minStart = fixedStart ?? [addDays(period.start_date, 1), canBackdate ? "" : today].sort().at(-1);
  const invalid =
    busy ||
    !start ||
    !form.employee_type_id ||
    !form.reason.trim() ||
    blocking.length > 0 ||
    (form.email_choice === "different" && !form.work_email.trim()) ||
    (form.with_assignment && (!form.department_id || !form.job_title_id));

  return (
    <form onSubmit={save} className="card">
      <h2>{t("relationshipChange.title")}</h2>
      <p className="muted small">{t("relationshipChange.help")}</p>
      <div className="grid2">
        <label>
          {t("relationshipChange.currentType")}
          <input value={period.employee_type.name} disabled />
        </label>
        <label>
          {t("relationshipChange.newType")} *
          <select required value={form.employee_type_id} onChange={set("employee_type_id")}>
            <option value="">{t("form.none")}</option>
            {types.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("relationshipChange.startDate")} *
          <input type="date" required min={minStart} max={fixedStart ?? undefined} value={form.start_date} onChange={set("start_date")} />
        </label>
        <label>
          {t("newPeriod.plannedEnd")}
          <input type="date" min={form.start_date} value={form.end_date} onChange={set("end_date")} />
        </label>
      </div>
      {ended && <p className="muted small">{t("relationshipChange.endedNote", { date: formatDate(period.end_date) })}</p>}
      {form.start_date === today && <p className="alert small">{t("sameDay.note")}</p>}

      <fieldset className="choice-group">
        <legend className="small">
          <strong>{t("detail.workEmail")}</strong>
        </legend>
        {period.work_email && (
          <label className="checkbox-field">
            <input type="radio" name="email" checked={form.email_choice === "keep"} onChange={() => setForm((f) => ({ ...f, email_choice: "keep" }))} />
            {t("relationshipChange.emailKeep", { email: period.work_email })}
          </label>
        )}
        <label className="checkbox-field">
          <input type="radio" name="email" checked={form.email_choice === "different"} onChange={() => setForm((f) => ({ ...f, email_choice: "different" }))} />
          {t("relationshipChange.emailDifferent")}
        </label>
        {form.email_choice === "different" && <input type="email" required maxLength={254} value={form.work_email} onChange={set("work_email")} />}
        <label className="checkbox-field">
          <input type="radio" name="email" checked={form.email_choice === "none"} onChange={() => setForm((f) => ({ ...f, email_choice: "none" }))} />
          {t("relationshipChange.emailNone")}
        </label>
      </fieldset>

      <label className="checkbox-field">
        <input type="checkbox" checked={form.with_assignment} onChange={(e) => toggleAssignment(e.target.checked)} />
        {t("relationshipChange.addAssignment")}
      </label>
      {form.with_assignment && (
        <>
          {suggestion && <p className="muted small">{t("relationshipChange.suggested")}</p>}
          <div className="grid2">
            {select("department_id", t("employees.columns.department"), opts.departments, false)}
            {select("job_title_id", t("employees.columns.jobTitle"), opts.jobTitles, false)}
            {select("job_level_id", t("detail.jobLevel"), opts.levels, true)}
            {select("manager_person_id", t("detail.manager"), opts.managers, true)}
          </div>
        </>
      )}

      <h2>{t("assignmentChange.impact")}</h2>
      <ul className="small">
        <li>{t("relationshipChange.typeChange", { from: period.employee_type.name, to: types.find((o) => o.id === form.employee_type_id)?.label ?? "—" })}</li>
        {oldEnd && <li>{t("relationshipChange.oldEnd", { date: formatDate(oldEnd) })}</li>}
        {replacesPlanned && (
          <li>
            <strong>{t("relationshipChange.replacesPlanned", { from: formatDate(period.end_date), to: formatDate(oldEnd) })}</strong>
          </li>
        )}
        {start && <li>{t("relationshipChange.newStart", { date: formatDate(start) })}</li>}
        {suggestion && blocking.length === 0 && suggestion.effective_to !== start && (
          <li>{t("relationshipChange.oldAssignment", { from: formatDate(suggestion.effective_from), to: formatDate(start) })}</li>
        )}
        <li>{form.with_assignment ? t("relationshipChange.withAssignment") : t("relationshipChange.withoutAssignment")}</li>
        <li>
          {form.email_choice === "keep"
            ? t("relationshipChange.emailKeepImpact")
            : form.email_choice === "different"
              ? t("relationshipChange.emailDifferentImpact")
              : t("relationshipChange.emailNoneImpact")}
        </li>
      </ul>
      {blocking.length > 0 && (
        <p className="alert small">
          {t(
            // PV-29 / BD-9: a still-planned assignment is cancelled with Cancel Planned Assignment, never auto-changed.
            blocking.every((a) => a.effective_from > today) ? "relationshipChange.blockedPlanned" : "relationshipChange.blocked",
            { list: blocking.map((a) => `${formatDate(a.effective_from)} ${a.department.name}`).join(", ") },
          )}
        </p>
      )}
      <p className="muted small">{t("relationshipChange.noReversal")}</p>
      <label>
        {t("profileEdit.reason")} *
        <textarea
          required
          rows={2}
          maxLength={1000}
          value={form.reason}
          onChange={set("reason")}
        />
      </label>
      <ErrorBox error={error} />
      <div className="form-actions">
        <button className="primary" type="submit" disabled={invalid}>
          {busy ? t("form.saving") : t("relationshipChange.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t("profileEdit.cancel")}
        </button>
      </div>
    </form>
  );
}
