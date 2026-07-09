/**
 * PG → CH migration: token_holder_snapshots + score_history.
 *
 * These tables are XRPL-derived time-series (per the doctrine in
 * CLAUDE.md and docs/wiki/architecture/databases.md) and belong in
 * ClickHouse, not Postgres. Both currently live in Postgres for
 * historical reasons:
 *   - token_holder_snapshots (1.5 GB, 3.6M rows): top-10 holders per
 *     active token, snapshotted every 4 h. Read by whale-activity,
 *     issuer-analysis, holder-queries, network analytics, token-data.
 *   - score_history (1.2 MB, ~5K rows): smart-money composite score
 *     per scoring run. Read by /api/smart-money/[address]/history.
 *
 * This script creates the CH tables. A separate backfill copies
 * existing rows; readers/writers are swapped in subsequent commits.
 *
 * Schema rationale:
 *   - token_holder_snapshots: ORDER BY (currency, issuer, snapshot_time,
 *     holder_address) makes per-token range scans (the dominant query
 *     pattern — whale-activity, issuer-analysis) sequential. ENGINE =
 *     ReplacingMergeTree(snapshot_time) gives idempotent inserts on
 *     re-run, mirroring the PG `ON CONFLICT DO NOTHING` behavior.
 *   - score_history: ORDER BY (address, scored_at) makes per-wallet
 *     trend lookups sequential. ReplacingMergeTree(scored_at) so that
 *     a duplicate insert at the same instant collapses (rare but safe).
 *   - Timestamps are DateTime64(3) (millisecond precision) — PG's
 *     TIMESTAMPTZ has microsecond precision, and during the backfill
 *     audit we found 23,779 rows in token_holder_snapshots that share
 *     the same second-level timestamp + dedup key (overlapping poll
 *     runs across Railway container restarts). DateTime64(3) preserves
 *     all of them; second-precision DateTime would collapse them.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate-pg-to-ch-snapshots.ts                    # smoketest
 *   pnpm exec tsx scripts/migrate-pg-to-ch-snapshots.ts --db sonde --confirm-production
 *
 * Two safety gates for production:
 *   1. --db must be set to "sonde" (default is sonde_smoketest)
 *   2. --confirm-production must also be passed
 *
 * Requires CLICKHOUSE_URL in the environment (read from .env.local).
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
    "[migrate-pg-to-ch-snapshots] refusing to target production database 'sonde' without --confirm-production",
  );
  console.error(
    "[migrate-pg-to-ch-snapshots] re-run as: pnpm exec tsx scripts/migrate-pg-to-ch-snapshots.ts --db sonde --confirm-production",
  );
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("[migrate-pg-to-ch-snapshots] CLICKHOUSE_URL env var required (set in .env.local)");
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
}

const steps: MigrationStep[] = [
  /* ── token_holder_snapshots ──────────────────────────────────────── */
  {
    label: "CREATE TABLE token_holder_snapshots",
    query: `
      CREATE TABLE IF NOT EXISTS ${DB}.token_holder_snapshots (
        snapshot_time   DateTime64(3),
        currency        LowCardinality(String),
        issuer          String,
        holder_address  String,
        balance         Float64,
        total_supply    Float64,
        rank            UInt8
      ) ENGINE = ReplacingMergeTree(snapshot_time)
      PARTITION BY toYYYYMM(snapshot_time)
      ORDER BY (currency, issuer, snapshot_time, holder_address)
      SETTINGS index_granularity = 8192
    `,
  },

  /* ── score_history ───────────────────────────────────────────────── */
  {
    label: "CREATE TABLE score_history",
    query: `
      CREATE TABLE IF NOT EXISTS ${DB}.score_history (
        scored_at       DateTime64(3),
        address         String,
        composite_score Float64
      ) ENGINE = ReplacingMergeTree(scored_at)
      PARTITION BY toYYYYMM(scored_at)
      ORDER BY (address, scored_at)
      SETTINGS index_granularity = 8192
    `,
  },
];

async function main() {
  console.log(`[migrate-pg-to-ch-snapshots] target database: ${DB}`);
  if (DB === "sonde") {
    console.log("[migrate-pg-to-ch-snapshots] *** PRODUCTION TARGET — --confirm-production was passed ***");
  }
  console.log(`[migrate-pg-to-ch-snapshots] CH host: ${new URL(url!).host}`);
  console.log(`[migrate-pg-to-ch-snapshots] applying ${steps.length} steps`);

  /* Verify the database exists. */
  try {
    const dbCheck = await client.query({
      query: `SELECT count() AS cnt FROM system.databases WHERE name = '${DB}'`,
      format: "JSONEachRow",
    });
    const dbRows = (await dbCheck.json()) as { cnt: number }[];
    if (Number(dbRows[0]?.cnt ?? 0) === 0) {
      console.error(`[migrate-pg-to-ch-snapshots] database '${DB}' does not exist on this CH cluster`);
      process.exit(1);
    }
  } catch (err) {
    console.error(
      `[migrate-pg-to-ch-snapshots] cannot reach database '${DB}':`,
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  /* Apply each step. CREATE TABLE IF NOT EXISTS is idempotent. */
  for (const step of steps) {
    try {
      await client.command({ query: step.query });
      console.log(`  [+] ${step.label}`);
    } catch (err) {
      console.error(`  [✗] ${step.label}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  /* Sanity check: confirm both tables exist + show columns. */
  const tablesResult = await client.query({
    query: `
      SELECT name, engine, partition_key, sorting_key
      FROM system.tables
      WHERE database = '${DB}' AND name IN ('token_holder_snapshots', 'score_history')
      ORDER BY name
    `,
    format: "JSONEachRow",
  });
  const tables = (await tablesResult.json()) as {
    name: string;
    engine: string;
    partition_key: string;
    sorting_key: string;
  }[];

  console.log(`\n[migrate-pg-to-ch-snapshots] tables in ${DB}:`);
  for (const t of tables) {
    console.log(`  ${t.name}`);
    console.log(`    engine:    ${t.engine}`);
    console.log(`    partition: ${t.partition_key}`);
    console.log(`    sort key:  ${t.sorting_key}`);
  }

  if (tables.length !== 2) {
    console.error(
      `\n[migrate-pg-to-ch-snapshots] expected 2 tables, found ${tables.length} — something went wrong`,
    );
    process.exit(1);
  }

  /* Show columns for each so the schemas can be eyeballed. */
  for (const tableName of ["token_holder_snapshots", "score_history"]) {
    const colsResult = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = '${DB}' AND table = '${tableName}'
        ORDER BY position
      `,
      format: "JSONEachRow",
    });
    const cols = (await colsResult.json()) as { name: string; type: string }[];
    console.log(`\n[migrate-pg-to-ch-snapshots] ${DB}.${tableName} columns:`);
    for (const c of cols) {
      console.log(`  ${c.name.padEnd(20)} ${c.type}`);
    }
  }

  console.log(`\n[migrate-pg-to-ch-snapshots] done — schemas in place. Run backfill-pg-to-ch.ts next.`);

  await client.close();
}

main().catch(async (err) => {
  console.error("[migrate-pg-to-ch-snapshots] fatal:", err instanceof Error ? err.message : err);
  await client.close().catch(() => undefined);
  process.exit(1);
});
