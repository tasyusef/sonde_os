/**
 * Smoketest for value_transfer_events extraction.
 *
 * Pulls a sample of Payment, AccountDelete, and CheckCash txs from
 * sonde.transactions, runs them through classifyLedger, and inspects
 * the chValueTransferEvents output.
 *
 * Usage: NODE_OPTIONS="--conditions react-server" npx tsx scripts/test-value-transfer-events.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { classifyLedger } from "@/lib/intel-ingestion";
import type { RawLedgerTx, ExpandedLedger } from "@/types/ingestion";

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("CLICKHOUSE_URL required");
  process.exit(1);
}

const ch = createClient({ url, database: "sonde", request_timeout: 30_000 });

async function fetchTx(txHash: string): Promise<RawLedgerTx | null> {
  const result = await ch.query({
    query: `SELECT tx_hash, tx_type, ledger_index, timestamp, tx_json, meta_json
            FROM sonde.transactions
            WHERE tx_hash = '${txHash}'
            LIMIT 1`,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{
    tx_hash: string;
    tx_type: string;
    ledger_index: number;
    timestamp: string;
    tx_json: string;
    meta_json: string;
  }>;
  const r = rows[0];
  if (!r) return null;
  const tx = JSON.parse(r.tx_json) as Record<string, unknown>;
  const meta = JSON.parse(r.meta_json);
  return {
    ...tx,
    hash: r.tx_hash,
    ledger_index: r.ledger_index,
    meta,
  } as unknown as RawLedgerTx;
}

async function runSample(label: string, query: string) {
  console.log(`\n[${label}]`);
  const result = await ch.query({ query, format: "JSONEachRow" });
  const samples = (await result.json()) as Array<{ tx_hash: string }>;
  console.log(`  found ${samples.length} samples`);

  for (const s of samples) {
    const tx = await fetchTx(s.tx_hash);
    if (!tx) continue;
    const ledger: ExpandedLedger = {
      ledger: {
        ledger_index: 1,
        close_time: 700_000_000,
        total_coins: "100000000000000000",
        transactions: [tx],
      },
    };
    const classified = classifyLedger(ledger);
    if (!classified) {
      console.log(`  [skip] classifyLedger returned null for ${s.tx_hash.slice(0, 12)}`);
      continue;
    }
    const events = classified.chValueTransferEvents;
    console.log(`  tx=${s.tx_hash.slice(0, 16)}... → ${events.length} value events`);
    for (const e of events) {
      const amt = e.amount_iou
        ? e.amount_iou.slice(0, 80) + (e.amount_iou.length > 80 ? "..." : "")
        : `${e.amount_drops} drops`;
      console.log(
        `    ${e.transfer_kind}: ${e.from_account.slice(0, 16)} → ${e.to_account.slice(0, 16)}  ${amt}`,
      );
    }
  }
}

async function main() {
  console.log("=== value_transfer_events extraction smoketest ===");

  await runSample(
    "Payment (XRP)",
    `SELECT tx_hash FROM sonde.transactions
     WHERE tx_type = 'Payment' AND result = 'tesSUCCESS' AND currency = 'XRP'
       AND ledger_index > 103860000 LIMIT 3`,
  );

  await runSample(
    "Payment (IOU, non-self)",
    `SELECT tx_hash FROM sonde.transactions
     WHERE tx_type = 'Payment' AND result = 'tesSUCCESS' AND currency != 'XRP' AND currency != ''
       AND account != destination
       AND ledger_index > 103860000 LIMIT 3`,
  );

  await runSample(
    "AccountDelete",
    `SELECT tx_hash FROM sonde.transactions
     WHERE tx_type = 'AccountDelete' AND result = 'tesSUCCESS'
     LIMIT 3`,
  );

  await runSample(
    "CheckCash",
    `SELECT tx_hash FROM sonde.transactions
     WHERE tx_type = 'CheckCash' AND result = 'tesSUCCESS'
     LIMIT 3`,
  );

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
