"use client";

import { useId, useState } from "react";
import { motion } from "motion/react";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import AddressLink from "@/components/shared/AddressLink";
import { CACHE_KEYS } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import type { TopTraderEntry } from "@/types/analytics";

type Mode = "volume" | "profit";
type Period = "24h" | "7d" | "30d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

const MODES: { value: Mode; label: string }[] = [
  { value: "volume", label: "Volume" },
  { value: "profit", label: "Profit" },
];

function formatVolume(xrp: number): string {
  const abs = Math.abs(xrp);
  const sign = xrp < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function TopTraders() {
  const [mode, setMode] = useState<Mode>("volume");
  const [period, setPeriod] = useState<Period>("24h");
  const layoutId = useId();

  const { data: raw, isLoading, isValidating } = useSWR<{
    traders: TopTraderEntry[];
  }>(CACHE_KEYS.topTraders(mode, period));

  const loading = isLoading || isValidating;
  const traders = raw?.traders ?? [];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Top Traders"
        subtitle={
          <span className="hidden font-mono text-cell font-medium text-muted sm:inline">
            {mode === "volume" ? "By total XRP trade volume" : "By estimated net profit (sells \u2212 buys)"}
          </span>
        }
        controls={
          <>
            {/* Custom mode toggle \u2014 uses the same shape as Toggle but
                 with a Framer Motion shared layout for the indicator
                 pill (so switching modes animates the highlight
                 across). Not the standard Toggle component because of
                 that animation requirement. */}
            <div className="flex items-center rounded-full border border-elevated bg-elevated p-0.5">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    "relative rounded-full px-2.5 py-0.5 font-mono text-label font-medium uppercase tracking-pill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                    mode === m.value ? "text-brand" : "text-muted hover:text-secondary",
                  )}
                >
                  {mode === m.value && (
                    <motion.div
                      layoutId={`trader-mode-${layoutId}`}
                      className="absolute inset-0 rounded-full bg-surface shadow-sm"
                      transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                    />
                  )}
                  <span className="relative z-10">{m.label}</span>
                </button>
              ))}
            </div>
            <Toggle options={PERIODS} active={period} onChange={setPeriod} />
          </>
        }
      />

      <div className={cn("relative p-4 transition-opacity", loading && "opacity-40")}>
        {traders.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center">
            <p className="font-mono text-body text-muted">
              {loading ? "Loading trader data..." : "No trader data available"}
            </p>
          </div>
        ) : (
          // Horizontal bar chart. Volume mode bars are brand-colored and
          // proportional to volume; profit mode colors by sign (green for
          // gains, red for losses) with bar length proportional to the
          // absolute magnitude vs the biggest mover. Trade count stays as
          // a muted secondary metric on the right.
          (() => {
            const isProfit = mode === "profit";
            const maxValue = isProfit
              ? Math.max(...traders.map((t) => Math.abs(t.netProfitXrp)), 1)
              : Math.max(...traders.map((t) => t.totalVolumeXrp), 1);
            return (
              <>
                <div
                  aria-hidden="true"
                  className="mb-2 flex items-center gap-3 px-1"
                >
                  <span className="w-5 shrink-0 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                    #
                  </span>
                  <span className="w-28 shrink-0 font-display text-tag font-medium uppercase tracking-header text-muted">
                    Address
                  </span>
                  <span className="flex-1 font-display text-tag font-medium uppercase tracking-header text-muted">
                    {isProfit ? "Net Profit (XRP)" : "Volume (XRP)"}
                  </span>
                  <span className="w-16 shrink-0 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                    Trades
                  </span>
                </div>
                <ul className="space-y-1.5" aria-label={`Top traders by ${mode}`}>
                {traders.map((t, i) => {
                  const value = isProfit ? t.netProfitXrp : t.totalVolumeXrp;
                  const pct = (Math.abs(value) / maxValue) * 100;
                  const isNegative = isProfit && value < 0;
                  return (
                    <li key={t.address} className="flex items-center gap-3">
                      <span className="w-5 shrink-0 text-right font-mono text-tag tabular-nums text-muted">
                        {i + 1}
                      </span>
                      <span className="w-28 shrink-0 truncate font-mono text-cell">
                        <AddressLink address={t.address} />
                      </span>
                      <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-elevated">
                        <div
                          className={cn(
                            "absolute inset-y-0 left-0 transition-all duration-500 ease-out",
                            isNegative
                              ? "bg-error/20"
                              : isProfit
                                ? "bg-success/25"
                                : "bg-brand/25",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex h-full items-center px-2">
                          <span
                            className={cn(
                              "font-mono text-cell tabular-nums font-medium",
                              isNegative
                                ? "text-error"
                                : isProfit
                                  ? "text-success"
                                  : "text-primary",
                            )}
                          >
                            {isProfit && value >= 0 && "+"}
                            {formatVolume(value)}
                          </span>
                        </div>
                      </div>
                      <span className="w-16 shrink-0 text-right font-mono text-tag tabular-nums text-muted">
                        {t.tradeCount.toLocaleString()}
                      </span>
                    </li>
                  );
                })}
                </ul>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

export default TopTraders;
