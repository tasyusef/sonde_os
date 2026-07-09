"use client";

import { useSubscription } from "@/hooks/useSubscription";
import Link from "next/link";
import { buttonClasses } from "@/components/shared/Button";

interface UpgradeBannerProps {
  tier: "pro";
  feature: string;
  children?: React.ReactNode;
}

const TIER_LABELS: Record<string, string> = {
  pro: "Pro",
};

/**
 * Inline banner for sections that need upsell. Less aggressive than PaywallOverlay.
 * Renders nothing if user already has access.
 */
export default function UpgradeBanner({
  tier: requiredTier,
  feature,
  children,
}: UpgradeBannerProps) {
  const { tier } = useSubscription();

  const hasAccess = tier === "pro";

  if (hasAccess) return null;

  return (
    <div className="flex items-center gap-4 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3">
      <div className="flex-1">
        <p className="font-body text-ui font-medium text-primary">
          {feature}
          <span className="ml-1.5 rounded-tag bg-brand/10 px-2 py-0.5 font-mono text-tag font-semibold text-brand">
            {TIER_LABELS[requiredTier]}
          </span>
        </p>
        {children && (
          <p className="mt-1 font-body text-label text-muted">{children}</p>
        )}
      </div>
      <Link href="/pricing" className={buttonClasses({ variant: "primary", size: "sm", className: "shrink-0" })}>
        Upgrade
      </Link>
    </div>
  );
}
