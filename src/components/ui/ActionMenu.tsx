"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { IconChevronDown } from "./icons";
import { nextRovingIndex } from "./keyboard";

export type ActionMenuEntry =
  | { type: "item"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { type: "group"; label: string }
  | { type: "separator" };

/**
 * Menu button (WAI-ARIA menu pattern): Enter/Space/ArrowDown opens, arrows/Home/End move, Escape closes and returns
 * focus to the trigger, Tab or a click outside closes. Callers pass only the actions the user is allowed to perform.
 */
export function ActionMenu({ label, entries, variant = "secondary" }: { label: ReactNode; entries: ActionMenuEntry[]; variant?: "secondary" | "primary" }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const items = entries.filter((e): e is Extract<ActionMenuEntry, { type: "item" }> => e.type === "item" && !e.disabled);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!entries.some((e) => e.type === "item")) return null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    const next = nextRovingIndex(current < 0 ? 0 : current, e.key, items.length, "vertical");
    if (next !== null) {
      e.preventDefault();
      itemRefs.current[next]?.focus();
    }
  };

  let itemIndex = -1;
  return (
    <div className="action-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={variant === "primary" ? "primary" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
        <IconChevronDown />
      </button>
      {open && (
        <ul id={menuId} className="action-menu-list" role="menu" onKeyDown={onMenuKey}>
          {entries.map((entry, i) => {
            if (entry.type === "separator") return <li key={i} role="separator" className="action-menu-separator" />;
            if (entry.type === "group")
              return (
                <li key={i} role="presentation" className="action-menu-group">
                  {entry.label}
                </li>
              );
            const enabled = !entry.disabled;
            const ref = enabled ? ++itemIndex : -1;
            return (
              <li key={i} role="none">
                <button
                  ref={(el) => {
                    if (ref >= 0) itemRefs.current[ref] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={!enabled}
                  className={entry.danger ? "action-menu-item danger" : "action-menu-item"}
                  onClick={() => {
                    close(true);
                    entry.onSelect();
                  }}
                >
                  {entry.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
