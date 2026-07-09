"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/shared/Button";
import type { BillingCycle } from "@/lib/pricing";

interface PricingCardProps {
  name: string;
  tier: "free" | "pro";
  price: number;
  cycle: BillingCycle;
  features: string[];
  current: boolean;
  isAuthenticated: boolean;
  payMethod?: "crypto" | "fiat";
  onAuthRequired?: () => void;
}

export default function PricingCard({
  name,
  tier,
  price,
  cycle,
  features,
  current,
  isAuthenticated,
  payMethod = "crypto",
  onAuthRequired,
}: PricingCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthlyEquiv =
    cycle === "annual" && price > 0
      ? `$${(price / 12).toFixed(2)}/mo`
      : null;

  async function handleSubscribe() {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (payMethod === "fiat") {
        const res = await fetch("/api/checkout/stripe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier, cycle }),
        });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        setError(data.error || "Failed to start checkout");
      } else {
        // Crypto: redirect to checkout flow (handled by CheckoutFlow modal in future)
        // For now, navigate to a checkout page with params
        router.push(
          `/pricing/checkout?tier=${tier}&cycle=${cycle}&method=${payMethod}`,
        );
      }
    } catch {
      setError("Could not connect to payment service");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="group flex flex-col rounded-xl border border-elevated bg-surface p-6 shadow-card transition-all duration-300 hover:border-brand hover:shadow-card-hover hover:-translate-y-1"
    >
      {/* Tier name */}
      <h3 className="font-display text-heading font-bold text-primary">
        {name}
      </h3>

      {/* Price */}
      <div className="mt-4 flex items-baseline gap-1">
        {price === 0 ? (
          <span className="font-display text-display font-bold text-primary">
            Free
          </span>
        ) : (
          <>
            <span className="font-display text-display font-bold text-primary">
              ${price}
            </span>
            <span className="font-body text-ui text-muted">
              /{cycle === "annual" ? "yr" : "mo"}
            </span>
          </>
        )}
      </div>

      {/* Monthly equivalent for annual */}
      {monthlyEquiv && (
        <p className="mt-1 font-mono text-label text-muted">
          {monthlyEquiv} billed annually
        </p>
      )}

      {/* Features */}
      <ul className="mt-6 flex flex-1 flex-col gap-2.5">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 font-body text-ui text-secondary"
          >
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-brand"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m4.5 12.75 6 6 9-13.5"
              />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-8">
        {current ? (
          <div className="rounded-lg border border-elevated bg-elevated px-4 py-2.5 text-center font-body text-ui font-medium text-muted">
            Current Plan
          </div>
        ) : tier === "free" ? (
          <div className="rounded-lg border border-elevated px-4 py-2.5 text-center font-body text-ui font-medium text-muted">
            Included
          </div>
        ) : (
          <Button
            onClick={handleSubscribe}
            loading={loading}
            variant="outline"
            fullWidth
            className="border-brand/30 text-muted group-hover:border-brand group-hover:bg-brand group-hover:!text-white"
          >
            {loading ? "Redirecting…" : "Get Started"}
          </Button>
        )}
        {error && (
          <p role="alert" className="mt-2 font-mono text-label text-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
