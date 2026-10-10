"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { t } from "@/i18n";
import { IconClose } from "./icons";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focused workflow dialog: title → description → body → footer (Cancel / primary). Keyboard-safe: focus moves into the
 * dialog, Tab stays inside, Escape closes (unless `busy`), focus returns to the opener on close, and the page behind
 * does not scroll. `variant="drawer"` (UI-9) shows the same dialog as a right-side panel for longer workflows.
 */
export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  busy = false,
  wide = false,
  variant = "dialog",
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  variant?: "dialog" | "drawer";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // Latest busy/onClose for the document key handler, updated after render (never during render).
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  useEffect(() => {
    busyRef.current = busy;
    closeRef.current = onClose;
  }, [busy, onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    // Scope every selector alternative to the body, so the first field (not the × button) receives focus.
    const inBody = FOCUSABLE.split(",").map((sel) => `.modal-body ${sel.trim()}`).join(", ");
    const first = dialog?.querySelector<HTMLElement>(inBody) ?? dialog?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (!dialog) return;
      if (e.key === "Escape" && !busyRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div className={variant === "drawer" ? "modal-overlay drawer-overlay" : "modal-overlay"}>
      <div
        ref={ref}
        className={["modal", wide ? "wide" : "", variant === "drawer" ? "drawer" : ""].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && (
              <p id={descId} className="modal-description">
                {description}
              </p>
            )}
          </div>
          <button type="button" className="ghost modal-close" onClick={onClose} disabled={busy} aria-label={t("ui.close")}>
            <IconClose />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
