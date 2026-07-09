"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AreaChart,
  Area,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import CopyButton from "@/components/shared/CopyButton";
import AmendmentVoteChart from "@/components/amendments/AmendmentVoteChart";
import type { AmendmentInfo, AmendmentVotePoint } from "@/types/amendments";
import { cn } from "@/lib/utils";

interface AmendmentCardProps {
  amendment: AmendmentInfo;
  sparklineData?: AmendmentVotePoint[];
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
}

function getStatusBadge(amendment: AmendmentInfo) {
  if (amendment.enabled) {
    return { label: "Enabled", className: "bg-success/10 text-success" };
  }
  if (amendment.hasMajority) {
    return { label: "Majority", className: "bg-warning/10 text-warning" };
  }
  return { label: "Pending", className: "bg-elevated text-muted" };
}

function getProgressColor(percent: number): string {
  if (percent >= 80) return "bg-success";
  if (percent >= 50) return "bg-warning";
  return "bg-brand";
}

/**
 * Card for amendments in the "Active Voting" section. The body has
 * two states based on whether we have validator vote counts yet:
 *
 *   - hasVoteData (totalValidators > 0): full card with progress bar
 *     and a mini sparkline (desktop only) above the chevron.
 *   - no vote data yet: shows name + hash + status + an explicit
 *     "No vote tracking yet" line so users don't read 0/0 (0%) as a
 *     real signal.
 *
 * The expand chevron + vote-history chart are ALWAYS available — the
 * chart's own empty state handles "no history yet" gracefully, and
 * once the systemd tracker captures a snapshot the chart starts
 * showing data with no further code changes.
 *
 * Padding is tighter on mobile (px-4 py-3) and the sparkline hides
 * below `sm` since the progress bar already conveys the same info in
 * a fraction of the vertical space.
 */
export function AmendmentCard({ amendment, sparklineData }: AmendmentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const badge = getStatusBadge(amendment);
  const isHashName = amendment.name === amendment.hash;
  const displayName = isHashName ? truncateHash(amendment.hash) : amendment.name;
  const hasVoteData = amendment.totalValidators > 0;
  const showSparkline = hasVoteData && sparklineData && sparklineData.length > 1;

  return (
    <div className="rounded-2xl bg-surface shadow-card transition-shadow hover:shadow-card-hover">
      {/* Card click target uses role="button" instead of a real <button>
          so the inner CopyButton (which IS a real <button>) doesn't
          violate the no-button-inside-button HTML rule and trigger a
          hydration error. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        aria-expanded={expanded}
        className="w-full cursor-pointer rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:px-5 sm:py-4"
      >
        {/* Header row — name + status badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-ui font-medium text-primary">
              {displayName}
            </h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate font-mono text-tag text-muted">
                {truncateHash(amendment.hash)}
              </span>
              <span onClick={(e) => e.stopPropagation()}>
                <CopyButton text={amendment.hash} />
              </span>
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 font-mono text-label font-semibold",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </div>

        {/* Vote progress (when validator data is available) */}
        {hasVoteData && (
          <div className="mt-3">
            <p className="font-mono text-cell text-secondary">
              {amendment.currentYesCount} / {amendment.totalValidators} validators
              <span className="ml-1.5 text-muted">
                ({amendment.majorityPercent}%)
              </span>
            </p>
            <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  getProgressColor(amendment.majorityPercent),
                )}
                style={{ width: `${Math.min(amendment.majorityPercent, 100)}%` }}
              />
              {/* 80% activation threshold marker */}
              <div
                className="absolute top-0 h-full w-px bg-muted/50"
                style={{ left: "80%" }}
              />
            </div>
          </div>
        )}

        {/* No-vote-data state — explicit instead of "0 / 0 (0%)" */}
        {!hasVoteData && (
          <p className="mt-3 font-mono text-tag text-muted">
            No vote progress tracked yet.
          </p>
        )}

        {/* Mini sparkline — desktop only, only when data exists */}
        {showSparkline && (
          <div className="mt-3 hidden pointer-events-none sm:block">
            <ResponsiveContainer width="100%" height={48}>
              <AreaChart
                data={sparklineData}
                margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
              >
                <defs>
                  <linearGradient
                    id={`spark-${amendment.hash}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--color-brand)"
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-brand)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <ReferenceLine
                  y={80}
                  stroke="var(--color-muted)"
                  strokeDasharray="3 3"
                  strokeOpacity={0.4}
                />
                <Area
                  type="monotone"
                  dataKey="percent"
                  stroke="var(--color-brand)"
                  strokeWidth={1.5}
                  fill={`url(#spark-${amendment.hash})`}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Expand chevron — always available; the chart handles its
            own no-data state. */}
        <div className="mt-2 flex items-center justify-center">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              "text-muted transition-transform duration-200",
              expanded && "rotate-180",
            )}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Expanded chart */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-elevated px-4 py-3 sm:px-5 sm:py-4">
              <h4 className="mb-2 font-display text-label font-bold uppercase tracking-header text-brand">
                Vote History
              </h4>
              <AmendmentVoteChart
                hash={amendment.hash}
                initialHistory={sparklineData}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default AmendmentCard;
