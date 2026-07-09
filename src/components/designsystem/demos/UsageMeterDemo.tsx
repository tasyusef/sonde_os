"use client";

import { useState } from "react";
import DemoCard from "../shared/DemoCard";
import { NumberControl } from "../shared/PropControl";
import { cn } from "@/lib/utils";

/**
 * Static visual clone of UsageMeter. The real component reads from the
 * subscription hook; we accept raw counts here so we can demo the states.
 */
function StaticUsageMeter({
  queriesUsed,
  monthlyLimit,
}: {
  queriesUsed: number;
  monthlyLimit: number;
}) {
  const pct = Math.min((queriesUsed / monthlyLimit) * 100, 100);
  const isNearLimit = pct >= 80;

  return (
    <div className="rounded-lg border border-elevated bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-label text-muted">AI Queries</span>
        <span className="font-mono text-label text-secondary">
          {queriesUsed}{" "}
          <span className="text-muted">/ {monthlyLimit}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isNearLimit ? "bg-error" : "bg-brand",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-label text-muted">
        Resets on the 1st of each month (UTC)
      </p>
    </div>
  );
}

export default function UsageMeterDemo() {
  const [used, setUsed] = useState(32);
  const limit = 50;

  return (
    <DemoCard
      name="UsageMeter"
      importPath="@/components/subscription/UsageMeter"
      description="Progress bar showing AI query usage for Pro users. Reads from the useSubscription hook. Turns red when usage hits 80% of the monthly limit. Renders nothing for free users."
      preview={
        <div className="mx-auto max-w-sm p-6">
          <StaticUsageMeter queriesUsed={used} monthlyLimit={limit} />
        </div>
      }
      controls={
        <NumberControl
          label="queriesUsed (demo)"
          value={used}
          onChange={setUsed}
          min={0}
          max={limit}
        />
      }
      code={`<UsageMeter />`}
    />
  );
}
