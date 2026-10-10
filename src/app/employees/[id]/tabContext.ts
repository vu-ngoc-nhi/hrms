import type { Detail } from "./detailModel";

/** What each Employee Detail tab receives from the page. */
export type TabContext = {
  d: Detail;
  can: (permission: string) => boolean;
  /** The representative period whose primary actions live in the header (UI-3, D-UI-13). */
  targetId: string | null;
  onSaved: (updated: Detail, notice?: string) => void;
};
