import type { DetailTab } from "./workflowModel";

// Employee Detail tab ↔ URL (owner acceptance fix, same pattern as C-114): the tab is read from the ROUTER's search
// params — never from window.location, which during an in-app navigation still holds the previous page — so canonical
// links such as /employees/{id}?tab=contracts open the right tab from a direct URL, an in-app link, a refresh and
// Back / Forward. Overview is the bare URL.
export const DETAIL_TABS: readonly DetailTab[] = ["overview", "personal", "employment", "assignment", "contracts", "history"];

/** The tab named by a `?tab=` value; unknown or missing values mean Overview. */
export function tabFromQuery(value: string | null | undefined): DetailTab {
  return (DETAIL_TABS as readonly string[]).includes(value ?? "") ? (value as DetailTab) : "overview";
}

/** The canonical address of a tab of this record. */
export const tabHref = (pathname: string, tab: DetailTab) => `${pathname}${tab === "overview" ? "" : `?tab=${tab}`}`;
