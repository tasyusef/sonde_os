"use client";

import { useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { CACHE_KEYS } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import type { TokenVelocityEntry } from "@/types/analytics";

type Period = "7d" | "30d" | "90d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

function formatVolume(xrp: number): string {
  if (xrp >= 1_000_000) return `${(xrp / 1_000_000).toFixed(2)}M`;
  if (xrp >= 1_000) return `${(xrp / 1_000).toFixed(1)}K`;
  return xrp.toFixed(1);
}

// Unicode subscript digits ₀–₉ at U+2080–2089. Used for compact
// rendering of very small values via the DexScreener / GeckoTerminal
// convention: 0.0₇92 means "0." then 7 zeros then "92" (= 0.000000092).
// The visible "0" right after the decimal counts as one of the n zeros
// indicated by the subscript — it's the anchor character the subscript
// digit hangs off of, not a separate placeholder.
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT_DIGITS[Number(d)])
    .join("");
}

function formatVelocity(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "0";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);

  // Derive leadingZeros + sig digits from toExponential so mantissa
  // rollover (9.999e-5 → 1.0e-4) recomputes the correct zero count
  // instead of double-counting against the original value.
  const [mantissaStr, expPart] = v.toExponential(1).split("e");
  const exp = parseInt(expPart, 10);
  const leadingZeros = -exp - 1;

  // ≥4 leading zeros → subscript shorthand (0.0₇92 reads cleaner
  // than 0.000000092). Below that the plain decimal is short enough
  // to leave alone — switching threshold to 3 starts saving 2 chars
  // for marginal readability gain, not worth the extra subscript
  // glyph cost.
  if (leadingZeros >= 4) {
    const sigDigits = mantissaStr.replace(".", "");
    return `0.0${toSubscript(leadingZeros)}${sigDigits}`;
  }

  // 0.0001 ≤ v < 0.01 — plain decimal, ~3 sig figs, trim trailing zeros.
  const decimals = Math.min(leadingZeros + 3, 18);
  return v.toFixed(decimals).replace(/\.?0+$/, "");
}

function formatSupply(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function TokenVelocityChart() {
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<{
    tokens: TokenVelocityEntry[];
  }>(CACHE_KEYS.tokenVelocity(period));

  const loading = isLoading || isValidating;
  const tokens = raw?.tokens ?? [];
  const maxVelocity = tokens.length > 0 ? Math.max(...tokens.map((t) => t.velocity)) : 1;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Token Velocity"
        subtitle={
          /* Description-only subtitle — hide on mobile so the header
             collapses to title + toggle (the title is self-explanatory
             enough to skip the "Volume / Supply ratio" gloss on a
             phone). */
          <span className="hidden font-mono text-label text-muted sm:inline">
            Volume / Supply ratio
          </span>
        }
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div
        className={cn(
          "transition-opacity",
          loading && "opacity-40",
        )}
      >
        {tokens.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading velocity data..." : "No data available"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-elevated">
                  {/* Rank + Token columns deliberately tight: pl-4
                       puts # at the page edge, pr-0 + Token's pl-3
                       gives a 12px gap before the icon. Matches the
                       grid-cols-[16px_1fr_auto] gap-x-3 spacing used
                       by the Top Tokens card so the two leaderboard
                       cards read as a consistent pair. */}
                  <th scope="col" className="pl-4 pr-0 py-2 text-left font-display text-label font-medium uppercase tracking-header text-muted">
                    #
                  </th>
                  <th scope="col" className="pl-3 pr-4 py-2 text-left font-display text-label font-medium uppercase tracking-header text-muted">
                    Token
                  </th>
                  <th scope="col" className="hidden px-4 py-2 text-right font-display text-label font-medium uppercase tracking-header text-muted sm:table-cell">
                    Volume (XRP)
                  </th>
                  <th scope="col" className="hidden px-4 py-2 text-right font-display text-label font-medium uppercase tracking-header text-muted md:table-cell">
                    Supply
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-display text-label font-medium uppercase tracking-header text-muted">
                    Velocity
                  </th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token, i) => (
                  <tr
                    key={`${token.currency}-${token.issuer}`}
                    className="border-b border-elevated last:border-b-0"
                  >
                    <td className="pl-4 pr-0 py-2.5 font-mono text-cell text-muted">
                      {i + 1}
                    </td>
                    <td className="pl-3 pr-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {token.icon && (
                          <Image
                            src={token.icon}
                            alt=""
                            width={20}
                            height={20}
                            className="h-5 w-5 rounded-full"
                            unoptimized
                          />
                        )}
                        <div>
                          <span className="font-mono text-cell font-medium text-primary">
                            {token.currencyDisplay}
                          </span>
                          {token.issuerName && (
                            <span className="ml-1.5 font-mono text-label text-muted">
                              {token.issuerName}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-right font-mono text-cell tabular-nums text-primary sm:table-cell">
                      {formatVolume(token.volumeXrp)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right font-mono text-cell tabular-nums text-muted md:table-cell">
                      {formatSupply(token.totalSupply)}
                    </td>
                    <td className="relative px-4 py-2.5 text-right">
                      <div
                        className="absolute inset-y-0 right-0 bg-brand/10"
                        style={{ width: `${(token.velocity / maxVelocity) * 100}%` }}
                      />
                      <span className="relative font-mono text-cell font-medium tabular-nums text-primary">
                        {formatVelocity(token.velocity)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default TokenVelocityChart;
