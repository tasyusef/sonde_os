"use client";

import { useSubscription } from "@/hooks/useSubscription";

/**
 * Shows AI query usage for Pro users.
 * Displays progress bar with queries used / monthly limit.
 */
export default function UsageMeter() {
  const { tier, usage } = useSubscription();

  if (tier !== "pro") return null;

  const { queriesUsed, monthlyLimit } = usage;
  const pct = Math.min((queriesUsed / monthlyLimit) * 100, 100);
  const isNearLimit = pct >= 80;

  return (
    <div className="rounded-lg border border-elevated bg-card px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-label text-muted">AI Queries</span>
        <span className="font-mono text-label text-secondary">
          {queriesUsed}{" "}
          <span className="text-muted">/ {monthlyLimit}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
        <div
          className={`h-full rounded-full transition-all ${
            isNearLimit ? "bg-error" : "bg-brand"
          }`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={queriesUsed}
          aria-valuemin={0}
          aria-valuemax={monthlyLimit}
          aria-label={`${queriesUsed} of ${monthlyLimit} AI queries used this month`}
        />
      </div>
      <p className="mt-1.5 font-mono text-label text-muted">
        Resets on the 1st of each month (UTC)
      </p>
    </div>
  );
}
