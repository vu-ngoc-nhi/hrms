// Pure keyboard-navigation helpers shared by Tabs and ActionMenu (unit-tested; no DOM access).

/** Next index for roving focus among `count` items (wraps). Returns null for keys that do not move focus. */
export function nextRovingIndex(current: number, key: string, count: number, orientation: "horizontal" | "vertical"): number | null {
  if (count <= 0) return null;
  const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  if (key === forward) return (current + 1 + count) % count;
  if (key === backward) return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
