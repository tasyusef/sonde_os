"use client";

import DemoCard from "../shared/DemoCard";

/**
 * Static visual reference for TierBadge. The real component reads subscription
 * state via hooks, so we recreate its look with static markup here.
 */
function StaticTierBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex h-4 items-center rounded-tag border border-brand/20 bg-brand/10 px-1.5 font-display text-micro font-bold uppercase tracking-header leading-none text-brand whitespace-nowrap">
      {label}
    </span>
  );
}

export default function TierBadgeDemo() {
  return (
    <DemoCard
      name="TierBadge"
      importPath="@/components/subscription/TierBadge"
      description="Compact tier indicator shown in the sidebar header. Reads subscription state from the useSubscription hook — renders nothing for free users. Shown below as a static visual reference (the real component requires a live subscription)."
      preview={
        <div className="flex items-center justify-center gap-4 p-8">
          <StaticTierBadge label="PRO" />
        </div>
      }
      code={`<TierBadge />`}
    />
  );
}
