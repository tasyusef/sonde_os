/**
 * Backfill intel stores with HISTORICAL ledgers (oldest first).
 *
 * Processes ledgers from the main pipeline that were ingested before
 * the intel pipeline started. Goes backwards from the earliest
 * intel-processed ledger.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-intel-historical.ts [count]
 *
 * Arguments:
 *   count — number of ledgers to backfill (default: 5000)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as dsql } from "drizzle-orm";
import { createClient as createCH } from "@clickhouse/client";
import neo4j from "neo4j-driver";
import WS from "ws";
import * as schema from "../src/db/schema";
import type { RawLedgerTx, ExpandedLedger, CurrencyAmount } from "../src/types/ingestion";
import { extractTokenTrades } from "../src/lib/trade-extractors";

/* ── Config ── */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

const COUNT = Number(process.argv[2]) || 5000;
const RIPPLE_EPOCH = 946684800;

const XRPL_URLS = [
  "wss://s1.ripple.com",
  "wss://s2.ripple.com",
  "wss://xrplcluster.com",
];

/* ── Clients ── */

const pg = postgres(DATABASE_URL, { max: 5, idle_timeout: 30 });
const db = drizzle(pg, { schema });

const chClient = CLICKHOUSE_URL
  ? createCH({ url: CLICKHOUSE_URL, database: process.env.CLICKHOUSE_DATABASE ?? "sonde" })
  : null;

const neo4jDriver = NEO4J_URI && NEO4J_PASSWORD
  ? neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD))
  : null;

/* ── XRPL WS ── */

let ws: WS | null = null;
let wsReqId = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

async function connectXrpl(): Promise<void> {
  for (const url of XRPL_URLS) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = new WS(url);
        const timeout = setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 10_000);
        socket.on("open", () => { clearTimeout(timeout); ws = socket; resolve(); });
        socket.on("error", () => { clearTimeout(timeout); reject(new Error("connect error")); });
        socket.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            const cb = pending.get(msg.id);
            if (cb) { pending.delete(msg.id); cb.resolve(msg.result ?? msg); }
          } catch { /* ignore */ }
        });
      });
      console.log(`  Connected to ${url}`);
      return;
    } catch { continue; }
  }
  throw new Error("Failed to connect to any XRPL node");
}

async function xrplRequest(command: Record<string, unknown>): Promise<unknown> {
  if (!ws || ws.readyState !== WS.OPEN) throw new Error("Not connected");
  const id = ++wsReqId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error("request timeout")); }, 15_000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    ws!.send(JSON.stringify({ ...command, id }));
  });
}

/* ── Amount parsing ── */

function parseAmount(amount: string | CurrencyAmount | undefined): {
  drops: number; currency: string; issuer: string;
} {
  if (!amount) return { drops: 0, currency: "XRP", issuer: "" };
  if (typeof amount === "string") return { drops: Number(amount), currency: "XRP", issuer: "" };
  const raw = Number(amount.value);
  return {
    drops: Number.isFinite(raw) ? Math.trunc(Math.min(Math.max(raw, -9e18), 9e18)) : 0,
    currency: amount.currency,
    issuer: amount.issuer,
  };
}

/* ── Process a single ledger ── */

async function processLedger(ledgerIndex: number): Promise<{ txs: number; ch: number; neo: number }> {
  const result = await xrplRequest({
    command: "ledger",
    ledger_index: ledgerIndex,
    transactions: true,
    expand: true,
  }) as ExpandedLedger;

  const ledger = result.ledger;
  const txs = (ledger.transactions ?? []) as RawLedgerTx[];

  const chRows: Record<string, string | number>[] = [];
  const chDexRows: Record<string, string | number>[] = [];
  const neo4jPayments: Array<Record<string, string | number>> = [];
  const neo4jTrades: Array<Record<string, string | number>> = [];
  const accountTimestamps = new Map<string, number>();

  for (const rawTx of txs) {
    if (rawTx.date == null) rawTx.date = ledger.close_time;
    if (rawTx.ledger_index == null) rawTx.ledger_index = ledger.ledger_index;

    const meta = rawTx.meta ?? rawTx.metaData;
    if (meta?.TransactionResult !== "tesSUCCESS") continue;

    const txDate = rawTx.date ?? ledger.close_time;
    const unixTs = txDate + RIPPLE_EPOCH;
    const isoDate = new Date(unixTs * 1000).toISOString().replace("T", " ").slice(0, 19);

    accountTimestamps.set(rawTx.Account, unixTs);
    if (rawTx.Destination) accountTimestamps.set(rawTx.Destination, unixTs);

    let memo = "";
    const memos = (rawTx as unknown as Record<string, unknown>).Memos as
      | Array<{ Memo?: { MemoData?: string } }> | undefined;
    if (memos?.[0]?.Memo?.MemoData) {
      try { memo = Buffer.from(memos[0].Memo.MemoData, "hex").toString("utf-8").slice(0, 500); } catch { /* skip */ }
    }

    const effectiveAmount = rawTx.TransactionType === "Payment" && meta?.delivered_amount
      ? meta.delivered_amount : rawTx.Amount;
    const parsed = parseAmount(effectiveAmount);

    if (chClient) {
      chRows.push({
        tx_hash: rawTx.hash, tx_type: rawTx.TransactionType,
        account: rawTx.Account, destination: rawTx.Destination ?? "",
        amount_drops: parsed.drops, currency: parsed.currency, issuer: parsed.issuer,
        fee_drops: Number(rawTx.Fee || "0"), timestamp: isoDate,
        ledger_index: ledger.ledger_index, result: "tesSUCCESS", memo,
      });
    }

    if (rawTx.TransactionType === "Payment" && rawTx.Destination && rawTx.Account !== rawTx.Destination) {
      const delivered = parseAmount(meta?.delivered_amount ?? rawTx.Amount);
      neo4jPayments.push({
        from: rawTx.Account, to: rawTx.Destination,
        amount: delivered.drops, currency: delivered.currency,
        timestamp: unixTs, tx_hash: rawTx.hash, ledger_index: ledger.ledger_index,
      });
    }

    if (rawTx.TransactionType === "OfferCreate") {
      const fills = extractTokenTrades(rawTx);
      for (const fill of fills) {
        if (fill.takerGetsCurrency === "XRP" && fill.takerPaysCurrency === "XRP") continue;
        const ts = fill.date + RIPPLE_EPOCH;
        const fillIso = new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
        const baseIsGets = fill.takerGetsCurrency !== "XRP";
        const baseCurrency = baseIsGets ? fill.takerGetsCurrency : fill.takerPaysCurrency;
        const baseIssuer = baseIsGets ? (fill.takerGetsIssuer ?? "") : (fill.takerPaysIssuer ?? "");
        const baseAmount = Number(baseIsGets ? fill.takerGetsValue : fill.takerPaysValue);
        const quoteCurrency = baseIsGets ? fill.takerPaysCurrency : fill.takerGetsCurrency;
        const quoteIssuer = baseIsGets ? (fill.takerPaysIssuer ?? "") : (fill.takerGetsIssuer ?? "");
        const quoteAmount = Number(baseIsGets ? fill.takerPaysValue : fill.takerGetsValue);
        const price = baseAmount > 0 ? quoteAmount / baseAmount : 0;

        if (chClient) {
          chDexRows.push({
            tx_hash: fill.txHash, timestamp: fillIso, ledger_index: fill.ledgerIndex,
            taker: fill.account, maker: fill.makerAccount ?? "",
            base_currency: baseCurrency, base_issuer: baseIssuer, base_amount: baseAmount,
            quote_currency: quoteCurrency, quote_issuer: quoteIssuer, quote_amount: quoteAmount,
            price, xrp_volume_drops: Number(fill.xrpVolumeDrops ?? 0),
          });
        }
        if (fill.makerAccount) {
          neo4jTrades.push({
            taker: fill.account, maker: fill.makerAccount,
            base_currency: baseCurrency, base_issuer: baseIssuer, base_amount: baseAmount,
            quote_currency: quoteCurrency, quote_issuer: quoteIssuer, quote_amount: quoteAmount,
            price, timestamp: ts, tx_hash: fill.txHash,
          });
          accountTimestamps.set(fill.account, ts);
          accountTimestamps.set(fill.makerAccount, ts);
        }
      }
    }
  }

  // Flush ClickHouse
  if (chClient) {
    if (chRows.length > 0) await chClient.insert({ table: "transactions", values: chRows, format: "JSONEachRow" });
    if (chDexRows.length > 0) await chClient.insert({ table: "dex_trades", values: chDexRows, format: "JSONEachRow" });
  }

  // Flush Neo4j
  const neoCount = neo4jPayments.length + neo4jTrades.length;
  if (neo4jDriver && neoCount > 0) {
    const session = neo4jDriver.session({ defaultAccessMode: neo4j.session.WRITE });
    try {
      const accounts = Array.from(accountTimestamps.entries()).map(([address, ts]) => ({ address, ts }));
      if (accounts.length > 0) {
        await session.run(
          `UNWIND $accounts AS a
           MERGE (acc:Account {address: a.address})
           ON CREATE SET acc.first_seen = a.ts, acc.last_active = a.ts
           ON MATCH SET acc.last_active = CASE WHEN a.ts > acc.last_active THEN a.ts ELSE acc.last_active END,
                        acc.first_seen = CASE WHEN a.ts < acc.first_seen THEN a.ts ELSE acc.first_seen END`,
          { accounts },
        );
      }
      if (neo4jPayments.length > 0) {
        await session.run(
          `UNWIND $payments AS p
           MATCH (from:Account {address: p.from}) MATCH (to:Account {address: p.to})
           CREATE (from)-[:PAYMENT {amount: p.amount, currency: p.currency, timestamp: p.timestamp, tx_hash: p.tx_hash, ledger_index: p.ledger_index}]->(to)`,
          { payments: neo4jPayments },
        );
      }
      if (neo4jTrades.length > 0) {
        await session.run(
          `UNWIND $trades AS t
           MATCH (taker:Account {address: t.taker}) MATCH (maker:Account {address: t.maker})
           CREATE (taker)-[:DEX_TRADE {base_currency: t.base_currency, base_issuer: t.base_issuer, base_amount: t.base_amount, quote_currency: t.quote_currency, quote_issuer: t.quote_issuer, quote_amount: t.quote_amount, price: t.price, timestamp: t.timestamp, tx_hash: t.tx_hash}]->(maker)`,
          { trades: neo4jTrades },
        );
      }
    } finally {
      await session.close();
    }
  }

  return { txs: txs.length, ch: chRows.length + chDexRows.length, neo: neoCount };
}

/* ── Main ── */

async function main() {
  console.log(`\nHistorical backfill — ${COUNT} oldest unprocessed ledgers\n`);
  console.log(`  ClickHouse: ${chClient ? "enabled" : "disabled"}`);
  console.log(`  Neo4j: ${neo4jDriver ? "enabled" : "disabled"}\n`);

  // Find the earliest ledger the intel pipeline has processed
  const [intelState] = await db
    .select()
    .from(schema.ingestionState)
    .where(dsql`${schema.ingestionState.key} = 'intel_latest_ledger'`)
    .limit(1);
  const intelLatest = intelState ? Number(intelState.value) : Infinity;

  // Also check if we've tracked an earliest intel ledger
  const [earliestState] = await db
    .select()
    .from(schema.ingestionState)
    .where(dsql`${schema.ingestionState.key} = 'intel_earliest_ledger'`)
    .limit(1);
  const intelEarliest = earliestState ? Number(earliestState.value) : intelLatest;

  // Get ledgers BEFORE the earliest intel-processed ledger (oldest first)
  const rows = await db
    .select({ ledgerIndex: schema.ingestedLedgers.ledgerIndex })
    .from(schema.ingestedLedgers)
    .where(dsql`${schema.ingestedLedgers.ledgerIndex} < ${intelEarliest}`)
    .orderBy(dsql`${schema.ingestedLedgers.ledgerIndex} DESC`)
    .limit(COUNT);

  if (rows.length === 0) {
    console.log("No historical ledgers to backfill.");
    await cleanup();
    return;
  }

  // Process newest-first (so we extend the contiguous range downward)
  const ledgers = rows.map((r) => r.ledgerIndex);
  console.log(`  Ledger range: ${ledgers[ledgers.length - 1]} → ${ledgers[0]}`);
  console.log(`  Total: ${ledgers.length}\n`);

  await connectXrpl();

  let processed = 0;
  let totalTxs = 0;
  let totalCH = 0;
  let totalNeo = 0;
  let lastSuccessfulLedger = 0;
  let consecutiveErrors = 0;
  const startTime = Date.now();

  for (const ledgerIndex of ledgers) {
    try {
      const stats = await processLedger(ledgerIndex);
      processed++;
      totalTxs += stats.txs;
      totalCH += stats.ch;
      totalNeo += stats.neo;
      lastSuccessfulLedger = ledgerIndex;
      consecutiveErrors = 0;

      if (processed % 50 === 0 || processed === ledgers.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (processed / (Number(elapsed) || 1)).toFixed(1);
        console.log(
          `  [${processed}/${ledgers.length}] ledger ${ledgerIndex} — ` +
          `${totalTxs} txs, ${totalCH} CH rows, ${totalNeo} Neo4j rels — ` +
          `${rate} ledgers/s (${elapsed}s)`,
        );
      }

      if (processed % 10 === 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      console.error(`  Error at ledger ${ledgerIndex}:`, err instanceof Error ? err.message : err);
      consecutiveErrors++;

      if (!ws || ws.readyState !== WS.OPEN) {
        console.log("  Reconnecting...");
        try {
          await connectXrpl();
          consecutiveErrors = 0;
        } catch {
          console.error("  Reconnection failed — aborting.");
          break;
        }
      }

      if (consecutiveErrors >= 10) {
        console.error("  10 consecutive errors — aborting.");
        break;
      }
    }
  }

  // Update the earliest intel ledger marker
  if (lastSuccessfulLedger > 0) {
    const earliest = ledgers[ledgers.length - 1]; // Smallest ledger index we attempted
    const actualEarliest = Math.min(earliest, lastSuccessfulLedger);
    await db
      .insert(schema.ingestionState)
      .values({ key: "intel_earliest_ledger", value: String(actualEarliest), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.ingestionState.key,
        set: {
          value: dsql`LEAST(${schema.ingestionState.value}::int, ${actualEarliest})::text`,
          updatedAt: new Date(),
        },
      });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nHistorical backfill complete: ${processed} ledgers in ${elapsed}s`);
  console.log(`  Transactions: ${totalTxs}`);
  console.log(`  ClickHouse rows: ${totalCH}`);
  console.log(`  Neo4j relationships: ${totalNeo}`);

  await cleanup();
}

async function cleanup() {
  ws?.close();
  if (neo4jDriver) await neo4jDriver.close();
  if (chClient) await chClient.close();
  await pg.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
