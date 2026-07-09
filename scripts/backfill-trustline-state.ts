/**
 * Backfill `trustlines` from historical `transactions.meta_json` blobs.
 *
 * Replays every tx whose meta touches a RippleState ledger entry and
 * runs the same `extractTrustlineEvents()` extractor the live ingester
 * uses. ReplacingMergeTree(last_updated) on `(account, currency,
 * counterparty)` collapses successive updates to the latest state per
 * pair after merge.
 *
 * Direction: newest-first by default. The state-mirror doctrine
 * (`docs/wiki/architecture/state-mirrors.md`) flags this — newest-first
 * lets ReplacingMergeTree dedup to the latest state without us
 * processing every historical mutation. Older partitions still get
 * walked, but their writes lose to the newer ones already-merged.
 *
 * Filter: rows where meta_json contains "RippleState". Catches
 * TrustSet, Payment-with-IOU, AMM ops, AccountDelete, OfferCreate
 * cross-currency rippling — uniform handling via meta.AffectedNodes.
 *
 * Throughput: trustline-touching txs are a much bigger share of the
 * tx feed than NFT txs (every IOU payment hits at least one
 * RippleState). On a 760M-row transactions table maybe ~50-150M
 * trustline-touching txs across all partitions.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { extractTrustlineEvents } from "../src/lib/trustline-state-extractor";
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
const FORWARD = args.includes("--forward");
const FROM_PARTITION = getArg("--from-partition");
const TO_PARTITION = getArg("--to-partition");
const INSERT_BATCH_SIZE = Number(getArg("--insert-batch-size") ?? "5000");
const PAGE_SIZE = Number(getArg("--page-size") ?? "25000");
const SLICE_HOURS = Number(getArg("--slice-hours") ?? "4");
const PARALLEL_SLICES = Number(getArg("--parallel-slices") ?? "4");

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error(
    "[backfill-trustline-state] refusing to target production 'sonde' without --confirm-production",
  );
  process.exit(1);
}
if (!Number.isFinite(INSERT_BATCH_SIZE) || INSERT_BATCH_SIZE < 100) {
  console.error("[backfill-trustline-state] --insert-batch-size must be ≥ 100");
  process.exit(1);
}
if (!Number.isFinite(PAGE_SIZE) || PAGE_SIZE < 1000) {
  console.error("[backfill-trustline-state] --page-size must be ≥ 1000");
  process.exit(1);
}
if (!Number.isFinite(SLICE_HOURS) || SLICE_HOURS < 1) {
  console.error("[backfill-trustline-state] --slice-hours must be ≥ 1");
  process.exit(1);
}
if (
  !Number.isFinite(PARALLEL_SLICES) ||
  PARALLEL_SLICES < 1 ||
  PARALLEL_SLICES > 16
) {
  console.error(
    "[backfill-trustline-state] --parallel-slices must be in [1, 16]",
  );
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error(
    "[backfill-trustline-state] CLICKHOUSE_URL required (set in .env.local)",
  );
  process.exit(1);
}

const ch = createClient({
  url,
  database: DB,
  request_timeout: 600_000,
});

/* ── Types ─────────────────────────────────────────────────────────── */

interface SourceRow {
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
  const rows = await queryRows<{ partition: string }>(
    `SELECT partition_id AS partition, sum(rows) AS rows
       FROM system.parts
       WHERE database = '${DB}' AND table = 'transactions' AND active = 1
       GROUP BY partition_id
       HAVING rows > 0
       ORDER BY partition_id ${FORWARD ? "ASC" : "DESC"}`,
  );
  let parts = rows.map((r) => r.partition);
  if (FROM_PARTITION) parts = parts.filter((p) => p >= FROM_PARTITION);
  if (TO_PARTITION) parts = parts.filter((p) => p <= TO_PARTITION);
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
       AND positionUTF8(meta_json, 'RippleState') > 0`,
  );
}

interface Slice {
  /** ISO 'YYYY-MM-DD HH:mm:ss' lower bound, inclusive. */
  start: string;
  /** ISO 'YYYY-MM-DD HH:mm:ss' upper bound, exclusive. */
  end: string;
}

/** Compute non-overlapping timestamp slices spanning a partition's
 *  earliest..latest range. Slices are emitted newest-first by default
 *  (DESC) to match the partition iteration order — current state lands
 *  fastest. Slice width is `--slice-hours` wide.
 *
 *  Why slice: the `transactions` PK is `(account, timestamp, tx_hash)`,
 *  so a `(timestamp, tx_hash) < cursor` predicate without `account` can't
 *  use the PK for seeking, falling back to a granule scan over the whole
 *  partition. Bounding the scan to a small timestamp window via
 *  `timestamp >= start AND timestamp < end` narrows that scan by
 *  ~partition_hours / SLICE_HOURS. Slices also run in parallel. */
function computeSlices(stats: PartitionStats): Slice[] {
  const earliestMs = Date.parse(`${stats.earliest}Z`);
  const latestMs = Date.parse(`${stats.latest}Z`);
  if (
    !Number.isFinite(earliestMs) ||
    !Number.isFinite(latestMs) ||
    latestMs <= earliestMs
  ) {
    return [];
  }
  const sliceMs = SLICE_HOURS * 60 * 60 * 1000;
  // Pad +1s on the upper bound so the latest tx is included when we use
  // `< end`. The partition's `latest` came from `max(timestamp)` which is
  // inclusive — without padding we'd miss that exact-second row.
  const upperMs = latestMs + 1000;
  const slices: Slice[] = [];
  for (let end = upperMs; end > earliestMs; end -= sliceMs) {
    const start = Math.max(end - sliceMs, earliestMs);
    slices.push({ start: msToCh(start), end: msToCh(end) });
    if (start === earliestMs) break;
  }
  return FORWARD ? slices.reverse() : slices;
}

/** ms epoch → 'YYYY-MM-DD HH:mm:ss'. CH parses this as DateTime. */
function msToCh(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Cursor-paginated SELECT scoped to a single timestamp slice. The slice
 *  predicate prunes the partition scan to the slice's granules; the
 *  cursor predicate then advances within the slice, page by page. */
async function fetchPage(
  partition: string,
  slice: Slice,
  cursor: { timestamp: string; tx_hash: string } | null,
): Promise<SourceRow[]> {
  const cmp = FORWARD ? ">" : "<";
  const cursorClause = cursor
    ? `AND (transactions.timestamp, tx_hash) ${cmp} ('${cursor.timestamp}', '${cursor.tx_hash}')`
    : "";
  const order = FORWARD ? "ASC" : "DESC";
  return queryRows<SourceRow>(
    `SELECT
        tx_hash,
        ledger_index,
        toUInt32(toUnixTimestamp(transactions.timestamp) - ${XRPL_EPOCH_OFFSET_S}) AS xrpl_date,
        toString(transactions.timestamp) AS timestamp,
        tx_json,
        meta_json
     FROM ${DB}.transactions
     WHERE toYYYYMM(transactions.timestamp) = ${partition}
       AND transactions.timestamp >= '${slice.start}'
       AND transactions.timestamp <  '${slice.end}'
       AND result = 'tesSUCCESS'
       AND positionUTF8(meta_json, 'RippleState') > 0
       ${cursorClause}
     ORDER BY transactions.timestamp ${order}, tx_hash ${order}
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
  rows: number;
  ms: number;
}

/** Process a single slice end-to-end: cursor-paginate within its
 *  timestamp window, extract trustline events, flush in batches. Stats
 *  mutate the shared partition object — Node's single-threaded loop
 *  means concurrent worker increments are safe without locking. */
async function processSlice(
  partition: string,
  slice: Slice,
  workerId: number,
  stats: BackfillStats,
  partitionStart: number,
): Promise<void> {
  let pendingRows: Array<Record<string, unknown>> = [];
  let cursor: { timestamp: string; tx_hash: string } | null = null;
  let pageNum = 0;

  while (true) {
    const pageStart = Date.now();
    const rows = await fetchPage(partition, slice, cursor);
    if (rows.length === 0) break;
    pageNum += 1;
    const fetchMs = Date.now() - pageStart;

    for (const row of rows) {
      const rawTx = reconstructRawTx(row);
      if (!rawTx) continue;
      stats.txs += 1;
      const events = extractTrustlineEvents(rawTx);
      for (const r of events) {
        stats.rows += 1;
        pendingRows.push(r);
        if (pendingRows.length >= INSERT_BATCH_SIZE) {
          await flushRows(pendingRows);
          pendingRows = [];
        }
      }
    }

    const elapsedSec = ((Date.now() - partitionStart) / 1000).toFixed(0);
    const rate = Math.round(stats.txs / Math.max(1, Number(elapsedSec)));
    process.stdout.write(
      `[partition ${partition}] [w${workerId} ${slice.start}] page=${pageNum} ` +
        `rows=${rows.length} fetchMs=${fetchMs} ` +
        `total_txs=${stats.txs} trustline_rows=${stats.rows} ` +
        `${elapsedSec}s rate=${rate}/s\n`,
    );

    const last = rows[rows.length - 1];
    cursor = { timestamp: last.timestamp, tx_hash: last.tx_hash };
    if (rows.length < PAGE_SIZE) break;
  }

  if (pendingRows.length > 0) await flushRows(pendingRows);
}

async function backfillPartition(
  partition: string,
  sizing: PartitionStats,
): Promise<BackfillStats> {
  const start = Date.now();
  const stats: BackfillStats = { partition, txs: 0, rows: 0, ms: 0 };

  const slices = computeSlices(sizing);
  console.log(
    `[partition ${partition}] slices=${slices.length} ` +
      `slice-hours=${SLICE_HOURS} parallel=${PARALLEL_SLICES} ` +
      `page-size=${PAGE_SIZE}`,
  );

  // Shared queue. Workers race to pop the next slice; once empty, they
  // exit. Dispatching this way means slow slices (heavier hours) don't
  // hold up the rest — fast slices keep workers busy.
  const queue = [...slices];
  const workers = Array.from({ length: PARALLEL_SLICES }, async (_, idx) => {
    while (queue.length > 0) {
      const slice = queue.shift();
      if (!slice) break;
      await processSlice(partition, slice, idx, stats, start);
    }
  });
  await Promise.all(workers);

  stats.ms = Date.now() - start;
  return stats;
}

async function flushRows(rows: Array<Record<string, unknown>>) {
  if (!EXECUTE) return;
  await ch.insert({
    table: `${DB}.trustlines`,
    values: rows,
    format: "JSONEachRow",
  });
}

/* ── Main ──────────────────────────────────────────────────────────── */

async function main() {
  console.log(
    `[backfill-trustline-state] db=${DB} execute=${EXECUTE} forward=${FORWARD}`,
  );
  console.log(
    `[backfill-trustline-state] insert-batch=${INSERT_BATCH_SIZE} ` +
      `page-size=${PAGE_SIZE} slice-hours=${SLICE_HOURS} ` +
      `parallel-slices=${PARALLEL_SLICES}`,
  );

  const partitions = await listPartitions();
  console.log(
    `[backfill-trustline-state] partitions=${partitions.length} ` +
      `from=${partitions[0] ?? "(none)"} to=${partitions.at(-1) ?? "(none)"}`,
  );

  let totalTxs = 0;
  let totalRows = 0;
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
    const stats = await backfillPartition(p, sizing);
    totalTxs += stats.txs;
    totalRows += stats.rows;
    const rate =
      stats.ms > 0 ? Math.round((stats.txs * 1000) / stats.ms) : 0;
    console.log(
      `[partition ${p}] done txs=${stats.txs} trustline_rows=${stats.rows} ` +
        `ms=${stats.ms} rate=${rate}/s`,
    );
  }

  const elapsed = Date.now() - startedAt;
  console.log(
    `[backfill-trustline-state] complete totals: ` +
      `txs=${totalTxs} trustline_rows=${totalRows} ` +
      `elapsed=${(elapsed / 1000).toFixed(1)}s`,
  );

  await ch.close();
}

main().catch(async (err) => {
  console.error("[backfill-trustline-state] failed", err);
  await ch.close();
  process.exit(1);
});
