import type { ReactNode } from "react";

export type InfoVariant = "info" | "success" | "warning" | "danger";

/** Inline message box. Danger is announced immediately (role="alert"); the others politely (role="status"). */
export function InfoBox({ variant = "info", title, children }: { variant?: InfoVariant; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`alert ${variant}`} role={variant === "danger" ? "alert" : "status"}>
      {title && <div className="alert-title">{title}</div>}
      {children}
    </div>
  );
}
