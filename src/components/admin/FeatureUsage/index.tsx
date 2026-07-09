"use client";

import useSWR from "swr";
import StatCard from "@/components/shared/StatCard";
import { fetcher } from "@/lib/swr-config";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RouteView {
  route_pattern: string;
  views: number;
}

interface FeatureData {
  activeAlertRules: number;
  totalWatchlistItems: number;
  smartMoneyViewsThisWeek: number;
  topRoutes: RouteView[];
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                         */
/* ------------------------------------------------------------------ */

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function FeatureUsage() {
  const { data, isLoading, isValidating } = useSWR<FeatureData>(
    "/api/admin/features",
    fetcher,
    { dedupingInterval: 30_000, revalidateOnFocus: true },
  );

  const loading = isLoading || isValidating;
  const topRoutes = (data?.topRoutes ?? []).slice(0, 10);

  return (
    <section>
      <h2 className="mb-4 font-display text-heading font-semibold text-primary">
        Feature Usage
      </h2>

      {/* Stat cards */}
      <div
        className={cn(
          "mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 transition-opacity",
          loading ? "opacity-40" : "opacity-100",
        )}
      >
        <StatCard
          label="Active Alert Rules"
          value={fmtNum(data?.activeAlertRules ?? 0)}
        />
        <StatCard
          label="Watchlist Items"
          value={fmtNum(data?.totalWatchlistItems ?? 0)}
        />
        <StatCard
          label="Smart Money Views"
          value={fmtNum(data?.smartMoneyViewsThisWeek ?? 0)}
        />
      </div>

      {/* Top routes table */}
      <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <p className="mb-3 font-display text-label font-bold uppercase tracking-header text-brand">
          Top Route Patterns
        </p>
        <div
          className={cn(
            "transition-opacity",
            loading ? "opacity-40" : "opacity-100",
          )}
        >
          {topRoutes.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="font-mono text-body text-muted">
                {loading ? "Loading..." : "No data"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-elevated">
                    <th
                      scope="col"
                      className="pb-2 text-left font-display text-label font-medium uppercase tracking-header text-muted"
                    >
                      Route
                    </th>
                    <th
                      scope="col"
                      className="pb-2 text-right font-display text-label font-medium uppercase tracking-header text-muted"
                    >
                      Views
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topRoutes.map((r, i) => (
                    <tr
                      key={r.route_pattern}
                      className={cn(
                        "border-b border-elevated",
                        i === topRoutes.length - 1 && "border-b-0",
                      )}
                    >
                      <td className="py-2 font-mono text-cell text-primary">
                        {r.route_pattern}
                      </td>
                      <td className="py-2 text-right font-mono text-cell tabular-nums text-muted">
                        {fmtNum(r.views)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default FeatureUsage;
