"use client";

import { useLiveData } from "@/hooks/useLiveData";
import { formatVolume } from "@/lib/format";
import type { NetworkStats, PriceData } from "@/types/live-data";

/**
 * Single-card market overview for the Network page hero. Same shape
 * as `account/OverviewCard` and `SmartMoneyOverviewCard`:
 *
 *   ┌──────────────────────────────────────┐
 *   │ ● LIVE              XRP Network      │
 *   ├──────────────────────────────────────┤
 *   │ $X.XXXX            +Y.YY%            │
 *   │ 24h volume $X.XXM                    │
 *   ├──────────────────────────────────────┤
 *   │ MARKET CAP │ CIRCULATING │ TOTAL     │
 *   └──────────────────────────────────────┘
 *
 * Pre-2026-05-10 this was a 3-card stack (XRP Price / 24h Activity
 * / Supply) with Framer Motion staggered entrance animations and a
 * `horizontal` flag for an alternate layout that no consumer used.
 * Consolidating mirrors the other overview cards' visual language
 * (status-dot + label + identifier header strip → big primary
 * value + sub-line → divide-x 3-col stats strip) and frees up
 * vertical real estate that the redesigned Overview needed.
 *
 * Last-Ledger Txns + Avg TPS dropped from this card — those are
 * network-state metrics rather than XRP-as-asset metrics, and the
 * `NetworkHealthBanner` already surfaces validated-ledger-seq +
 * load factor + ledger range in the same hero zone.
 */
export default function NetworkStatsBar({
  initialStats,
  initialPriceData,
  bottomSlot,
}: {
  initialStats: NetworkStats;
  initialPriceData?: PriceData | null;
  /**
   * Optional content rendered at the bottom of the card with a
   * top divider. Used by the Network Overview tab to embed
   * AnomalyFeed inside the overview card instead of leaving it
   * as a standalone strip above it.
   */
  bottomSlot?: React.ReactNode;
}) {
  const live = useLiveData();
  const stats = live.stats ?? initialStats;
  const priceData = live.price ?? initialPriceData ?? null;

  let totalXrp = 0;
  try {
    totalXrp = Number(BigInt(stats.totalCoins) / 1000000n) / 1_000_000_000;
  } catch {
    /* invalid totalCoins string — show 0 */
  }

  const circulatingXrp = priceData
    ? priceData.circulatingSupply / 1_000_000_000
    : null;
  const isUp = priceData ? priceData.change24h >= 0 : true;

  return (
    <section
      aria-label="XRP network market overview"
      className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
    >
      {/* Header — live status dot + identifier. Mirrors the
           "● BALANCE | rXXX...lLm | copy" / "● SMART MONEY | rXXX |
           copy" header strips on the account / smart-money
           overview cards. */}
      <div className="flex items-center justify-between gap-2 border-b border-elevated px-4 py-1.5">
        <span className="flex shrink-0 items-center gap-1.5 font-display text-label font-medium uppercase tracking-header text-muted">
          <span
            aria-hidden="true"
            className="inline-block size-1.5 animate-pulse rounded-full bg-success"
          />
          Live
        </span>
        <span className="font-mono text-label text-secondary">
          XRP Network
        </span>
      </div>

      {/* Hero — XRP price as the headline number, 24h change % to
           the right, 24h volume as the sub-line. Same typography as
           OverviewCard's xrp-balance / SmartMoneyOverviewCard's
           composite-score. */}
      <div className="px-6 py-5">
        {priceData ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <p className="font-mono text-display font-medium tabular-nums text-brand sm:text-display-lg">
                ${priceData.price.toFixed(4)}
              </p>
              <p
                className={`font-mono text-heading font-medium tabular-nums ${
                  isUp ? "text-success" : "text-error"
                }`}
              >
                {isUp ? "+" : ""}
                {priceData.change24h.toFixed(2)}%
              </p>
            </div>
            <p className="mt-1 font-mono text-cell tabular-nums text-secondary">
              {formatVolume(priceData.volume24h)} 24h volume
            </p>
          </>
        ) : (
          <p className="font-mono text-body text-muted">—</p>
        )}
      </div>

      {/* 3-col stats strip — divide-x mirrors OverviewCard's
           "Total Value | Reserve | Age" row. Each cell carries
           a label + value, optionally a sub-line. */}
      <div className="grid grid-cols-3 divide-x divide-elevated border-t border-elevated">
        <Stat label="Market Cap" accent>
          {priceData ? formatVolume(priceData.marketCap) : "—"}
        </Stat>
        <Stat
          label="Circulating"
          sub={
            circulatingXrp !== null && totalXrp > 0
              ? `of ${totalXrp.toFixed(2)}B total`
              : undefined
          }
        >
          {circulatingXrp !== null ? `${circulatingXrp.toFixed(2)}B XRP` : "—"}
        </Stat>
        <Stat
          label="Last Ledger"
          sub={`${stats.txCount.toLocaleString()} txns`}
        >
          ~{Math.round(stats.txCount / 4)} TPS
        </Stat>
      </div>

      {bottomSlot && (
        <div className="border-t border-elevated">
          {bottomSlot}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  children,
  sub,
  accent = false,
}: {
  label: string;
  children: React.ReactNode;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="block font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </span>
      <p
        className={`mt-1 truncate font-mono text-cell font-medium tabular-nums ${
          accent ? "text-brand" : "text-primary"
        }`}
      >
        {children}
      </p>
      {sub && (
        <p className="mt-0.5 truncate font-mono text-tag text-muted">{sub}</p>
      )}
    </div>
  );
}
