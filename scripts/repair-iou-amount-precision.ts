/**
 * Repair IOU amount precision — one-off backfill for the lossy parseAmount() bug.
 *
 * The original ingester routed every Amount through Number() + Math.trunc()
 * into the Int64 amount_drops column. For IOU values (which can have up to
 * 16 significant digits) this dropped:
 *   - All decimals (e.g. "1003.24361031" → 1003)
 *   - Sig digits past 2^53 (e.g. "1763440206529562e-4" → 8663525)
 *   - Values with weird scientific notation (e.g. "1000000000000000e3" → 1003)
 *
 * The fix landed on 2026-04-28: parseXrplAmount() now routes IOU through
 * a new String column `amount_iou` (lossless JSON) and XRP through BigInt.
 * Pre-fix rows in production have:
 *   - currency != 'XRP' (correct)
 *   - issuer set (correct)
 *   - amount_drops = some truncated int (WRONG — should be 0 for IOU)
 *   - amount_iou = '' (default — needs to be populated from tx_json/meta_json)
 *
 * This script runs a CH ALTER TABLE ... UPDATE mutation that:
 *   1. Populates amount_iou from the Payment delivered_amount (preferred)
 *      or tx.Amount (fallback) — using JSONExtractRaw to preserve precision.
 *   2. Zeros out amount_drops on those rows (so IOU rows correctly have
 *      amount_drops = 0, matching the new ingester's invariant).
 *
 * Source of truth: tx_json and meta_json columns hold the original raw
 * payloads, so we can reconstruct the correct IOU value losslessly.
 *
 * Usage:
 *   pnpm exec tsx scripts/repair-iou-amount-precision.ts                  # dry-run on sonde_smoketest (preview only)
 *   pnpm exec tsx scripts/repair-iou-amount-precision.ts --execute        # apply on sonde_smoketest
 *   pnpm exec tsx scripts/repair-iou-amount-precision.ts --db sonde --confirm-production --execute
 *
 * Idempotent: filter only matches rows where amount_iou = '' AND amount_drops > 0
 * AND currency != 'XRP'. Re-running after success is a no-op.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}

const DB = getArg("--db") ?? "sonde_smoketest";
const CONFIRM_PRODUCTION = args.includes("--confirm-production");
const EXECUTE = args.includes("--execute");

if (DB === "sonde" && !CONFIRM_PRODUCTION) {
  console.error(
    "[repair-iou] refusing to target production database 'sonde' without --confirm-production",
  );
  process.exit(1);
}

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("[repair-iou] CLICKHOUSE_URL env var required (set in .env.local)");
  process.exit(1);
}

const client = createClient({
  url,
  database: DB,
  request_timeout: 600_000,
});

/* The repair filter. We update rows that:
 *   - have an IOU currency (not XRP, not empty)
 *   - have amount_iou not yet populated (still default '')
 *   - have either: a non-zero (lossy) amount_drops to fix, OR a zero
 *     amount_drops where the original value truncated to 0 (e.g. "0.5"
 *     → 0). Both cases need amount_iou populated from the raw payload.
 */
const FILTER = `currency != 'XRP' AND currency != '' AND amount_iou = ''`;

/* Reconstruct amount_iou from the raw payload. Mirrors parseXrplAmount()'s
 * effectiveAmount selection (Payment with delivered_amount → delivered;
 * else tx.Amount). JSONExtractRaw returns the JSON object literal verbatim,
 * preserving full IOU precision. */
const UPDATE_EXPR = `if(
  tx_type = 'Payment'
    AND JSONHas(meta_json, 'delivered_amount')
    AND JSONType(meta_json, 'delivered_amount') = 'Object',
  JSONExtractRaw(meta_json, 'delivered_amount'),
  JSONExtractRaw(tx_json, 'Amount')
)`;

async function main() {
  console.log(`[repair-iou] target database: ${DB}`);
  if (DB === "sonde") {
    console.log("[repair-iou] *** PRODUCTION TARGET — --confirm-production was passed ***");
  }
  console.log(`[repair-iou] CH host: ${new URL(url!).host}`);
  console.log(`[repair-iou] mode: ${EXECUTE ? "EXECUTE" : "DRY-RUN (preview only)"}`);
  console.log("");

  /* Step 1: row count to be updated */
  console.log("[repair-iou] step 1: counting rows that match filter...");
  const countResult = await client.query({
    query: `SELECT count() AS cnt FROM ${DB}.transactions WHERE ${FILTER}`,
    format: "JSONEachRow",
  });
  const countRows = (await countResult.json()) as { cnt: string }[];
  const matchCount = Number(countRows[0]?.cnt ?? 0);
  console.log(`[repair-iou] rows matching filter: ${matchCount.toLocaleString()}`);

  if (matchCount === 0) {
    console.log("[repair-iou] nothing to repair — already idempotent. exiting.");
    return;
  }

  /* Step 2: sample preview — show what 5 rows would look like after the update */
  console.log("");
  console.log("[repair-iou] step 2: preview of 5 sample rows (before → after):");
  const previewResult = await client.query({
    query: `SELECT
      tx_hash,
      tx_type,
      currency,
      issuer,
      amount_drops AS old_drops,
      ${UPDATE_EXPR} AS new_iou
    FROM ${DB}.transactions
    WHERE ${FILTER}
    LIMIT 5`,
    format: "JSONEachRow",
  });
  const previewRows = (await previewResult.json()) as Array<{
    tx_hash: string;
    tx_type: string;
    currency: string;
    issuer: string;
    old_drops: string;
    new_iou: string;
  }>;
  for (const r of previewRows) {
    console.log(
      `  ${r.tx_type} ${r.tx_hash.slice(0, 12)}…  drops=${r.old_drops} → iou=${r.new_iou.slice(0, 100)}${r.new_iou.length > 100 ? "…" : ""}`,
    );
  }

  if (!EXECUTE) {
    console.log("");
    console.log("[repair-iou] DRY-RUN complete. Re-run with --execute to apply.");
    return;
  }

  /* Step 3: apply the mutation. CH mutations run asynchronously in the
   * background — they queue, then merge new parts on subsequent merges.
   * We submit and exit; check progress via system.mutations.
   */
  console.log("");
  console.log(`[repair-iou] step 3: submitting mutation on ${matchCount.toLocaleString()} rows...`);
  const sql = `ALTER TABLE ${DB}.transactions
    UPDATE
      amount_iou = ${UPDATE_EXPR},
      amount_drops = 0
    WHERE ${FILTER}`;

  await client.command({
    query: sql,
    /* mutations_sync = 0 (default) → submit and return. = 1 wait for parts on
     *   this replica. = 2 wait for parts on all replicas. We're not replicated,
     *   so 0 vs 1 is just "fire-and-forget" vs "block until done." Let's block
     *   so the caller knows when it's safe to verify.
     */
    clickhouse_settings: { mutations_sync: "1" },
  });

  console.log(`[repair-iou] mutation completed.`);

  /* Step 4: verify */
  console.log("");
  console.log("[repair-iou] step 4: verification...");
  const verifyResult = await client.query({
    query: `SELECT
      countIf(amount_iou != '' AND currency != 'XRP') AS iou_populated,
      countIf(amount_iou = '' AND currency != 'XRP' AND currency != '') AS iou_still_empty,
      countIf(currency != 'XRP' AND currency != '' AND amount_drops > 0) AS iou_drops_nonzero
    FROM ${DB}.transactions`,
    format: "JSONEachRow",
  });
  const verifyRows = (await verifyResult.json()) as Array<{
    iou_populated: string;
    iou_still_empty: string;
    iou_drops_nonzero: string;
  }>;
  const v = verifyRows[0];
  console.log(`  IOU rows with amount_iou populated: ${Number(v.iou_populated).toLocaleString()}`);
  console.log(`  IOU rows still missing amount_iou:  ${Number(v.iou_still_empty).toLocaleString()}`);
  console.log(`  IOU rows with amount_drops > 0:     ${Number(v.iou_drops_nonzero).toLocaleString()} (should be 0 if no concurrent live writes)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[repair-iou] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
