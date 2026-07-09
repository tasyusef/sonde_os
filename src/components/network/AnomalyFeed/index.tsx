"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import type { Anomaly, Severity } from "@/lib/anomaly-detection";

interface AnomalyResponse {
  anomalies: Anomaly[];
  checkedAt: string;
}

const SEVERITY_STYLES: Record<Severity, { bg: string; text: string; label: string }> = {
  notable: { bg: "bg-warning/10", text: "text-warning", label: "Notable" },
  significant: { bg: "bg-tx-escrow/10", text: "text-tx-escrow", label: "Significant" },
  extreme: { bg: "bg-error/10", text: "text-error", label: "Extreme" },
};

const METRIC_LABELS: Record<string, string> = {
  tx_count: "Transaction Volume",
  dex_volume: "DEX Volume",
  active_accounts: "Active Accounts",
  fee_burn: "Fee Burn Rate",
};

export default function AnomalyFeed({
  className,
  embedded = false,
}: {
  className?: string;
  /**
   * When true, render in "embedded" mode: drop the per-row card chrome
   * (rounded-2xl, border, bg-surface, shadow) and use flush rows with
   * divider borders instead. Also pulls the status-line padding in
   * line with the parent card's section padding. Used when AnomalyFeed
   * sits inside another card (NetworkStatsBar's bottom slot) so we
   * don't end up with nested rounded chrome.
   */
  embedded?: boolean;
}) {
  const { data, isLoading } = useSWR<AnomalyResponse>(
    "/api/intel/anomalies",
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: true, dedupingInterval: 60_000 },
  );

  if (isLoading) {
    return (
      <div
        className={cn("animate-pulse motion-reduce:animate-none rounded-2xl bg-elevated h-[24px]", className)}
        role="status"
        aria-label="Loading anomaly detection"
      />
    );
  }

  const anomalies = data?.anomalies ?? [];
  const hasAnomalies = anomalies.length > 0;

  return (
    <div className={className}>
      {/* Status line. Embedded mode pulls padding in to match the
           parent card's section padding (NetworkStatsBar uses px-4
           py-3 for its stats strip — same here). Naked mode keeps
           the existing minimal padding for the on-background look. */}
      <div
        className={cn(
          "flex items-center justify-between",
          embedded ? "px-4 py-2.5" : "px-1 pb-3",
        )}
      >
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Anomaly Detection
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              hasAnomalies ? "bg-warning animate-pulse" : "bg-success",
            )}
          />
          <span className="font-mono text-tag text-muted">
            {hasAnomalies ? `${anomalies.length} active` : "Normal"}
          </span>
        </span>
      </div>

      {/* Body — only render when anomalies exist. aria-live="polite"
           on the body so new anomalies are announced to screen readers
           without interrupting; aria-atomic=false so only the changed
           item is announced rather than the entire list each tick.
           Embedded mode uses flush rows + divider borders since the
           parent card already provides the chrome. Naked mode keeps
           per-row rounded card chrome for legibility against the
           page background. */}
      {hasAnomalies && (
        <div
          aria-live="polite"
          aria-atomic="false"
          className={cn(
            embedded
              ? "divide-y divide-elevated border-t border-elevated"
              : "space-y-2",
          )}
        >
          {anomalies.map((anomaly) => {
            const style = SEVERITY_STYLES[anomaly.severity];
            return (
              <div
                key={anomaly.id}
                className={cn(
                  embedded
                    ? "px-4 py-3"
                    : "rounded-2xl border border-elevated bg-surface px-4 py-3 shadow-card",
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Severity badge */}
                  <span
                    className={cn(
                      "rounded-tag px-2 py-0.5 font-mono text-tag font-medium",
                      style.bg,
                      style.text,
                    )}
                  >
                    {style.label}
                  </span>

                  {/* Metric label */}
                  <span className="font-mono text-cell font-medium text-primary">
                    {METRIC_LABELS[anomaly.metric] ?? anomaly.metric}
                  </span>

                  {/* Confirmation status */}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-mono text-label font-semibold",
                      anomaly.confirmation === "confirmed"
                        ? "bg-brand/10 text-brand"
                        : "bg-elevated text-muted",
                    )}
                  >
                    {anomaly.confirmation === "confirmed" ? "Confirmed" : "Developing"}
                  </span>
                </div>

                {/* Description */}
                <p className="mt-1 font-mono text-tag text-muted">
                  {anomaly.description}
                </p>

                {/* Low confidence indicator */}
                {anomaly.confidence === "low" && (
                  <p className="mt-0.5 font-mono text-tag text-muted/60 italic">
                    Low confidence (limited seasonal data)
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
