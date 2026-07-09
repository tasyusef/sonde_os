"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import type { TokenHealthResult, FactorStatus } from "@/lib/token-health";

interface Props {
  currency: string;
  issuer: string;
  className?: string;
}

const SCORE_COLORS = {
  good: { text: "text-success", bg: "bg-success/10", bar: "bg-success" },
  moderate: { text: "text-warning", bg: "bg-warning/10", bar: "bg-warning" },
  poor: { text: "text-error", bg: "bg-error/10", bar: "bg-error" },
} as const;

function getScoreColors(score: number) {
  if (score >= 70) return SCORE_COLORS.good;
  if (score >= 40) return SCORE_COLORS.moderate;
  return SCORE_COLORS.poor;
}

function getScoreLabel(score: number) {
  if (score >= 70) return "Healthy";
  if (score >= 40) return "Moderate";
  return "Poor";
}

const STATUS_LABELS: Record<FactorStatus, string> = {
  scored: "",
  insufficient_data: "Limited data",
  unavailable: "Unavailable",
};

export default function TokenHealthCard({ currency, issuer, className }: Props) {
  const [expanded, setExpanded] = useState(false);

  const { data, error, isLoading } = useSWR<TokenHealthResult>(
    `/api/intel/token-health?currency=${encodeURIComponent(currency)}&issuer=${encodeURIComponent(issuer)}`,
    fetcher,
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  );

  if (isLoading) {
    return (
      <div
        className="animate-pulse motion-reduce:animate-none rounded-2xl bg-elevated h-[72px]"
        role="status"
        aria-label="Loading token health"
      />
    );
  }

  // Graceful degradation: render nothing on error or no data
  if (error || !data || data.compositeScore === -1) return null;

  const colors = getScoreColors(data.compositeScore);
  const label = getScoreLabel(data.compositeScore);

  return (
    <div className={cn("rounded-2xl border border-elevated bg-surface shadow-card", className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-2xl"
        aria-expanded={expanded}
        aria-controls="health-details"
      >
        {/* Donut gauge */}
        <div
          className="relative h-12 w-12 shrink-0"
          title={`Token health score: ${data.compositeScore}/100`}
        >
          <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
            <circle
              cx="18" cy="18" r="15.91"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-elevated"
            />
            <circle
              cx="18" cy="18" r="15.91"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${data.compositeScore} ${100 - data.compositeScore}`}
              className={colors.text}
              strokeLinecap="round"
            />
          </svg>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center font-mono text-tag font-bold",
              colors.text,
            )}
          >
            {data.compositeScore}
          </span>
        </div>

        {/* Label */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-label font-medium uppercase tracking-header text-muted">
              Token Health
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-mono text-label font-semibold uppercase",
                colors.bg,
                colors.text,
              )}
            >
              {label}
            </span>
            {data.limitedData && (
              <span className="rounded-tag bg-warning/10 px-2 py-0.5 font-mono text-tag font-medium text-warning">
                Limited data
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "shrink-0 text-muted transition-transform",
            expanded && "rotate-180",
          )}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expandable factor breakdown */}
      {expanded && (
        <div id="health-details" className="border-t border-elevated px-4 pb-4 pt-3 space-y-3">
          {data.factors.map((factor) => (
            <div key={factor.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-tag font-medium text-muted">
                  {factor.name}
                </span>
                <div className="flex items-center gap-2">
                  {factor.status !== "scored" && (
                    <span className="font-mono text-tag text-muted italic">
                      {STATUS_LABELS[factor.status]}
                    </span>
                  )}
                  {factor.status === "scored" && (
                    <span className={cn("font-mono text-tag font-semibold", getScoreColors(factor.score).text)}>
                      {factor.score}
                    </span>
                  )}
                </div>
              </div>
              {/* Score bar */}
              <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                {factor.status === "scored" && (
                  <div
                    className={cn("h-full rounded-full transition-all", getScoreColors(factor.score).bar)}
                    style={{ width: `${factor.score}%` }}
                  />
                )}
              </div>
              <p className="mt-0.5 font-mono text-tag text-muted/70">
                {factor.detail}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
