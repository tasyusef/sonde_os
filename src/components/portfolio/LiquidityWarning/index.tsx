"use client";

import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TokenEntry {
  currency: string;
  issuer: string;
  name: string;
  valueUsd: number;
}

interface TokensResponse {
  tokens: TokenEntry[];
}

interface CurrentPortfolio {
  totalValueUsd: number;
}

/**
 * Flags tokens that represent a significant portfolio allocation
 * but may have limited liquidity (small value tokens held in large quantities).
 *
 * Heuristic: tokens worth > 5% of portfolio but < $500 total value
 * are likely illiquid (thin orderbook / low AMM TVL).
 */
export default function LiquidityWarning() {
  const { data: tokensData } = useSWR<TokensResponse>(
    CACHE_KEYS.portfolioTokens(),
    fetcher,
  );

  const { data: currentData } = useSWR<CurrentPortfolio>(
    CACHE_KEYS.portfolioCurrent(),
    fetcher,
  );

  if (!tokensData || !currentData) return null;

  const total = currentData.totalValueUsd || 1;
  const illiquid = tokensData.tokens
    .filter((t) => {
      const pctOfPortfolio = (t.valueUsd / total) * 100;
      // Significant allocation (>5%) but very low absolute value (<$500)
      // suggests thin liquidity — hard to exit without slippage
      return pctOfPortfolio > 5 && t.valueUsd < 500;
    })
    .sort((a, b) => b.valueUsd - a.valueUsd);

  if (illiquid.length === 0) return null;

  return (
    <div className="space-y-2">
      {illiquid.map((t) => (
        <div
          key={`${t.currency}:${t.issuer}`}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2",
            "border-brand/20 bg-brand/5",
          )}
          role="status"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0 text-brand"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <p className="font-mono text-label text-secondary">
            <strong>{t.name}</strong> ({formatVolume(t.valueUsd)},{" "}
            {((t.valueUsd / total) * 100).toFixed(1)}% of portfolio) — may have
            limited liquidity
          </p>
        </div>
      ))}
    </div>
  );
}
