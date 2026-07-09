/**
 * Phase 2 Day 1 — ClickHouse schema migrations.
 *
 * Idempotent, additive. Adds:
 *   - New columns to `transactions` (tx_json, meta_json, nftoken_id, flags,
 *     sequence, source_tag, destination_tag, delivered_amount_drops,
 *     delivered_amount_iou)
 *   - New table `ledger_metadata` (ReplacingMergeTree on ledger_index)
 *   - New table `amm_state_changes` (plain MergeTree — append-only events)
 *
 * Does NOT do:
 *   - The pseudo-tx cleanup mutation (`UPDATE account = '__pseudo_tx__'`)
 *     — that's a one-off operation against `sonde` only; run it manually
 *     after audit confirms safety. See runbook §2.
 *   - PG schema changes — see scripts/migrate-phase2-pg-schema.ts
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-phase2-ch-schema.ts                  # defaults to sonde_smoketest
 *   pnpm exec tsx scripts/migrate-phase2-ch-schema.ts --db sonde --confirm-production
 *
 * Two safety gates for production:
 *   1. --db must be explicitly set to "sonde" (default is sonde_smoketest)
 *   2. --confirm-production must also be passed when --db sonde
 *
 * Requires CLICKHOUSE_URL env var (read from .env.local).
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

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error(
    "[migrate-phase2-ch] refusing to target production database 'sonde' without --confirm-production",
  );
  console.error("[migrate-phase2-ch] re-run as: pnpm exec tsx scripts/migrate-phase2-ch-schema.ts --db sonde --confirm-production");
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("[migrate-phase2-ch] CLICKHOUSE_URL env var required (set in .env.local)");
  process.exit(1);
}

const client = createClient({
  url,
  database: DB,
  request_timeout: 60_000,
});

interface MigrationStep {
  label: string;
  query: string;
  /**
   * For idempotent ALTER TABLE ADD COLUMN on CH versions that don't
   * support `IF NOT EXISTS` per-column, we catch & swallow the
   * "DUPLICATE_COLUMN" error so re-runs are no-ops.
   */
  swallowDuplicateColumn?: boolean;
}

const steps: MigrationStep[] = [
  /* ── transactions: extend with raw blobs + extracted fields ─────── */
  {
    label: "transactions: ADD COLUMN tx_json",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS tx_json String DEFAULT '' CODEC(ZSTD(3))`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN meta_json",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS meta_json String DEFAULT '' CODEC(ZSTD(3))`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN nftoken_id",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS nftoken_id FixedString(64) DEFAULT toFixedString('0', 64)`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN flags",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS flags UInt32 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN sequence",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS sequence UInt32 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN source_tag",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS source_tag UInt32 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN destination_tag",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS destination_tag UInt32 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN delivered_amount_drops",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS delivered_amount_drops Int64 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN delivered_amount_iou",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS delivered_amount_iou String DEFAULT ''`,
    swallowDuplicateColumn: true,
  },
  /* IOU precision fix (2026-04-28). The original ingester routed every
   * Amount through Number() + Math.trunc() into Int64 amount_drops, which
   * lost all decimals + sig digits past 2^53 for IOU values. amount_iou
   * is the lossless string column for IOU values; amount_drops becomes
   * XRP-only (0 for IOU rows). Mirrors the existing delivered_amount_iou
   * pattern. See docs/wiki/architecture/ingestion.md §IOU Precision. */
  {
    label: "transactions: ADD COLUMN amount_iou",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS amount_iou String DEFAULT ''`,
    swallowDuplicateColumn: true,
  },
  /* Multi-memo decoding (2026-04-28). MemoType + MemoFormat for the
   * first memo entry (data already in `memo`). Multi-memo arrays remain
   * accessible via tx_json. */
  {
    label: "transactions: ADD COLUMN memo_type",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS memo_type LowCardinality(String) DEFAULT ''`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN memo_format",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS memo_format LowCardinality(String) DEFAULT ''`,
    swallowDuplicateColumn: true,
  },
  /* Tier 1.5 (2026-04-28). Top-level columns for queryable common fields
   * that previously required JSONExtract on tx_json. Plus a minmax skip
   * index on ledger_index for ledger-range scans.
   * See docs/wiki/architecture/tier1.5-audit-findings.md s3 + m1. */
  {
    label: "transactions: ADD COLUMN last_ledger_sequence",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS last_ledger_sequence UInt32 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN ticket_sequence",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS ticket_sequence UInt32 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN signing_pub_key",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS signing_pub_key String DEFAULT ''`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD COLUMN network_id",
    query: `ALTER TABLE ${DB}.transactions ADD COLUMN IF NOT EXISTS network_id UInt32 DEFAULT 0`,
    swallowDuplicateColumn: true,
  },
  {
    label: "transactions: ADD INDEX idx_ledger_index",
    query: `ALTER TABLE ${DB}.transactions ADD INDEX IF NOT EXISTS idx_ledger_index ledger_index TYPE minmax GRANULARITY 1`,
    swallowDuplicateColumn: true,
  },

  /* ── ledger_metadata: per-ledger close metadata ─────────────────── */
  {
    label: "CREATE TABLE ledger_metadata",
    query: `
      CREATE TABLE IF NOT EXISTS ${DB}.ledger_metadata (
        ledger_index       UInt32,
        ledger_hash        FixedString(64),
        parent_hash        FixedString(64),
        close_time         DateTime,
        close_flags        UInt8 DEFAULT 0,
        total_coins        UInt64,
        account_hash       FixedString(64) DEFAULT toFixedString('0', 64),
        transaction_hash   FixedString(64) DEFAULT toFixedString('0', 64),
        base_fee_drops     UInt32,
        reserve_base       UInt32,
        reserve_increment  UInt32,
        tx_count           UInt32,
        validator_count    UInt16
      ) ENGINE = ReplacingMergeTree
      ORDER BY ledger_index
      SETTINGS index_granularity = 8192
    `,
  },

  /* ── amm_state_changes: per-tx AMM pool state events ────────────── */
  /* IMPORTANT: plain MergeTree, NOT ReplacingMergeTree.               */
  /* Each AMM tx is genuinely unique by (pool_id, tx_hash); dedup is   */
  /* unnecessary AND ReplacingMergeTree(ledger_index) would never      */
  /* dedupe anyway because tx_hash is in the ORDER BY.                 */
  {
    label: "CREATE TABLE amm_state_changes",
    query: `
      CREATE TABLE IF NOT EXISTS ${DB}.amm_state_changes (
        ledger_index    UInt32,
        timestamp       DateTime,
        tx_hash         FixedString(64),
        pool_id         FixedString(64),
        asset1_amount   String,
        asset2_amount   String,
        lp_supply       String,
        change_type     LowCardinality(String)
      ) ENGINE = MergeTree
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (pool_id, ledger_index, tx_hash)
      SETTINGS index_granularity = 8192
    `,
  },

  /* ── value_transfer_events: unified value-transfer log ───────────────
   * Captures every tx that moves value between accounts:
   *   - Payment (success), one row per (from, to, currency, issuer) pair
   *   - EscrowFinish (delivers escrowed funds to original Destination)
   *   - PaymentChannelClaim (PayChan settlement to channel.Destination)
   *   - CheckCash (cashes a check; sender → cashee)
   *   - AccountDelete (sweeps remaining balance to Destination)
   *   - XChainClaim (XLS-38 sidechain claim)
   *
   * Designed as the system-of-record for Neo4j PAYMENT edge derivation.
   * The live ingester writes this table + projects edges into Neo4j; the
   * backfill writes only this table (Neo4j projection happens later from
   * the CH source).
   *
   * Schema rationale:
   *   - One row per (tx, from, to, currency, issuer) tuple. Same-currency
   *     same-direction Payments produce 1 row. Cross-currency Payments
   *     where source ≠ delivered are still ONE row (using delivered values
   *     since that's what the recipient got).
   *   - amount_drops + amount_iou mirror the transactions table pattern
   *     (XRP via Int64, IOU via String JSON for lossless precision).
   *   - transfer_kind is a low-cardinality enum capturing tx-type-specific
   *     semantics ('payment', 'escrow_finish', 'paychan_claim', 'check_cash',
   *     'account_delete', 'xchain_claim').
   *   - ORDER BY (to_account, timestamp, tx_hash, from_account, currency, issuer)
   *     — receiver-keyed for "who received from where" lookups, with
   *     from/currency/issuer in the dedup key so dual-asset rows (e.g.
   *     AMMDeposit pairs writing TO the same AMM in two currencies) don't
   *     collide. Tier 1.5 (2026-04-28) extended the original 3-field
   *     ORDER BY to prevent that dedup-eat. See
   *     docs/wiki/architecture/tier1.5-audit-findings.md C3. */
  {
    label: "CREATE TABLE value_transfer_events",
    query: `
      CREATE TABLE IF NOT EXISTS ${DB}.value_transfer_events (
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
      SETTINGS index_granularity = 8192
    `,
  },
];

function isDuplicateColumnError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists|DUPLICATE_COLUMN|column.*already/i.test(msg);
}

async function main() {
  console.log(`[migrate-phase2-ch] target database: ${DB}`);
  if (DB === "sonde") {
    console.log("[migrate-phase2-ch] *** PRODUCTION TARGET — --confirm-production was passed ***");
  }
  console.log(`[migrate-phase2-ch] CH host: ${new URL(url!).host}`);
  console.log(`[migrate-phase2-ch] applying ${steps.length} steps`);

  /* Verify the database exists. */
  try {
    await client.query({ query: `SELECT 1 FROM system.databases WHERE name = '${DB}'` });
  } catch (err) {
    console.error(`[migrate-phase2-ch] cannot reach database '${DB}':`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  /* Verify the transactions table exists in the target DB.
   * If targeting sonde_smoketest and the table doesn't exist, we'll
   * create a minimal stub mirror of sonde.transactions before running
   * ALTER TABLE steps.
   */
  const result = await client.query({
    query: `SELECT count() AS cnt FROM system.tables WHERE database = '${DB}' AND name = 'transactions'`,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as { cnt: number }[];
  const txExists = Number(rows[0]?.cnt ?? 0) > 0;

  if (!txExists) {
    if (DB !== "sonde_smoketest") {
      console.error(`[migrate-phase2-ch] table ${DB}.transactions does not exist — refusing to create from scratch in production. Bootstrap manually first.`);
      process.exit(1);
    }
    console.log(`[migrate-phase2-ch] ${DB}.transactions doesn't exist — bootstrapping minimal mirror of sonde.transactions schema`);
    /* Mirror current sonde.transactions schema. We use AS to inherit
     * the schema verbatim (including engine + ORDER BY) but with no rows.
     */
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${DB}.transactions AS sonde.transactions`,
    });
    /* Same for dex_trades and trustline_events since some smoke tests
     * will want to write to them. */
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${DB}.dex_trades AS sonde.dex_trades`,
    });
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS ${DB}.trustline_events AS sonde.trustline_events`,
    });
    console.log(`[migrate-phase2-ch] bootstrap complete: ${DB}.transactions, dex_trades, trustline_events`);
  }

  /* Apply each step. */
  let applied = 0;
  let skipped = 0;
  for (const step of steps) {
    try {
      await client.command({ query: step.query });
      console.log(`  [+] ${step.label}`);
      applied++;
    } catch (err) {
      if (step.swallowDuplicateColumn && isDuplicateColumnError(err)) {
        console.log(`  [.] ${step.label} (already present, skipped)`);
        skipped++;
        continue;
      }
      console.error(`  [✗] ${step.label}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  console.log(`\n[migrate-phase2-ch] done — ${applied} applied, ${skipped} already-present`);

  /* Sanity check: enumerate the new columns on transactions. */
  const colsResult = await client.query({
    query: `SELECT name, type FROM system.columns WHERE database = '${DB}' AND table = 'transactions' ORDER BY position`,
    format: "JSONEachRow",
  });
  const cols = (await colsResult.json()) as { name: string; type: string }[];
  console.log(`\n[migrate-phase2-ch] ${DB}.transactions schema (${cols.length} columns):`);
  for (const c of cols) {
    const isNew = ["tx_json", "meta_json", "nftoken_id", "flags", "sequence", "source_tag", "destination_tag", "delivered_amount_drops", "delivered_amount_iou"].includes(c.name);
    console.log(`  ${isNew ? "*" : " "} ${c.name.padEnd(28)} ${c.type}`);
  }

  /* And the two new tables exist. */
  const newTables = await client.query({
    query: `SELECT name FROM system.tables WHERE database = '${DB}' AND name IN ('ledger_metadata', 'amm_state_changes') ORDER BY name`,
    format: "JSONEachRow",
  });
  const tables = (await newTables.json()) as { name: string }[];
  console.log(`\n[migrate-phase2-ch] new tables in ${DB}: ${tables.map((t) => t.name).join(", ") || "(none)"}`);

  await client.close();
}

main().catch(async (err) => {
  console.error("[migrate-phase2-ch] fatal:", err instanceof Error ? err.message : err);
  await client.close().catch(() => undefined);
  process.exit(1);
});
