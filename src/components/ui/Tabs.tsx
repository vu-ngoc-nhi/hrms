"use client";

import { useRef, type KeyboardEvent } from "react";
import { nextRovingIndex } from "./keyboard";

export type TabItem<T extends string> = { id: T; label: string };

/** WAI-ARIA tabs (manual activation is not needed: arrows move focus and select). The panel is rendered by the caller
 *  with role="tabpanel" and aria-labelledby={`tab-${idPrefix}-${value}`}. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
  label,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  idPrefix: string;
  label: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const next = nextRovingIndex(index, e.key, items.length, "horizontal");
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next].id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${idPrefix}-${item.id}`}
          aria-controls={`panel-${idPrefix}-${item.id}`}
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
