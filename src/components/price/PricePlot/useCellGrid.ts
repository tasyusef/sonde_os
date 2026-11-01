import { type RefObject, useEffect, useState } from "react";
import { CELL } from "@/lib/pixel-chart";

/** How many whole cells fit the element, kept current as it resizes.
 *  Zero until the first measure, which happens after hydration. */
export function useCellGrid(ref: RefObject<HTMLElement | null>) {
  const [grid, setGrid] = useState({ cols: 0, rows: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const cols = Math.floor(entry.contentRect.width / CELL);
      const rows = Math.floor(entry.contentRect.height / CELL);
      setGrid((prev) => (prev.cols === cols && prev.rows === rows ? prev : { cols, rows }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return grid;
}
