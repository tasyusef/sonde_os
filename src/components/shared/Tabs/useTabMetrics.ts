import { useLayoutEffect, useRef, useState } from "react";
import type { TabMetrics } from "./fitTabs";

const sameMetrics = (a: TabMetrics, b: TabMetrics) =>
  a.available === b.available &&
  a.gap === b.gap &&
  a.moreWidth === b.moreWidth &&
  a.widths.length === b.widths.length &&
  a.widths.every((w, i) => w === b.widths[i]);

/**
 * Measures the tab row for `fitTabs`. `measureRef` is a hidden replica
 * row: one child per tab, then the More trigger as the last child.
 * `containerRef` is the space the real row gets. `null` until the first
 * measurement, so the server render shows every tab.
 *
 * A layout effect takes a synchronous reading before paint, so a new tab
 * (Account's "Issued" arriving after load) never paints as one
 * overflowing row; the observer then refines it.
 *
 * Re-measures on container resize, when labels change (`labelsKey`, e.g.
 * a count landing in "Transactions (20)"), and when a web font swaps in
 * (each replica is observed, so its width change fires the observer).
 */
export function useTabMetrics(labelsKey: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<TabMetrics | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const items = Array.from(measure.children) as HTMLElement[];
    const more = items.pop();

    // Widths come from the observer's entries: layout sizes, so an
    // ancestor's entrance transform (scale) can't skew a reading taken
    // mid-animation the way getBoundingClientRect would, and fractional,
    // unlike offsetWidth, which only serves the synchronous first reading
    // and any element the observer hasn't reported yet.
    const sizes = new Map<Element, number>();
    const width = (el: HTMLElement) => sizes.get(el) ?? el.offsetWidth;

    const calculate = () => {
      const next: TabMetrics = {
        widths: items.map(width),
        available: width(container),
        gap: parseFloat(getComputedStyle(measure).columnGap) || 0,
        moreWidth: more ? width(more) : 0,
      };
      setMetrics((prev) => (prev && sameMetrics(prev, next) ? prev : next));
    };

    calculate();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        sizes.set(
          entry.target,
          entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width,
        );
      }
      calculate();
    });
    ro.observe(container);
    for (const el of measure.children) ro.observe(el);
    return () => ro.disconnect();
  }, [labelsKey]);

  return { containerRef, measureRef, metrics };
}
