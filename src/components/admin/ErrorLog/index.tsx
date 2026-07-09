"use client";

import useSWR from "swr";
import StatCard from "@/components/shared/StatCard";
import { fetcher } from "@/lib/swr-config";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ErrorEntry {
  id: number;
  route: string;
  error_message: string;
  timestamp: string;
}

interface ErrorData {
  errorsToday: number;
  errorsYesterday: number;
  failedAlerts: number;
  recentErrors: ErrorEntry[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TrendArrow({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  if (current === previous) {
    return (
      <span className="font-mono text-label text-muted" aria-label="No change">
        --
      </span>
    );
  }
  const up = current > previous;
  return (
    <span
      className={cn(
        "font-mono text-label font-medium",
        up ? "text-error" : "text-success",
      )}
      aria-label={up ? "Errors increasing" : "Errors decreasing"}
    >
      {up ? "\u2191" : "\u2193"}{" "}
      {Math.abs(current - previous)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ErrorLog() {
  const { data, isLoading, isValidating } = useSWR<ErrorData>(
    "/api/admin/errors",
    fetcher,
    { dedupingInterval: 30_000, revalidateOnFocus: true },
  );

  const loading = isLoading || isValidating;
  const errorsToday = data?.errorsToday ?? 0;
  const errorsYesterday = data?.errorsYesterday ?? 0;
  const failedAlerts = data?.failedAlerts ?? 0;
  const recentErrors = data?.recentErrors ?? [];

  return (
    <section>
      <h2 className="mb-4 font-display text-heading font-semibold text-primary">
        Error Log
      </h2>

      {/* Stat row */}
      <div
        className={cn(
          "mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 transition-opacity",
          loading ? "opacity-40" : "opacity-100",
        )}
      >
        <StatCard
          label="Errors Today"
          value={
            <span className="inline-flex items-baseline gap-2">
              {fmtNum(errorsToday)}
              <TrendArrow current={errorsToday} previous={errorsYesterday} />
            </span>
          }
        />
        <StatCard label="Errors Yesterday" value={fmtNum(errorsYesterday)} />
        <StatCard label="Failed Alerts" value={fmtNum(failedAlerts)} />
      </div>

      {/* Recent errors table */}
      <div className="rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <p className="mb-3 font-display text-label font-bold uppercase tracking-header text-brand">
          Recent Errors
        </p>
        <div
          className={cn(
            "transition-opacity",
            loading ? "opacity-40" : "opacity-100",
          )}
        >
          {recentErrors.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="font-mono text-body text-muted">
                {loading ? "Loading..." : "No recent errors"}
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
                      className="pb-2 text-left font-display text-label font-medium uppercase tracking-header text-muted"
                    >
                      Message
                    </th>
                    <th
                      scope="col"
                      className="pb-2 text-right font-display text-label font-medium uppercase tracking-header text-muted"
                    >
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentErrors.map((err, i) => (
                    <tr
                      key={err.id ?? `${err.timestamp}-${i}`}
                      className={cn(
                        "border-b border-elevated",
                        i === recentErrors.length - 1 && "border-b-0",
                      )}
                    >
                      <td className="py-2 pr-4 font-mono text-cell text-error">
                        {err.route}
                      </td>
                      <td className="py-2 pr-4 font-mono text-cell text-primary">
                        {err.error_message}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right font-mono text-cell tabular-nums text-muted">
                        {fmtTimestamp(err.timestamp)}
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

export default ErrorLog;
