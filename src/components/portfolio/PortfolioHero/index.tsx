"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { truncate } from "@/lib/xrpl-helpers";
import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";
import CopyButton from "@/components/shared/CopyButton";

interface CurrentPortfolio {
  xrpBalance: number;
  xrpPriceUsd: number;
  tokenValueUsd: number;
  nftCount: number;
  ammValueUsd: number;
  lockedXrp: number;
  totalValueUsd: number;
}

interface Snapshot {
  totalValueUsd: number;
}

interface HistoryResponse {
  snapshots: Snapshot[];
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return Math.abs(pct) >= 100
    ? `${sign}${pct.toFixed(0)}%`
    : `${sign}${pct.toFixed(2)}%`;
}

/**
 * Hero + mobile-only sticky compact bar that pins to the top of the
 * viewport once the user scrolls past the full hero. Shows just the
 * current total value and 24h change so users always see their balance
 * while scrolling through holdings/charts below.
 *
 * Desktop (lg+) renders the full hero only — no compact bar, since the
 * value is visible in the dashboard's vertical flow anyway.
 */
export default function PortfolioHero({ address }: { address: string }) {
  const { data } = useSWR<CurrentPortfolio>(
    CACHE_KEYS.portfolioCurrent(),
    fetcher,
  );
  const { data: historyData } = useSWR<HistoryResponse>(
    CACHE_KEYS.portfolioHistory("24h"),
    fetcher,
  );

  const total = data?.totalValueUsd ?? 0;
  const earliest = historyData?.snapshots?.[0];
  const totalChange =
    data && earliest ? pctChange(total, earliest.totalValueUsd) : undefined;

  // Scroll-driven visibility for the compact bar. Triggers around the
  // typical height of the full hero (~150px). Desktop media query is
  // handled in CSS (lg:hidden) so the listener runs but the bar is
  // always display:none on lg+.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 150);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Compact sticky bar — mobile only. Floats as a centered pill
           below the fixed mobile top bar (app header ends ~60px), with
           a small gap so it reads as its own floating surface rather
           than attached to the nav. */}
      <div
        aria-hidden={!scrolled}
        className={cn(
          "fixed left-1/2 top-[68px] z-30 -translate-x-1/2 rounded-full border border-elevated bg-surface shadow-card transition-all duration-200 lg:hidden",
          scrolled
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-2 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-1.5">
          <span className="font-mono text-label font-medium text-muted">
            {truncate(address, 4)}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-cell font-semibold tabular-nums text-primary">
              {data ? formatVolume(total) : "—"}
            </span>
            {data && totalChange != null && (
              <span
                className={cn(
                  "font-mono text-tag font-semibold tabular-nums",
                  totalChange >= 0 ? "text-success" : "text-error",
                )}
              >
                {formatChange(totalChange)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Full hero */}
      <section className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center gap-1.5">
          <span className="rounded-lg bg-elevated px-3 py-1.5 font-mono text-label font-medium text-brand">
            {truncate(address, 6)}
          </span>
          <CopyButton text={address} />
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-display text-label font-medium uppercase tracking-header text-muted">
            Total Portfolio Value
          </span>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-heading font-semibold tabular-nums tracking-display text-primary sm:text-title">
              {data ? formatVolume(total) : "—"}
            </span>
            {data && totalChange != null && (
              <span
                className={cn(
                  "font-mono text-label font-semibold tabular-nums",
                  totalChange >= 0 ? "text-success" : "text-error",
                )}
              >
                {formatChange(totalChange)}
              </span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
