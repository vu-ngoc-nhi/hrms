"use client";

import { useId, type ReactNode } from "react";
import { t } from "@/i18n";

export type FieldControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; "aria-required"?: boolean };

/** Label + control + hint/error with programmatic association (label htmlFor, aria-describedby). */
export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
        {required && (
          <span className="field-required" aria-label={t("ui.required")}>
            *
          </span>
        )}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required || undefined })}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}
