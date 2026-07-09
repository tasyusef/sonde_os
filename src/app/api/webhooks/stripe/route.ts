import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { invalidateSubscriptionCache } from "@/lib/subscription";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";
import logger from "@/lib/logger";

/**
 * Extract the billing period from a Stripe Subscription.
 * In Stripe v22, current_period_start/end moved from Subscription to SubscriptionItem.
 */
function getPeriod(sub: Stripe.Subscription): { start: Date; end: Date } {
  const item = sub.items.data[0];
  if (item) {
    return {
      start: new Date(item.current_period_start * 1000),
      end: new Date(item.current_period_end * 1000),
    };
  }
  // Fallback: use billing_cycle_anchor + 30 days
  const start = new Date(sub.billing_cycle_anchor * 1000);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
}

/**
 * Extract subscription ID from a Stripe Invoice.
 * In Stripe v22, subscription moved to invoice.parent.subscription_details.subscription.
 */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subDetails = invoice.parent?.subscription_details;
  if (!subDetails) return null;
  return typeof subDetails.subscription === "string"
    ? subDetails.subscription
    : subDetails.subscription?.id ?? null;
}

/**
 * POST /api/webhooks/stripe
 * Handles Stripe subscription lifecycle events.
 * Verified via webhook signing secret.
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    logger.error({ err }, "[stripe-webhook] Signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
    }
  } catch (err) {
    logger.error({ err }, `[stripe-webhook] Error handling ${event.type}`);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userAddress = session.metadata?.userAddress;
  const tier = session.metadata?.tier;
  const cycle = session.metadata?.cycle;
  if (!userAddress || !tier || !cycle) return;

  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;

  if (!stripeSubscriptionId) return;

  // Fetch the subscription from Stripe to get period from items
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const period = getPeriod(stripeSub);

  // Atomic: deactivate old + insert new in a single transaction.
  // Prevents race condition where concurrent webhook deliveries both pass
  // the idempotency check and create duplicate subscriptions.
  await db.transaction(async (tx) => {
    // Idempotency: skip if we already have a row for this Stripe subscription
    const existing = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId),
      columns: { id: true },
    });
    if (existing) return;

    // Deactivate any existing active subscription for this user
    await tx
      .update(subscriptions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.userAddress, userAddress),
          eq(subscriptions.status, "active"),
        ),
      );

    await tx.insert(subscriptions).values({
      userAddress,
      tier,
      status: "active",
      paymentMethod: "stripe",
      billingCycle: cycle,
      stripeCustomerId: stripeCustomerId ?? null,
      stripeSubscriptionId,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
    });
  });

  invalidateSubscriptionCache(userAddress);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  // Fetch subscription from Stripe for updated period
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const period = getPeriod(stripeSub);

  const [updated] = await db
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      renewalReminderSent: false,
    })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .returning({ userAddress: subscriptions.userAddress });

  if (updated) invalidateSubscriptionCache(updated.userAddress);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeSubscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  const [updated] = await db
    .update(subscriptions)
    .set({ status: "past_due" })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .returning({ userAddress: subscriptions.userAddress });

  if (updated) invalidateSubscriptionCache(updated.userAddress);
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const period = getPeriod(sub);
  const updates: Record<string, unknown> = {
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };

  // Sync status
  if (sub.status === "active") updates.status = "active";
  else if (sub.status === "past_due") updates.status = "past_due";
  else if (sub.status === "canceled") updates.status = "canceled";

  const [updated] = await db
    .update(subscriptions)
    .set(updates)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .returning({ userAddress: subscriptions.userAddress });

  if (updated) invalidateSubscriptionCache(updated.userAddress);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const [updated] = await db
    .update(subscriptions)
    .set({ status: "expired" })
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .returning({ userAddress: subscriptions.userAddress });

  if (updated) invalidateSubscriptionCache(updated.userAddress);
}
