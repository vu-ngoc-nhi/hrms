import { useState } from "react";

/**
 * UI-3: a workflow form opened from the Employee header (primary action or More actions) instead of its own button.
 * The form starts open and tells the page when it closes (Cancel or after saving); its content and logic are unchanged.
 */
export type Launched = { onClose: () => void };

export function useFormOpen(launched?: Launched) {
  const [open, setOpenState] = useState(Boolean(launched));
  const setOpen = (value: boolean) => {
    setOpenState(value);
    if (!value) launched?.onClose();
  };
  return [open, setOpen] as const;
}
