/**
 * Slice-5a smoketest: pull representative txs from prod CH, run them
 * through `extractAccountTxIndex`, eyeball the output.
 *
 * Picks one tx of each interesting shape:
 *   - OfferCreate (tests offer_owner extraction from crossed offers)
 *   - AMMDeposit  (tests amm_lp via RippleState peer detection)
 *   - Payment    (tests trustline_peer + account_root_modified for any
 *                  intermediate accounts touched)
 *
 * Usage: `pnpm exec tsx scripts/verify-account-index-extractor.ts`
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { extractAccountTxIndex } from "@/lib/account-index-extractor";
import type { RawLedgerTx } from "@/types/ingestion";

const client = createClient({
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
  request_timeout: 120_000,
});

async function query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const result = await client.query({ query: sql, query_params: params, format: "JSONEachRow" });
  return (await result.json()) as T[];
}

interface TxRow extends Record<string, unknown> {
  tx_hash: string;
  tx_type: string;
  account: string;
  destination: string;
  ledger_index: number;
  ts: number | string;
  tx_json: string;
  meta_json: string;
}

async function fetchSample(txType: string, extra = ""): Promise<TxRow | null> {
  // Partition filter to current month, plus an AffectedNodes-richness
  // filter so we don't pick a degenerate no-op tx (idempotent TrustSet,
  // direct Payment with no path-finding, OfferCreate that didn't
  // cross). Length probe is approximate (counts node objects within
  // the array literal) but good enough for filtering.
  const rows = await query<TxRow>(
    `SELECT tx_hash, tx_type, account, destination, ledger_index,
            toUnixTimestamp(timestamp) AS ts, tx_json, meta_json
     FROM transactions
     WHERE tx_type = {tx_type:String}
       AND result = 'tesSUCCESS'
       AND tx_json != ''
       AND meta_json != ''
       AND timestamp >= now() - INTERVAL 1 DAY
       AND length(JSONExtractArrayRaw(meta_json, 'AffectedNodes')) >= 5
       ${extra}
     ORDER BY timestamp DESC
     LIMIT 1`,
    { tx_type: txType },
  );
  return rows[0] ?? null;
}

function reconstructRawTx(row: TxRow): RawLedgerTx {
  const tx = JSON.parse(row.tx_json) as Record<string, unknown>;
  const meta = JSON.parse(row.meta_json) as Record<string, unknown>;
  return {
    ...(tx as unknown as RawLedgerTx),
    hash: row.tx_hash,
    Account: row.account,
    Destination: row.destination || undefined,
    TransactionType: row.tx_type,
    ledger_index: row.ledger_index,
    meta: meta as unknown as RawLedgerTx["meta"],
  };
}

async function fetchByHash(txHash: string): Promise<TxRow | null> {
  const rows = await query<TxRow>(
    `SELECT tx_hash, tx_type, account, destination, ledger_index,
            toUnixTimestamp(timestamp) AS ts, tx_json, meta_json
     FROM transactions
     WHERE tx_hash = {hash:String}
     LIMIT 1`,
    { hash: txHash },
  );
  return rows[0] ?? null;
}

async function main() {
  const samples = [
    { label: "OfferCreate (DEX trader, offer crossings expected)", type: "OfferCreate" },
    { label: "AMMDeposit (LP + RippleState peer expected)", type: "AMMDeposit" },
    { label: "Payment (trustline_peer / account_root via path-finding)", type: "Payment" },
    { label: "TrustSet (trustline_peer expected)", type: "TrustSet" },
  ];

  for (const s of samples) {
    console.log(`\n=== ${s.label} ===`);
    const row = await fetchSample(s.type);
    if (!row) {
      console.log(`  no recent ${s.type} found, skipping`);
      continue;
    }

    const rawTx = reconstructRawTx(row);
    const ts = typeof row.ts === "string" ? Number(row.ts) : row.ts;
    // ledger.close_time is XRPL epoch (post-2000) — derive from the
    // unix `ts` we read by subtracting the offset.
    const closeTime = ts - 946_684_800;

    console.log(`  tx_hash:        ${row.tx_hash}`);
    console.log(`  ledger_index:   ${row.ledger_index}`);
    console.log(`  Account:        ${row.account}`);
    console.log(`  Destination:    ${row.destination || "(none)"}`);

    const result = extractAccountTxIndex(rawTx, {
      ledger_index: row.ledger_index,
      close_time: closeTime,
    });

    console.log(`  rows extracted: ${result.length}`);
    for (const r of result) {
      console.log(
        `    [${r.role.padEnd(24)}] ${r.account}`,
      );
    }

    // Sanity: confirm we never emit the tx Account or Destination as
    // an account_tx_index row — those should be excluded.
    const wrongHits = result.filter(
      (r) => r.account === row.account || r.account === row.destination,
    );
    if (wrongHits.length > 0) {
      console.error(
        `  ❌ BUG: extractor emitted rows for sender/destination — exclude set isn't working`,
      );
      console.error(wrongHits);
    }
  }

  // Regression check: a Payment from earlier smoketest that had a real
  // path-finding offer crossing. Pre-fix it produced 4 rows (offer_owner
  // + account_root_modified + 2 trustline_peer for rJ4Ep / rhvf9). The
  // issuer-side / AMM filters in the fix should NOT remove the
  // offer_owner / account_root_modified rows — those are legitimate
  // AffectedNodes-only relationships. Trustline rows might be filtered
  // if either side is an IOU issuer.
  console.log(`\n=== Regression check: known offer-crossing Payment ===`);
  const known = await fetchByHash(
    "2D46149BAFF1F4788449404F66E79D01DCC6177129A818F19A91BEC5E8D736EB",
  );
  if (!known) {
    console.log(`  not found (older than backfill window or replaced)`);
  } else {
    const rawTx = reconstructRawTx(known);
    const ts = typeof known.ts === "string" ? Number(known.ts) : known.ts;
    const closeTime = ts - 946_684_800;
    console.log(`  tx_hash: ${known.tx_hash}`);
    const result = extractAccountTxIndex(rawTx, {
      ledger_index: known.ledger_index,
      close_time: closeTime,
    });
    console.log(`  rows extracted: ${result.length}`);
    for (const r of result) {
      console.log(`    [${r.role.padEnd(24)}] ${r.account}`);
    }
    if (result.length === 0) {
      console.warn(
        `  ⚠️  zero rows on a known offer-crossing Payment — fix may be over-filtering`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("verify-account-index-extractor failed:", err);
    process.exit(1);
  });
