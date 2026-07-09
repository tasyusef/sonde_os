"use client";

import useSWR from "swr";
import StatCard from "@/components/shared/StatCard";
import { fetcher } from "@/lib/swr-config";
import type { AiUsageData } from "./types";
import { fmtNum, fmtUsd } from "./formatters";
import QueryTypeBreakdown from "./QueryTypeBreakdown";
import DailyTrend from "./DailyTrend";
import ModelBreakdown from "./ModelBreakdown";

export function AiUsageMetrics() {
  const { data, isLoading, isValidating } = useSWR<AiUsageData>(
    "/api/admin/ai-usage",
    fetcher,
    { dedupingInterval: 5_000, revalidateOnFocus: true, refreshInterval: 30_000 },
  );

  const loading = isLoading || isValidating;
  const thisMonth = data?.thisMonth ?? {
    totalQueries: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
  };
  const byQueryType = data?.byQueryType ?? [];
  const byModel = data?.byModel ?? [];
  const daily = data?.daily ?? [];

  return (
    <section>
      <h2 className="mb-4 font-display text-heading font-semibold text-primary">AI Usage</h2>

      {/* Top row — 4 stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Queries (MTD)" value={fmtNum(thisMonth.totalQueries)} />
        <StatCard label="Input Tokens" value={fmtNum(thisMonth.totalInputTokens)} />
        <StatCard label="Output Tokens" value={fmtNum(thisMonth.totalOutputTokens)} />
        <StatCard label="Total Cost (MTD)" value={fmtUsd(thisMonth.totalCostUsd)} emphasis />
      </div>

      <QueryTypeBreakdown byQueryType={byQueryType} loading={loading} />

      {/* Charts row — daily queries + model breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DailyTrend daily={daily} loading={loading} />
        <ModelBreakdown byModel={byModel} loading={loading} />
      </div>
    </section>
  );
}

export default AiUsageMetrics;
