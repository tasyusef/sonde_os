/**
 * Backfill `nft_offers` + `nft_ownership` from historical
 * `transactions.meta_json` blobs.
 *
 * The live ingester (Phase 2 of this project) writes both tables on every
 * new ledger. This script replays the historical transactions table to
 * populate state for everything before the live cutover.
 *
 * Per-partition flow:
 *   1. SELECT count() — sized progress
 *   2. SELECT NFT-related rows in PK order, paginated via a strict-tuple
 *      cursor so re-runs after a crash pick up cleanly. Five tx types:
 *      NFTokenMint, NFTokenBurn, NFTokenCreateOffer, NFTokenCancelOffer,
 *      NFTokenAcceptOffer
 *   3. Reconstruct RawLedgerTx, run extractNftStateEvents, batch insert
 *      offer + ownership rows separately
 *   4. Move to the next partition
 *
 * Both target tables are `ReplacingMergeTree(last_updated)` — re-running
 * a partition is safe; later inserts replace earlier ones on the same
 * (nft_offer_index | nft_id) key after the next merge.
 *
 * Throughput: NFT-related txs are a small fraction of total transactions.
 * On the 760M-row table, only ~5-10M rows are NFT-related (lifetime).
 * Backfill should complete in well under an hour.
 *
 * Flags:
 *   --db <database>           default: `sonde_smoketest`
 *   --confirm-production      required when --db sonde
 *   --execute                 actually insert (default is dry-run)
 *   --from-partition YYYYMM   skip partitions older than this (default: all)
 *   --to-partition YYYYMM     skip partitions newer than this (default: all)
 *   --batch-size N            rows per CH SELECT page (default 25000)
 *   --insert-batch-size N     rows per CH INSERT (default 5000)
 *   --reverse                 walk newest → oldest. Default: oldest → newest,
 *                             keeps ReplacingMergeTree merges resolving in
 *                             chronological order so close events overwrite
 *                             create events on the same offer index.
 *
 * Examples:
 *   pnpm exec tsx scripts/backfill-nft-state.ts                                      # smoketest dry-run
 *   pnpm exec tsx scripts/backfill-nft-state.ts --execute                            # smoketest apply
 *   pnpm exec tsx scripts/backfill-nft-state.ts --db sonde --confirm-production --execute
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { extractNftStateEvents } from "../src/lib/nft-state-extractor";
import type { RawLedgerTx, TxMeta } from "../src/types/ingestion";

/* ── CLI parsing ───────────────────────────────────────────────────── */

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

const DB = getArg("--db") ?? "sonde_smoketest";
const CONFIRM_PRODUCTION = args.includes("--confirm-production");
const EXECUTE = args.includes("--execute");
const REVERSE = args.includes("--reverse");
const FROM_PARTITION = getArg("--from-partition");
const TO_PARTITION = getArg("--to-partition");
const INSERT_BATCH_SIZE = Number(getArg("--insert-batch-size") ?? "5000");
/** When set, processes only NFTokenMint events. Used to populate
 *  `nft_static_metadata` (URI, taxon, mint info) without re-doing the
 *  full multi-tx-type NFT backfill — much smaller scope. */
const MINT_ONLY = args.includes("--mint-only");

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error(
    "[backfill-nft-state] refusing to target production 'sonde' without --confirm-production",
  );
  process.exit(1);
}
if (!Number.isFinite(INSERT_BATCH_SIZE) || INSERT_BATCH_SIZE < 100) {
  console.error("[backfill-nft-state] --insert-batch-size must be ≥ 100");
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error(
    "[backfill-nft-state] CLICKHOUSE_URL required (set in .env.local)",
  );
  process.exit(1);
}

const ch = createClient({
  url,
  database: DB,
  request_timeout: 600_000, // 10 min per CH command
});

const NFT_TX_TYPES = [
  "NFTokenMint",
  "NFTokenBurn",
  "NFTokenCreateOffer",
  "NFTokenCancelOffer",
  "NFTokenAcceptOffer",
] as const;

const NFT_TX_TYPES_SQL = (
  MINT_ONLY ? (["NFTokenMint"] as const) : NFT_TX_TYPES
)
  .map((t) => `'${t}'`)
  .join(",");

/* ── Types matching what we SELECT from transactions ───────────────── */

interface SourceRow {
  account: string;
  tx_hash: string;
  ledger_index: number;
  xrpl_date: number;
  timestamp: string;
  tx_json: string;
  meta_json: string;
}

const XRPL_EPOCH_OFFSET_S = 946_684_800;

/* ── Helpers ───────────────────────────────────────────────────────── */

async function queryRows<T>(query: string): Promise<T[]> {
  const r = await ch.query({ query, format: "JSONEachRow" });
  return (await r.json()) as T[];
}

async function querySingle<T>(query: string): Promise<T> {
  const rows = await queryRows<T>(query);
  return rows[0];
}

async function listPartitions(): Promise<string[]> {
  const rows = await queryRows<{ partition: string; rows: string }>(
    `SELECT partition_id AS partition, sum(rows) AS rows
       FROM system.parts
       WHERE database = '${DB}' AND table = 'transactions' AND active = 1
       GROUP BY partition_id
       HAVING rows > 0
       ORDER BY partition_id ASC`,
  );
  let parts = rows.map((r) => r.partition);
  if (FROM_PARTITION) parts = parts.filter((p) => p >= FROM_PARTITION);
  if (TO_PARTITION) parts = parts.filter((p) => p <= TO_PARTITION);
  if (REVERSE) parts.reverse();
  return parts;
}

interface PartitionStats {
  rows: string;
  earliest: string;
  latest: string;
}

async function partitionStats(partition: string): Promise<PartitionStats> {
  return querySingle<PartitionStats>(
    `SELECT
       toString(count())              AS rows,
       toString(min(timestamp))       AS earliest,
       toString(max(timestamp))       AS latest
     FROM ${DB}.transactions
     WHERE toYYYYMM(timestamp) = ${partition}
       AND result = 'tesSUCCESS'
       AND tx_type IN (${NFT_TX_TYPES_SQL})`,
  );
}

/** Cursor-paginated SELECT. ORDER BY (timestamp, tx_hash) — both PK
 *  columns within a partition (PK is (account, timestamp, tx_hash) so
 *  ordering by the trailing two requires a per-partition sort, which CH
 *  handles in memory for a 1.5M-row partition without trouble). The
 *  alternative — ORDER BY account first — fragments work into many
 *  small islands per account, which is fine but harder to reason about
 *  for cursor monotonicity in the presence of the tx_type filter.
 *
 *  Each page is a small finished SELECT (a few seconds at worst) which
 *  is what we want — streaming a long-running query was hitting CH's
 *  socket-level timeouts even with max_execution_time = 0.
 *
 *  PAGE_SIZE of 5000 keeps each round-trip well under a few seconds
 *  even when the filter is sparse. */
const PAGE_SIZE = 5000;

async function fetchPage(
  partition: string,
  cursor: { timestamp: string; tx_hash: string } | null,
): Promise<SourceRow[]> {
  const cursorClause = cursor
    ? `AND (transactions.timestamp, tx_hash) > ('${cursor.timestamp}', '${cursor.tx_hash}')`
    : "";
  return queryRows<SourceRow>(
    `SELECT
        account,
        tx_hash,
        ledger_index,
        toUInt32(toUnixTimestamp(transactions.timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
        toString(transactions.timestamp) AS timestamp,
        tx_json,
        meta_json
     FROM ${DB}.transactions
     WHERE toYYYYMM(transactions.timestamp) = ${partition}
       AND result = 'tesSUCCESS'
       AND tx_type IN (${NFT_TX_TYPES_SQL})
       ${cursorClause}
     ORDER BY transactions.timestamp ASC, tx_hash ASC
     LIMIT ${PAGE_SIZE}`,
  );
}

function reconstructRawTx(row: SourceRow): RawLedgerTx | null {
  let parsedTx: Record<string, unknown>;
  let parsedMeta: Record<string, unknown>;
  try {
    parsedTx = JSON.parse(row.tx_json) as Record<string, unknown>;
    parsedMeta = JSON.parse(row.meta_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const merged = {
    ...parsedTx,
    hash: row.tx_hash,
    ledger_index: row.ledger_index,
    date: row.xrpl_date,
    meta: parsedMeta as unknown as TxMeta,
  } as unknown as RawLedgerTx;
  if (typeof merged.TransactionType !== "string" || !merged.TransactionType) {
    return null;
  }
  return merged;
}

interface BackfillStats {
  partition: string;
  txs: number;
  offerRows: number;
  ownershipRows: number;
  staticRows: number;
  ms: number;
}

async function backfillPartition(partition: string): Promise<BackfillStats> {
  const start = Date.now();
  const stats: BackfillStats = {
    partition,
    txs: 0,
    offerRows: 0,
    ownershipRows: 0,
    staticRows: 0,
    ms: 0,
  };

  let pendingOffers: Array<Record<string, unknown>> = [];
  let pendingOwnership: Array<Record<string, unknown>> = [];
  let pendingStatic: Array<Record<string, unknown>> = [];
  let cursor: { timestamp: string; tx_hash: string } | null = null;
  let pageNum = 0;
  const partitionStart = Date.now();

  while (true) {
    const pageStart = Date.now();
    const rows = await fetchPage(partition, cursor);
    if (rows.length === 0) break;
    pageNum += 1;
    const fetchMs = Date.now() - pageStart;

    for (const row of rows) {
      const rawTx = reconstructRawTx(row);
      if (!rawTx) continue;
      stats.txs += 1;
      const events = extractNftStateEvents(rawTx);
      for (const r of events.offers) {
        stats.offerRows += 1;
        pendingOffers.push(r);
        if (pendingOffers.length >= INSERT_BATCH_SIZE) {
          await flushOffers(pendingOffers);
          pendingOffers = [];
        }
      }
      for (const r of events.ownership) {
        stats.ownershipRows += 1;
        pendingOwnership.push(r);
        if (pendingOwnership.length >= INSERT_BATCH_SIZE) {
          await flushOwnership(pendingOwnership);
          pendingOwnership = [];
        }
      }
      for (const r of events.staticMetadata) {
        stats.staticRows += 1;
        pendingStatic.push(r);
        if (pendingStatic.length >= INSERT_BATCH_SIZE) {
          await flushStatic(pendingStatic);
          pendingStatic = [];
        }
      }
    }

    const elapsedSec = ((Date.now() - partitionStart) / 1000).toFixed(0);
    const rate = Math.round(stats.txs / Math.max(1, Number(elapsedSec)));
    process.stdout.write(
      `[partition ${partition}] page=${pageNum} ` +
        `rows=${rows.length} fetchMs=${fetchMs} ` +
        `total_txs=${stats.txs} offers=${stats.offerRows} ` +
        `ownership=${stats.ownershipRows} static=${stats.staticRows} ` +
        `${elapsedSec}s rate=${rate}/s\n`,
    );

    // Advance cursor to the last row of this page.
    const last = rows[rows.length - 1];
    cursor = { timestamp: last.timestamp, tx_hash: last.tx_hash };
    if (rows.length < PAGE_SIZE) break;
  }

  if (pendingOffers.length > 0) await flushOffers(pendingOffers);
  if (pendingOwnership.length > 0) await flushOwnership(pendingOwnership);
  if (pendingStatic.length > 0) await flushStatic(pendingStatic);

  stats.ms = Date.now() - start;
  return stats;
}

async function flushOffers(rows: Array<Record<string, unknown>>) {
  if (!EXECUTE) return;
  await ch.insert({
    table: `${DB}.nft_offers`,
    values: rows,
    format: "JSONEachRow",
  });
}

async function flushOwnership(rows: Array<Record<string, unknown>>) {
  if (!EXECUTE) return;
  await ch.insert({
    table: `${DB}.nft_ownership`,
    values: rows,
    format: "JSONEachRow",
  });
}

async function flushStatic(rows: Array<Record<string, unknown>>) {
  if (!EXECUTE) return;
  await ch.insert({
    table: `${DB}.nft_static_metadata`,
    values: rows,
    format: "JSONEachRow",
  });
}

/* ── Main ──────────────────────────────────────────────────────────── */

async function main() {
  console.log(
    `[backfill-nft-state] db=${DB} execute=${EXECUTE} reverse=${REVERSE}`,
  );
  console.log(
    `[backfill-nft-state] insert-batch=${INSERT_BATCH_SIZE}`,
  );

  const partitions = await listPartitions();
  console.log(
    `[backfill-nft-state] partitions=${partitions.length} ` +
      `from=${partitions[0] ?? "(none)"} to=${partitions.at(-1) ?? "(none)"}`,
  );

  let totalTxs = 0;
  let totalOffers = 0;
  let totalOwnership = 0;
  const startedAt = Date.now();

  for (const p of partitions) {
    const sizing = await partitionStats(p);
    console.log(
      `[partition ${p}] sizing rows=${sizing.rows} ` +
        `earliest=${sizing.earliest} latest=${sizing.latest}`,
    );
    if (sizing.rows === "0") {
      console.log(`[partition ${p}] empty — skipping`);
      continue;
    }
    const stats = await backfillPartition(p);
    totalTxs += stats.txs;
    totalOffers += stats.offerRows;
    totalOwnership += stats.ownershipRows;
    const rate =
      stats.ms > 0 ? Math.round((stats.txs * 1000) / stats.ms) : 0;
    console.log(
      `[partition ${p}] done txs=${stats.txs} offers=${stats.offerRows} ` +
        `ownership=${stats.ownershipRows} ms=${stats.ms} rate=${rate}/s`,
    );
  }

  const elapsed = Date.now() - startedAt;
  console.log(
    `[backfill-nft-state] complete totals: ` +
      `txs=${totalTxs} offers=${totalOffers} ownership=${totalOwnership} ` +
      `elapsed=${(elapsed / 1000).toFixed(1)}s`,
  );

  await ch.close();
}

main().catch(async (err) => {
  console.error("[backfill-nft-state] failed", err);
  await ch.close();
  process.exit(1);
});
