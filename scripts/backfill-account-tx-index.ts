/**
 * Slice-5b backfill — populate `account_tx_index` from historical
 * `transactions.meta_json` blobs.
 *
 * Slice 5a wired the live ingester to write `account_tx_index` rows per
 * tx going forward. This backfill walks the existing 600M+ row
 * `transactions` history, parses `meta_json` + `tx_json`, runs the same
 * pure `extractAccountTxIndex()` extractor, and inserts the resulting
 * AffectedNodes-only relationships into `account_tx_index`.
 *
 * Flow per partition (one CH `toYYYYMM(timestamp)` partition ≈ 1 month):
 *   1. SELECT count() to size progress
 *   2. SELECT rows in (timestamp, tx_hash) order, paginated via a strict-
 *      tuple cursor so re-runs after a crash pick up cleanly
 *   3. Parse JSON blobs, run extractor, batch insert into account_tx_index
 *   4. Move to the next partition
 *
 * `account_tx_index` is `ReplacingMergeTree(version=timestamp)` — re-running
 * a partition is safe; later inserts replace earlier ones on the same
 * (account, timestamp, tx_hash, role) PK after the next merge.
 *
 * The script is throughput-bounded by JSON parsing in Node, not CH
 * I/O. ~50k txs/sec sustained on a CPX62. A 600M-row backfill is
 * ~3.5 hours straight; partition-by-partition lets you pause and resume.
 *
 * Flags:
 *   --db <database>           default: `sonde_smoketest`
 *   --confirm-production      required when --db sonde
 *   --execute                 actually insert (default is dry-run)
 *   --from-partition YYYYMM   skip partitions older than this (default: all)
 *   --to-partition YYYYMM     skip partitions newer than this (default: all)
 *   --batch-size N            rows per CH SELECT page (default 25000)
 *   --insert-batch-size N     rows per CH INSERT (default 5000)
 *   --reverse                 walk newest → oldest (default: oldest → newest,
 *                             keeps the prod box's working set warm)
 *   --truncate                TRUNCATE the table before backfilling. Use with
 *                             care — this is the only path that doesn't rely
 *                             on ReplacingMergeTree dedup. Required when the
 *                             extractor logic changes shape.
 *
 * Examples:
 *   pnpm exec tsx scripts/backfill-account-tx-index.ts                                      # smoketest dry-run
 *   pnpm exec tsx scripts/backfill-account-tx-index.ts --execute                            # smoketest apply
 *   pnpm exec tsx scripts/backfill-account-tx-index.ts --db sonde --confirm-production --execute --from-partition 202604
 *
 * After the smoketest run finishes, sanity-check role distribution:
 *   SELECT role, count() FROM <db>.account_tx_index GROUP BY role
 * Expected ballpark from the slice-5a smoketest: roughly 33/33/33 across
 * offer_owner / amm_lp / trustline_peer, with account_root_modified a
 * smaller residual.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { extractAccountTxIndex } from "../src/lib/account-index-extractor";
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
const TRUNCATE = args.includes("--truncate");
const FROM_PARTITION = getArg("--from-partition");
const TO_PARTITION = getArg("--to-partition");
const BATCH_SIZE = Number(getArg("--batch-size") ?? "25000");
const INSERT_BATCH_SIZE = Number(getArg("--insert-batch-size") ?? "5000");

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error(
    "[backfill-account-tx-index] refusing to target production 'sonde' without --confirm-production",
  );
  process.exit(1);
}
if (!Number.isFinite(BATCH_SIZE) || BATCH_SIZE < 100) {
  console.error("[backfill-account-tx-index] --batch-size must be ≥ 100");
  process.exit(1);
}
if (!Number.isFinite(INSERT_BATCH_SIZE) || INSERT_BATCH_SIZE < 100) {
  console.error("[backfill-account-tx-index] --insert-batch-size must be ≥ 100");
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error(
    "[backfill-account-tx-index] CLICKHOUSE_URL required (set in .env.local)",
  );
  process.exit(1);
}

const ch = createClient({
  url,
  database: DB,
  request_timeout: 600_000, // 10 min per CH command
});

/* ── Types matching what we SELECT from transactions ───────────────── */

interface SourceRow {
  /** Sender account — the leading column of the PK and the first cursor
   *  field. Including it (rather than only timestamp) lets CH walk the
   *  partition in PK storage order without a re-sort, which OOMs at
   *  27 GiB on a single 4M-row partition otherwise. */
  account: string;
  tx_hash: string;
  ledger_index: number;
  /** XRPL `date` (seconds since 2000-01-01 UTC). */
  xrpl_date: number;
  /** CH DateTime literal `YYYY-MM-DD HH:MM:SS` — we don't actually use this
   *  during extraction (the extractor synthesizes its own from xrpl_date)
   *  but we read it for the cursor + the partition discriminator. */
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
  // partition_id on `transactions` is the YYYYMM string from `toYYYYMM`.
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
  // `partition` is a YYYYMM string from `system.parts` — server-vetted —
  // so direct interpolation is safe and avoids the {p:String}→UInt32
  // coercion dance the parameter binding wants.
  return querySingle<PartitionStats>(
    `SELECT
       toString(count())              AS rows,
       toString(min(timestamp))       AS earliest,
       toString(max(timestamp))       AS latest
     FROM ${DB}.transactions
     WHERE toYYYYMM(timestamp) = ${partition}
       AND result = 'tesSUCCESS'`,
  );
}

/** Fetch one page of `transactions` rows in PK order
 *  `(account, timestamp, tx_hash)` from a single partition. `cursor` is
 *  the previous page's last PK tuple — pass null on first call.
 *
 *  Ordering by the PK lets CH walk the partition in storage order with
 *  zero re-sort. An earlier ORDER BY on `(timestamp, tx_hash)` (the PK
 *  minus its leading column) forced a full external sort that OOM'd CH
 *  at 27 GiB on a 4M-row partition. */
async function fetchPage(
  partition: string,
  cursor: { account: string; timestamp: string; tx_hash: string } | null,
  limit: number,
): Promise<SourceRow[]> {
  // Single-quoting the cursor values is safe here because they all come
  // from a previous CH row (account is XRPL-validated, timestamp is a
  // formatted DateTime, tx_hash is hex). No user input.
  const cursorClause = cursor
    ? `AND (account, transactions.timestamp, tx_hash) > ('${cursor.account}', '${cursor.timestamp}', '${cursor.tx_hash}')`
    : "";
  // Result-only filter — failed txs would just be skipped by the extractor
  // via the `tesSUCCESS` check, but filtering at SQL level avoids parsing
  // their meta blobs (which are bigger on tec/tef-class failures).
  const rows = await queryRows<SourceRow>(
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
       ${cursorClause}
     ORDER BY account ASC, transactions.timestamp ASC, tx_hash ASC
     LIMIT ${limit}`,
  );
  return rows;
}

/** Reconstruct a RawLedgerTx-like object from CH columnar + JSON. The
 *  extractor only reads the fields used by AffectedNodes walking +
 *  Account/Destination exclusion + tx_type/hash/date stamping. */
function reconstructRawTx(row: SourceRow): RawLedgerTx | null {
  let parsedTx: Record<string, unknown>;
  let parsedMeta: Record<string, unknown>;
  try {
    parsedTx = JSON.parse(row.tx_json) as Record<string, unknown>;
    parsedMeta = JSON.parse(row.meta_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  // Overlay canonical fields from CH columns onto the parsed blob — same
  // pattern as the read-side helpers in clickhouse-queries.ts. tx_json
  // doesn't always carry `hash` / `date` reliably, but the columns do.
  const merged = {
    ...parsedTx,
    hash: row.tx_hash,
    ledger_index: row.ledger_index,
    date: row.xrpl_date,
    meta: parsedMeta as unknown as TxMeta,
  } as unknown as RawLedgerTx;
  // Without TransactionType we can't write the row's tx_type column. Bail.
  if (typeof merged.TransactionType !== "string" || !merged.TransactionType) {
    return null;
  }
  return merged;
}

interface BackfillStats {
  partition: string;
  txs: number;
  rows: number;
  byRole: Record<string, number>;
  ms: number;
}

async function backfillPartition(
  partition: string,
  closeTime: number,
): Promise<BackfillStats> {
  const start = Date.now();
  const stats: BackfillStats = {
    partition,
    txs: 0,
    rows: 0,
    byRole: {},
    ms: 0,
  };

  let cursor: { account: string; timestamp: string; tx_hash: string } | null = null;
  let pendingInserts: Array<Record<string, unknown>> = [];

  while (true) {
    const page = await fetchPage(partition, cursor, BATCH_SIZE);
    if (page.length === 0) break;

    for (const row of page) {
      const rawTx = reconstructRawTx(row);
      if (!rawTx) continue;
      const indexRows = extractAccountTxIndex(rawTx, {
        ledger_index: row.ledger_index,
        // The extractor falls back to ledger.close_time only when rawTx.date
        // is missing. We've already overlaid date onto rawTx above, so this
        // is just a safety net. Use the row's own xrpl_date as the close-
        // time approximation — within a single tx that's exact.
        close_time: closeTime > 0 ? closeTime : row.xrpl_date,
      });
      stats.txs += 1;
      for (const r of indexRows) {
        stats.rows += 1;
        stats.byRole[r.role] = (stats.byRole[r.role] ?? 0) + 1;
        pendingInserts.push(r);
        if (pendingInserts.length >= INSERT_BATCH_SIZE) {
          await flushInserts(pendingInserts);
          pendingInserts = [];
        }
      }
    }

    const last = page[page.length - 1];
    cursor = {
      account: last.account,
      timestamp: last.timestamp,
      tx_hash: last.tx_hash,
    };
    if (page.length < BATCH_SIZE) break;
  }

  if (pendingInserts.length > 0) {
    await flushInserts(pendingInserts);
  }

  stats.ms = Date.now() - start;
  return stats;
}

async function flushInserts(rows: Array<Record<string, unknown>>): Promise<void> {
  if (!EXECUTE || rows.length === 0) return;
  await ch.insert({
    table: "account_tx_index",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: {
      async_insert: 0,
      max_partitions_per_insert_block: 0 as unknown as string,
    },
  });
}

/* ── Main ──────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log(
    `[backfill-account-tx-index] target=${DB} execute=${EXECUTE} ` +
      `truncate=${TRUNCATE} from=${FROM_PARTITION ?? "*"} to=${TO_PARTITION ?? "*"}`,
  );

  const targetExists = await querySingle<{ n: number }>(
    `SELECT count() AS n FROM system.tables
       WHERE database = '${DB}' AND name = 'account_tx_index'`,
  );
  if (Number(targetExists.n) === 0) {
    console.error(
      `[backfill-account-tx-index] table ${DB}.account_tx_index doesn't exist — run migrate-account-page-foundations.ts first`,
    );
    process.exit(1);
  }

  if (TRUNCATE) {
    if (!EXECUTE) {
      console.log("[backfill-account-tx-index] --truncate is a write — pass --execute to apply");
    } else {
      console.log(`[backfill-account-tx-index] TRUNCATE ${DB}.account_tx_index`);
      await ch.command({ query: `TRUNCATE TABLE ${DB}.account_tx_index` });
    }
  }

  const partitions = await listPartitions();
  console.log(
    `[backfill-account-tx-index] partitions: ${partitions.length} ` +
      `(${REVERSE ? "newest first" : "oldest first"})`,
  );
  if (partitions.length === 0) {
    console.log("[backfill-account-tx-index] nothing to do");
    await ch.close();
    return;
  }

  let totalTxs = 0;
  let totalRows = 0;
  const totalsByRole: Record<string, number> = {};
  const startAll = Date.now();

  for (let i = 0; i < partitions.length; i++) {
    const p = partitions[i];
    process.stdout.write(`  [${i + 1}/${partitions.length}] ${p}: `);
    const before = await partitionStats(p);
    process.stdout.write(`${Number(before.rows).toLocaleString()} txs (${before.earliest} → ${before.latest})... `);
    const stats = await backfillPartition(p, 0);
    totalTxs += stats.txs;
    totalRows += stats.rows;
    for (const [k, v] of Object.entries(stats.byRole)) {
      totalsByRole[k] = (totalsByRole[k] ?? 0) + v;
    }
    const rolePart = Object.entries(stats.byRole)
      .map(([k, v]) => `${k}=${v.toLocaleString()}`)
      .join(", ");
    const seconds = (stats.ms / 1000).toFixed(1);
    console.log(
      `${stats.txs.toLocaleString()} txs → ${stats.rows.toLocaleString()} rows ` +
        `[${rolePart}] in ${seconds}s`,
    );
  }

  const elapsed = (Date.now() - startAll) / 1000;
  console.log("");
  console.log(`[backfill-account-tx-index] done in ${(elapsed / 60).toFixed(1)}m`);
  console.log(
    `  ${totalTxs.toLocaleString()} txs scanned → ` +
      `${totalRows.toLocaleString()} index rows ` +
      `(${EXECUTE ? "inserted" : "DRY RUN — no inserts"})`,
  );
  for (const [role, count] of Object.entries(totalsByRole)) {
    console.log(`    ${role}: ${count.toLocaleString()}`);
  }

  await ch.close();
}

main().catch(async (err) => {
  console.error("[backfill-account-tx-index] fatal:", err);
  await ch.close().catch(() => {});
  process.exit(1);
});
