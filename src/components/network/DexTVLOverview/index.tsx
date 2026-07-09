"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import Image from "next/image";
import Toggle from "@/components/shared/Toggle";
import { CACHE_KEYS } from "@/lib/swr-config";
import type { DexTVLData, DexTVLPool } from "@/types/analytics";

type SortKey = "tvl" | "fee" | "holders";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "tvl", label: "TVL" },
  { value: "fee", label: "Fee" },
  { value: "holders", label: "Holders" },
];

function sortPools(pools: DexTVLPool[], key: SortKey): DexTVLPool[] {
  return [...pools].sort((a, b) => {
    if (key === "tvl") return b.tvlXrp - a.tvlXrp;
    if (key === "fee") return b.tradingFee - a.tradingFee;
    return b.holders - a.holders;
  });
}

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatXrp(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatFee(bps: number): string {
  return `${(bps / 1000).toFixed(2)}%`;
}

export function DexTVLOverview() {
  const [sortKey, setSortKey] = useState<SortKey>("tvl");

  const { data, isLoading } = useSWR<DexTVLData>(CACHE_KEYS.dexTvl());

  const sortedPools = useMemo(
    () => (data ? sortPools(data.topPools, sortKey) : []),
    [data, sortKey],
  );

  if (isLoading) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-6" role="status" aria-label="Loading DEX data">
        <p className="font-mono text-body text-muted">Loading DEX data...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-6">
        <p className="font-mono text-body text-muted">No AMM pool data available</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl shadow-card bg-surface">
      {/* Header — matches FeeBurnChart / CorridorChart pattern */}
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="font-display text-label font-bold uppercase tracking-header text-brand">
            DEX Liquidity (AMM TVL)
          </span>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-mono text-value font-medium tabular-nums text-primary">
              {formatUsd(data.totalTvlUsd)}
            </span>
            <span className="font-mono text-cell text-muted">
              {formatXrp(data.totalTvlXrp)} XRP · {data.poolCount} pools
            </span>
          </div>
        </div>
        <Toggle options={SORT_OPTIONS} active={sortKey} onChange={setSortKey} />
      </div>

      {/* Top pools table */}
      {sortedPools.length > 0 && (
        <div className="px-4 py-3">
          <table className="w-full">
            <thead>
              <tr>
                <th scope="col" className="pb-1 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
                  Pool
                </th>
                <th scope="col" className="pb-1 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                  {sortKey === "tvl" && "TVL (XRP)"}
                  {sortKey === "fee" && "Fee"}
                  {sortKey === "holders" && "Holders"}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPools.map((pool) => (
                <tr key={pool.account} className="border-b border-elevated last:border-b-0">
                  <td className="py-row-compact">
                    <div className="flex items-center gap-2">
                      {pool.imageUrl && (
                        <Image
                          src={pool.imageUrl}
                          alt=""
                          width={20}
                          height={20}
                          className="h-5 w-5 rounded-full"
                          unoptimized
                        />
                      )}
                      <span className="font-mono text-cell font-medium text-primary">
                        XRP / {pool.currency}
                      </span>
                      {pool.issuerName && (
                        <span className="font-mono text-tag text-muted">
                          ({pool.issuerName})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-row-compact text-right font-mono text-cell tabular-nums text-secondary">
                    {sortKey === "tvl" && formatXrp(pool.tvlXrp)}
                    {sortKey === "fee" && formatFee(pool.tradingFee)}
                    {sortKey === "holders" && pool.holders.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DexTVLOverview;
