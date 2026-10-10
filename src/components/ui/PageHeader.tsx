import Link from "next/link";
import type { ReactNode } from "react";

/** Page title area: optional back link, title, subtitle and right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <Link href={back.href} className="back">
            ← {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
