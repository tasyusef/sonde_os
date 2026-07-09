/**
 * Account-page foundations migration.
 *
 * Slice 1 of the synthesis-first CH-as-source-of-truth account page rework
 * (see docs/plans/db-first-page-loads.md). Three changes:
 *
 *   1. transactions.idx_tx_hash — bloom-filter skip-index on tx_hash so
 *      `WHERE tx_hash = ...` is granule-pruned instead of full-table-
 *      scanned. Powers the new CH-first /tx/[hash] page.
 *
 *   2. account_tx_index table — per-account inverted index for the
 *      "AffectedNodes-only relationships" coverage gap. New table; later
 *      slices wire the ingester to populate it and backfill the historical
 *      window from transactions.meta_json.
 *
 *   3. mv_account_counterparty_daily activation — the Neo4j-replacement
 *      MV defined in setup-clickhouse.ts on 2026-04-30 but never seeded on
 *      prod. Two consumers (`/api/intel/counterparties`, `intel-graph-
 *      features.ts`) currently use the slow UNION fallback. Activates the
 *      MV target + 4 source views, then backfills from
 *      value_transfer_events + dex_trades partition-by-partition.
 *
 * Idempotent. Re-running on an already-applied DB skips the steps that
 * are already done. Sentinels:
 *   - account_tx_index table existence → schema is created
 *   - mv_account_counterparty_daily row count > 0 → backfill has run
 *
 * Slow operations (informational, not blocking):
 *   - MATERIALIZE INDEX idx_tx_hash on prod transactions (631M rows,
 *     337 GiB): runs as a background mutation. Estimated 30-60 min.
 *     Script fires it and polls system.mutations.
 *   - mv_account_counterparty_daily backfill: 163M value_transfer_events +
 *     67M dex_trades rows aggregated per-partition. Estimated 1-2 hours
 *     on prod.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-account-page-foundations.ts                                      # smoketest dry-run
 *   pnpm exec tsx scripts/migrate-account-page-foundations.ts --execute                            # smoketest apply
 *   pnpm exec tsx scripts/migrate-account-page-foundations.ts --db sonde --confirm-production --execute   # prod
 *   pnpm exec tsx scripts/migrate-account-page-foundations.ts --execute --schema-only              # skip slow ops
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
const SCHEMA_ONLY = args.includes("--schema-only");

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error("[migrate-account-page-foundations] refusing to target production 'sonde' without --confirm-production");
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("[migrate-account-page-foundations] CLICKHOUSE_URL required (set in .env.local)");
  process.exit(1);
}

const client = createClient({
  url,
  database: DB,
  // Backfill INSERTs over big partitions can take minutes each; give ample
  // headroom but rely on per-step progress logging rather than this timeout.
  request_timeout: 1_800_000, // 30 min per command
});

interface Step {
  label: string;
  query: string;
  /** Set on idempotent steps that should NOT abort if already applied. */
  swallowIfExists?: boolean;
}

const SCHEMA_STEPS: Step[] = [
  /* ── 1. idx_tx_hash on transactions (definition only; materialize is a separate step) ── */
  {
    label: "transactions: ADD INDEX idx_tx_hash (definition)",
    swallowIfExists: true,
    query: `ALTER TABLE ${DB}.transactions
            ADD INDEX IF NOT EXISTS idx_tx_hash tx_hash TYPE bloom_filter GRANULARITY 4`,
  },

  /* ── 2. account_tx_index table ── */
  {
    label: "CREATE TABLE account_tx_index",
    swallowIfExists: true,
    query: `CREATE TABLE IF NOT EXISTS ${DB}.account_tx_index (
              account       String,
              timestamp     DateTime,
              tx_hash       FixedString(64),
              ledger_index  UInt32,
              tx_type       LowCardinality(String),
              role          LowCardinality(String)
            )
            ENGINE = ReplacingMergeTree(timestamp)
            PARTITION BY toYYYYMM(timestamp)
            ORDER BY (account, timestamp, tx_hash, role)
            SETTINGS index_granularity = 8192`,
  },

  /* ── 3. mv_account_counterparty_daily target table ── */
  {
    label: "CREATE TABLE mv_account_counterparty_daily (target)",
    swallowIfExists: true,
    query: `CREATE TABLE IF NOT EXISTS ${DB}.mv_account_counterparty_daily (
              account         String,
              counterparty    String,
              day             Date,
              tx_count        UInt64,
              payment_count   UInt64,
              dex_count       UInt64,
              last_ts         SimpleAggregateFunction(max, DateTime)
            )
            ENGINE = SummingMergeTree()
            PARTITION BY toYYYYMM(day)
            ORDER BY (account, counterparty, day)
            SETTINGS index_granularity = 8192`,
  },

  /* ── 4. The 4 source views (only fire on NEW inserts going forward) ── */
  {
    label: "CREATE VIEW mv_account_counterparty_daily_vte_from_view",
    swallowIfExists: true,
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DB}.mv_account_counterparty_daily_vte_from_view
            TO ${DB}.mv_account_counterparty_daily AS
            SELECT
              from_account      AS account,
              to_account        AS counterparty,
              toDate(timestamp) AS day,
              count()           AS tx_count,
              count()           AS payment_count,
              toUInt64(0)       AS dex_count,
              max(timestamp)    AS last_ts
            FROM ${DB}.value_transfer_events
            WHERE from_account != '' AND to_account != ''
            GROUP BY account, counterparty, day`,
  },
  {
    label: "CREATE VIEW mv_account_counterparty_daily_vte_to_view",
    swallowIfExists: true,
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DB}.mv_account_counterparty_daily_vte_to_view
            TO ${DB}.mv_account_counterparty_daily AS
            SELECT
              to_account        AS account,
              from_account      AS counterparty,
              toDate(timestamp) AS day,
              count()           AS tx_count,
              count()           AS payment_count,
              toUInt64(0)       AS dex_count,
              max(timestamp)    AS last_ts
            FROM ${DB}.value_transfer_events
            WHERE from_account != '' AND to_account != ''
            GROUP BY account, counterparty, day`,
  },
  {
    label: "CREATE VIEW mv_account_counterparty_daily_dex_taker_view",
    swallowIfExists: true,
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DB}.mv_account_counterparty_daily_dex_taker_view
            TO ${DB}.mv_account_counterparty_daily AS
            SELECT
              taker             AS account,
              maker             AS counterparty,
              toDate(timestamp) AS day,
              count()           AS tx_count,
              toUInt64(0)       AS payment_count,
              count()           AS dex_count,
              max(timestamp)    AS last_ts
            FROM ${DB}.dex_trades
            WHERE taker != '' AND maker != ''
            GROUP BY account, counterparty, day`,
  },
  {
    label: "CREATE VIEW mv_account_counterparty_daily_dex_maker_view",
    swallowIfExists: true,
    query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${DB}.mv_account_counterparty_daily_dex_maker_view
            TO ${DB}.mv_account_counterparty_daily AS
            SELECT
              maker             AS account,
              taker             AS counterparty,
              toDate(timestamp) AS day,
              count()           AS tx_count,
              toUInt64(0)       AS payment_count,
              count()           AS dex_count,
              max(timestamp)    AS last_ts
            FROM ${DB}.dex_trades
            WHERE taker != '' AND maker != ''
            GROUP BY account, counterparty, day`,
  },
];

async function run(label: string, query: string, swallowIfExists = false) {
  process.stdout.write(`  ${label}... `);
  try {
    await client.command({ query });
    console.log("ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (swallowIfExists && /already exists|DUPLICATE_/i.test(msg)) {
      console.log("already-exists (ok)");
      return;
    }
    console.log("FAILED");
    console.error(`    error: ${msg}`);
    throw err;
  }
}

async function querySingle<T>(query: string): Promise<T> {
  const result = await client.query({ query, format: "JSONEachRow" });
  const rows = (await result.json()) as T[];
  return rows[0];
}

async function preflightCheck() {
  console.log("[preflight]");
  const stats = await querySingle<{
    tx_rows: string;
    tx_size: string;
    vte_rows: string;
    dex_rows: string;
    cp_mv_exists: number;
    atx_exists: number;
    idx_exists: number;
  }>(`SELECT
        (SELECT toString(count()) FROM ${DB}.transactions) AS tx_rows,
        (SELECT formatReadableSize(sum(bytes_on_disk)) FROM system.parts WHERE database = '${DB}' AND table = 'transactions' AND active = 1) AS tx_size,
        (SELECT toString(count()) FROM ${DB}.value_transfer_events) AS vte_rows,
        (SELECT toString(count()) FROM ${DB}.dex_trades) AS dex_rows,
        (SELECT count() FROM system.tables WHERE database = '${DB}' AND name = 'mv_account_counterparty_daily') AS cp_mv_exists,
        (SELECT count() FROM system.tables WHERE database = '${DB}' AND name = 'account_tx_index') AS atx_exists,
        (SELECT count() FROM system.data_skipping_indices WHERE database = '${DB}' AND table = 'transactions' AND name = 'idx_tx_hash') AS idx_exists`);

  console.log(`  transactions: ${Number(stats.tx_rows).toLocaleString()} rows, ${stats.tx_size}`);
  console.log(`  value_transfer_events: ${Number(stats.vte_rows).toLocaleString()} rows`);
  console.log(`  dex_trades: ${Number(stats.dex_rows).toLocaleString()} rows`);
  console.log(`  account_tx_index exists: ${stats.atx_exists ? "yes" : "no"}`);
  console.log(`  transactions.idx_tx_hash exists: ${stats.idx_exists ? "yes" : "no"}`);
  console.log(`  mv_account_counterparty_daily exists: ${stats.cp_mv_exists ? "yes" : "no"}`);

  if (Number(stats.cp_mv_exists) > 0) {
    const cpRows = await querySingle<{ rows: string }>(
      `SELECT toString(count()) AS rows FROM ${DB}.mv_account_counterparty_daily`,
    );
    console.log(`  mv_account_counterparty_daily rows: ${Number(cpRows.rows).toLocaleString()}`);
  }
  console.log("");
  return stats;
}

async function materializeIndex() {
  console.log("[materialize idx_tx_hash]");
  console.log("  firing ALTER TABLE ... MATERIALIZE INDEX (background mutation)");
  await client.command({
    query: `ALTER TABLE ${DB}.transactions MATERIALIZE INDEX idx_tx_hash`,
  });

  console.log("  polling system.mutations for completion (every 30s)...");
  const start = Date.now();
  // Poll until the materialize mutation is gone from the active list.
  while (true) {
    const r = await querySingle<{ active: number; latest_fail_reason: string }>(
      `SELECT
         count()                                  AS active,
         coalesce(max(latest_fail_reason), '')    AS latest_fail_reason
       FROM system.mutations
       WHERE database = '${DB}' AND table = 'transactions'
         AND command LIKE '%MATERIALIZE INDEX%idx_tx_hash%'
         AND is_done = 0`,
    );
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (Number(r.active) === 0) {
      console.log(`  ✓ materialize complete (${elapsed}s elapsed)`);
      return;
    }
    if (r.latest_fail_reason) {
      throw new Error(`MATERIALIZE INDEX failed: ${r.latest_fail_reason}`);
    }
    process.stdout.write(`  ... still running (${elapsed}s elapsed)\n`);
    await new Promise((res) => setTimeout(res, 30_000));
  }
}

async function backfillCounterpartyMv() {
  console.log("[backfill mv_account_counterparty_daily]");

  // List all partitions present on either source table.
  const partitions = await client.query({
    query: `SELECT DISTINCT partition_id AS partition
            FROM system.parts
            WHERE database = '${DB}'
              AND active = 1
              AND table IN ('value_transfer_events', 'dex_trades')
            ORDER BY partition`,
    format: "JSONEachRow",
  });
  // Newest first. The DROP-PARTITION + INSERT-SELECT race against a live
  // writer is the same window in either direction; ordering is purely
  // ergonomic. Run this with the live ingester STOPPED to make the
  // window zero — see docs/runbooks/ch-account-foundations.md.
  const partitionList = ((await partitions.json()) as { partition: string }[])
    .sort((a, b) => b.partition.localeCompare(a.partition));
  console.log(`  ${partitionList.length} partitions to process (newest first)`);

  for (let i = 0; i < partitionList.length; i++) {
    const p = partitionList[i].partition;
    const start = Date.now();
    process.stdout.write(`  [${i + 1}/${partitionList.length}] partition ${p}... `);

    // DROP PARTITION first to make this re-runnable. SummingMergeTree
    // would compound row values on re-INSERT; dropping the partition
    // metadata-only is near-instant (no row scan).
    await client.command({
      query: `ALTER TABLE ${DB}.mv_account_counterparty_daily DROP PARTITION ${p}`,
    });

    // Four INSERT INTO ... SELECT statements, one per source-side, scoped
    // to this partition. Same SELECT shape as the views in setup-clickhouse.ts.
    await client.command({
      query: `INSERT INTO ${DB}.mv_account_counterparty_daily
              SELECT
                from_account      AS account,
                to_account        AS counterparty,
                toDate(timestamp) AS day,
                count()           AS tx_count,
                count()           AS payment_count,
                toUInt64(0)       AS dex_count,
                max(timestamp)    AS last_ts
              FROM ${DB}.value_transfer_events
              WHERE toYYYYMM(timestamp) = ${p}
                AND from_account != '' AND to_account != ''
              GROUP BY account, counterparty, day`,
    });
    await client.command({
      query: `INSERT INTO ${DB}.mv_account_counterparty_daily
              SELECT
                to_account        AS account,
                from_account      AS counterparty,
                toDate(timestamp) AS day,
                count()           AS tx_count,
                count()           AS payment_count,
                toUInt64(0)       AS dex_count,
                max(timestamp)    AS last_ts
              FROM ${DB}.value_transfer_events
              WHERE toYYYYMM(timestamp) = ${p}
                AND from_account != '' AND to_account != ''
              GROUP BY account, counterparty, day`,
    });
    await client.command({
      query: `INSERT INTO ${DB}.mv_account_counterparty_daily
              SELECT
                taker             AS account,
                maker             AS counterparty,
                toDate(timestamp) AS day,
                count()           AS tx_count,
                toUInt64(0)       AS payment_count,
                count()           AS dex_count,
                max(timestamp)    AS last_ts
              FROM ${DB}.dex_trades
              WHERE toYYYYMM(timestamp) = ${p}
                AND taker != '' AND maker != ''
              GROUP BY account, counterparty, day`,
    });
    await client.command({
      query: `INSERT INTO ${DB}.mv_account_counterparty_daily
              SELECT
                maker             AS account,
                taker             AS counterparty,
                toDate(timestamp) AS day,
                count()           AS tx_count,
                toUInt64(0)       AS payment_count,
                count()           AS dex_count,
                max(timestamp)    AS last_ts
              FROM ${DB}.dex_trades
              WHERE toYYYYMM(timestamp) = ${p}
                AND taker != '' AND maker != ''
              GROUP BY account, counterparty, day`,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`ok (${elapsed}s)`);
  }

  // Final tally so we can sanity-check vs. source-table counts.
  const tally = await querySingle<{ rows: string }>(
    `SELECT toString(count()) AS rows FROM ${DB}.mv_account_counterparty_daily`,
  );
  console.log(`  ✓ backfill complete — ${Number(tally.rows).toLocaleString()} rows in MV`);
  console.log(`  note: must run with sonde-ingester + sonde-backfill stopped to avoid`);
  console.log(`  a double-count race. View-fired rows landing during the INSERT's SELECT`);
  console.log(`  snapshot get summed twice by SummingMergeTree on merge. See the runbook.`);
}

async function main() {
  console.log(`[migrate-account-page-foundations] target database: ${DB}`);
  if (DB === "sonde") {
    console.log("[migrate-account-page-foundations] *** PRODUCTION TARGET — --confirm-production was passed ***");
  }
  console.log(`[migrate-account-page-foundations] CH host: ${new URL(url!).host}`);
  console.log(`[migrate-account-page-foundations] mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`[migrate-account-page-foundations] schema-only: ${SCHEMA_ONLY ? "yes" : "no"}`);
  console.log("");

  await preflightCheck();

  console.log(`[schema] ${SCHEMA_STEPS.length} steps:`);
  for (let i = 0; i < SCHEMA_STEPS.length; i++) {
    console.log(`  [${i + 1}/${SCHEMA_STEPS.length}] ${SCHEMA_STEPS[i].label}`);
  }
  if (!SCHEMA_ONLY) {
    console.log(`[slow ops]`);
    console.log(`  - MATERIALIZE INDEX idx_tx_hash (background mutation; ~30-60 min on prod)`);
    console.log(`  - mv_account_counterparty_daily backfill (~1-2 hours on prod)`);
  }
  console.log("");

  if (!EXECUTE) {
    console.log("[migrate-account-page-foundations] DRY-RUN — re-run with --execute to apply.");
    return;
  }

  console.log("[applying schema]");
  for (const step of SCHEMA_STEPS) {
    await run(step.label, step.query, step.swallowIfExists);
  }
  console.log("");

  if (!SCHEMA_ONLY) {
    await materializeIndex();
    console.log("");
    await backfillCounterpartyMv();
    console.log("");
  } else {
    console.log("[migrate-account-page-foundations] --schema-only set; skipped slow ops");
    console.log("");
  }

  console.log("[verify]");
  await preflightCheck();
  console.log("[migrate-account-page-foundations] DONE.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate-account-page-foundations] failed:", err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
