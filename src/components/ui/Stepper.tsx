import { t } from "@/i18n";

export type StepperItem<T extends string> = { id: T; label: string };

/**
 * Step indicator for short wizards (UI-8). State is given in text, not colour only: the current step carries
 * aria-current="step", completed steps say "Completed". Visited steps can be revisited; later ones cannot be skipped to.
 */
export function Stepper<T extends string>({
  items,
  current,
  visited,
  onSelect,
  label,
}: {
  items: StepperItem<T>[];
  current: T;
  visited: readonly T[];
  onSelect?: (id: T) => void;
  label: string;
}) {
  const currentIndex = items.findIndex((i) => i.id === current);
  return (
    <nav aria-label={label}>
      <ol className="stepper" style={{ "--stepper-count": items.length } as React.CSSProperties}>
        {items.map((item, i) => {
          const state = i === currentIndex ? "current" : visited.includes(item.id) && i < currentIndex ? "done" : visited.includes(item.id) ? "visited" : "todo";
          const content = (
            <>
              <span className="stepper-number" aria-hidden="true">
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className="stepper-label">{item.label}</span>
              {state === "done" && <span className="sr-only"> ({t("ui.stepCompleted")})</span>}
            </>
          );
          return (
            <li key={item.id} className={`stepper-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
              {onSelect && state !== "current" && state !== "todo" ? (
                <button type="button" className="stepper-button" onClick={() => onSelect(item.id)}>
                  {content}
                </button>
              ) : (
                <span className="stepper-button">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
