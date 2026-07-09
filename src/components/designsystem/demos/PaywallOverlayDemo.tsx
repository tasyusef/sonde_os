"use client";

import Link from "next/link";
import { buttonClasses } from "@/components/shared/Button";
import DemoCard from "../shared/DemoCard";

/**
 * Static visual clone of PaywallOverlay in "blur" mode. The real component
 * checks subscription state via hooks — we recreate its look here so it's
 * always visible in the design system.
 */
function StaticPaywallOverlay() {
  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-sm opacity-50" aria-hidden="true">
        <div className="rounded-lg border border-elevated bg-surface p-6">
          <p className="font-display text-label uppercase tracking-header text-muted">Protected Content</p>
          <p className="mt-2 font-body text-ui text-primary">
            This would be the real feature content — charts, data, insights.
          </p>
          <div className="mt-4 h-32 rounded-lg bg-elevated" />
        </div>
      </div>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-lg bg-black/40 backdrop-blur-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-elevated bg-surface">
          <svg
            className="h-5 w-5 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
        </div>
        <p className="font-body text-ui text-secondary">
          Upgrade to <span className="font-semibold text-primary">Pro</span> to unlock this feature
        </p>
        <Link href="/pricing" className={buttonClasses({ variant: "primary", size: "md" })}>
          View Plans
        </Link>
      </div>
    </div>
  );
}

export default function PaywallOverlayDemo() {
  return (
    <DemoCard
      name="PaywallOverlay"
      importPath="@/components/subscription/PaywallOverlay"
      description="Wraps gated content with a blurred preview and upgrade CTA. If the user has the required tier, the children render unmodified. Otherwise, the content is blurred and a centered paywall panel appears on top. UX-only — API guards are the actual security layer."
      preview={
        <div className="p-4">
          <StaticPaywallOverlay />
        </div>
      }
      code={`<PaywallOverlay requiredTier="pro">
  <ProtectedFeature />
</PaywallOverlay>`}
    />
  );
}
