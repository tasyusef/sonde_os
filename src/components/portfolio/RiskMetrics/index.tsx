"use client";

import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { cn } from "@/lib/utils";

interface Snapshot {
  time: string;
  totalValueUsd: number;
}

interface HistoryResponse {
  snapshots: Snapshot[];
}

interface DrawdownResult {
  maxDrawdownPct: number;
  peakDate: string;
  troughDate: string;
}

function computeMaxDrawdown(snapshots: Snapshot[]): DrawdownResult | null {
  if (snapshots.length < 2) return null;

  let peak = snapshots[0].totalValueUsd;
  let peakDate = snapshots[0].time;
  let maxDd = 0;
  let ddPeakDate = peakDate;
  let ddTroughDate = peakDate;

  for (const s of snapshots) {
    if (s.totalValueUsd > peak) {
      peak = s.totalValueUsd;
      peakDate = s.time;
    }
    const dd = peak > 0 ? ((peak - s.totalValueUsd) / peak) * 100 : 0;
    if (dd > maxDd) {
      maxDd = dd;
      ddPeakDate = peakDate;
      ddTroughDate = s.time;
    }
  }

  if (maxDd === 0) return null;
  return { maxDrawdownPct: maxDd, peakDate: ddPeakDate, troughDate: ddTroughDate };
}

function computeSharpe(snapshots: Snapshot[]): number | null {
  if (snapshots.length < 14) return null; // need at least 2 weeks of data

  // Compute daily returns (sample one snapshot per day)
  const dailyMap = new Map<string, number>();
  for (const s of snapshots) {
    const day = s.time.slice(0, 10); // YYYY-MM-DD
    dailyMap.set(day, s.totalValueUsd);
  }

  const dailyValues = [...dailyMap.values()];
  if (dailyValues.length < 7) return null;

  const returns: number[] = [];
  for (let i = 1; i < dailyValues.length; i++) {
    if (dailyValues[i - 1] > 0) {
      returns.push((dailyValues[i] - dailyValues[i - 1]) / dailyValues[i - 1]);
    }
  }

  if (returns.length < 7) return null;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  // Annualize: daily risk-free rate ≈ 0 for crypto
  const annualizedReturn = mean * 365;
  const annualizedStdDev = stdDev * Math.sqrt(365);

  return annualizedReturn / annualizedStdDev;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function RiskMetrics() {
  const { data } = useSWR<HistoryResponse>(
    CACHE_KEYS.portfolioHistory("all"),
    fetcher,
  );

  if (!data || data.snapshots.length < 7) return null;

  const dd = computeMaxDrawdown(data.snapshots);
  const sharpe = computeSharpe(data.snapshots);

  if (!dd && sharpe == null) return null;

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Max Drawdown */}
      <div className="flex flex-col gap-1.5 rounded-xl bg-elevated px-4 py-3">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Max Drawdown
        </span>
        {dd ? (
          <>
            <span className="font-mono text-value font-medium tabular-nums text-error">
              -{dd.maxDrawdownPct.toFixed(1)}%
            </span>
            <span className="font-mono text-tag text-muted">
              {formatDate(dd.peakDate)} → {formatDate(dd.troughDate)}
            </span>
          </>
        ) : (
          <span className="font-mono text-cell text-muted">—</span>
        )}
      </div>

      {/* Sharpe Ratio */}
      <div className="flex flex-col gap-1.5 rounded-xl bg-elevated px-4 py-3">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Sharpe Ratio
        </span>
        {sharpe != null ? (
          <>
            <span
              className={cn(
                "font-mono text-value font-medium tabular-nums",
                sharpe >= 1
                  ? "text-success"
                  : sharpe >= 0
                    ? "text-primary"
                    : "text-error",
              )}
            >
              {sharpe.toFixed(2)}
            </span>
            <span className="font-mono text-tag text-muted">
              {sharpe >= 2
                ? "Excellent"
                : sharpe >= 1
                  ? "Good"
                  : sharpe >= 0
                    ? "Below average"
                    : "Negative returns"}
            </span>
          </>
        ) : (
          <span className="font-mono text-cell text-muted">—</span>
        )}
      </div>
    </div>
  );
}
