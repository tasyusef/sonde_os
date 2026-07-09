import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { getSubscription, invalidateSubscriptionCache } from "@/lib/subscription";
import { getStripe } from "@/lib/stripe";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import logger from "@/lib/logger";

/**
 * POST /api/subscription/cancel
 * Sets cancel_at_period_end = true. Features remain until period end.
 * Stripe call must succeed before DB is updated to prevent divergence.
 */
export async function POST() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await getSubscription(session.address);
  if (sub.status !== "active") {
    return NextResponse.json({ error: "No active subscription" }, { status: 400 });
  }
  if (sub.cancelAtPeriodEnd) {
    return NextResponse.json({ error: "Already canceled" }, { status: 400 });
  }

  // For Stripe: update Stripe first, then DB. If Stripe fails, don't touch DB.
  // Wrap the Stripe call in try/catch so a transient Stripe outage returns
  // a clear error to the user rather than silently 500-ing mid-billing.
  if (sub.paymentMethod === "stripe") {
    const row = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userAddress, session.address),
        eq(subscriptions.status, "active"),
      ),
      columns: { stripeSubscriptionId: true },
    });

    if (!row?.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "Stripe subscription not found" },
        { status: 400 },
      );
    }

    try {
      const stripe = getStripe();
      await stripe.subscriptions.update(row.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    } catch (err) {
      logger.error({ err, address: session.address }, "[subscription/cancel] Stripe update failed");
      return NextResponse.json(
        { error: "Couldn't reach Stripe — your subscription was not changed. Please try again." },
        { status: 502 },
      );
    }
  }

  try {
    // DB update only runs after Stripe succeeds (or for crypto subs)
    await db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(
        and(
          eq(subscriptions.userAddress, session.address),
          eq(subscriptions.status, "active"),
        ),
      );

    invalidateSubscriptionCache(session.address);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, address: session.address }, "[subscription/cancel] DB update failed");
    return NextResponse.json(
      { error: "Cancellation accepted by Stripe but our database didn't sync. Please contact support." },
      { status: 500 },
    );
  }
}
