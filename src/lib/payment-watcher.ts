import "server-only";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { cryptoPayments, subscriptions } from "@/db/schema";
import { invalidateSubscriptionCache } from "./subscription";
import { xrplClient, type TransactionStream } from "./xrpl-client";
import logger from "./logger";

const log = logger.child({ module: "payment-watcher" });

// Ripple epoch offset: XRPL dates are seconds since Jan 1, 2000 00:00 UTC
const RIPPLE_EPOCH = 946684800;

/**
 * Normalize XRPL Payment Amount to a number.
 * XRP amounts arrive as a string of drops ("9000000" = 9 XRP).
 * Issued currency amounts arrive as { value: "9", currency: "...", issuer: "..." }.
 */
function parsePaymentAmount(
  amount: string | { value: string; currency: string; issuer: string },
): number {
  if (typeof amount === "string") {
    return parseInt(amount, 10) / 1_000_000; // drops -> XRP
  }
  return parseFloat(amount.value);
}

class PaymentWatcher {
  private started = false;

  /** Called once at server startup (alongside other managers in init-server.ts) */
  async start() {
    if (this.started) return;
    this.started = true;

    const treasury = process.env.SONDE_TREASURY_ADDRESS;
    if (!treasury) {
      log.warn("SONDE_TREASURY_ADDRESS not set — PaymentWatcher disabled");
      this.started = false;
      return;
    }

    log.info({ treasury }, "Starting PaymentWatcher");

    // Subscribe to treasury account transactions via XrplClient
    await xrplClient.subscribeAccount(treasury, (tx) =>
      this.handleTransaction(tx).catch((err) =>
        log.error({ err }, "Error handling transaction"),
      ),
    );

    // On startup, check for payments that arrived while server was down
    await this.reconcilePendingPayments();
  }

  private async handleTransaction(tx: TransactionStream) {
    const treasury = process.env.SONDE_TREASURY_ADDRESS;

    // Only process Payment transactions
    if (tx.transaction.TransactionType !== "Payment") return;

    // Only process successful transactions
    if (tx.meta?.TransactionResult !== "tesSUCCESS") return;

    // Must be TO the treasury (not FROM)
    if (tx.transaction.Destination !== treasury) return;

    // Extract destination tag
    const tag = tx.transaction.DestinationTag;
    if (tag === undefined) return; // no tag = not a subscription payment

    // Look up pending payment by destination tag
    const pending = await db.query.cryptoPayments.findFirst({
      where: and(
        eq(cryptoPayments.destinationTag, tag),
        eq(cryptoPayments.status, "pending"),
      ),
    });
    if (!pending) return; // unknown tag or already processed

    // Verify amount >= expected
    if (!tx.transaction.Amount) return;
    const receivedAmount = parsePaymentAmount(tx.transaction.Amount);
    const expectedAmount = parseFloat(pending.amount);
    if (receivedAmount < expectedAmount) {
      await db
        .update(cryptoPayments)
        .set({ txHash: tx.transaction.hash, status: "underpaid" })
        .where(eq(cryptoPayments.id, pending.id));
      log.warn(
        { tag, received: receivedAmount, expected: expectedAmount },
        "Underpayment detected",
      );
      return;
    }

    // Activate!
    await this.activateSubscription(pending, tx.transaction.hash);
  }

  private async activateSubscription(
    pending: typeof cryptoPayments.$inferSelect,
    txHash: string,
  ) {
    try {
      await db.transaction(async (trx) => {
        // Atomic check-and-set: only update if still pending (idempotency guard)
        const [updated] = await trx
          .update(cryptoPayments)
          .set({ status: "verified", txHash })
          .where(
            and(
              eq(cryptoPayments.id, pending.id),
              eq(cryptoPayments.status, "pending"),
            ),
          )
          .returning();

        if (!updated) return; // already processed (duplicate delivery)

        // Deactivate any existing active subscription for this user
        await trx
          .update(subscriptions)
          .set({ status: "expired", updatedAt: new Date() })
          .where(
            and(
              eq(subscriptions.userAddress, pending.userAddress),
              eq(subscriptions.status, "active"),
            ),
          );

        // Create new subscription
        const periodStart = new Date();
        const periodEnd = new Date();
        periodEnd.setMonth(
          periodEnd.getMonth() + (pending.billingCycle === "annual" ? 12 : 1),
        );

        const [sub] = await trx
          .insert(subscriptions)
          .values({
            userAddress: pending.userAddress,
            tier: pending.tier,
            status: "active",
            paymentMethod: pending.currency.toLowerCase() as "xrp" | "rlusd",
            walletProvider: pending.walletProvider,
            billingCycle: pending.billingCycle,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          })
          .returning();

        // Link payment to subscription
        await trx
          .update(cryptoPayments)
          .set({ subscriptionId: sub.id })
          .where(eq(cryptoPayments.id, pending.id));
      });

      log.info(
        { user: pending.userAddress, tier: pending.tier, txHash },
        "Subscription activated",
      );
    } catch (err) {
      // Handle unique constraint violations gracefully (duplicate tx_hash)
      if ((err as { code?: string })?.code === "23505") {
        log.warn({ tag: pending.destinationTag }, "Duplicate activation attempt");
        return;
      }
      throw err;
    }

    // Invalidate subscription cache
    invalidateSubscriptionCache(pending.userAddress);
  }

  /** On startup: check for payments that landed while server was offline */
  private async reconcilePendingPayments() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingPayments = await db.query.cryptoPayments.findMany({
      where: and(
        eq(cryptoPayments.status, "pending"),
        gt(cryptoPayments.createdAt, oneDayAgo),
      ),
    });

    if (pendingPayments.length === 0) return;

    log.info({ count: pendingPayments.length }, "Reconciling pending payments");

    // Find the oldest pending payment to know how far back to search
    const oldestPending = pendingPayments.reduce(
      (oldest, p) => (p.createdAt < oldest.createdAt ? p : oldest),
      pendingPayments[0],
    );

    const treasury = process.env.SONDE_TREASURY_ADDRESS!;
    let marker: unknown = undefined;
    const allTxs: Array<{ tx: Record<string, unknown>; meta: Record<string, unknown> }> = [];

    do {
      const result = (await xrplClient.send({
        command: "account_tx",
        account: treasury,
        limit: 200,
        ...(marker ? { marker } : {}),
      })) as {
        transactions: Array<{ tx: Record<string, unknown>; meta: Record<string, unknown> }>;
        marker?: unknown;
      };

      allTxs.push(...result.transactions);
      marker = result.marker;

      // Stop paginating once we've gone past the oldest pending payment
      const lastTx = result.transactions[result.transactions.length - 1];
      if (lastTx) {
        const txDate = new Date(
          ((lastTx.tx.date as number) + RIPPLE_EPOCH) * 1000,
        );
        if (txDate < oldestPending.createdAt) break;
      }
    } while (marker);

    for (const entry of allTxs) {
      const tx = entry.tx;
      const meta = entry.meta;
      if (tx.TransactionType !== "Payment") continue;
      if (meta?.TransactionResult !== "tesSUCCESS") continue;
      if (tx.Destination !== treasury) continue;

      const tag = tx.DestinationTag as number | undefined;
      const match = pendingPayments.find(
        (p) => p.destinationTag === tag && p.status === "pending",
      );
      if (!match) continue;

      const received = parsePaymentAmount(
        tx.Amount as string | { value: string; currency: string; issuer: string },
      );
      if (received >= parseFloat(match.amount)) {
        await this.activateSubscription(match, tx.hash as string);
      }
    }
  }
}

// globalThis singleton for HMR survival
const globalForPaymentWatcher = globalThis as unknown as {
  _paymentWatcher?: PaymentWatcher;
};
if (!globalForPaymentWatcher._paymentWatcher) {
  globalForPaymentWatcher._paymentWatcher = new PaymentWatcher();
}
export const paymentWatcher = globalForPaymentWatcher._paymentWatcher;
