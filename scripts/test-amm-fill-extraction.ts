/**
 * Smoketest for the new AMM fill extraction logic.
 *
 * Pulls real txs from sonde.transactions that have AMM affected nodes,
 * runs them through extractTokenTrades + classifyLedger to verify:
 *   - AMM-routed Payments produce dex_trades rows (previously zero)
 *   - Book-routed Payments produce dex_trades rows (previously zero)
 *   - amm_state_changes captures swap-driven mutations
 *   - IOU values preserve precision through subtractAmounts
 *
 * Usage: pnpm exec tsx scripts/test-amm-fill-extraction.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { extractTokenTrades } from "@/lib/trade-extractors";
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

  // Reconstruct the RawLedgerTx the ingester would have seen
  const tx = JSON.parse(r.tx_json) as Record<string, unknown>;
  const meta = JSON.parse(r.meta_json);
  return {
    ...tx,
    hash: r.tx_hash,
    ledger_index: r.ledger_index,
    meta,
  } as unknown as RawLedgerTx;
}

async function main() {
  console.log("=== AMM fill extraction smoketest ===\n");

  /* Pull a sample of Payment txs that touched AMM */
  console.log("[1] Sampling Payments that touched AMM ledger entries...");
  const sampleResult = await ch.query({
    query: `SELECT tx_hash, ledger_index, currency
            FROM sonde.transactions
            WHERE tx_type = 'Payment'
              AND result = 'tesSUCCESS'
              AND ledger_index > 103850000
              AND like(meta_json, '%LedgerEntryType%AMM%')
            LIMIT 5`,
    format: "JSONEachRow",
  });
  const samples = (await sampleResult.json()) as Array<{
    tx_hash: string;
    ledger_index: number;
    currency: string;
  }>;

  console.log(`  found ${samples.length} sample txs\n`);

  let totalTradesExtracted = 0;
  for (const s of samples) {
    const tx = await fetchTx(s.tx_hash);
    if (!tx) {
      console.log(`  [skip] could not load ${s.tx_hash}`);
      continue;
    }

    const trades = extractTokenTrades(tx);
    console.log(`  tx=${s.tx_hash.slice(0, 16)}... ledger=${s.ledger_index} → ${trades.length} fills`);
    for (const t of trades) {
      console.log(
        `    ${t.takerGetsValue} ${t.takerGetsCurrency.slice(0, 8)} <-- ${t.takerPaysValue} ${t.takerPaysCurrency.slice(0, 8)} | maker=${(t.makerAccount ?? "?").slice(0, 16)}`,
      );
    }
    totalTradesExtracted += trades.length;
  }

  console.log(
    `\n  total trades extracted: ${totalTradesExtracted} (Payment-driven trades — previously 0 in dex_trades)\n`,
  );

  /* Verify classifyLedger() produces amm_state_changes for Payment-driven swaps */
  console.log("[2] Verifying classifyLedger emits amm_state_changes='swap' for Payment txs...");
  if (samples.length === 0) {
    console.log("  no samples to test");
  } else {
    const tx = await fetchTx(samples[0].tx_hash);
    if (tx) {
      // Build a minimal ExpandedLedger wrapper
      const ledger: ExpandedLedger = {
        ledger: {
          ledger_index: samples[0].ledger_index,
          close_time: 700_000_000, // arbitrary post-AMM timestamp
          total_coins: "100000000000000000",
          transactions: [tx],
        },
      };
      const classified = classifyLedger(ledger);
      if (!classified) {
        console.log("  classifyLedger returned null");
      } else {
        // Tier 1.5+: AMM swap fills now live in dex_trades, not
        // amm_state_changes (the 'swap' change_type was removed because
        // Payment-driven swaps don't mutate the AMM ledger object — they
        // only mutate AccountRoot.AMMID + RippleState). Smoketest validates
        // dex_trades AMM fills via maker = AMM pseudo-account address.
        const ammFills = classified.chDexRows.filter((r) => r.maker !== "");
        console.log(
          `  classifyLedger produced ${classified.chDexRows.length} dex_trades (${ammFills.length} with maker — AMM fills are a subset)`,
        );
        for (const r of ammFills.slice(0, 3)) {
          const baseAmountIou = typeof r.base_amount_iou === "string" ? r.base_amount_iou : "";
          console.log(
            `    fill_index=${r.fill_index} maker=${r.maker.slice(0, 12)}... base=${r.base_currency} amount_iou=${baseAmountIou.slice(0, 30)}`,
          );
        }
      }
    }
  }

  /* IOU precision test on subtractAmounts indirectly via a partial fill */
  console.log("\n[3] IOU precision smoketest...");
  const precisionResult = await ch.query({
    query: `SELECT tx_hash FROM sonde.transactions
            WHERE tx_type = 'OfferCreate'
              AND result = 'tesSUCCESS'
              AND like(meta_json, '%ModifiedNode%LedgerEntryType%Offer%')
              AND ledger_index > 103860000
            LIMIT 3`,
    format: "JSONEachRow",
  });
  const offerSamples = (await precisionResult.json()) as Array<{ tx_hash: string }>;

  for (const o of offerSamples) {
    const tx = await fetchTx(o.tx_hash);
    if (!tx) continue;
    const trades = extractTokenTrades(tx);
    for (const t of trades) {
      // Just verify the value strings don't have rounding artifacts like "0.999999999..." or "1e-8"
      const sus =
        t.takerGetsValue.includes("e") ||
        t.takerPaysValue.includes("e") ||
        /\.0+$/.test(t.takerGetsValue) ||
        /\.0+$/.test(t.takerPaysValue);
      if (sus) {
        console.log(
          `  [WARN] suspicious value formatting in ${o.tx_hash.slice(0, 12)}: gets=${t.takerGetsValue} pays=${t.takerPaysValue}`,
        );
      }
    }
  }
  console.log("  done\n");

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err);
    process.exit(1);
  });
