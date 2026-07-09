"use client";

import { useState } from "react";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { CACHE_KEYS } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import type { NetworkGrowthData, NetworkGrowthMetric } from "@/types/analytics";

type Period = "7d" | "30d" | "90d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function ChangeBadge({ change }: { change: number | null }) {
  if (change == null) return null;

  const isPositive = change >= 0;
  const arrow = isPositive ? "\u2191" : "\u2193";
  const formatted = `${arrow} ${Math.abs(change).toFixed(1)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-label font-medium",
        isPositive
          ? "bg-success/10 text-success"
          : "bg-error/10 text-error",
      )}
    >
      {formatted}
    </span>
  );
}

function MetricCard({ metric }: { metric: NetworkGrowthMetric }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-display text-label font-medium uppercase tracking-header text-muted">
        {metric.label}
      </p>
      <div className="flex items-baseline gap-2">
        <p className="font-mono text-value font-semibold tabular-nums text-primary">
          {formatCompact(metric.current)}
        </p>
        <ChangeBadge change={metric.changePercent} />
      </div>
    </div>
  );
}

export function NetworkGrowthStats() {
  const [period, setPeriod] = useState<Period>("7d");

  const { data: raw, isLoading, isValidating } = useSWR<NetworkGrowthData>(
    CACHE_KEYS.networkGrowth(period),
  );

  const loading = isLoading || isValidating;
  const metrics = raw?.metrics ?? [];

  return (
    <div
      className={cn(
        "rounded-2xl shadow-card bg-surface transition-opacity",
        loading && "opacity-40",
      )}
    >
      <ChartCardHeader
        title="Network Growth"
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />
      {metrics.length === 0 ? (
        <p className="px-4 py-3 font-mono text-body text-muted">
          {loading ? "Loading growth stats..." : "No data available"}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-y-4 px-4 py-3 sm:grid-cols-4">
          {metrics.map((m) => (
            <MetricCard key={m.label} metric={m} />
          ))}
        </div>
      )}
    </div>
  );
}

export default NetworkGrowthStats;
