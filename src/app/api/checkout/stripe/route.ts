import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getStripe, getStripePriceId } from "@/lib/stripe";
import logger from "@/lib/logger";

/**
 * POST /api/checkout/stripe
 * Creates a Stripe Checkout session for subscription payment.
 * Body: { tier, cycle }
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe payments not configured" },
      { status: 503 },
    );
  }

  let body: { tier: string; cycle: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tier, cycle } = body;
  if (tier !== "pro") {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  if (cycle !== "monthly" && cycle !== "annual") {
    return NextResponse.json({ error: "Invalid cycle" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const priceId = getStripePriceId(tier, cycle);
    // Use env var to prevent Host header injection in redirect URLs
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userAddress: session.address, tier, cycle },
      success_url: `${origin}/portfolio?success=1`,
      cancel_url: `${origin}/pricing`,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    logger.error({ err }, "[checkout/stripe] Error");
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }
}
