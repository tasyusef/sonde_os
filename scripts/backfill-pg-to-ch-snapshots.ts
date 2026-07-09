/**
 * Backfill PG → CH for token_holder_snapshots + score_history.
 *
 * Streams rows from Postgres (via cursor, so memory stays flat even for
 * the 3.6M-row token_holder_snapshots table) and inserts them into the
 * ClickHouse mirror created by migrate-pg-to-ch-snapshots.ts.
 *
 * Idempotent — both CH tables are ReplacingMergeTree, so re-running
 * the backfill just inserts duplicates that get collapsed at merge
 * time. Safe to interrupt and re-run; the worst case is wasted work.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-pg-to-ch-snapshots.ts                    # smoketest
 *   pnpm exec tsx scripts/backfill-pg-to-ch-snapshots.ts --db sonde --confirm-production
 *   pnpm exec tsx scripts/backfill-pg-to-ch-snapshots.ts --table token_holder_snapshots
 *   pnpm exec tsx scripts/backfill-pg-to-ch-snapshots.ts --batch 5000
 *
 * Two safety gates for production:
 *   1. --db must be set to "sonde" (default is sonde_smoketest)
 *   2. --confirm-production must also be passed
 *
 * Requires DATABASE_URL and CLICKHOUSE_URL in env (.env.local).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
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
const ONLY_TABLE = getArg("--table"); // "token_holder_snapshots" | "score_history" | undefined
const BATCH_SIZE = Number(getArg("--batch") ?? 10000);

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error(
    "[backfill-pg-to-ch-snapshots] refusing to target production database 'sonde' without --confirm-production",
  );
  process.exit(1);
}

if (ONLY_TABLE && !["token_holder_snapshots", "score_history"].includes(ONLY_TABLE)) {
  console.error(
    `[backfill-pg-to-ch-snapshots] --table must be 'token_holder_snapshots' or 'score_history', got: ${ONLY_TABLE}`,
  );
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[backfill-pg-to-ch-snapshots] DATABASE_URL required");
  process.exit(1);
}

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!CLICKHOUSE_URL) {
  console.error("[backfill-pg-to-ch-snapshots] CLICKHOUSE_URL required");
  process.exit(1);
}

const pg = postgres(DATABASE_URL, { max: 2, idle_timeout: 30 });
const ch = createClient({
  url: CLICKHOUSE_URL,
  database: DB,
  request_timeout: 60_000,
});

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Postgres TIMESTAMPTZ → CH DateTime64(3) string ('YYYY-MM-DD HH:MM:SS.mmm' UTC).
 *
 * Millisecond precision — sufficient to disambiguate the 23,779 rows in
 * token_holder_snapshots that share a same-second timestamp + dedup key.
 * Microsecond precision would also work but isn't needed (PG stores μs but
 * the manager only writes one timestamp per poll). */
function pgTimeToChDateTime(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  // toISOString() → '2026-04-15T12:34:56.789Z' → '2026-04-15 12:34:56.789'.
  return d.toISOString().slice(0, 23).replace("T", " ");
}

/** PG numeric → CH Float64. PG returns numerics as strings to preserve precision. */
function pgNumericToFloat(v: string | number | null): number {
  if (v === null) return 0;
  return typeof v === "number" ? v : parseFloat(v);
}

/* ── token_holder_snapshots ───────────────────────────────────────── */

interface PgHolderSnapshotRow {
  snapshot_time: Date | string;
  currency: string;
  issuer: string;
  holder_address: string;
  balance: string;
  total_supply: string;
  rank: number;
}

interface ChHolderSnapshotRow {
  snapshot_time: string;
  currency: string;
  issuer: string;
  holder_address: string;
  balance: number;
  total_supply: number;
  rank: number;
}

async function backfillHolderSnapshots(): Promise<void> {
  const totalResult = await pg<{ count: string }[]>`
    SELECT count(*)::text AS count FROM token_holder_snapshots
  `;
  const total = Number(totalResult[0]?.count ?? 0);
  console.log(
    `[backfill-pg-to-ch-snapshots] token_holder_snapshots: ${total.toLocaleString()} rows in PG → CH ${DB}.token_holder_snapshots`,
  );

  if (total === 0) {
    console.log("  (nothing to copy)");
    return;
  }

  const startedAt = Date.now();
  let copied = 0;
  let lastProgressAt = Date.now();

  // Cursor-stream the PG table — keeps memory flat regardless of total size.
  const cursor = pg<PgHolderSnapshotRow[]>`
    SELECT
      snapshot_time,
      currency,
      issuer,
      holder_address,
      balance,
      total_supply,
      rank
    FROM token_holder_snapshots
    ORDER BY snapshot_time ASC, currency ASC, issuer ASC, holder_address ASC
  `.cursor(BATCH_SIZE);

  for await (const batch of cursor) {
    const chRows: ChHolderSnapshotRow[] = batch.map((r) => ({
      snapshot_time: pgTimeToChDateTime(r.snapshot_time),
      currency: r.currency,
      issuer: r.issuer,
      holder_address: r.holder_address,
      balance: pgNumericToFloat(r.balance),
      total_supply: pgNumericToFloat(r.total_supply),
      rank: r.rank,
    }));

    await ch.insert({
      table: `${DB}.token_holder_snapshots`,
      values: chRows,
      format: "JSONEachRow",
    });

    copied += chRows.length;

    // Progress every 5s
    if (Date.now() - lastProgressAt > 5000) {
      const pct = ((copied / total) * 100).toFixed(1);
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = Math.round(copied / elapsed);
      const eta = Math.round((total - copied) / Math.max(1, rate));
      console.log(
        `  [+] ${copied.toLocaleString()}/${total.toLocaleString()} (${pct}%) — ${rate.toLocaleString()} rows/s — ETA ${eta}s`,
      );
      lastProgressAt = Date.now();
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  [✓] ${copied.toLocaleString()} rows copied in ${elapsed}s\n`);
}

/* ── score_history ───────────────────────────────────────────────────── */

interface PgScoreHistoryRow {
  scored_at: Date | string;
  address: string;
  composite_score: string;
}

interface ChScoreHistoryRow {
  scored_at: string;
  address: string;
  composite_score: number;
}

async function backfillScoreHistory(): Promise<void> {
  const totalResult = await pg<{ count: string }[]>`
    SELECT count(*)::text AS count FROM score_history
  `;
  const total = Number(totalResult[0]?.count ?? 0);
  console.log(
    `[backfill-pg-to-ch-snapshots] score_history: ${total.toLocaleString()} rows in PG → CH ${DB}.score_history`,
  );

  if (total === 0) {
    console.log("  (nothing to copy)");
    return;
  }

  const startedAt = Date.now();
  let copied = 0;

  // score_history is small enough (~5K rows) to stream in one cursor pass.
  const cursor = pg<PgScoreHistoryRow[]>`
    SELECT scored_at, address, composite_score
    FROM score_history
    ORDER BY scored_at ASC, address ASC
  `.cursor(BATCH_SIZE);

  for await (const batch of cursor) {
    const chRows: ChScoreHistoryRow[] = batch.map((r) => ({
      scored_at: pgTimeToChDateTime(r.scored_at),
      address: r.address,
      composite_score: pgNumericToFloat(r.composite_score),
    }));

    await ch.insert({
      table: `${DB}.score_history`,
      values: chRows,
      format: "JSONEachRow",
    });

    copied += chRows.length;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`  [✓] ${copied.toLocaleString()} rows copied in ${elapsed}s\n`);
}

/* ── Verification ────────────────────────────────────────────────────── */

async function verify(): Promise<void> {
  console.log("[backfill-pg-to-ch-snapshots] verification:");

  for (const table of ["token_holder_snapshots", "score_history"]) {
    if (ONLY_TABLE && table !== ONLY_TABLE) continue;

    const pgResult = await pg<{ count: string }[]>`
      SELECT count(*)::text AS count FROM ${pg(table)}
    `;
    const pgCount = Number(pgResult[0]?.count ?? 0);

    // FINAL is required so ReplacingMergeTree dedup is applied at read.
    // Without FINAL, freshly-inserted rows that collide on the sort key
    // would double-count until background merges run.
    const chResult = await ch.query({
      query: `SELECT count() AS count FROM ${DB}.${table} FINAL`,
      format: "JSONEachRow",
    });
    const chRows = (await chResult.json()) as { count: string | number }[];
    const chCount = Number(chRows[0]?.count ?? 0);

    const match = pgCount === chCount;
    const symbol = match ? "✓" : "⚠";
    console.log(
      `  [${symbol}] ${table.padEnd(24)} PG=${pgCount.toLocaleString().padStart(10)}  CH=${chCount.toLocaleString().padStart(10)}${match ? "" : "  (mismatch)"}`,
    );
  }
}

/* ── Main ────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log(`[backfill-pg-to-ch-snapshots] target CH database: ${DB}`);
  if (DB === "sonde") {
    console.log("[backfill-pg-to-ch-snapshots] *** PRODUCTION TARGET — --confirm-production was passed ***");
  }
  console.log(`[backfill-pg-to-ch-snapshots] PG host: ${new URL(DATABASE_URL!).host}`);
  console.log(`[backfill-pg-to-ch-snapshots] CH host: ${new URL(CLICKHOUSE_URL!).host}`);
  console.log(`[backfill-pg-to-ch-snapshots] batch size: ${BATCH_SIZE.toLocaleString()}`);
  if (ONLY_TABLE) {
    console.log(`[backfill-pg-to-ch-snapshots] table filter: ${ONLY_TABLE}`);
  }
  console.log();

  if (!ONLY_TABLE || ONLY_TABLE === "token_holder_snapshots") {
    await backfillHolderSnapshots();
  }
  if (!ONLY_TABLE || ONLY_TABLE === "score_history") {
    await backfillScoreHistory();
  }

  await verify();

  await pg.end();
  await ch.close();

  console.log("\n[backfill-pg-to-ch-snapshots] done.");
}

main().catch(async (err) => {
  console.error("[backfill-pg-to-ch-snapshots] fatal:", err instanceof Error ? err.message : err);
  await pg.end().catch(() => undefined);
  await ch.close().catch(() => undefined);
  process.exit(1);
});
