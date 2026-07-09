import "server-only";
import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/** Map tier + cycle to Stripe Price ID from env vars */
export function getStripePriceId(
  tier: "pro",
  cycle: "monthly" | "annual",
): string {
  // tier param kept for forward-compat in case a second tier is reintroduced.
  void tier;
  const key =
    cycle === "monthly"
      ? "STRIPE_PRO_MONTHLY_PRICE_ID"
      : "STRIPE_PRO_ANNUAL_PRICE_ID";

  const priceId = process.env[key];
  if (!priceId) throw new Error(`${key} env var is required`);
  return priceId;
}
