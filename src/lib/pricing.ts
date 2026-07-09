/** Subscription pricing in USD. Crypto prices are lower (no Stripe processing fees).
 *
 * Repriced 2026-05-01 alongside the Pro = AI only reshape — was $9/$79
 * fiat, $8/$75 crypto. The thinner Pro shape (managed AI access only,
 * everything else free) doesn't justify the previous tier price. New
 * prices land at ~$5/mo with a $1 crypto discount and ~17% annual save. */
export const PRICING = {
  pro: {
    crypto: { monthly: 4, annual: 40 },
    fiat: { monthly: 5, annual: 50 },
  },
} as const;

export type SubscriptionTier = "pro";
export type BillingCycle = "monthly" | "annual";
export type PaymentCurrency = "XRP" | "RLUSD";

/** Get the USD price for a tier/cycle/method combo */
export function getPrice(
  tier: SubscriptionTier,
  cycle: BillingCycle,
  method: "crypto" | "fiat",
): number {
  return PRICING[tier][method][cycle];
}
