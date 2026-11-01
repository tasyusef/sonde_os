/** Measured widths for the tab row, in px. */
export interface TabMetrics {
  /** Each tab's rendered width, in tab order. */
  widths: number[];
  /** Width available to the row. */
  available: number;
  /** Gap between adjacent items (tabs and the More trigger). */
  gap: number;
  /** Width of the "More" trigger. */
  moreWidth: number;
}

/**
 * Indices (ascending) of the tabs that stay in the strip; the rest go
 * under "More". When everything fits there is no More trigger.
 *
 * The active tab is always kept: it's what the panel's
 * `aria-labelledby` points at, so it has to exist as a `role="tab"`
 * even when it'd naturally overflow. The others fill in tab order until
 * the next one (plus the More trigger) no longer fits. At least one tab
 * always shows, even if it alone is too wide.
 */
export function fitTabs(
  { widths, available, gap, moreWidth }: TabMetrics,
  activeIndex: number,
): number[] {
  const all = widths.map((_, i) => i);
  const total =
    widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available) return all;

  const budget = available - gap - moreWidth;
  const keep = new Set<number>();
  let used = 0;
  if (activeIndex >= 0 && activeIndex < widths.length) {
    keep.add(activeIndex);
    used = widths[activeIndex];
  }
  for (const i of all) {
    if (keep.has(i)) continue;
    const needed = used + (keep.size > 0 ? gap : 0) + widths[i];
    if (needed > budget) break;
    keep.add(i);
    used = needed;
  }
  if (keep.size === 0 && widths.length > 0) keep.add(0);
  return all.filter((i) => keep.has(i));
}
