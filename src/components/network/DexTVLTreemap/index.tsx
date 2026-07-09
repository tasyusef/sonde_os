"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CACHE_KEYS } from "@/lib/swr-config";
import Treemap from "@/components/shared/Treemap";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import type { DexTVLData, DexTVLPool } from "@/types/analytics";

function formatXrp(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatFee(bps: number): string {
  return `${(bps / 1000).toFixed(2)}%`;
}

interface PoolCell {
  key: string;
  name: string;
  tvlXrp: number;
  fee: number;
  holders: number;
  imageUrl: string | null;
  /** Rank-based opacity so larger pools are slightly more saturated */
  fill: number;
}

/* Cell content — token logo (if present) + pair name + TVL pill. Hides
 * elements as the cell shrinks so a tiny tail-of-the-distribution rect
 * doesn't render with overflowing text. Sized in CSS so it matches the
 * surrounding design system. */
function PoolCellContent({
  pool,
  width,
  height,
  isHovered,
  onHoverChange,
}: {
  pool: PoolCell;
  width: number;
  height: number;
  isHovered: boolean;
  onHoverChange: (key: string | null) => void;
}) {
  const showLogo = width > 56 && height > 64 && pool.imageUrl;
  const showName = width > 50 && height > 30;
  const showValue = width > 60 && height > (showLogo ? 80 : 52);

  return (
    <button
      type="button"
      className="group relative h-full w-full rounded-lg transition-[opacity,transform] duration-200 ease-out hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      style={{
        backgroundColor: `color-mix(in srgb, var(--color-brand) ${Math.round(pool.fill * 100)}%, transparent)`,
        opacity: isHovered ? 1 : undefined,
      }}
      onPointerEnter={() => onHoverChange(pool.key)}
      onPointerLeave={() => onHoverChange(null)}
      aria-label={`${pool.name}: ${formatXrp(pool.tvlXrp)} XRP, ${formatFee(pool.fee)} fee, ${pool.holders.toLocaleString()} holders`}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2">
        {showLogo && pool.imageUrl ? (
          <span
            className="rounded-full bg-surface/50 ring-1 ring-elevated"
            style={{
              backgroundImage: `url(${pool.imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              width: 24,
              height: 24,
            }}
            aria-hidden="true"
          />
        ) : null}
        {showName && (
          <span className="max-w-full truncate font-mono text-cell font-medium text-primary">
            {pool.name}
          </span>
        )}
        {showValue && (
          <span className="rounded bg-surface/85 px-1.5 py-0.5 font-mono text-tag tabular-nums text-muted">
            {formatXrp(pool.tvlXrp)}
          </span>
        )}
      </div>
    </button>
  );
}

function HoverTooltip({ pool }: { pool: PoolCell | null }) {
  if (!pool) return null;
  return (
    <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-lg border border-elevated bg-surface px-3 py-2 shadow-card">
      <p className="font-mono text-cell font-medium text-primary">{pool.name}</p>
      <p className="mt-0.5 font-mono text-tag text-secondary">
        {formatXrp(pool.tvlXrp)} XRP
      </p>
      <p className="font-mono text-tag text-muted">
        Fee: {formatFee(pool.fee)} · {pool.holders.toLocaleString()} holders
      </p>
    </div>
  );
}

export default function DexTVLTreemap() {
  const { data, isLoading } = useSWR<DexTVLData>(CACHE_KEYS.dexTvl());
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const pools = useMemo<PoolCell[]>(() => {
    if (!data?.topPools) return [];
    const filtered = data.topPools
      .filter((p: DexTVLPool) => p.tvlXrp >= 1)
      .sort((a: DexTVLPool, b: DexTVLPool) => b.tvlXrp - a.tvlXrp);
    return filtered.map((pool: DexTVLPool, i: number) => ({
      key: `${pool.currency}:${pool.tradingFee}`,
      name: `XRP/${pool.currency}`,
      tvlXrp: pool.tvlXrp,
      fee: pool.tradingFee,
      holders: pool.holders,
      imageUrl: pool.imageUrl,
      // Rank-driven fill: top pool 45%, tail pools 25%. Subtle but enough
      // to read "this one's bigger" before doing the area-comparison.
      fill: 0.45 - (i / Math.max(filtered.length - 1, 1)) * 0.2,
    }));
  }, [data]);

  const hovered = pools.find((p) => p.key === hoveredKey) ?? null;

  if (isLoading) {
    return (
      <div
        className="flex h-[400px] items-center justify-center rounded-2xl shadow-card bg-surface p-6"
        role="status"
        aria-label="Loading DEX data"
      >
        <p className="font-mono text-body text-muted">Loading DEX data...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-2xl shadow-card bg-surface p-6">
        <p className="font-mono text-body text-muted">No AMM pool data available</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-[400px] flex-col rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="DEX Liquidity"
        subtitle={
          <>
            <span className="font-mono text-value font-medium tabular-nums text-primary">
              {formatUsd(data.totalTvlUsd)}
            </span>
            <span className="hidden font-mono text-cell text-muted sm:inline">
              {formatXrp(data.totalTvlXrp)} XRP · {data.poolCount} pools
            </span>
          </>
        }
      />

      <div className="relative min-h-0 flex-1 px-4 py-3">
        <Treemap
          data={pools}
          getValue={(p) => p.tvlXrp}
          getKey={(p) => p.key}
          algorithm="binary"
          padding={3}
          ariaLabel="AMM pool TVL distribution"
          renderCell={(p, w, h) => (
            <PoolCellContent
              pool={p}
              width={w}
              height={h}
              isHovered={hoveredKey === p.key}
              onHoverChange={setHoveredKey}
            />
          )}
        />
        <HoverTooltip pool={hovered} />
      </div>
    </div>
  );
}
