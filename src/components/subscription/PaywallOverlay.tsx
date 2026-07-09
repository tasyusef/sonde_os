"use client";

import { useSubscription } from "@/hooks/useSubscription";
import Link from "next/link";
import { buttonClasses } from "@/components/shared/Button";
import { cn } from "@/lib/utils";

interface PaywallOverlayProps {
  requiredTier: "pro";
  children: React.ReactNode;
  previewMode?: "blur" | "lock";
}

const TIER_LABELS: Record<string, string> = {
  pro: "Pro",
};

/**
 * Wraps gated content. Shows blurred preview with upgrade CTA when user
 * doesn't have the required tier. UX-only — API guards are the security layer.
 */
export default function PaywallOverlay({
  requiredTier,
  children,
  previewMode = "blur",
}: PaywallOverlayProps) {
  const { tier, isLoading } = useSubscription();

  // While loading, show skeleton to avoid flashing paywall for paid users
  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Loading subscription"
        className="h-64 animate-pulse rounded-lg bg-elevated"
      />
    );
  }

  const hasAccess = tier === "pro";

  if (hasAccess) return <>{children}</>;

  return (
    <div className="relative">
      <div
        className={cn(
          previewMode === "blur"
            ? "pointer-events-none select-none blur-sm opacity-50"
            : "hidden",
        )}
        aria-hidden="true"
      >
        {children}
      </div>

      {previewMode === "lock" && (
        <div className="flex h-64 items-center justify-center rounded-lg border border-elevated bg-card" />
      )}

      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-lg bg-background/80 backdrop-blur-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-elevated bg-card">
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
          Upgrade to{" "}
          <span className="font-semibold text-primary">
            {TIER_LABELS[requiredTier]}
          </span>{" "}
          to unlock this feature
        </p>
        <Link href="/pricing" className={buttonClasses({ variant: "primary", size: "md" })}>
          View Plans
        </Link>
      </div>
    </div>
  );
}
