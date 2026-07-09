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
 * POST /api/subscription/reactivate
 * Undo cancellation before period end.
 * Stripe call must succeed before DB is updated to prevent divergence.
 */
export async function POST() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await getSubscription(session.address);
  if (sub.status !== "active" || !sub.cancelAtPeriodEnd) {
    return NextResponse.json(
      { error: "No pending cancellation to undo" },
      { status: 400 },
    );
  }

  // For Stripe: update Stripe first, then DB. Wrap so a Stripe outage
  // doesn't silently 500 mid-reactivation.
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
        cancel_at_period_end: false,
      });
    } catch (err) {
      logger.error({ err, address: session.address }, "[subscription/reactivate] Stripe update failed");
      return NextResponse.json(
        { error: "Couldn't reach Stripe — your subscription was not changed. Please try again." },
        { status: 502 },
      );
    }
  }

  try {
    await db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: false })
      .where(
        and(
          eq(subscriptions.userAddress, session.address),
          eq(subscriptions.status, "active"),
        ),
      );

    invalidateSubscriptionCache(session.address);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error({ err, address: session.address }, "[subscription/reactivate] DB update failed");
    return NextResponse.json(
      { error: "Reactivation accepted by Stripe but our database didn't sync. Please contact support." },
      { status: 500 },
    );
  }
}
