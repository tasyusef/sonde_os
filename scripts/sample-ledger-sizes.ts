/**
 * Sample per-era ledger storage cost. Fetches N random ledgers from each
 * of 6 historical eras via honeycluster (full history Clio), classifies
 * them through the same pipeline as production, inserts into a fresh
 * `sonde_eras` CH database, and reports per-era compressed bytes per
 * ledger. Used to validate the full-history capacity projection.
 *
 * Run on the Hetzner box (CH is localhost there, low-latency):
 *   NODE_OPTIONS="--conditions react-server" pnpm tsx scripts/sample-ledger-sizes.ts
 *
 * Output: a markdown table you can paste into the plan/runbook.
 */

import { config } from "dotenv";
config({ path: ".env" });

import { XrplClient } from "@/lib/xrpl-client";
import { classifyLedger } from "@/lib/intel-ingestion";
import { extractNFTTrade, extractTokenTrades, extractPaymentCorridor } from "@/lib/trade-extractors";
import { createClient } from "@clickhouse/client";
import type { ExpandedLedger, RawLedgerTx } from "@/types/ingestion";

/* ------------------------------------------------------------------ */

const ERAS: { name: string; minLedger: number; maxLedger: number; description: string }[] = [
  { name: "2013-2014", minLedger: 1, maxLedger: 15_000_000, description: "Pre-most-amendments (early chain)" },
  { name: "2015-2017", minLedger: 15_000_000, maxLedger: 40_000_000, description: "FlowCross / SignerLists era" },
  { name: "2018-2020", minLedger: 40_000_000, maxLedger: 63_000_000, description: "Escrow / PayChan era" },
  { name: "2021-Oct-2022", minLedger: 63_000_000, maxLedger: 75_443_457, description: "Pre-NFT" },
  { name: "Oct-2022-Mar-2024", minLedger: 75_443_457, maxLedger: 86_795_265, description: "NFT live, pre-AMM" },
  { name: "Mar-2024-now", minLedger: 86_795_265, maxLedger: 103_867_000, description: "AMM era (current)" },
];

const SAMPLES_PER_ERA = parseInt(process.env.SAMPLES_PER_ERA ?? "50", 10);
const CONCURRENCY = parseInt(process.env.SAMPLE_CONCURRENCY ?? "5", 10);

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!CLICKHOUSE_URL) {
  console.error("CLICKHOUSE_URL required");
  process.exit(1);
}

/* ------------------------------------------------------------------ */

async function main() {
  const ch = createClient({ url: CLICKHOUSE_URL, database: "default" });
  const xrpl = new XrplClient(["wss://honeycluster.io", "wss://s2.ripple.com"]);

  console.log(`Sampling ${SAMPLES_PER_ERA} ledgers per era × ${ERAS.length} eras`);
  console.log(`WS endpoints: honeycluster.io (primary), s2.ripple.com (failover)\n`);

  // ── Reset target DB ──────────────────────────────────────────────
  await ch.command({ query: "DROP DATABASE IF EXISTS sonde_eras" });
  await ch.command({ query: "CREATE DATABASE sonde_eras" });

  // Recreate the schemas we care about — copy the production DDL.
  // We mirror only the tables that production fills per ledger.
  await ch.command({
    query: `CREATE TABLE sonde_eras.transactions (
      tx_hash        FixedString(64),
      tx_type        LowCardinality(String),
      account        String,
      destination    String DEFAULT '',
      amount_drops   Int64 DEFAULT 0,
      currency       LowCardinality(String) DEFAULT 'XRP',
      issuer         String DEFAULT '',
      fee_drops      UInt32,
      timestamp      DateTime,
      ledger_index   UInt32,
      result         LowCardinality(String),
      memo           String DEFAULT '',
      tx_json        String DEFAULT '',
      meta_json      String DEFAULT '',
      nftoken_id     FixedString(64) DEFAULT '0',
      flags          UInt32 DEFAULT 0,
      sequence       UInt32 DEFAULT 0,
      source_tag     UInt32 DEFAULT 0,
      destination_tag UInt32 DEFAULT 0,
      delivered_amount_drops Int64 DEFAULT 0,
      delivered_amount_iou String DEFAULT '',
      era            LowCardinality(String)
    ) ENGINE = ReplacingMergeTree(timestamp)
      PARTITION BY era
      ORDER BY (era, account, timestamp, tx_hash)
      SETTINGS index_granularity = 8192`,
  });

  await ch.command({
    query: `CREATE TABLE sonde_eras.dex_trades (
      tx_hash          FixedString(64),
      timestamp        DateTime,
      ledger_index     UInt32,
      taker            String,
      maker            String,
      base_currency    LowCardinality(String),
      base_issuer      String DEFAULT '',
      base_amount      Float64,
      quote_currency   LowCardinality(String),
      quote_issuer     String DEFAULT '',
      quote_amount     Float64,
      price            Float64,
      xrp_volume_drops Int64 DEFAULT 0,
      era              LowCardinality(String)
    ) ENGINE = ReplacingMergeTree()
      PARTITION BY era
      ORDER BY (era, tx_hash, taker, maker)`,
  });

  await ch.command({
    query: `CREATE TABLE sonde_eras.trustline_events (
      tx_hash        FixedString(64),
      ledger_index   UInt32,
      timestamp      DateTime,
      account        String,
      currency       LowCardinality(String),
      issuer         String,
      limit_amount   Float64,
      action         Enum8('set' = 1, 'delete' = 2),
      era            LowCardinality(String)
    ) ENGINE = ReplacingMergeTree(timestamp)
      PARTITION BY era
      ORDER BY (era, currency, issuer, timestamp, account)`,
  });

  await ch.command({
    query: `CREATE TABLE sonde_eras.nft_trades (
      tx_hash          FixedString(64),
      ledger_index     UInt32,
      timestamp        DateTime,
      nft_id           FixedString(64),
      issuer           String,
      taxon            UInt32 DEFAULT 0,
      seller           String,
      buyer            String,
      broker           String DEFAULT '',
      marketplace      LowCardinality(String) DEFAULT '',
      amount_drops     Int64 DEFAULT 0,
      amount_currency  LowCardinality(String) DEFAULT 'XRP',
      amount_issuer    String DEFAULT '',
      amount_value     String DEFAULT '',
      is_xrp           UInt8 DEFAULT 1,
      era              LowCardinality(String)
    ) ENGINE = ReplacingMergeTree()
      PARTITION BY era
      ORDER BY (era, tx_hash, nft_id)`,
  });

  await ch.command({
    query: `CREATE TABLE sonde_eras.payment_corridors (
      tx_hash           FixedString(64),
      ledger_index      UInt32,
      timestamp         DateTime,
      src_currency      LowCardinality(String),
      src_issuer        String DEFAULT '',
      dst_currency      LowCardinality(String),
      dst_issuer        String DEFAULT '',
      xrp_volume_drops  Int64 DEFAULT 0,
      era               LowCardinality(String)
    ) ENGINE = ReplacingMergeTree()
      PARTITION BY era
      ORDER BY (era, tx_hash)`,
  });

  console.log("Reset sonde_eras DB + tables\n");

  // ── Per-era sampling ─────────────────────────────────────────────
  type EraStats = { era: string; ledgersFetched: number; ledgersFailed: number };
  const stats: EraStats[] = [];

  for (const era of ERAS) {
    console.log(`── Era: ${era.name} (${era.description}) ──`);
    console.log(`   range [${era.minLedger.toLocaleString()}, ${era.maxLedger.toLocaleString()}]`);

    const indices = sampleRandomLedgers(era.minLedger, era.maxLedger, SAMPLES_PER_ERA);

    let fetched = 0;
    let failed = 0;
    for (let i = 0; i < indices.length; i += CONCURRENCY) {
      const chunk = indices.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (idx) => {
          try {
            const res = (await xrpl.getLedger(idx, true)) as ExpandedLedger;
            return { idx, res, ok: true } as const;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { idx, msg, ok: false } as const;
          }
        }),
      );

      for (const r of results) {
        if (!r.ok) {
          failed++;
          continue;
        }
        try {
          await processAndInsert(ch, r.idx, r.res, era.name);
          fetched++;
        } catch (err) {
          console.warn(`   process+insert failed for ledger ${r.idx}:`, err instanceof Error ? err.message : err);
          failed++;
        }
      }
      process.stdout.write(`   fetched=${fetched} failed=${failed}\r`);
    }
    console.log(`\n   done: fetched=${fetched} failed=${failed}\n`);
    stats.push({ era: era.name, ledgersFetched: fetched, ledgersFailed: failed });
  }

  // Force merges so size measurement is accurate.
  for (const tbl of ["transactions", "dex_trades", "trustline_events", "nft_trades", "payment_corridors"]) {
    await ch.command({ query: `OPTIMIZE TABLE sonde_eras.${tbl} FINAL` });
  }

  // ── Measurement ──────────────────────────────────────────────────
  const sizesRes = await ch.query({
    query: `SELECT
      partition AS era,
      sum(bytes_on_disk) AS bytes,
      sum(data_uncompressed_bytes) AS uncompressed,
      sum(rows) AS rows
    FROM system.parts
    WHERE active AND database = 'sonde_eras'
    GROUP BY era
    ORDER BY era`,
    format: "JSONEachRow",
  });
  const sizes = await sizesRes.json<{
    era: string;
    bytes: string;
    uncompressed: string;
    rows: string;
  }>();

  const totalsRes = await ch.query({
    query: `SELECT
      partition AS era,
      table,
      sum(bytes_on_disk) AS bytes,
      sum(rows) AS rows
    FROM system.parts
    WHERE active AND database = 'sonde_eras'
    GROUP BY era, table
    ORDER BY era, table`,
    format: "JSONEachRow",
  });
  const totals = await totalsRes.json<{
    era: string;
    table: string;
    bytes: string;
    rows: string;
  }>();

  // ── Report ───────────────────────────────────────────────────────
  console.log("\n============ RESULTS ============\n");

  // Aggregated per-era table
  console.log("| Era | Sampled ledgers | Total compressed | Per-ledger compressed | Compression ratio |");
  console.log("|---|---|---|---|---|");
  for (const era of ERAS) {
    const stat = stats.find((s) => s.era === era.name);
    const sz = sizes.find((s) => s.era === era.name);
    const fetched = stat?.ledgersFetched ?? 0;
    const bytes = sz ? Number(sz.bytes) : 0;
    const uncompressed = sz ? Number(sz.uncompressed) : 0;
    const perLedger = fetched > 0 ? bytes / fetched : 0;
    const ratio = bytes > 0 ? uncompressed / bytes : 0;
    console.log(
      `| ${era.name} | ${fetched} | ${(bytes / 1024).toFixed(0)} KB | ${(perLedger / 1024).toFixed(1)} KB | ${ratio.toFixed(1)}× |`,
    );
  }

  // Per-table breakdown
  console.log("\n## Per-table breakdown\n");
  console.log("| Era | Table | Rows | Bytes |");
  console.log("|---|---|---|---|");
  for (const t of totals) {
    console.log(`| ${t.era} | ${t.table} | ${Number(t.rows).toLocaleString()} | ${(Number(t.bytes) / 1024).toFixed(0)} KB |`);
  }

  // Full-history projection
  console.log("\n## Full-history projection\n");
  const ERA_LEDGER_COUNTS: Record<string, number> = {
    "2013-2014": 15_000_000,
    "2015-2017": 25_000_000,
    "2018-2020": 23_000_000,
    "2021-Oct-2022": 12_443_457,
    "Oct-2022-Mar-2024": 11_351_808,
    "Mar-2024-now": 17_072_000,
  };
  let totalEstimateBytes = 0;
  console.log("| Era | Ledgers in era | Per-ledger | Era total |");
  console.log("|---|---|---|---|");
  for (const era of ERAS) {
    const stat = stats.find((s) => s.era === era.name);
    const sz = sizes.find((s) => s.era === era.name);
    const fetched = stat?.ledgersFetched ?? 0;
    const bytes = sz ? Number(sz.bytes) : 0;
    const perLedger = fetched > 0 ? bytes / fetched : 0;
    const eraLedgers = ERA_LEDGER_COUNTS[era.name] ?? 0;
    const eraEstimate = perLedger * eraLedgers;
    totalEstimateBytes += eraEstimate;
    console.log(
      `| ${era.name} | ${eraLedgers.toLocaleString()} | ${(perLedger / 1024).toFixed(1)} KB | ${(eraEstimate / 1024 / 1024 / 1024).toFixed(1)} GB |`,
    );
  }
  console.log(`\n**Full history estimate: ~${(totalEstimateBytes / 1024 / 1024 / 1024).toFixed(0)} GB**\n`);

  await ch.close();
  process.exit(0);
}

function sampleRandomLedgers(min: number, max: number, n: number): number[] {
  const set = new Set<number>();
  while (set.size < n) {
    set.add(Math.floor(min + Math.random() * (max - min)));
  }
  return Array.from(set).sort((a, b) => a - b);
}

async function processAndInsert(
  ch: ReturnType<typeof createClient>,
  ledgerIndex: number,
  res: ExpandedLedger,
  era: string,
): Promise<void> {
  const classified = classifyLedger(res);
  if (!classified) return;

  // Tag every row with the era partition.
  const transactionsRows = classified.chRows.map((r) => ({ ...r, era }));
  const dexRows = classified.chDexRows.map((r) => ({ ...r, era }));
  const trustlineRows = classified.chTrustlineRows.map((r) => ({ ...r, era }));

  // Walk transactions for NFT + corridor data (the unified ingester does this
  // outside classifyLedger). We don't need the ammMutations etc. for a size
  // measurement; just the row-producing extractors.
  const nftTradeRows: Record<string, unknown>[] = [];
  const corridorRows: Record<string, unknown>[] = [];
  const txs = (res.ledger.transactions ?? []) as RawLedgerTx[];
  for (const rawTx of txs) {
    // The extractor closure expects `date` + `ledger_index` already on rawTx
    const stamped = {
      ...rawTx,
      date: res.ledger.close_time,
      ledger_index: res.ledger.ledger_index,
    } as RawLedgerTx;

    const isSuccess = (rawTx as { meta?: { TransactionResult?: string } }).meta?.TransactionResult === "tesSUCCESS";
    if (!isSuccess) continue;

    const corridor = extractPaymentCorridor(stamped);
    if (corridor) {
      corridorRows.push({
        tx_hash: padHash(rawTx.hash ?? ""),
        ledger_index: res.ledger.ledger_index,
        timestamp: new Date(corridor.dateIso).toISOString().replace("T", " ").slice(0, 19),
        src_currency: corridor.srcCurrency,
        src_issuer: corridor.srcIssuer,
        dst_currency: corridor.dstCurrency,
        dst_issuer: corridor.dstIssuer,
        xrp_volume_drops: Number(corridor.xrpVolumeDrops),
        era,
      });
    }

    const nftTrade = extractNFTTrade(stamped, new Map());
    if (nftTrade) {
      nftTradeRows.push({
        tx_hash: padHash(nftTrade.txHash),
        ledger_index: res.ledger.ledger_index,
        timestamp: new Date(nftTrade.dateIso).toISOString().replace("T", " ").slice(0, 19),
        nft_id: padHash(nftTrade.nftId),
        issuer: nftTrade.issuer,
        taxon: nftTrade.taxon,
        seller: nftTrade.seller,
        buyer: nftTrade.buyer,
        broker: nftTrade.broker ?? "",
        marketplace: nftTrade.marketplace ?? "",
        amount_drops: nftTrade.isXrp && nftTrade.amountDrops ? Number(nftTrade.amountDrops) : 0,
        amount_currency: nftTrade.isXrp ? "XRP" : (nftTrade.amountCurrency ?? ""),
        amount_issuer: nftTrade.amountIssuer ?? "",
        amount_value: nftTrade.amountValue ?? "",
        is_xrp: nftTrade.isXrp ? 1 : 0,
        era,
      });
    }

    // Token trades not measured separately — they go into dex_trades via classifyLedger.
    extractTokenTrades(stamped);
  }

  await Promise.all([
    transactionsRows.length > 0
      ? ch.insert({ table: "sonde_eras.transactions", values: transactionsRows, format: "JSONEachRow" })
      : Promise.resolve(),
    dexRows.length > 0
      ? ch.insert({ table: "sonde_eras.dex_trades", values: dexRows.map((r) => ({ ...r, era })), format: "JSONEachRow" })
      : Promise.resolve(),
    trustlineRows.length > 0
      ? ch.insert({ table: "sonde_eras.trustline_events", values: trustlineRows.map((r) => ({ ...r, era })), format: "JSONEachRow" })
      : Promise.resolve(),
    nftTradeRows.length > 0
      ? ch.insert({ table: "sonde_eras.nft_trades", values: nftTradeRows, format: "JSONEachRow" })
      : Promise.resolve(),
    corridorRows.length > 0
      ? ch.insert({ table: "sonde_eras.payment_corridors", values: corridorRows, format: "JSONEachRow" })
      : Promise.resolve(),
  ]);
}

function padHash(hash: string): string {
  return (hash + "0".repeat(64)).slice(0, 64);
}

main().catch((err) => {
  console.error("[sample-ledger-sizes] fatal:", err);
  process.exit(1);
});
