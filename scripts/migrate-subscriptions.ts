/**
 * Migration: create subscription, crypto_payments, and ai_usage tables.
 * Includes partial unique index and updated_at trigger.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/migrate-subscriptions.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function main() {
  // ── subscriptions ──
  console.log("Creating subscriptions table...");
  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_address VARCHAR(35) NOT NULL REFERENCES tracked_accounts(address) ON DELETE CASCADE,
      tier VARCHAR(10) NOT NULL,
      status VARCHAR(10) NOT NULL,
      payment_method VARCHAR(10) NOT NULL,
      wallet_provider VARCHAR(15),
      billing_cycle VARCHAR(10) NOT NULL,
      stripe_customer_id VARCHAR(255),
      stripe_subscription_id VARCHAR(255),
      current_period_start TIMESTAMPTZ NOT NULL,
      current_period_end TIMESTAMPTZ NOT NULL,
      cancel_at_period_end BOOLEAN DEFAULT FALSE,
      renewal_reminder_sent BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("Creating subscriptions indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_address)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions (stripe_customer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions (current_period_end)`;

  // Partial unique index: only one active subscription per user
  console.log("Creating partial unique index (one active sub per user)...");
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_active_user
    ON subscriptions (user_address) WHERE status = 'active'
  `;

  // Auto-update updated_at trigger
  console.log("Creating updated_at trigger...");
  await sql`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql
  `;
  // DROP first to avoid "trigger already exists" error on re-run
  await sql`DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions`;
  await sql`
    CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at()
  `;

  // ── crypto_payments ──
  console.log("Creating crypto_payments table...");
  await sql`
    CREATE TABLE IF NOT EXISTS crypto_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_address VARCHAR(35) NOT NULL,
      tx_hash VARCHAR(64) UNIQUE,
      amount VARCHAR(50) NOT NULL,
      currency VARCHAR(10) NOT NULL,
      tier VARCHAR(10) NOT NULL,
      billing_cycle VARCHAR(10) NOT NULL,
      destination_tag INTEGER NOT NULL UNIQUE,
      status VARCHAR(15) NOT NULL DEFAULT 'pending',
      wallet_provider VARCHAR(15),
      subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("Creating crypto_payments indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_crypto_payments_tag ON crypto_payments (destination_tag)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crypto_payments_status ON crypto_payments (status)`;

  // ── ai_usage ──
  console.log("Creating ai_usage table...");
  await sql`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_address VARCHAR(35) NOT NULL,
      query_type VARCHAR(20) NOT NULL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      cost_usd NUMERIC(10, 6),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("Creating ai_usage indexes...");
  await sql`CREATE INDEX IF NOT EXISTS idx_ai_usage_daily ON ai_usage (user_address, created_at)`;

  console.log("Done — all subscription tables created.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
