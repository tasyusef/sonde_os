import "server-only";
import { eq, and, lt, ne, lte } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, cryptoPayments, authSessions } from "@/db/schema";
import { invalidateSubscriptionCache, GRACE_PERIOD_DAYS } from "./subscription";
import logger from "./logger";

const log = logger.child({ module: "subscription-expiry" });

const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const REMINDER_DAYS = 7;

class SubscriptionExpiryChecker {
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    log.info("Starting SubscriptionExpiryChecker (hourly)");

    // Run immediately, then every hour
    this.check().catch((err) => log.error({ err }, "Expiry check failed"));
    this.timer = setInterval(() => {
      this.check().catch((err) => log.error({ err }, "Expiry check failed"));
    }, CHECK_INTERVAL);
  }

  private async check() {
    const now = new Date();

    // 1. Expire active crypto subscriptions past their period end + grace period
    const graceExpiry = new Date(
      now.getTime() - GRACE_PERIOD_DAYS * 86_400_000,
    );
    const expired = await db
      .update(subscriptions)
      .set({ status: "expired" })
      .where(
        and(
          eq(subscriptions.status, "active"),
          ne(subscriptions.paymentMethod, "stripe"), // Stripe handles its own expiry via webhooks
          lte(subscriptions.currentPeriodEnd, graceExpiry),
        ),
      )
      .returning({ userAddress: subscriptions.userAddress });

    if (expired.length > 0) {
      log.info({ count: expired.length }, "Expired crypto subscriptions");
      for (const row of expired) {
        invalidateSubscriptionCache(row.userAddress);
      }
    }

    // 2. Set renewal reminder flag for crypto subs expiring within 7 days
    const reminderThreshold = new Date(
      now.getTime() + REMINDER_DAYS * 86_400_000,
    );
    await db
      .update(subscriptions)
      .set({ renewalReminderSent: true })
      .where(
        and(
          eq(subscriptions.status, "active"),
          ne(subscriptions.paymentMethod, "stripe"),
          eq(subscriptions.renewalReminderSent, false),
          lte(subscriptions.currentPeriodEnd, reminderThreshold),
        ),
      );

    // 3. Expire stale pending crypto payments (past their payment window)
    await db
      .update(cryptoPayments)
      .set({ status: "expired" })
      .where(
        and(
          eq(cryptoPayments.status, "pending"),
          lt(cryptoPayments.expiresAt, now),
        ),
      );

    // 4. Clean up expired auth sessions to prevent unbounded table growth
    const deletedSessions = await db
      .delete(authSessions)
      .where(lt(authSessions.expiresAt, now))
      .returning({ id: authSessions.id });
    if (deletedSessions.length > 0) {
      log.info(`Cleaned up ${deletedSessions.length} expired auth sessions`);
    }
  }
}

// globalThis singleton for HMR survival
const globalForExpiry = globalThis as unknown as {
  _subscriptionExpiry?: SubscriptionExpiryChecker;
};
if (!globalForExpiry._subscriptionExpiry) {
  globalForExpiry._subscriptionExpiry = new SubscriptionExpiryChecker();
}
const subscriptionExpiryChecker = globalForExpiry._subscriptionExpiry;

export function initSubscriptionExpiry() {
  subscriptionExpiryChecker.start();
}
