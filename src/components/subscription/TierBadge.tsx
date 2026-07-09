"use client";

import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/hooks/useAuth";

const TIER_CONFIG: Record<string, string> = {
  pro: "PRO",
};

/** Compact tier badge — fits its content, no animation. */
export default function TierBadge() {
  const { address } = useAuth();
  const { tier } = useSubscription();

  if (!address || tier === "free") return null;

  const label = TIER_CONFIG[tier];
  if (!label) return null;

  return (
    <span className="inline-flex h-4 items-center rounded-tag border border-brand/20 bg-brand/10 px-1.5 font-display text-micro font-bold uppercase tracking-header leading-none text-brand whitespace-nowrap">
      {label}
    </span>
  );
}
