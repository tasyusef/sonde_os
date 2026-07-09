/**
 * Backfill trustline_events from existing ClickHouse transactions table.
 *
 * Fast path: extracts TrustSet transactions directly from ClickHouse —
 * no WebSocket calls needed. This is a ClickHouse-to-ClickHouse operation.
 *
 * Note: The transactions table stores TrustSet amounts via parseAmount(),
 * which puts the LimitAmount currency/issuer into the currency/issuer columns
 * and the limit value into amount_drops. For non-XRP trustlines, amount_drops
 * is 0 (parseAmount converts IOU amounts to 0 drops) — so we use the raw
 * value from a subquery or accept 0 as the limit_amount and rely on the
 * action field (set vs delete based on whether the row exists).
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-trustline-events.ts
 *
 * Requires .env.local with CLICKHOUSE_URL.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!CLICKHOUSE_URL) {
  console.error("CLICKHOUSE_URL required");
  process.exit(1);
}

const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";

const client = createClient({
  url: CLICKHOUSE_URL,
  request_timeout: 300_000, // 5 min — large backfill
});

async function main() {
  console.log("Backfilling trustline_events from existing transactions...\n");

  // Check how many TrustSet transactions exist
  const countResult = await client.query({
    query: `SELECT count() AS cnt FROM ${DATABASE}.transactions WHERE tx_type = 'TrustSet' AND result = 'tesSUCCESS'`,
    format: "JSONEachRow",
  });
  const rows = await countResult.json<{ cnt: string }>();
  const totalTrustSets = Number(rows[0]?.cnt ?? 0);
  console.log(`  Found ${totalTrustSets.toLocaleString()} successful TrustSet transactions`);

  if (totalTrustSets === 0) {
    console.log("  Nothing to backfill.");
    await client.close();
    return;
  }

  // Check existing trustline_events to avoid duplicates
  const existingResult = await client.query({
    query: `SELECT count() AS cnt FROM ${DATABASE}.trustline_events`,
    format: "JSONEachRow",
  });
  const existingRows = await existingResult.json<{ cnt: string }>();
  const existingCount = Number(existingRows[0]?.cnt ?? 0);
  console.log(`  Existing trustline_events: ${existingCount.toLocaleString()}`);

  if (existingCount > 0) {
    console.log("  trustline_events already has data. To re-backfill, truncate the table first:");
    console.log(`  TRUNCATE TABLE ${DATABASE}.trustline_events`);
    await client.close();
    return;
  }

  // Insert directly from transactions table
  // For TrustSet, parseAmount puts currency/issuer from LimitAmount into the
  // currency/issuer columns. amount_drops is 0 for IOUs (parseAmount behavior).
  // We use 0 as limit_amount and determine action from whether it's a delete
  // (amount_drops = 0 AND the original intent was to remove the trustline).
  // In practice, we can't distinguish "set limit to 0" (delete) from "IOU amount
  // stored as 0 drops" without the raw LimitAmount.value. So we mark all as 'set'
  // during backfill and accept the minor inaccuracy for historical data.
  // Going forward, the live pipeline extracts LimitAmount directly.
  console.log("\n  Inserting into trustline_events...");

  await client.command({
    query: `
      INSERT INTO ${DATABASE}.trustline_events
      SELECT
        tx_hash,
        ledger_index,
        timestamp,
        account,
        currency,
        issuer,
        0 AS limit_amount,
        'set' AS action
      FROM ${DATABASE}.transactions
      WHERE tx_type = 'TrustSet'
        AND result = 'tesSUCCESS'
    `,
  });

  // Verify
  const verifyResult = await client.query({
    query: `SELECT count() AS cnt FROM ${DATABASE}.trustline_events`,
    format: "JSONEachRow",
  });
  const verifyRows = await verifyResult.json<{ cnt: string }>();
  const inserted = Number(verifyRows[0]?.cnt ?? 0);
  console.log(`  [+] Inserted ${inserted.toLocaleString()} trustline events`);

  // Check materialized view
  const mvResult = await client.query({
    query: `SELECT count() AS cnt FROM ${DATABASE}.mv_trustline_counts`,
    format: "JSONEachRow",
  });
  const mvRows = await mvResult.json<{ cnt: string }>();
  const mvCount = Number(mvRows[0]?.cnt ?? 0);
  console.log(`  [+] mv_trustline_counts has ${mvCount.toLocaleString()} rows`);

  console.log("\nBackfill complete.");
  await client.close();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
