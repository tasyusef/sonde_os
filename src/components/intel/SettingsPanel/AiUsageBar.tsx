"use client";

import { useSubscription } from "@/hooks/useSubscription";

export default function AiUsageBar() {
  const { usage } = useSubscription();
  const { queriesUsed, monthlyLimit } = usage;
  const pct = Math.min((queriesUsed / monthlyLimit) * 100, 100);

  return (
    <div className="rounded-lg border border-elevated bg-surface px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-label text-muted">AI Queries</span>
        <span className="font-mono text-label text-secondary">
          {queriesUsed}<span className="text-muted">/{monthlyLimit}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
        <div
          className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-error" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={queriesUsed}
          aria-valuemin={0}
          aria-valuemax={monthlyLimit}
          aria-label={`${queriesUsed} of ${monthlyLimit} AI queries used this month`}
        />
      </div>
    </div>
  );
}
