"use client";

import { useState } from "react";
import Treemap from "@/components/shared/Treemap";
import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TreemapItem } from "./types";

/* Portfolio allocation treemap.
 *
 * Each cell is a token sized by USD value; cell tint runs success → error
 * by PnL %, intensity scales with magnitude of move. Replaces a Recharts
 * <Treemap> implementation that had brittle SVG custom rendering and no
 * working animation. */

/* Mirrors --treemap-font-lg / --treemap-font-sm in globals.css. JS
 * constant form is necessary because the rendered size is a runtime
 * `Math.min(token, width/N)` clamp — we can't drop into CSS calc()
 * without losing the cell-width input. Keep the values in sync with
 * the CSS tokens. */
const TREEMAP_FONT_LG = 13;
const TREEMAP_FONT_SM = 11;

function pnlBackgroundColor(pnlPct: number): string {
  // Map |pnlPct| to a 0.15 - 0.6 alpha range; sign picks the channel.
  const intensity = Math.min(Math.abs(pnlPct) / 50, 1);
  const alpha = 0.15 + intensity * 0.45;
  // Using rgba directly so we don't need to register CSS variables for
  // success/error in alpha form. The hex values match
  // var(--color-success) and var(--color-error) approximately.
  return pnlPct >= 0
    ? `rgba(34, 197, 94, ${alpha})`
    : `rgba(239, 68, 68, ${alpha})`;
}

function PortfolioCell({
  item,
  width,
  height,
  isHovered,
  onHoverChange,
}: {
  item: TreemapItem;
  width: number;
  height: number;
  isHovered: boolean;
  onHoverChange: (key: string | null) => void;
}) {
  const showName = width > 40 && height > 28;
  const showPct = showName && width > 50 && height > 42 && item.pnlPct !== 0;

  return (
    <button
      type="button"
      className="group relative h-full w-full rounded transition-opacity duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      style={{
        backgroundColor: pnlBackgroundColor(item.pnlPct),
        opacity: isHovered ? 1 : undefined,
      }}
      onPointerEnter={() => onHoverChange(item.name)}
      onPointerLeave={() => onHoverChange(null)}
      aria-label={`${item.name}: ${formatVolume(item.value)}, PnL ${item.pnlPct >= 0 ? "+" : ""}${item.pnlPct.toFixed(1)}%`}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1">
        {showName && (
          <span
            className="max-w-full truncate font-mono font-semibold text-primary"
            style={{ fontSize: Math.min(TREEMAP_FONT_LG, width / 6) }}
          >
            {item.name}
          </span>
        )}
        {showPct && (
          <span
            className={cn(
              "font-mono font-medium tabular-nums",
              item.pnlPct >= 0 ? "text-success" : "text-error",
            )}
            style={{ fontSize: Math.min(TREEMAP_FONT_SM, width / 7) }}
          >
            {item.pnlPct >= 0 ? "+" : ""}
            {item.pnlPct.toFixed(1)}%
          </span>
        )}
      </div>
    </button>
  );
}

function HoverTooltip({ item }: { item: TreemapItem | null }) {
  if (!item) return null;
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium text-primary">{item.name}</p>
      <p className="font-mono text-tag text-muted">{formatVolume(item.value)}</p>
      <p
        className={cn(
          "font-mono text-tag font-semibold tabular-nums",
          item.pnlPct >= 0 ? "text-success" : "text-error",
        )}
      >
        PnL: {item.pnlPct >= 0 ? "+" : ""}
        {item.pnlPct.toFixed(1)}%
      </p>
    </div>
  );
}

export default function TreemapView({ data }: { data: TreemapItem[] }) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const hovered = data.find((d) => d.name === hoveredKey) ?? null;

  return (
    <div className="relative h-[280px] w-full">
      <Treemap
        data={data}
        getValue={(d) => d.value}
        getKey={(d) => d.name}
        algorithm="binary"
        padding={2}
        ariaLabel="Portfolio allocation treemap"
        renderCell={(d, w, h) => (
          <PortfolioCell
            item={d}
            width={w}
            height={h}
            isHovered={hoveredKey === d.name}
            onHoverChange={setHoveredKey}
          />
        )}
      />
      <HoverTooltip item={hovered} />
    </div>
  );
}
