/**
 * Roving-focus index math shared by the composite widgets (Toggle's
 * radiogroup, Tabs' tablist, ResponsiveSelect's listbox). Given a key and
 * the index of the item that has focus, returns the index that should
 * take focus next, or `null` when the key isn't a navigation key for
 * this widget (so the caller leaves it to the browser).
 *
 * - `orientation` picks which arrows count: tabs move on Left/Right,
 *   listboxes on Up/Down, radio groups on both (per the APG patterns).
 * - `wrap` loops past either end (tabs, radios); without it the index
 *   stops at the ends (listbox).
 * - `index` -1 means nothing in the widget is focused or selected yet:
 *   the forward keys land on the first item, the backward ones on the last.
 */
export type RovingOrientation = "horizontal" | "vertical" | "both";

export function rovingIndex(
  key: string,
  index: number,
  count: number,
  { orientation, wrap }: { orientation: RovingOrientation; wrap: boolean },
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;

  const horizontal = orientation !== "vertical";
  const vertical = orientation !== "horizontal";
  let step: 1 | -1;
  if ((horizontal && key === "ArrowRight") || (vertical && key === "ArrowDown")) step = 1;
  else if ((horizontal && key === "ArrowLeft") || (vertical && key === "ArrowUp")) step = -1;
  else return null;

  if (index < 0 || index >= count) return step === 1 ? 0 : count - 1;
  const next = index + step;
  if (wrap) return (next + count) % count;
  return Math.min(Math.max(next, 0), count - 1);
}
