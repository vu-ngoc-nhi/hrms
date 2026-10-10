// UI-9 workflow surface model (pure). One Employee Detail workflow is open at a time, in a Drawer (multi-field
// workflows, long previews) or a Modal (short ones). Business logic stays in the unchanged workflow forms and the server.
import type { ActionId } from "./detailModel";

export type DetailTab = "overview" | "personal" | "employment" | "assignment" | "history";
export type WorkflowTarget = { periodId?: string; assignmentId?: string };
export type OpenWorkflow = { action: ActionId; target: WorkflowTarget; n: number };

const MODAL_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>(["edit_work_email", "correct_work_email", "clear_work_email", "cancel_planned", "reverse_end"]);

/** Drawer for multi-field workflows and long previews (End Employment, Void); Modal for short, focused ones. */
export const surfaceFor = (action: ActionId): "drawer" | "modal" => (MODAL_ACTIONS.has(action) ? "modal" : "drawer");

// Corrections of wrongly recorded data carry the "Correct record" explanation (never shown on business changes).
// Cancel Planned / Reverse End are recovery actions with their own explanation; Correct Name or Date of Birth has its own.
const DATA_CORRECTIONS: ReadonlySet<ActionId> = new Set<ActionId>(["correct_period", "correct_work_email", "clear_work_email", "correct_assignment"]);
export const isDataCorrection = (action: ActionId) => DATA_CORRECTIONS.has(action);

/** Where HR lands after a successful workflow. */
export function successTab(action: ActionId): DetailTab {
  if (action === "change_assignment" || action === "initial_assignment" || action === "correct_assignment") return "assignment";
  if (action === "edit_personal" || action === "correct_personal") return "personal";
  return "employment";
}

/** Opening a workflow always replaces the previous one: never two forms mounted at once. */
export const openWorkflow = (current: OpenWorkflow | null, action: ActionId, target: WorkflowTarget = {}): OpenWorkflow => ({
  action,
  target,
  n: (current?.n ?? 0) + 1,
});

/** Close request (Escape, ×): unchanged forms close at once; changed ones ask first. No drafts are kept. */
export const shouldClose = (dirty: boolean, confirm: () => boolean) => !dirty || confirm();
