"use client";

import Link from "next/link";
import { buttonClasses } from "@/components/shared/Button";
import DemoCard from "../shared/DemoCard";

/**
 * Static visual clone of UpgradeBanner. The real component checks subscription
 * state and only renders for free users — we recreate its look here with
 * static markup so it's always visible in the design system.
 */
function StaticUpgradeBanner() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3">
      <div className="flex-1">
        <p className="font-body text-ui font-medium text-primary">
          Portfolio PnL Tracking
          <span className="ml-1.5 rounded-tag bg-brand/10 px-2 py-0.5 font-mono text-tag font-semibold text-brand">
            Pro
          </span>
        </p>
        <p className="mt-1 font-body text-label text-muted">
          Unlock cost basis calculation, realized PnL, and AMM position tracking.
        </p>
      </div>
      <Link href="/pricing" className={buttonClasses({ variant: "primary", size: "sm", className: "shrink-0" })}>
        Upgrade
      </Link>
    </div>
  );
}

export default function UpgradeBannerDemo() {
  return (
    <DemoCard
      name="UpgradeBanner"
      importPath="@/components/subscription/UpgradeBanner"
      description="Inline upsell banner for gated features. Renders nothing if the user already has Pro. Less aggressive than PaywallOverlay — use this to advertise a feature inline without blocking content."
      preview={
        <div className="p-6">
          <StaticUpgradeBanner />
        </div>
      }
      code={`<UpgradeBanner tier="pro" feature="Portfolio PnL Tracking">
  Unlock cost basis calculation, realized PnL, and AMM position tracking.
</UpgradeBanner>`}
    />
  );
}
