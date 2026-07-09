"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { PRICING } from "@/lib/pricing";
import type { BillingCycle, SubscriptionTier } from "@/lib/pricing";
import PricingCard from "./PricingCard";
import Toggle from "@/components/shared/Toggle";
import Button from "@/components/shared/Button";
import { cn } from "@/lib/utils";

const FREE_FEATURES = [
  "Block explorer: accounts, txs, ledgers",
  "Token list, token pages, NFT gallery",
  "Network overview and live feed",
  "Network analytics (volume, fees, corridors)",
  "Anomaly detection and token health",
  "Smart Money — full leaderboard, wallet detail, holdings, live trade feed",
  "Whale activity feed",
  "Issuer analysis",
  "Fund tracing (multi-hop follow the money)",
  "Common counterparties between accounts",
  "Risk scoring and wash trading detection",
  "Watchlist + alerts (up to 20 rules)",
  "Full portfolio: PnL, cost basis, allocation, AMM positions, CSV export",
  "Xaman wallet sign-in",
];

const PRO_FEATURES = [
  "Natural language query — ask the ledger questions in plain English",
  "Portfolio AI assistant — ask Claude about your own holdings",
  "50 managed AI queries per month, powered by Claude",
  "Bring your own Anthropic / OpenAI / Google key for unlimited (BYOK)",
];

const TIERS: { name: string; tier: SubscriptionTier | "free"; features: string[] }[] = [
  { name: "Explorer", tier: "free", features: FREE_FEATURES },
  { name: "Pro", tier: "pro", features: PRO_FEATURES },
];

function MobileAccordion({
  tiers,
  cycle,
  method,
  payMethod,
  currentTier,
  isAuthenticated,
  onAuthRequired,
}: {
  tiers: typeof TIERS;
  cycle: BillingCycle;
  method: "crypto" | "fiat";
  payMethod: "crypto" | "fiat";
  currentTier: string;
  isAuthenticated: boolean;
  onAuthRequired: () => void;
}) {
  const router = useRouter();
  const [expandedTier, setExpandedTier] = useState<string>("free");
  const [loading, setLoading] = useState<string | null>(null);

  function getPrice(tier: string): number {
    if (tier === "free") return 0;
    return PRICING.pro[method][cycle];
  }

  async function handleSubscribe(tier: string) {
    if (!isAuthenticated) { onAuthRequired(); return; }
    setLoading(tier);
    try {
      if (payMethod === "fiat") {
        const res = await fetch("/api/checkout/stripe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier, cycle }),
        });
        const data = await res.json();
        if (data.url) { window.location.assign(data.url); return; }
      } else {
        router.push(`/pricing/checkout?tier=${tier}&cycle=${cycle}&method=${payMethod}`);
      }
    } catch { /* handled by button state */ } finally { setLoading(null); }
  }

  return (
    <div className="mt-12 flex flex-col gap-3 md:hidden">
      {tiers.map((t) => {
        const price = getPrice(t.tier);
        const isExpanded = expandedTier === t.tier;
        const isCurrent = currentTier === t.tier;
        const monthlyEquiv = cycle === "annual" && price > 0
          ? `$${(price / 12).toFixed(2)}/mo`
          : null;

        return (
          <div key={t.tier} className="rounded-xl border border-elevated bg-surface shadow-card overflow-hidden">
            {/* Collapsed header — always visible */}
            <button
              onClick={() => setExpandedTier(isExpanded ? "" : t.tier)}
              className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-elevated/30"
            >
              <div>
                <span className="font-display text-ui font-bold text-primary">{t.name}</span>
                {isCurrent && (
                  <span className="ml-2 rounded-tag bg-brand/10 px-1.5 py-0.5 font-mono text-tag text-brand">Current</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-display text-heading font-bold text-primary">
                  {price === 0 ? "Free" : `$${price}`}
                  {price > 0 && <span className="font-body text-label text-muted">/{cycle === "annual" ? "yr" : "mo"}</span>}
                </span>
                <svg
                  className={cn("h-4 w-4 text-muted transition-transform duration-200", isExpanded && "rotate-180")}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </button>

            {/* Expanded content */}
            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-elevated px-5 pb-5 pt-4">
                    {monthlyEquiv && (
                      <p className="mb-3 font-mono text-label text-muted">{monthlyEquiv} billed annually</p>
                    )}

                    <ul className="flex flex-col gap-2">
                      {t.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 font-body text-ui text-secondary">
                          <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <div className="mt-5">
                      {isCurrent ? (
                        <div className="rounded-lg border border-elevated bg-elevated px-4 py-2.5 text-center font-body text-ui font-medium text-muted">
                          Current Plan
                        </div>
                      ) : t.tier === "free" ? (
                        <div className="rounded-lg border border-elevated px-4 py-2.5 text-center font-body text-ui font-medium text-muted">
                          Included
                        </div>
                      ) : (
                        <Button
                          onClick={() => handleSubscribe(t.tier)}
                          loading={loading === t.tier}
                          variant="primary"
                          size="lg"
                          fullWidth
                        >
                          {loading === t.tier ? "Redirecting…" : "Get Started"}
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export default function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [payMethod, setPayMethod] = useState<"crypto" | "fiat">("fiat");
  const { address } = useAuth();
  const { tier } = useSubscription();

  const [showAuthOverlay, setShowAuthOverlay] = useState(false);

  // Crypto supports both monthly and annual — no auto-renewal, manual each period
  const effectiveCycle = cycle;
  const method = payMethod;

  const handleAuthRequired = useCallback(() => setShowAuthOverlay(true), []);

  // Close on Escape
  useEffect(() => {
    if (!showAuthOverlay) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAuthOverlay(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAuthOverlay]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      {/* Header */}
      <div className="text-center">
        <h1 className="font-display text-display font-bold tracking-display text-primary">
          Sonde is free. Pro adds managed AI.
        </h1>
        <p className="mt-3 font-body text-lg text-muted">
          The full explorer — Smart Money, alerts, fund tracing, portfolio — is free for everyone.
          Pro adds Claude-powered natural language access without needing your own API key.
        </p>
      </div>

      {/* Toggles */}
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
        {/* Billing cycle toggle */}
        <Toggle
          options={[
            { value: "monthly" as BillingCycle, label: "Monthly" },
            { value: "annual" as BillingCycle, label: <>Annual<span className="ml-1 rounded-tag bg-success/10 px-1 py-px text-micro font-semibold text-success">-17%</span></> },
          ]}
          active={cycle}
          onChange={setCycle}
        />

        {/* Payment method toggle */}
        <Toggle
          options={[
            { value: "fiat" as const, label: "Card" },
            { value: "crypto" as const, label: "Crypto" },
          ]}
          active={payMethod}
          onChange={setPayMethod}
        />
      </div>

      {/* Desktop: grid cards */}
      <div className="mt-12 hidden gap-6 md:grid md:grid-cols-2 md:max-w-3xl md:mx-auto">
        <PricingCard
          name="Explorer"
          tier="free"
          price={0}
          cycle={effectiveCycle}
          features={FREE_FEATURES}
          current={tier === "free"}
          isAuthenticated={!!address}
        />
        <PricingCard
          name="Pro"
          tier="pro"
          price={PRICING.pro[method][effectiveCycle]}
          cycle={effectiveCycle}
          features={PRO_FEATURES}
          current={tier === "pro"}
          isAuthenticated={!!address}
          payMethod={payMethod}
          onAuthRequired={handleAuthRequired}
        />
      </div>

      {/* Mobile: stacked accordion */}
      <MobileAccordion
        tiers={TIERS}
        cycle={effectiveCycle}
        method={method}
        payMethod={payMethod}
        currentTier={tier}
        isAuthenticated={!!address}
        onAuthRequired={handleAuthRequired}
      />

      {/* Footer note */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <p className="font-mono text-label text-muted">
          {payMethod === "crypto"
            ? "Pay with XRP or RLUSD. No processing fees."
            : "Powered by Stripe. Prices include processing fees."}
        </p>
        {payMethod === "crypto" && (
          <p className="rounded-tag border border-error/30 bg-error/10 px-2.5 py-1 font-mono text-tag text-error">
            Crypto payments do not auto-renew
          </p>
        )}
      </div>

      {/* Auth required overlay */}
      {showAuthOverlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowAuthOverlay(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-xl border border-elevated bg-card p-8 text-center shadow-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="auth-overlay-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand/10">
              <svg
                className="h-6 w-6 text-brand"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3"
                />
              </svg>
            </div>
            <h2
              id="auth-overlay-title"
              className="font-display text-heading font-bold text-primary"
            >
              Sign in first
            </h2>
            <p className="mt-2 font-body text-ui text-muted">
              Connect your wallet to subscribe to a plan.
            </p>
            <Button
              onClick={() => setShowAuthOverlay(false)}
              variant="primary"
              size="lg"
              fullWidth
              className="mt-6"
            >
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
