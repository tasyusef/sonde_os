"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  hierarchy,
  treemap as d3Treemap,
  treemapBinary,
  treemapSquarify,
} from "d3-hierarchy";

/**
 * Generic treemap primitive.
 *
 * d3-hierarchy provides the layout math (which rectangle goes where given
 * each item's value). We render the cells as absolutely-positioned HTML
 * divs — better text rendering, real CSS transitions on resize, easy
 * interactive overlays, accessible DOM. The Recharts <Treemap> we
 * replaced was SVG-only, had brittle custom-content APIs, and animations
 * that didn't actually work.
 *
 * Consumers supply:
 *   - data: a flat array of items
 *   - getValue: how to size each item
 *   - getKey: stable React key for animation continuity across data shifts
 *   - renderCell: given the item and its computed pixel dimensions, what
 *     to render inside its rectangle
 *
 * Why both `binary` and `squarify` algorithms are exposed: binary tends
 * to look cleaner on heavily-skewed data (typical AMM TVL distribution
 * where the top pool dwarfs the rest); squarify produces more uniform
 * aspect ratios on balanced data. Default to binary because most of our
 * use cases are skewed.
 */

interface ComputedCell<T> {
  data: T;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreemapProps<T> {
  data: T[];
  getValue: (d: T) => number;
  getKey: (d: T) => string;
  renderCell: (d: T, width: number, height: number) => ReactNode;
  /** Tile algorithm. `binary` is better for skewed data, `squarify` for
   *  balanced. Default `binary`. */
  algorithm?: "binary" | "squarify";
  /** Inner padding between cells in px. Default 2. */
  padding?: number;
  ariaLabel?: string;
  className?: string;
}

export default function Treemap<T>({
  data,
  getValue,
  getKey,
  renderCell,
  algorithm = "binary",
  padding = 2,
  ariaLabel = "Treemap",
  className = "",
}: TreemapProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Measure the container so we can pass concrete pixels to d3.treemap.
  // Updating only on actual size change avoids layout thrash from spurious
  // ResizeObserver entries (e.g., subpixel reflow during ancestor animations).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const cr = entry.contentRect;
      setSize((prev) =>
        Math.round(prev.width) === Math.round(cr.width)
          && Math.round(prev.height) === Math.round(cr.height)
          ? prev
          : { width: cr.width, height: cr.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cells = useMemo<ComputedCell<T>[]>(() => {
    if (!size.width || !size.height || data.length === 0) return [];

    // d3-hierarchy expects a tree. Wrap our flat array in a synthetic root
    // whose children are the items. The hierarchy() factory walks the
    // children accessor; we tell it children exist on the root and not on
    // the leaves, so it stops traversal there.
    type Wrapped = { value: number; data: T };
    type Root = { children: Wrapped[] };
    const root: Root = {
      children: data.map((d) => ({ value: getValue(d), data: d })),
    };

    const h = hierarchy<Root | Wrapped>(
      root,
      (n) => ("children" in n ? n.children : undefined),
    ).sum((n) => ("children" in n ? 0 : n.value));

    const tile = algorithm === "squarify" ? treemapSquarify : treemapBinary;
    // Treemap layout mutates the hierarchy in place AND returns it
    // typed as HierarchyRectangularNode (with x0/x1/y0/y1 set on every
    // node). We capture the typed return so .leaves() comes back with
    // the rectangle coords resolved instead of as plain HierarchyNode.
    const laidOut = d3Treemap<Root | Wrapped>()
      .size([size.width, size.height])
      .paddingInner(padding)
      .tile(tile)(h);

    return laidOut.leaves().map((node) => {
      const wrapped = node.data as Wrapped;
      return {
        data: wrapped.data,
        x: node.x0,
        y: node.y0,
        width: node.x1 - node.x0,
        height: node.y1 - node.y0,
      };
    });
  }, [data, size.width, size.height, algorithm, padding, getValue]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      {cells.map((cell) => (
        <div
          key={getKey(cell.data)}
          className="absolute overflow-hidden transition-[left,top,width,height] duration-300 ease-out"
          style={{
            left: cell.x,
            top: cell.y,
            width: cell.width,
            height: cell.height,
          }}
        >
          {renderCell(cell.data, cell.width, cell.height)}
        </div>
      ))}
    </div>
  );
}
