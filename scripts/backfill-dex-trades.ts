/**
 * Minimal historical backfill — writes only to ClickHouse dex_trades.
 *
 * The full intel historical backfill bundles Postgres + ClickHouse + Neo4j
 * writes and hit constant Neo4j deadlocks even with NEO4J_URI disabled
 * (something in the dependency graph kept talking to Neo4j). This script
 * strips everything to the minimum needed for smart money scoring:
 *
 *   XRPL WS → extractTokenTrades → dex_trades (ClickHouse)
 *
 * No Postgres writes inside the loop, no Neo4j at all, no intel-state
 * tracking. Run it overnight; stop with Ctrl+C whenever. Safe to re-run —
 * dex_trades is ReplacingMergeTree, dupes collapse on merge.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-dex-trades.ts [count] [--from=<ledger>]
 *
 * Arguments:
 *   count      Max ledgers to process (default: 100000)
 *   --from     Override starting ledger (default: derived from intel_earliest_ledger)
 *
 * Env: DATABASE_URL + CLICKHOUSE_URL from .env.local.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { createClient as createCH } from "@clickhouse/client";
import WS from "ws";
import { extractTokenTrades } from "../src/lib/trade-extractors";
import type { RawLedgerTx, ExpandedLedger } from "../src/types/ingestion";

/* ── Args ── */

const COUNT = Number(process.argv[2]) || 100000;
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const FROM_OVERRIDE = fromArg ? Number(fromArg.slice(7)) : null;

/* ── Config ── */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!CLICKHOUSE_URL) { console.error("CLICKHOUSE_URL required"); process.exit(1); }

const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";
const CH_BATCH_SIZE = 1000;
// honeycluster.io first — it's our full-history provider. Public nodes
// (s1/s2/xrplcluster) prune old ledgers, which is why the earlier run hit
// "lgrNotFound" on 97% of requests.
const XRPL_URLS = ["wss://honeycluster.io", "wss://xrplcluster.com", "wss://s2.ripple.com", "wss://s1.ripple.com"];

/* ── Clients ── */

const pg = postgres(DATABASE_URL, { max: 2, idle_timeout: 30 });
const ch = createCH({ url: CLICKHOUSE_URL, database: DATABASE, request_timeout: 120_000 });

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
        socket.on("close", () => {
          // Drop pending promises so reconnect can start fresh
          for (const { reject } of pending.values()) reject(new Error("socket closed"));
          pending.clear();
        });
        socket.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            const cb = pending.get(msg.id);
            if (!cb) return;
            pending.delete(msg.id);
            // XRPL error responses have status === "error" and no `result` field.
            // Surface them as rejections so the outer try/catch sees a clean
            // message rather than a downstream "cannot read properties" crash.
            if (msg.status === "error" || !msg.result) {
              cb.reject(new Error(msg.error_message ?? msg.error ?? "XRPL error response"));
              return;
            }
            cb.resolve(msg.result);
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
  if (!ws || ws.readyState !== WS.OPEN) throw new Error("WS not connected");
  const id = ++wsReqId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error("request timeout")); }, 20_000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    ws!.send(JSON.stringify({ ...command, id }));
  });
}

/* ── Ledger → dex_trades rows ── */

function buildDexRows(txs: RawLedgerTx[], ledgerCloseTime: number): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];

  for (const rawTx of txs) {
    if (rawTx.TransactionType !== "OfferCreate") continue;
    if (rawTx.date == null) rawTx.date = ledgerCloseTime;

    const fills = extractTokenTrades(rawTx);
    if (fills.length === 0) continue;

    for (const fill of fills) {
      // XRP/XRP trades are nonsense
      if (fill.takerGetsCurrency === "XRP" && fill.takerPaysCurrency === "XRP") continue;

      // Non-XRP side is base, XRP side is quote (matches intel-ingestion convention)
      const baseIsGets = fill.takerGetsCurrency !== "XRP";
      const baseCurrency = baseIsGets ? fill.takerGetsCurrency : fill.takerPaysCurrency;
      const baseIssuer = baseIsGets ? (fill.takerGetsIssuer ?? "") : (fill.takerPaysIssuer ?? "");
      const baseAmount = Number(baseIsGets ? fill.takerGetsValue : fill.takerPaysValue);

      const quoteCurrency = baseIsGets ? fill.takerPaysCurrency : fill.takerGetsCurrency;
      const quoteIssuer = baseIsGets ? (fill.takerPaysIssuer ?? "") : (fill.takerGetsIssuer ?? "");
      let quoteAmount = Number(baseIsGets ? fill.takerPaysValue : fill.takerGetsValue);

      // XRP values arrive as drops — convert so price is in XRP/token.
      if (quoteCurrency === "XRP") quoteAmount /= 1_000_000;

      const price = baseAmount > 0 ? quoteAmount / baseAmount : 0;
      const fillIso = fill.dateIso.toISOString().replace("T", " ").slice(0, 19);

      rows.push({
        tx_hash: fill.txHash,
        timestamp: fillIso,
        ledger_index: fill.ledgerIndex,
        taker: fill.account,
        maker: fill.makerAccount ?? "",
        base_currency: baseCurrency,
        base_issuer: baseIssuer,
        base_amount: baseAmount,
        quote_currency: quoteCurrency,
        quote_issuer: quoteIssuer,
        quote_amount: quoteAmount,
        price,
        xrp_volume_drops: fill.xrpVolumeDrops != null ? Number(fill.xrpVolumeDrops) : 0,
      });
    }
  }

  return rows;
}

async function flushBatch(batch: Record<string, string | number>[]): Promise<void> {
  if (batch.length === 0) return;
  await ch.insert({
    table: "dex_trades",
    values: batch,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, max_partitions_per_insert_block: 0 as unknown as string },
  });
}

/* ── Main ── */

async function main() {
  console.log(`\nDex-trades backfill — up to ${COUNT} ledgers\n`);

  // Find starting ledger: use --from or derive from intel_earliest_ledger
  let startLedger: number;
  if (FROM_OVERRIDE != null) {
    startLedger = FROM_OVERRIDE;
  } else {
    const [row] = await pg<{ value: string }[]>`
      SELECT value FROM ingestion_state WHERE key = 'intel_earliest_ledger' LIMIT 1
    `;
    if (!row) {
      console.error("No intel_earliest_ledger in ingestion_state — pass --from=<ledger> explicitly.");
      process.exit(1);
    }
    startLedger = Number(row.value);
  }

  // Pull ledger indexes we haven't processed yet (descending, newest first so
  // we extend the window backwards contiguously).
  const rows = await pg<{ ledger_index: number }[]>`
    SELECT ledger_index FROM ingested_ledgers
    WHERE ledger_index < ${startLedger}
    ORDER BY ledger_index DESC
    LIMIT ${COUNT}
  `;

  if (rows.length === 0) {
    console.log("No ledgers to backfill.");
    await cleanup();
    return;
  }

  const ledgers = rows.map((r) => r.ledger_index);
  console.log(`  Ledger range: ${ledgers[ledgers.length - 1]} → ${ledgers[0]}`);
  console.log(`  Total: ${ledgers.length}\n`);

  await connectXrpl();

  const batch: Record<string, string | number>[] = [];
  let processed = 0;
  let totalRows = 0;
  let consecutiveErrors = 0;
  let lowestLedger = ledgers[0];
  const startTime = Date.now();

  for (const ledgerIndex of ledgers) {
    try {
      const result = await xrplRequest({
        command: "ledger",
        ledger_index: ledgerIndex,
        transactions: true,
        expand: true,
      }) as ExpandedLedger;

      const ledger = result.ledger;
      const txs = (ledger.transactions ?? []) as RawLedgerTx[];
      const dexRows = buildDexRows(txs, ledger.close_time);

      for (const row of dexRows) batch.push(row);
      if (batch.length >= CH_BATCH_SIZE) {
        await flushBatch(batch);
        totalRows += batch.length;
        batch.length = 0;
      }

      processed++;
      consecutiveErrors = 0;
      lowestLedger = ledgerIndex;

      if (processed % 100 === 0 || processed === ledgers.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = ledgers.length - processed;
        const eta = rate > 0 ? remaining / rate : 0;
        console.log(
          `  [${processed}/${ledgers.length}] ledger ${ledgerIndex} — ` +
          `${totalRows + batch.length} rows — ${rate.toFixed(1)} ledgers/s — ` +
          `eta ${(eta / 60).toFixed(0)}m`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error at ledger ${ledgerIndex}: ${msg.slice(0, 200)}`);
      consecutiveErrors++;

      if (!ws || ws.readyState !== WS.OPEN) {
        console.log("  Reconnecting...");
        try {
          await connectXrpl();
          consecutiveErrors = 0;
        } catch {
          console.error("  Reconnection failed — flushing and aborting.");
          break;
        }
      }

      if (consecutiveErrors >= 20) {
        console.error("  20 consecutive errors — flushing and aborting.");
        break;
      }
    }
  }

  // Final flush
  try {
    await flushBatch(batch);
    totalRows += batch.length;
  } catch (err) {
    console.error("  Final flush failed:", err instanceof Error ? err.message : err);
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n  Done. ${processed} ledgers processed in ${(elapsed / 60).toFixed(1)}m`);
  console.log(`  Wrote ${totalRows} dex_trades rows. Lowest ledger: ${lowestLedger}`);

  // Advance the marker so subsequent runs pick up where we left off.
  if (FROM_OVERRIDE == null && processed > 0) {
    await pg`
      INSERT INTO ingestion_state (key, value, updated_at)
      VALUES ('intel_earliest_ledger', ${String(lowestLedger)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
    console.log(`  Updated intel_earliest_ledger → ${lowestLedger}`);
  }

  await cleanup();
}

async function cleanup() {
  if (ws) { ws.close(); ws = null; }
  await ch.close();
  await pg.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  await cleanup().catch(() => {});
  process.exit(1);
});
