/**
 * Backfill ClickHouse only (skip Neo4j) against a remote instance.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-clickhouse-only.ts [count]
 *
 * Requires .env.local with DATABASE_URL and CLICKHOUSE_URL (with credentials).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as dsql } from "drizzle-orm";
import { createClient as createCH } from "@clickhouse/client";
import WS from "ws";
import * as schema from "../src/db/schema";
import type { RawLedgerTx, ExpandedLedger, CurrencyAmount } from "../src/types/ingestion";
import { extractTokenTrades } from "../src/lib/trade-extractors";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!CLICKHOUSE_URL) { console.error("CLICKHOUSE_URL required"); process.exit(1); }

const COUNT = Number(process.argv[2]) || 10000;
const RIPPLE_EPOCH = 946684800;

const XRPL_URLS = [
  "wss://s1.ripple.com",
  "wss://s2.ripple.com",
  "wss://xrplcluster.com",
];

const pg = postgres(DATABASE_URL, { max: 5, idle_timeout: 30 });
const db = drizzle(pg, { schema });
const chClient = createCH({
  url: CLICKHOUSE_URL,
  database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
});

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
        socket.on("error", () => { clearTimeout(timeout); reject(new Error("error")); });
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

async function xrplRequest(cmd: Record<string, unknown>): Promise<unknown> {
  if (!ws || ws.readyState !== WS.OPEN) throw new Error("Not connected");
  const id = ++wsReqId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error("timeout")); }, 30_000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    ws!.send(JSON.stringify({ ...cmd, id }));
  });
}

function parseAmount(amount: string | CurrencyAmount | undefined): { drops: number; currency: string; issuer: string } {
  if (!amount) return { drops: 0, currency: "XRP", issuer: "" };
  if (typeof amount === "string") return { drops: Number(amount), currency: "XRP", issuer: "" };
  const raw = Number(amount.value);
  return { drops: Number.isFinite(raw) ? Math.trunc(Math.min(Math.max(raw, -9e18), 9e18)) : 0, currency: amount.currency, issuer: amount.issuer };
}

async function processLedger(ledgerIndex: number): Promise<number> {
  const result = await xrplRequest({ command: "ledger", ledger_index: ledgerIndex, transactions: true, expand: true }) as ExpandedLedger;
  const ledger = result?.ledger;
  if (!ledger || !ledger.transactions) return 0; // Node doesn't have this ledger expanded
  const txs = ledger.transactions as RawLedgerTx[];

  const chRows: Record<string, string | number>[] = [];
  const chDexRows: Record<string, string | number>[] = [];

  for (const rawTx of txs) {
    if (rawTx.date == null) rawTx.date = ledger.close_time;
    if (rawTx.ledger_index == null) rawTx.ledger_index = ledger.ledger_index;
    const meta = rawTx.meta ?? rawTx.metaData;
    if (meta?.TransactionResult !== "tesSUCCESS") continue;

    const txDate = rawTx.date ?? ledger.close_time;
    const unixTs = txDate + RIPPLE_EPOCH;
    const isoDate = new Date(unixTs * 1000).toISOString().replace("T", " ").slice(0, 19);

    let memo = "";
    const memos = (rawTx as unknown as Record<string, unknown>).Memos as Array<{ Memo?: { MemoData?: string } }> | undefined;
    if (memos?.[0]?.Memo?.MemoData) {
      try { memo = Buffer.from(memos[0].Memo.MemoData, "hex").toString("utf-8").slice(0, 500); } catch { /* skip */ }
    }

    // Use delivered_amount for Payments (Amount can be "send max" in partial payments)
    const effectiveAmount = rawTx.TransactionType === "Payment" && meta?.delivered_amount
      ? meta.delivered_amount : rawTx.Amount;
    const parsed = parseAmount(effectiveAmount);
    chRows.push({
      tx_hash: rawTx.hash, tx_type: rawTx.TransactionType,
      account: rawTx.Account, destination: rawTx.Destination ?? "",
      amount_drops: parsed.drops, currency: parsed.currency, issuer: parsed.issuer,
      fee_drops: Number(rawTx.Fee || "0"), timestamp: isoDate,
      ledger_index: ledger.ledger_index, result: "tesSUCCESS", memo,
    });

    if (rawTx.TransactionType === "OfferCreate") {
      const fills = extractTokenTrades(rawTx);
      for (const fill of fills) {
        if (fill.takerGetsCurrency === "XRP" && fill.takerPaysCurrency === "XRP") continue;
        const ts = fill.date + RIPPLE_EPOCH;
        const fillIso = new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
        const baseIsGets = fill.takerGetsCurrency !== "XRP";
        const bC = baseIsGets ? fill.takerGetsCurrency : fill.takerPaysCurrency;
        const bI = baseIsGets ? (fill.takerGetsIssuer ?? "") : (fill.takerPaysIssuer ?? "");
        const bA = Number(baseIsGets ? fill.takerGetsValue : fill.takerPaysValue);
        const qC = baseIsGets ? fill.takerPaysCurrency : fill.takerGetsCurrency;
        const qI = baseIsGets ? (fill.takerPaysIssuer ?? "") : (fill.takerGetsIssuer ?? "");
        const qA = Number(baseIsGets ? fill.takerPaysValue : fill.takerGetsValue);
        chDexRows.push({
          tx_hash: fill.txHash, timestamp: fillIso, ledger_index: fill.ledgerIndex,
          taker: fill.account, maker: fill.makerAccount ?? "",
          base_currency: bC, base_issuer: bI, base_amount: bA,
          quote_currency: qC, quote_issuer: qI, quote_amount: qA,
          price: bA > 0 ? qA / bA : 0, xrp_volume_drops: Number(fill.xrpVolumeDrops ?? 0),
        });
      }
    }
  }

  if (chRows.length > 0) await chClient.insert({ table: "transactions", values: chRows, format: "JSONEachRow" });
  if (chDexRows.length > 0) await chClient.insert({ table: "dex_trades", values: chDexRows, format: "JSONEachRow" });

  return chRows.length + chDexRows.length;
}

async function main() {
  console.log(`\nClickHouse-only backfill — ${COUNT} ledgers\n`);

  // Get ledgers to process (most recent first, skip already-done)
  const [chState] = await db.select().from(schema.ingestionState)
    .where(dsql`${schema.ingestionState.key} = 'ch_backfill_latest'`).limit(1);
  const lastDone = chState ? Number(chState.value) : 0;

  const rows = await db.select({ ledgerIndex: schema.ingestedLedgers.ledgerIndex })
    .from(schema.ingestedLedgers)
    .where(lastDone > 0 ? dsql`${schema.ingestedLedgers.ledgerIndex} > ${lastDone}` : dsql`1 = 1`)
    .orderBy(dsql`${schema.ingestedLedgers.ledgerIndex} DESC`)
    .limit(COUNT);

  if (rows.length === 0) { console.log("Nothing to backfill."); await cleanup(); return; }

  const ledgers = rows.map(r => r.ledgerIndex).reverse();
  console.log(`  Range: ${ledgers[0]} → ${ledgers[ledgers.length - 1]} (${ledgers.length} ledgers)\n`);

  await connectXrpl();

  let processed = 0, totalRows = 0, lastOk = 0, errors = 0;
  const start = Date.now();

  for (const idx of ledgers) {
    try {
      const rows = await processLedger(idx);
      processed++; totalRows += rows; lastOk = idx; errors = 0;
      if (processed % 100 === 0 || processed === ledgers.length) {
        const s = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  [${processed}/${ledgers.length}] ledger ${idx} — ${totalRows} rows — ${(processed / (Number(s) || 1)).toFixed(1)}/s (${s}s)`);
      }
      // Rate limit: 200ms between each request to avoid hammering the node
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`  Error ${idx}:`, err instanceof Error ? err.message : err);
      errors++;
      if (!ws || ws.readyState !== WS.OPEN) {
        try { await connectXrpl(); errors = 0; } catch { console.error("  Reconnect failed"); break; }
      }
      if (errors >= 10) { console.error("  10 consecutive errors, stopping."); break; }
    }
  }

  if (lastOk > 0) {
    await db.insert(schema.ingestionState)
      .values({ key: "ch_backfill_latest", value: String(lastOk), updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.ingestionState.key, set: { value: String(lastOk), updatedAt: new Date() } });
  }

  console.log(`\nDone: ${processed} ledgers, ${totalRows} CH rows in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  await cleanup();
}

async function cleanup() {
  ws?.close();
  await chClient.close();
  await pg.end();
}

main().catch(e => { console.error(e); process.exit(1); });
