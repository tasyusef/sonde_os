"use client";

import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { decodeCurrency, truncate } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";

interface Snapshot {
  ammValueUsd: number;
}

interface HistoryResponse {
  snapshots: Snapshot[];
}

interface AMMPosition {
  ammAccount: string;
  asset1Currency: string;
  asset1Issuer: string;
  asset1Name: string;
  asset1Value: number;
  asset1IsXrp: boolean;
  asset2Currency: string;
  asset2Issuer: string;
  asset2Name: string;
  asset2Value: number;
  asset2IsXrp: boolean;
  lpBalance: number;
  sharePercent: number;
  totalValueUsd: number;
  tradingFee: number;
}

interface AMMResponse {
  positions: AMMPosition[];
  totalValueUsd: number;
}

export default function DeFiPanel() {
  const { data, isLoading, error } = useSWR<AMMResponse>(
    CACHE_KEYS.portfolioAmm(),
    fetcher,
  );

  const { data: historyData } = useSWR<HistoryResponse>(
    CACHE_KEYS.portfolioHistory("all"),
    fetcher,
  );

  const positions = data?.positions ?? [];

  // Estimate LP returns from snapshot history (rough proxy)
  const firstSnapshot = historyData?.snapshots?.[0];
  const currentAmm = data?.totalValueUsd ?? 0;
  const firstAmm = firstSnapshot?.ammValueUsd ?? 0;
  const estReturns = currentAmm > 0 && firstAmm > 0 ? currentAmm - firstAmm : null;

  if (isLoading) {
    return (
      <section className="rounded-2xl shadow-card bg-surface">
        <div
          className="flex h-32 items-center justify-center"
          role="status"
          aria-label="Loading DeFi positions"
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl shadow-card bg-surface">
        <div role="alert" className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="font-mono text-cell text-error">Couldn&apos;t load DeFi positions.</p>
          <p className="font-mono text-tag text-muted">Try refreshing the page.</p>
        </div>
      </section>
    );
  }

  if (positions.length === 0) {
    return (
      <section className="flex flex-col items-center justify-center rounded-2xl bg-surface py-16 shadow-card">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-4 text-muted"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </svg>
        <h3 className="font-display text-heading font-semibold text-primary">
          No AMM Positions
        </h3>
        <p className="mt-2 max-w-sm text-center font-body text-body text-secondary">
          You don&apos;t have any active liquidity provider positions. Add
          liquidity to an AMM pool to see your positions here.
        </p>
      </section>
    );
  }

  function pairLabel(pos: AMMPosition) {
    const a1 = pos.asset1IsXrp
      ? "XRP"
      : pos.asset1Name || decodeCurrency(pos.asset1Currency);
    const a2 = pos.asset2IsXrp
      ? "XRP"
      : pos.asset2Name || decodeCurrency(pos.asset2Currency);
    return `${a1} / ${a2}`;
  }

  function formatAsset(value: number, isXrp: boolean) {
    if (isXrp) return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} XRP`;
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }

  /**
   * Estimate impermanent loss from the current pool asset ratio.
   * For a constant-product AMM, IL = 2*sqrt(r)/(1+r) - 1
   * where r = price_ratio_change. Without entry data, we derive r
   * from the current asset value imbalance (assumes 50/50 entry).
   */
  function estimateIL(pos: AMMPosition): number | null {
    const share = pos.sharePercent / 100;
    if (share <= 0) return null;

    // User's share of each asset's USD value
    const v1 = pos.totalValueUsd > 0
      ? pos.asset1Value * share
      : 0;
    const v2 = pos.totalValueUsd > 0
      ? pos.asset2Value * share
      : 0;

    if (v1 <= 0 || v2 <= 0) return null;

    // r = ratio of current values (for a 50/50 entry, entry ratio was 1:1 in USD)
    // The pool ratio r = v1/v2 (if entry was 1:1, this reflects the price change)
    const r = v1 / v2;
    // IL formula: 2*sqrt(r)/(1+r) - 1
    const il = (2 * Math.sqrt(r)) / (1 + r) - 1;
    return il * 100; // as percentage (always negative or zero)
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Est. LP Returns card */}
      {estReturns != null && (
        <div className="flex items-center justify-between rounded-xl bg-elevated px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-label font-medium uppercase tracking-header text-muted">
              Est. LP Returns (incl. IL)
            </span>
            <span className="font-mono text-tag text-muted">
              Since first snapshot — includes price changes
            </span>
          </div>
          <span
            className={cn(
              "font-mono text-value font-medium tabular-nums",
              estReturns >= 0 ? "text-success" : "text-error",
            )}
          >
            {estReturns >= 0 ? "+" : ""}
            {formatVolume(estReturns)}
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      {/* Summary */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-3">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          AMM Positions
        </span>
        <span className="font-mono text-value font-medium tabular-nums text-primary">
          {formatVolume(data?.totalValueUsd ?? 0)}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-elevated">
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-display text-label font-medium uppercase tracking-header text-muted"
              >
                Pool
              </th>
              <th
                scope="col"
                className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted sm:table-cell"
              >
                Share
              </th>
              <th
                scope="col"
                className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted md:table-cell"
              >
                Asset 1
              </th>
              <th
                scope="col"
                className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted md:table-cell"
              >
                Asset 2
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted"
              >
                Value
              </th>
              <th
                scope="col"
                className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted lg:table-cell"
              >
                Fee
              </th>
              <th
                scope="col"
                className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted lg:table-cell"
              >
                Est. IL
              </th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => (
              <tr
                key={pos.ammAccount}
                className="border-b border-elevated last:border-b-0"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-cell font-medium text-primary">
                      {pairLabel(pos)}
                    </span>
                    <span className="font-mono text-label text-muted">
                      {truncate(pos.ammAccount, 5)}
                    </span>
                  </div>
                </td>
                <td className="hidden px-4 py-3 text-right font-mono text-cell tabular-nums text-secondary sm:table-cell">
                  {pos.sharePercent.toFixed(4)}%
                </td>
                <td className="hidden px-4 py-3 text-right font-mono text-cell tabular-nums text-secondary md:table-cell">
                  {formatAsset(pos.asset1Value * (pos.sharePercent / 100), pos.asset1IsXrp)}
                </td>
                <td className="hidden px-4 py-3 text-right font-mono text-cell tabular-nums text-secondary md:table-cell">
                  {formatAsset(pos.asset2Value * (pos.sharePercent / 100), pos.asset2IsXrp)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cell font-medium tabular-nums text-primary">
                  {formatVolume(pos.totalValueUsd)}
                </td>
                <td
                  className={cn(
                    "hidden px-4 py-3 text-right font-mono text-cell tabular-nums text-muted lg:table-cell",
                  )}
                >
                  {(pos.tradingFee / 1000).toFixed(2)}%
                </td>
                <td className="hidden px-4 py-3 text-right font-mono text-cell tabular-nums lg:table-cell">
                  {(() => {
                    const il = estimateIL(pos);
                    if (il == null) return <span className="text-muted">—</span>;
                    return (
                      <span className={il < -1 ? "text-error" : "text-muted"}>
                        {il.toFixed(2)}%
                      </span>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </section>
  );
}
