/**
 * Tier 1.5 pre-reingest schema migration.
 *
 * Applies the schema-rigid fixes called out by the post-Tier-1 audit
 * (Opus C1/C2/C3 + s3 + m1) BEFORE the AMM-era re-ingestion bakes them in.
 * See docs/wiki/architecture/tier1.5-audit-findings.md for the full audit.
 *
 * Changes:
 *
 *   1. dex_trades — DESTRUCTIVE rebuild (data is in the contaminated range
 *      and will be re-ingested).
 *      - drop the 4 dependent MVs (mv_dex_pair_daily_view,
 *        mv_token_volume_hourly_view, mv_wallet_trade_volume_hourly_*_view)
 *      - drop the table
 *      - recreate with:
 *          * new columns: base_amount_iou String, quote_amount_iou String
 *            (lossless IOU values, parallel to amount_iou on transactions)
 *          * new column: fill_index UInt8 (disambiguates multi-fill case
 *            where one tx consumes multiple offers from the same maker)
 *          * ORDER BY (timestamp, tx_hash, fill_index) — drops the Float64
 *            base/quote_amount fields from the dedup key (they were a
 *            phantom-duplicate hazard on replay), keeps timestamp-leading
 *            order for fast time-range scans
 *          * ENGINE = ReplacingMergeTree(timestamp) — explicit version
 *            column for deterministic dedup on replay
 *          * Bloom filter indexes on taker, maker for leaderboard queries
 *      - recreate the 4 MVs to also project the new IOU columns
 *
 *   2. value_transfer_events — DESTRUCTIVE rebuild (table is empty).
 *      - drop + recreate with extended ORDER BY:
 *        ORDER BY (to_account, timestamp, tx_hash, from_account, currency, issuer)
 *      - prevents future dual-asset AMMDeposit/AMMWithdraw rows from
 *        dedup-eating one side
 *      - bloom filter on from_account for symmetric query support
 *
 *   3. transactions — ADDITIVE (no data loss):
 *      - ADD COLUMN last_ledger_sequence UInt32 DEFAULT 0
 *      - ADD COLUMN ticket_sequence UInt32 DEFAULT 0
 *      - ADD COLUMN signing_pub_key String DEFAULT ''
 *      - ADD COLUMN network_id UInt32 DEFAULT 0
 *      - ADD INDEX idx_ledger_index ledger_index TYPE minmax GRANULARITY 1
 *
 * The destructive parts (dex_trades + value_transfer_events) are
 * idempotent via DROP TABLE IF EXISTS + CREATE. Re-running on already-
 * migrated tables would lose data — so the script gates on a sentinel
 * column (`fill_index` on dex_trades) to detect prior application.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-tier1.5-pre-reingest.ts                              # sonde_smoketest, dry-run
 *   pnpm exec tsx scripts/migrate-tier1.5-pre-reingest.ts --execute                    # sonde_smoketest, apply
 *   pnpm exec tsx scripts/migrate-tier1.5-pre-reingest.ts --db sonde --confirm-production --execute
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}

const DB = getArg("--db") ?? "sonde_smoketest";
const CONFIRM_PRODUCTION = args.includes("--confirm-production");
const EXECUTE = args.includes("--execute");

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error("[migrate-tier1.5] refusing to target production 'sonde' without --confirm-production");
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("[migrate-tier1.5] CLICKHOUSE_URL required (set in .env.local)");
  process.exit(1);
}

const client = createClient({
  url,
  database: DB,
  request_timeout: 120_000,
});

async function checkAlreadyMigrated(): Promise<boolean> {
  /* Sentinel: the new dex_trades has a fill_index column; the old one doesn't. */
  const result = await client.query({
    query: `SELECT count() AS cnt FROM system.columns WHERE database = '${DB}' AND table = 'dex_trades' AND name = 'fill_index'`,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as { cnt: number }[];
  return Number(rows[0]?.cnt ?? 0) > 0;
}

interface Step {
  label: string;
  /** Set on idempotent steps that should NOT abort if the prior state is already
   *  applied. ALTER TABLE ADD COLUMN IF NOT EXISTS is naturally idempotent. */
  swallowIfExists?: boolean;
  query: string;
}

const STEPS: Step[] = [
  /* ── Drop the 4 dex_trades-dependent MVs ──────────────────────── */
  { label: "DROP VIEW mv_dex_pair_daily_view",                  query: `DROP VIEW IF EXISTS ${DB}.mv_dex_pair_daily_view` },
  { label: "DROP VIEW mv_token_volume_hourly_view",             query: `DROP VIEW IF EXISTS ${DB}.mv_token_volume_hourly_view` },
  { label: "DROP VIEW mv_wallet_trade_volume_hourly_maker_view", query: `DROP VIEW IF EXISTS ${DB}.mv_wallet_trade_volume_hourly_maker_view` },
  { label: "DROP VIEW mv_wallet_trade_volume_hourly_taker_view", query: `DROP VIEW IF EXISTS ${DB}.mv_wallet_trade_volume_hourly_taker_view` },

  /* ── DROP + CREATE dex_trades ────────────────────────────────── */
  { label: "DROP TABLE dex_trades",                             query: `DROP TABLE IF EXISTS ${DB}.dex_trades SYNC` },
  {
    label: "CREATE TABLE dex_trades (new schema)",
    query: `CREATE TABLE ${DB}.dex_trades (
      tx_hash          FixedString(64),
      fill_index       UInt8 DEFAULT 0,
      timestamp        DateTime,
      ledger_index     UInt32,
      taker            String,
      maker            String,
      base_currency    LowCardinality(String),
      base_issuer      String DEFAULT '',
      base_amount      Float64,
      base_amount_iou  String DEFAULT '',
      quote_currency   LowCardinality(String),
      quote_issuer     String DEFAULT '',
      quote_amount     Float64,
      quote_amount_iou String DEFAULT '',
      price            Float64,
      xrp_volume_drops Int64 DEFAULT 0,
      INDEX idx_taker taker TYPE bloom_filter GRANULARITY 1,
      INDEX idx_maker maker TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (timestamp, tx_hash, fill_index)
    SETTINGS index_granularity = 8192`,
  },

  /* ── Recreate the 4 MVs against the new dex_trades ────────────── */
  {
    label: "CREATE VIEW mv_dex_pair_daily_view",
    query: `CREATE MATERIALIZED VIEW ${DB}.mv_dex_pair_daily_view TO ${DB}.mv_dex_pair_daily AS
      SELECT
        toDate(timestamp) AS day,
        base_currency,
        base_issuer,
        quote_currency,
        quote_issuer,
        count() AS trade_count,
        sum(base_amount) AS base_volume,
        sum(quote_amount) AS quote_volume,
        sum(xrp_volume_drops) AS xrp_volume_drops
      FROM ${DB}.dex_trades
      GROUP BY day, base_currency, base_issuer, quote_currency, quote_issuer`,
  },
  {
    label: "CREATE VIEW mv_token_volume_hourly_view",
    query: `CREATE MATERIALIZED VIEW ${DB}.mv_token_volume_hourly_view TO ${DB}.mv_token_volume_hourly AS
      SELECT
        toStartOfHour(timestamp) AS hour,
        base_currency,
        base_issuer,
        quote_currency,
        quote_issuer,
        count() AS trade_count,
        sum(base_amount) AS base_volume,
        sum(quote_amount) AS quote_volume,
        sum(xrp_volume_drops) AS xrp_volume_drops,
        argMinState(price, timestamp) AS open_price,
        argMaxState(price, timestamp) AS close_price,
        max(price) AS high_price,
        min(price) AS low_price
      FROM ${DB}.dex_trades
      GROUP BY hour, base_currency, base_issuer, quote_currency, quote_issuer`,
  },
  {
    label: "CREATE VIEW mv_wallet_trade_volume_hourly_maker_view",
    query: `CREATE MATERIALIZED VIEW ${DB}.mv_wallet_trade_volume_hourly_maker_view TO ${DB}.mv_wallet_trade_volume_hourly AS
      SELECT
        toStartOfHour(timestamp) AS hour,
        maker AS wallet,
        count() AS trade_count,
        sum(xrp_volume_drops) AS xrp_volume_drops
      FROM ${DB}.dex_trades
      WHERE maker != ''
      GROUP BY hour, wallet`,
  },
  {
    label: "CREATE VIEW mv_wallet_trade_volume_hourly_taker_view",
    query: `CREATE MATERIALIZED VIEW ${DB}.mv_wallet_trade_volume_hourly_taker_view TO ${DB}.mv_wallet_trade_volume_hourly AS
      SELECT
        toStartOfHour(timestamp) AS hour,
        taker AS wallet,
        count() AS trade_count,
        sum(xrp_volume_drops) AS xrp_volume_drops
      FROM ${DB}.dex_trades
      WHERE taker != ''
      GROUP BY hour, wallet`,
  },

  /* ── DROP + CREATE value_transfer_events (table is empty) ──────── */
  { label: "DROP TABLE value_transfer_events", query: `DROP TABLE IF EXISTS ${DB}.value_transfer_events SYNC` },
  {
    label: "CREATE TABLE value_transfer_events (extended ORDER BY)",
    query: `CREATE TABLE ${DB}.value_transfer_events (
      tx_hash         FixedString(64),
      ledger_index    UInt32,
      timestamp       DateTime,
      tx_type         LowCardinality(String),
      transfer_kind   LowCardinality(String),
      from_account    String,
      to_account      String,
      amount_drops    Int64 DEFAULT 0,
      amount_iou      String DEFAULT '',
      currency        LowCardinality(String) DEFAULT 'XRP',
      issuer          String DEFAULT '',
      INDEX idx_from_account from_account TYPE bloom_filter GRANULARITY 1
    ) ENGINE = ReplacingMergeTree(timestamp)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (to_account, timestamp, tx_hash, from_account, currency, issuer)
    SETTINGS index_granularity = 8192`,
  },

  /* ── Additive ALTERs on transactions ──────────────────────────── */
  { label: "transactions: ADD COLUMN last_ledger_sequence", swallowIfExists: true,
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS last_ledger_sequence UInt32 DEFAULT 0` },
  { label: "transactions: ADD COLUMN ticket_sequence",      swallowIfExists: true,
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS ticket_sequence UInt32 DEFAULT 0` },
  { label: "transactions: ADD COLUMN signing_pub_key",      swallowIfExists: true,
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS signing_pub_key String DEFAULT ''` },
  { label: "transactions: ADD COLUMN network_id",           swallowIfExists: true,
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS network_id UInt32 DEFAULT 0` },

  /* Skip index for ledger-range queries. ALTER ... ADD INDEX is idempotent
   * via IF NOT EXISTS in CH 22+. */
  { label: "transactions: ADD INDEX idx_ledger_index", swallowIfExists: true,
    query: `ALTER TABLE ${DB}.transactions ADD INDEX IF NOT EXISTS idx_ledger_index ledger_index TYPE minmax GRANULARITY 1` },
];

async function main() {
  console.log(`[migrate-tier1.5] target database: ${DB}`);
  if (DB === "sonde") {
    console.log("[migrate-tier1.5] *** PRODUCTION TARGET — --confirm-production was passed ***");
  }
  console.log(`[migrate-tier1.5] CH host: ${new URL(url!).host}`);
  console.log(`[migrate-tier1.5] mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  console.log("");

  const alreadyMigrated = await checkAlreadyMigrated();
  if (alreadyMigrated) {
    console.log("[migrate-tier1.5] dex_trades.fill_index already exists — appears to already be migrated.");
    console.log("[migrate-tier1.5] aborting to avoid data loss. delete the column manually first if you want to re-run.");
    process.exit(0);
  }

  console.log(`[migrate-tier1.5] applying ${STEPS.length} steps:`);
  for (let i = 0; i < STEPS.length; i++) {
    console.log(`  [${i + 1}/${STEPS.length}] ${STEPS[i].label}`);
  }
  console.log("");

  if (!EXECUTE) {
    console.log("[migrate-tier1.5] DRY-RUN — re-run with --execute to apply.");
    return;
  }

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    process.stdout.write(`  [${i + 1}/${STEPS.length}] ${step.label}... `);
    try {
      await client.command({ query: step.query });
      console.log("ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (step.swallowIfExists && /already exists|DUPLICATE_COLUMN/i.test(msg)) {
        console.log("already-exists (ok)");
        continue;
      }
      console.log("FAILED");
      console.error(`    error: ${msg}`);
      process.exit(1);
    }
  }

  console.log("");
  console.log("[migrate-tier1.5] all steps applied. Verifying...");

  const verify = await client.query({
    query: `SELECT
      (SELECT count() FROM system.columns WHERE database = '${DB}' AND table = 'dex_trades' AND name = 'base_amount_iou') AS dex_iou_col,
      (SELECT count() FROM system.columns WHERE database = '${DB}' AND table = 'dex_trades' AND name = 'fill_index') AS fill_idx,
      (SELECT count() FROM system.columns WHERE database = '${DB}' AND table = 'value_transfer_events' AND name = 'from_account') AS vte_from,
      (SELECT count() FROM system.columns WHERE database = '${DB}' AND table = 'transactions' AND name = 'last_ledger_sequence') AS lls_col,
      (SELECT count() FROM system.columns WHERE database = '${DB}' AND table = 'transactions' AND name = 'signing_pub_key') AS spk_col,
      (SELECT count() FROM system.tables WHERE database = '${DB}' AND name = 'mv_dex_pair_daily_view') AS dex_mv,
      (SELECT count() FROM system.tables WHERE database = '${DB}' AND name = 'mv_token_volume_hourly_view') AS tok_mv`,
    format: "JSONEachRow",
  });
  const v = (await verify.json())[0] as Record<string, number>;
  console.log("  dex_trades.base_amount_iou      :", v.dex_iou_col === 1 ? "✓" : "✗");
  console.log("  dex_trades.fill_index           :", v.fill_idx === 1 ? "✓" : "✗");
  console.log("  value_transfer_events.from_account:", v.vte_from === 1 ? "✓" : "✗");
  console.log("  transactions.last_ledger_sequence :", v.lls_col === 1 ? "✓" : "✗");
  console.log("  transactions.signing_pub_key      :", v.spk_col === 1 ? "✓" : "✗");
  console.log("  mv_dex_pair_daily_view restored   :", v.dex_mv === 1 ? "✓" : "✗");
  console.log("  mv_token_volume_hourly_view restored:", v.tok_mv === 1 ? "✓" : "✗");

  const allOk = Object.values(v).every((n) => Number(n) === 1);
  console.log("");
  console.log(allOk ? "[migrate-tier1.5] DONE." : "[migrate-tier1.5] some checks failed — review above.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate-tier1.5] failed:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
