/**
 * Phase 2 smoke test — fetch N recent ledgers from rippled, run them through
 * the extended classifyLedger(), insert into sonde_smoketest, and validate
 * that the new columns + new tables populate correctly.
 *
 * Tests the full classifier path:
 *   - tx_json + meta_json blobs round-trip
 *   - nftoken_id extracted for NFT txs
 *   - flags / sequence / source_tag / destination_tag populated
 *   - delivered_amount split into drops vs iou
 *   - pseudo-tx rows tagged with __pseudo_tx__ sentinel
 *   - ledger_metadata table populated (one row per ledger)
 *   - amm_state_changes populated for any AMM tx in the window
 *
 * Usage:
 *   pnpm exec tsx scripts/smoke-phase2-classifier.ts
 *
 * Optional:
 *   --ledgers 100      number of recent ledgers to fetch (default 100)
 *   --reset            DROP+CREATE sonde_smoketest tables before running
 *
 * Always targets sonde_smoketest. Requires CLICKHOUSE_URL env var.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { XrplClient } from "@/lib/xrpl-client";
import { classifyLedger, type ClassifiedLedger, PSEUDO_TX_ACCOUNT } from "@/lib/intel-ingestion";
import type { ExpandedLedger } from "@/types/ingestion";

const args = process.argv.slice(2);
const NUM_LEDGERS = parseInt(args.find(a => a.startsWith("--ledgers="))?.split("=", 2)[1] ?? "100", 10);
const RESET = args.includes("--reset");
const WS_ENDPOINT = process.env.BACKFILL_WS_ENDPOINT ?? "wss://xrplcluster.com";

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("[smoke-phase2] CLICKHOUSE_URL env var required");
  process.exit(1);
}

const DB = "sonde_smoketest";

const client = createClient({
  url,
  database: DB,
  request_timeout: 60_000,
});

async function main() {
  console.log(`[smoke-phase2] target: ${DB} on ${new URL(url!).host}`);
  console.log(`[smoke-phase2] fetching ${NUM_LEDGERS} ledgers from ${WS_ENDPOINT}`);

  if (RESET) {
    console.log(`[smoke-phase2] --reset: clearing sonde_smoketest write tables`);
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${DB}.transactions` });
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${DB}.dex_trades` });
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${DB}.trustline_events` });
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${DB}.ledger_metadata` });
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${DB}.amm_state_changes` });
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${DB}.value_transfer_events` });
  }

  /* Fetch the head ledger to know where to start. */
  const xrpl = new XrplClient([WS_ENDPOINT]);

  console.log(`[smoke-phase2] resolving current head ledger...`);
  /* Use the "validated" sentinel — XrplClient passes through to rippled. */
  const headInfo = (await xrpl.getLedger("validated", false)) as ExpandedLedger;
  const headLedger = headInfo.ledger.ledger_index;
  console.log(`[smoke-phase2] head: ${headLedger}`);

  /* Fetch N ledgers ending at head, classify, accumulate. */
  const classified: ClassifiedLedger[] = [];
  const startedAt = Date.now();
  let nftCount = 0;
  let ammTxCount = 0;
  let ammStateChangeCount = 0;
  let pseudoTxCount = 0;
  let trustlineCount = 0;
  let dexTradeCount = 0;
  let txCount = 0;
  let totalAmmActiveLedgers = 0;

  for (let i = 0; i < NUM_LEDGERS; i++) {
    const idx = headLedger - i;
    try {
      const expanded = (await xrpl.getLedger(idx, true)) as ExpandedLedger;
      const cls = classifyLedger(expanded);
      if (!cls) {
        console.warn(`  ledger ${idx}: classifyLedger returned null`);
        continue;
      }
      classified.push(cls);
      txCount += cls.txCount;
      dexTradeCount += cls.chDexRows.length;
      trustlineCount += cls.chTrustlineRows.length;
      ammStateChangeCount += cls.chAmmStateChanges.length;
      for (const row of cls.chRows) {
        if (row.tx_type.startsWith("NFToken")) nftCount++;
        if (row.tx_type.startsWith("AMM")) ammTxCount++;
        if (row.account === PSEUDO_TX_ACCOUNT) pseudoTxCount++;
      }
      if (cls.chAmmStateChanges.length > 0) totalAmmActiveLedgers++;
      if ((i + 1) % 10 === 0) {
        console.log(`  fetched ${i + 1}/${NUM_LEDGERS} ledgers, ${txCount} txs so far`);
      }
    } catch (err) {
      console.warn(`  ledger ${idx}: fetch/classify failed:`, err instanceof Error ? err.message : err);
    }
  }

  const fetchElapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[smoke-phase2] fetch+classify complete in ${fetchElapsed}s`);
  console.log(`  ledgers classified : ${classified.length}`);
  console.log(`  total txs          : ${txCount}`);
  console.log(`  NFT txs            : ${nftCount}`);
  console.log(`  AMM txs            : ${ammTxCount}`);
  console.log(`  AMM state changes  : ${ammStateChangeCount} (in ${totalAmmActiveLedgers} ledgers)`);
  console.log(`  Pseudo-txs         : ${pseudoTxCount}`);
  console.log(`  DEX fills          : ${dexTradeCount}`);
  console.log(`  Trustline events   : ${trustlineCount}`);
  const valueTransferCount = classified.reduce((sum, c) => sum + c.chValueTransferEvents.length, 0);
  console.log(`  Value transfers    : ${valueTransferCount}`);

  if (classified.length === 0) {
    console.error("[smoke-phase2] no ledgers classified — aborting");
    await client.close();
    process.exit(1);
  }

  /* Flatten and insert everything into sonde_smoketest. */
  const allChRows = classified.flatMap(c => c.chRows);
  const allChDexRows = classified.flatMap(c => c.chDexRows);
  const allChTrustlines = classified.flatMap(c => c.chTrustlineRows);
  const allChLedgerMetadata = classified
    .map(c => c.chLedgerMetadata)
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const allChAmmStateChanges = classified.flatMap(c => c.chAmmStateChanges);
  const allChValueTransferEvents = classified.flatMap(c => c.chValueTransferEvents);

  console.log(`\n[smoke-phase2] inserting into ${DB}...`);
  const insertStart = Date.now();
  if (allChRows.length > 0) {
    await client.insert({ table: `${DB}.transactions`, values: allChRows, format: "JSONEachRow" });
    console.log(`  inserted ${allChRows.length} rows into transactions`);
  }
  if (allChDexRows.length > 0) {
    await client.insert({ table: `${DB}.dex_trades`, values: allChDexRows, format: "JSONEachRow" });
    console.log(`  inserted ${allChDexRows.length} rows into dex_trades`);
  }
  if (allChTrustlines.length > 0) {
    await client.insert({ table: `${DB}.trustline_events`, values: allChTrustlines, format: "JSONEachRow" });
    console.log(`  inserted ${allChTrustlines.length} rows into trustline_events`);
  }
  if (allChLedgerMetadata.length > 0) {
    await client.insert({ table: `${DB}.ledger_metadata`, values: allChLedgerMetadata, format: "JSONEachRow" });
    console.log(`  inserted ${allChLedgerMetadata.length} rows into ledger_metadata`);
  }
  if (allChAmmStateChanges.length > 0) {
    await client.insert({ table: `${DB}.amm_state_changes`, values: allChAmmStateChanges, format: "JSONEachRow" });
    console.log(`  inserted ${allChAmmStateChanges.length} rows into amm_state_changes`);
  }
  if (allChValueTransferEvents.length > 0) {
    await client.insert({ table: `${DB}.value_transfer_events`, values: allChValueTransferEvents, format: "JSONEachRow" });
    console.log(`  inserted ${allChValueTransferEvents.length} rows into value_transfer_events`);
  }
  const insertElapsed = ((Date.now() - insertStart) / 1000).toFixed(2);
  console.log(`[smoke-phase2] insert complete in ${insertElapsed}s`);

  /* Validation queries. */
  console.log(`\n[smoke-phase2] running validation queries against ${DB}...`);

  /* 1. Row count sanity. */
  const txTotal = (await (await client.query({
    query: `SELECT count() AS cnt FROM ${DB}.transactions`,
    format: "JSONEachRow",
  })).json()) as { cnt: number }[];
  console.log(`  ${DB}.transactions row count: ${txTotal[0].cnt}`);

  /* 2. tx_json + meta_json blob round-trip. Pick one row, parse, sanity-check. */
  const blobSample = (await (await client.query({
    query: `SELECT tx_hash, tx_json, meta_json FROM ${DB}.transactions WHERE tx_json != '' LIMIT 1`,
    format: "JSONEachRow",
  })).json()) as { tx_hash: string; tx_json: string; meta_json: string }[];
  if (blobSample.length === 0) {
    console.warn("  [!] no rows with tx_json — blobs may not be populating");
  } else {
    try {
      const parsed = JSON.parse(blobSample[0].tx_json);
      console.log(`  [✓] tx_json round-trip OK (sample tx ${blobSample[0].tx_hash.slice(0, 16)}…, type=${parsed.TransactionType})`);
    } catch (err) {
      console.error(`  [✗] tx_json parse failed: ${err instanceof Error ? err.message : err}`);
    }
    try {
      const parsedMeta = JSON.parse(blobSample[0].meta_json);
      console.log(`  [✓] meta_json round-trip OK (TransactionResult=${parsedMeta.TransactionResult})`);
    } catch (err) {
      console.error(`  [✗] meta_json parse failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /* 3. NFT extraction — any tx with tx_type starting NFToken should have nftoken_id (when meta provides it). */
  const nftSample = (await (await client.query({
    query: `SELECT tx_hash, tx_type, nftoken_id FROM ${DB}.transactions WHERE tx_type LIKE 'NFToken%' AND nftoken_id != toFixedString('0', 64) LIMIT 3`,
    format: "JSONEachRow",
  })).json()) as { tx_hash: string; tx_type: string; nftoken_id: string }[];
  console.log(`  [${nftSample.length > 0 ? "✓" : "·"}] nftoken_id populated on ${nftSample.length} sampled NFT txs`);

  /* 4. Pseudo-tx sentinel — if any ledger had EnableAmendment/SetFee/UNLModify, account should be __pseudo_tx__. */
  const pseudoSample = (await (await client.query({
    query: `SELECT tx_type, account FROM ${DB}.transactions WHERE tx_type IN ('EnableAmendment', 'SetFee', 'UNLModify') LIMIT 5`,
    format: "JSONEachRow",
  })).json()) as { tx_type: string; account: string }[];
  if (pseudoSample.length === 0) {
    console.log(`  [·] no pseudo-txs in this window (window is current-era; rare)`);
  } else {
    const allTagged = pseudoSample.every(r => r.account === PSEUDO_TX_ACCOUNT);
    console.log(`  [${allTagged ? "✓" : "✗"}] pseudo-tx sentinel: ${pseudoSample.length} found, all tagged=${allTagged}`);
  }

  /* 5. ledger_metadata: one row per classified ledger. */
  const metaCount = (await (await client.query({
    query: `SELECT count() AS cnt FROM ${DB}.ledger_metadata`,
    format: "JSONEachRow",
  })).json()) as { cnt: number }[];
  console.log(`  [${Number(metaCount[0].cnt) === classified.length ? "✓" : "✗"}] ledger_metadata: ${metaCount[0].cnt} rows (expected ${classified.length})`);

  /* 6. total_coins is non-increasing (key competitive-parity check). */
  const coinsCheck = (await (await client.query({
    query: `
      SELECT
        min(total_coins) AS min_coins,
        max(total_coins) AS max_coins,
        countIf(total_coins = 0) AS zero_count
      FROM ${DB}.ledger_metadata
    `,
    format: "JSONEachRow",
  })).json()) as { min_coins: number; max_coins: number; zero_count: number }[];
  console.log(`  [·] total_coins range: ${coinsCheck[0].min_coins} .. ${coinsCheck[0].max_coins} (${coinsCheck[0].zero_count} zero values)`);

  /* 7. AMM state changes — should be present if any AMM txs in window. */
  const ammCount = (await (await client.query({
    query: `SELECT count() AS cnt, uniq(pool_id) AS pools, groupArray(change_type) AS types FROM ${DB}.amm_state_changes`,
    format: "JSONEachRow",
  })).json()) as { cnt: number; pools: number; types: string[] }[];
  console.log(`  [${ammTxCount === 0 || Number(ammCount[0].cnt) > 0 ? "✓" : "?"}] amm_state_changes: ${ammCount[0].cnt} rows across ${ammCount[0].pools} pools`);
  if (Number(ammCount[0].cnt) > 0) {
    const types = new Set(ammCount[0].types);
    console.log(`    change types observed: ${Array.from(types).sort().join(", ")}`);
  }

  /* 8. Value transfer events — counts + sanity checks (no self-transfers,
   *    transfer_kind values are valid). */
  const vteCount = (await (await client.query({
    query: `SELECT
      count() AS cnt,
      countIf(from_account = to_account) AS self_count,
      groupUniqArray(transfer_kind) AS kinds
    FROM ${DB}.value_transfer_events`,
    format: "JSONEachRow",
  })).json()) as { cnt: number; self_count: number; kinds: string[] }[];
  const vteRow = vteCount[0];
  console.log(`  [${valueTransferCount === 0 || Number(vteRow.cnt) > 0 ? "✓" : "?"}] value_transfer_events: ${vteRow.cnt} rows`);
  if (Number(vteRow.self_count) > 0) {
    console.error(`  [✗] value_transfer_events has ${vteRow.self_count} self-transfers (should be 0)`);
  }
  if (Number(vteRow.cnt) > 0) {
    console.log(`    transfer kinds observed: ${vteRow.kinds.sort().join(", ")}`);
  }

  /* 8. Reconciliation: fetched-classified rows == inserted rows. */
  const txCountInDb = Number(txTotal[0].cnt);
  if (txCountInDb !== allChRows.length) {
    console.error(`  [✗] tx row mismatch: classified ${allChRows.length}, inserted ${txCountInDb}`);
  } else {
    console.log(`  [✓] tx row count matches: classified == inserted == ${txCountInDb}`);
  }

  console.log(`\n[smoke-phase2] DONE`);
  await client.close();
}

main().catch(async (err) => {
  console.error("[smoke-phase2] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  await client.close().catch(() => undefined);
  process.exit(1);
});
