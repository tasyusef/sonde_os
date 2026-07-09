import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { trackedAccounts } from "./portfolio";

/** User subscription records. One active subscription per user (enforced by partial unique index). */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userAddress: varchar("user_address", { length: 35 }).notNull()
    .references(() => trackedAccounts.address, { onDelete: "cascade" }),
  tier: varchar("tier", { length: 10 }).notNull(),         // 'pro' (legacy 'pro_ai' rows are normalized to 'pro' on read)
  status: varchar("status", { length: 10 }).notNull(),     // 'active' | 'canceled' | 'past_due' | 'expired'
  paymentMethod: varchar("payment_method", { length: 10 }).notNull(), // 'xrp' | 'rlusd' | 'stripe'
  walletProvider: varchar("wallet_provider", { length: 15 }),          // 'xaman' | 'walletconnect'
  billingCycle: varchar("billing_cycle", { length: 10 }).notNull(),    // 'monthly' | 'annual'
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  renewalReminderSent: boolean("renewal_reminder_sent").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_subscriptions_user").on(t.userAddress),
  index("idx_subscriptions_stripe_customer").on(t.stripeCustomerId),
  index("idx_subscriptions_period_end").on(t.currentPeriodEnd),
  // Partial unique index (one active sub per user) added via migration SQL —
  // Drizzle doesn't support partial indexes natively.
]);

/** Crypto payment tracking. Pending until PaymentWatcher detects on-ledger payment. */
export const cryptoPayments = pgTable("crypto_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userAddress: varchar("user_address", { length: 35 }).notNull(),
  txHash: varchar("tx_hash", { length: 64 }).unique(),
  amount: varchar("amount", { length: 50 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),         // 'XRP' | 'RLUSD'
  tier: varchar("tier", { length: 10 }).notNull(),
  billingCycle: varchar("billing_cycle", { length: 10 }).notNull(),
  destinationTag: integer("destination_tag").notNull().unique(),
  status: varchar("status", { length: 15 }).notNull().default("pending"),
  walletProvider: varchar("wallet_provider", { length: 15 }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_crypto_payments_tag").on(t.destinationTag),
  index("idx_crypto_payments_status").on(t.status),
]);

/** AI query usage tracking for rate limiting. */
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  userAddress: varchar("user_address", { length: 35 }).notNull(),
  queryType: varchar("query_type", { length: 20 }).notNull(),
  /** Model ID used for this request (e.g. "claude-haiku-4-5-20251001"). Nullable for rows written before the model-tracking migration. */
  model: varchar("model", { length: 50 }),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_ai_usage_daily").on(t.userAddress, t.createdAt),
  index("idx_ai_usage_model").on(t.model),
]);
