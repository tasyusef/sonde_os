"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import { formatVolume } from "@/lib/format";
import Toggle from "@/components/shared/Toggle";
import Skeleton from "@/components/shared/Skeleton";

type Period = "24h" | "7d" | "30d" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

interface StatsResponse {
  stats: {
    itemCount: number;
    liveCount: number;
    holderCount: number;
    floorDrops: string | null;
    volumes: {
      h24Drops: string;
      d7Drops: string;
      d30Drops: string;
      allDrops: string;
      h24Trades: number;
      d7Trades: number;
      d30Trades: number;
      allTrades: number;
    };
  } | null;
}

/**
 * Collection stats strip with a period toggle for the volume cell.
 * Items / Holders / Floor stay constant; Volume + trade count
 * cycle through 24h / 7d / 30d / all.
 *
 * Client component because the period toggle needs interactivity.
 * Data is fetched once for all periods (the underlying CH query
 * returns all four splits in one pass) so toggling between them is
 * instant — no extra round-trip.
 *
 * Renders as a chrome-less fragment — meant to be embedded inside
 * `<CollectionHero bottomSlot=…>` which provides the outer card
 * surface and the top divider. Don't render this directly without a
 * card wrapper or it'll float ungrounded on the page.
 */
export default function CollectionStats({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const [period, setPeriod] = useState<Period>("24h");

  const { data, isLoading } = useSWR<StatsResponse>(
    `/api/nft/collection/${issuer}/${taxon}/stats`,
    fetcher,
  );

  if (isLoading || !data) {
    return (
      <div aria-label="Collection stats" className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-elevated px-4 py-2.5">
          <Skeleton className="h-[14px] w-[60px]" />
          <Skeleton className="h-[28px] w-[160px] rounded-full" />
        </div>
        <div className="grid grid-cols-2 [&>:nth-child(-n+2)]:border-b [&>:nth-child(-n+2)]:border-elevated [&>:nth-child(odd)]:border-r [&>:nth-child(odd)]:border-elevated">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1 px-4 py-3">
              <Skeleton className="h-[10px] w-[50px]" />
              <Skeleton className="h-[14px] w-[70px]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const stats = data.stats;
  if (!stats) return null;

  const floorXrp =
    stats.floorDrops != null ? Number(dropsToXrp(stats.floorDrops)) : null;

  const volumeDrops =
    period === "24h"
      ? stats.volumes.h24Drops
      : period === "7d"
        ? stats.volumes.d7Drops
        : period === "30d"
          ? stats.volumes.d30Drops
          : stats.volumes.allDrops;

  const trades =
    period === "24h"
      ? stats.volumes.h24Trades
      : period === "7d"
        ? stats.volumes.d7Trades
        : period === "30d"
          ? stats.volumes.d30Trades
          : stats.volumes.allTrades;

  const volumeXrp = Number(dropsToXrp(volumeDrops));

  return (
    <div aria-label="Collection stats" className="flex h-full flex-col">
      {/* Period toggle row — only drives the volume cell. Header
           sits inline with the toggle so the section reads as:
           header → 2x2 grid of stats. Same shape mobile and desktop. */}
      <div className="flex items-center justify-between gap-3 border-b border-elevated px-4 py-1.5">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Stats
        </span>
        <Toggle options={PERIODS} active={period} onChange={setPeriod} />
      </div>

      {/* 2x2 grid both mobile and desktop. The desktop sidebar (320px
           fixed) is narrow enough that two columns of stacked stats
           feels more balanced than four full-width rows.
           Borders are applied position-aware (right on left-column
           cells, bottom on top-row cells) rather than via `divide-*`
           — Tailwind's `divide-x`/`divide-y` flat-list selectors put
           stub borders on Holders' top and Floor's left that don't
           respect the grid's row/column structure. */}
      <div className="grid grid-cols-2 [&>:nth-child(-n+2)]:border-b [&>:nth-child(-n+2)]:border-elevated [&>:nth-child(odd)]:border-r [&>:nth-child(odd)]:border-elevated">
        <Stat
          label="Items"
          value={stats.liveCount.toLocaleString()}
          sub={`${stats.itemCount.toLocaleString()} minted`}
        />
        <Stat label="Holders" value={stats.holderCount.toLocaleString()} />
        <Stat
          label="Floor"
          value={
            floorXrp != null
              ? `${floorXrp.toLocaleString(undefined, { maximumFractionDigits: 4 })} XRP`
              : "—"
          }
          accent
        />
        <Stat
          label={`Volume ${PERIODS.find((p) => p.value === period)?.label ?? ""}`}
          value={volumeXrp > 0 ? `${formatVolume(volumeXrp)} XRP` : "—"}
          sub={trades > 0 ? `${trades.toLocaleString()} trades` : undefined}
        />
      </div>
    </div>
  );
}

/**
 * A single stat cell — label stacked above value. Same layout on
 * mobile and the desktop sidebar (both use a 2x2 grid).
 */
function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <span className="font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      <div className="min-w-0">
        <p
          className={`truncate font-mono text-cell font-medium tabular-nums ${
            accent ? "text-brand" : "text-primary"
          }`}
        >
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 truncate font-mono text-tag text-muted">{sub}</p>
        )}
      </div>
    </div>
  );
}
