import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { getSubscription } from "@/lib/subscription";
import { getStripe } from "@/lib/stripe";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import logger from "@/lib/logger";

/**
 * POST /api/subscription/portal
 * Creates a Stripe Customer Portal session. Returns redirect URL.
 * Used for: update payment method, view invoices, manage cancellation.
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await getSubscription(session.address);
  if (sub.paymentMethod !== "stripe") {
    return NextResponse.json(
      { error: "Portal only available for Stripe subscriptions" },
      { status: 400 },
    );
  }

  const row = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userAddress, session.address),
      eq(subscriptions.paymentMethod, "stripe"),
    ),
    columns: { stripeCustomerId: true },
    orderBy: (s, { desc }) => [desc(s.currentPeriodEnd)],
  });

  if (!row?.stripeCustomerId) {
    return NextResponse.json(
      { error: "No Stripe customer found" },
      { status: 400 },
    );
  }

  try {
    const stripe = getStripe();
    // Use the configured app URL when available rather than trusting
    // the request's Host header — same pattern as /api/checkout/stripe.
    // Mitigates an attacker-supplied Host (via misconfigured proxy)
    // redirecting the user to a phishing /portfolio after Portal exit.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: row.stripeCustomerId,
      return_url: `${baseUrl}/portfolio`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    logger.error({ err }, "[subscription/portal] Error");
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 },
    );
  }
}
