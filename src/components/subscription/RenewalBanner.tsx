"use client";

import { useSyncExternalStore } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import Link from "next/link";
import { buttonClasses } from "@/components/shared/Button";

// Module-level timestamp updated every 60s. useSyncExternalStore reads it
// during render (pure — reading a variable, not calling Date.now()).
let nowMs = typeof window !== "undefined" ? Date.now() : 0;
let listeners: Array<() => void> = [];
if (typeof window !== "undefined") {
  setInterval(() => { nowMs = Date.now(); listeners.forEach((l) => l()); }, 60_000);
}
function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}
function getSnapshot() { return nowMs; }
// Return a sentinel that forces early-return on server, avoiding any
// date-dependent text that would mismatch with the client.
function getServerSnapshot() { return -1; }

/**
 * Rendered in the app layout. Shows a warning banner when a crypto
 * subscription is approaching expiry (within 7 days) or in grace period.
 * Stripe subs auto-renew so this only applies to crypto.
 */
export default function RenewalBanner() {
  const { tier, status, periodEnd, paymentMethod, cancelAtPeriodEnd } =
    useSubscription();

  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Server renders nothing — client hydrates and immediately shows the
  // correct banner on the first client paint, avoiding error #418.
  if (now < 0) return null;

  const daysLeft = periodEnd
    ? Math.ceil((periodEnd.getTime() - now) / 86_400_000)
    : null;

  if (tier === "free" || !periodEnd || paymentMethod === "stripe" || daysLeft === null) return null;

  // Active sub expiring within 7 days (includes day-of: >= 0)
  if (status === "active" && !cancelAtPeriodEnd && daysLeft <= 7 && daysLeft >= 0) {
    return (
      <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 md:mx-0">
        <p className="font-body text-ui text-primary">
          Your subscription {daysLeft === 0 ? "expires today" : (
            <>expires in{" "}
              <span className="font-semibold">
                {daysLeft} {daysLeft === 1 ? "day" : "days"}
              </span>
            </>
          )}
        </p>
        <Link
          href="/pricing"
          className={buttonClasses({ variant: "primary", size: "sm", className: "shrink-0" })}
        >
          Renew
        </Link>
      </div>
    );
  }

  // Canceled — features available until period end
  if (status === "active" && cancelAtPeriodEnd && daysLeft >= 0) {
    return (
      <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-muted/30 bg-elevated px-4 py-3 md:mx-0">
        <p className="font-body text-ui text-muted">
          Subscription canceled. Access until{" "}
          {periodEnd.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
          .
        </p>
        <Link
          href="/pricing"
          className={buttonClasses({ variant: "secondary", size: "sm", className: "shrink-0" })}
        >
          Reactivate
        </Link>
      </div>
    );
  }

  // Grace period (expired but within 3 days)
  if (status === "expired" && daysLeft >= -3 && daysLeft < 0) {
    const graceDaysLeft = 3 + daysLeft;
    return (
      <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-error/30 bg-error/5 px-4 py-3 md:mx-0">
        <p className="font-body text-ui text-primary">
          Subscription expired.{" "}
          {graceDaysLeft > 0 ? (
            <>
              Grace period ends in{" "}
              <span className="font-semibold text-error">
                {graceDaysLeft} {graceDaysLeft === 1 ? "day" : "days"}
              </span>
            </>
          ) : (
            <span className="font-semibold text-error">
              Grace period ends today
            </span>
          )}
        </p>
        <Link
          href="/pricing"
          className={buttonClasses({ variant: "primary", size: "sm", className: "shrink-0" })}
        >
          Renew Now
        </Link>
      </div>
    );
  }

  return null;
}
