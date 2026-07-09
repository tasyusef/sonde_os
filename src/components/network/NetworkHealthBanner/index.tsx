"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { ServerHealth } from "@/types/network";
import { useLiveData } from "@/hooks/useLiveData";
import { cn } from "@/lib/utils";

function stateColor(state: string): string {
  switch (state) {
    case "full":
    case "proposing":
    case "validating":
    case "validated":
      return "bg-success";
    case "connected":
    case "syncing":
    case "tracking":
      return "bg-warning";
    default:
      return "bg-error";
  }
}

function loadColor(factor: number): string {
  if (factor <= 1) return "text-success";
  if (factor <= 5) return "text-warning";
  return "text-error";
}

function formatLoadFactor(factor: number): string {
  if (Number.isInteger(factor)) return `${factor}x`;
  return `${parseFloat(factor.toFixed(2))}x`;
}

export default function NetworkHealthBanner({
  initialHealth,
}: {
  initialHealth: ServerHealth | null;
}) {
  const live = useLiveData();
  const health = live.health ?? initialHealth;
  const [expanded, setExpanded] = useState(false);

  if (!health) {
    return (
      <div className="mb-6 rounded-2xl shadow-card bg-surface p-4 text-center">
        <p className="font-mono text-body text-muted">
          Unable to fetch server health data
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-2xl shadow-card bg-surface">
      {/* Status line */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/50 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        {/* State indicator */}
        <span
          aria-hidden="true"
          className={cn("h-2 w-2 shrink-0 rounded-full", stateColor(health.serverState))}
        />
        <span className="font-mono text-cell font-medium text-primary capitalize">
          {health.serverState}
        </span>

        <span className="font-mono text-cell text-muted" aria-hidden="true">
          /
        </span>

        {/* Validated ledger */}
        <span className="font-mono text-cell tabular-nums text-primary">
          #{health.validatedSeq.toLocaleString()}
        </span>

        {/* Load factor — only show if elevated */}
        {health.loadFactor > 1 && (
          <>
            <span className="font-mono text-cell text-muted" aria-hidden="true">
              /
            </span>
            <span className={cn("font-mono text-cell tabular-nums font-medium", loadColor(health.loadFactor))}>
              {formatLoadFactor(health.loadFactor)} load
            </span>
          </>
        )}

        {/* Spacer + chevron */}
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-tag text-muted sm:inline">
            {expanded ? "Less" : "Details"}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            className={cn(
              "text-muted transition-transform duration-200",
              expanded && "rotate-180",
            )}
          >
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {/* Expandable details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-elevated px-4 py-3 sm:grid-cols-4">
              <div>
                <p className="font-display text-tag font-medium uppercase tracking-header text-muted">
                  Load Factor
                </p>
                <p className={cn("mt-0.5 font-mono text-cell font-medium", loadColor(health.loadFactor))}>
                  {formatLoadFactor(health.loadFactor)}
                </p>
              </div>
              <div>
                <p className="font-display text-tag font-medium uppercase tracking-header text-muted">
                  Quorum
                </p>
                <p className="mt-0.5 font-mono text-cell font-medium text-primary">
                  {health.quorum}
                </p>
              </div>
              <div>
                <p className="font-display text-tag font-medium uppercase tracking-header text-muted">
                  Ledger Range
                </p>
                <p className="mt-0.5 font-mono text-cell font-medium text-primary">
                  {health.completeLedgers}
                </p>
              </div>
              <div>
                <p className="font-display text-tag font-medium uppercase tracking-header text-muted">
                  Build Version
                </p>
                <p
                  className="mt-0.5 max-w-full truncate font-mono text-cell font-medium text-primary"
                  title={health.buildVersion}
                >
                  {health.buildVersion}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
