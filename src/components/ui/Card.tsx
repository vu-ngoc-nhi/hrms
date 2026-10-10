import type { ReactNode } from "react";

/** Surface container with an optional header (title + actions). */
export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={["card", className].filter(Boolean).join(" ")}>
      {(title || actions) && (
        <div className="card-header">
          {title ? <h2>{title}</h2> : <span />}
          {actions && <div className="page-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
