import type { ActionId, Detail } from "./detailModel";
import type { WorkflowTarget } from "./workflowModel";

/** What each Employee Detail tab receives from the page. */
export type TabContext = {
  d: Detail;
  can: (permission: string) => boolean;
  /** The representative period: its assignment action is the header's primary action (D-UI-13, D-UI-16). */
  targetId: string | null;
  /** Opens the single workflow surface (UI-9). */
  launch: (action: ActionId, target?: WorkflowTarget) => void;
};
