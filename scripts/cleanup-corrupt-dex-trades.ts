/**
 * Cleanup: remove corrupt pre-2026-04-09 dex_trades rows where quote_amount
 * was stored in drops instead of XRP (the drops-vs-XRP bug fixed in
 * 2026-04-09's commit to intel-ingestion.ts).
 *
 * Predicate: for a row where the fix is applied, quote_amount is in XRP and
 * xrp_volume_drops is in drops, so quote_amount * 1M ≈ xrp_volume_drops. For
 * a corrupt row, quote_amount is *also* in drops, so quote_amount ≈
 * xrp_volume_drops. We catch corrupt rows via quote_amount > xrp_volume_drops
 * * 0.5 (which holds when they're both drops but fails when quote_amount is
 * in XRP at 1/1,000,000 scale).
 *
 * Only deletes pre-2026-04-09 rows — post-fix data is verified clean.
 *
 * This is a targeted mutation, not a full reset. We accept the 18-day gap
 * in pre-Apr 9 XRP-quoted DEX history rather than spending ~11 days
 * re-ingesting. See docs/wiki/audits/2026-04-22-backend-audit.md for context.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-corrupt-dex-trades.ts
 *
 * ClickHouse runs mutations asynchronously. This script issues the command,
 * then polls system.mutations until the mutation completes (or reports
 * progress if it's slow).
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@clickhouse/client";

const PREDICATE = `
  quote_currency = 'XRP'
  AND xrp_volume_drops > 0
  AND quote_amount > xrp_volume_drops * 0.5
  AND timestamp < '2026-04-09 00:00:00'
`;

async function main() {
  const ch = createClient({
    url: process.env.CLICKHOUSE_URL,
    database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
    request_timeout: 60_000,
  });

  // 1. Final pre-flight count
  console.log("Pre-flight: counting rows that match the corrupt predicate...");
  const countRows = await (
    await ch.query({
      query: `SELECT count() AS cnt FROM dex_trades WHERE ${PREDICATE}`,
      format: "JSONEachRow",
    })
  ).json<{ cnt: string }>();
  const targetCount = Number(countRows[0].cnt);
  console.log(`  ${targetCount.toLocaleString()} rows match.\n`);

  if (targetCount === 0) {
    console.log("Nothing to delete. Exiting.");
    await ch.close();
    return;
  }

  // 2. Issue the mutation. ClickHouse's ALTER TABLE ... DELETE runs
  // asynchronously — the command returns as soon as it's queued.
  console.log("Issuing ALTER TABLE DELETE mutation...");
  await ch.command({
    query: `ALTER TABLE dex_trades DELETE WHERE ${PREDICATE}`,
  });
  console.log("  Mutation queued.\n");

  // 3. Poll system.mutations until ours completes.
  console.log("Waiting for mutation to complete...");
  const started = Date.now();
  let lastLogAt = 0;
  while (true) {
    const rows = await (
      await ch.query({
        query: `
          SELECT mutation_id, is_done, parts_to_do, latest_failed_part, latest_fail_reason
          FROM system.mutations
          WHERE database = currentDatabase()
            AND table = 'dex_trades'
          ORDER BY create_time DESC
          LIMIT 1
        `,
        format: "JSONEachRow",
      })
    ).json<{
      mutation_id: string;
      is_done: number;
      parts_to_do: number;
      latest_failed_part: string;
      latest_fail_reason: string;
    }>();

    if (rows.length === 0) {
      console.log("  No mutation found in system.mutations — unexpected.");
      break;
    }

    const m = rows[0];
    if (m.latest_fail_reason) {
      console.log(`  ❌ Mutation failed on part ${m.latest_failed_part}: ${m.latest_fail_reason}`);
      break;
    }

    if (m.is_done === 1) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  ✅ Mutation complete in ${elapsed}s (id: ${m.mutation_id})\n`);
      break;
    }

    // Progress log every ~10 seconds
    if (Date.now() - lastLogAt > 10_000) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  [${elapsed}s] ${m.parts_to_do} parts remaining...`);
      lastLogAt = Date.now();
    }

    await new Promise((r) => setTimeout(r, 2_000));
  }

  // 4. Verify the rows are gone
  console.log("Post-flight verification:");
  const after = await (
    await ch.query({
      query: `SELECT count() AS cnt FROM dex_trades WHERE ${PREDICATE}`,
      format: "JSONEachRow",
    })
  ).json<{ cnt: string }>();
  const afterCount = Number(after[0].cnt);
  console.log(`  Rows matching predicate after delete: ${afterCount.toLocaleString()}`);

  if (afterCount === 0) {
    console.log("  ✅ All corrupt rows cleared.");
  } else {
    console.log("  ⚠️  Some corrupt rows remain. Re-run after ClickHouse completes the merge.");
  }

  // 5. Show overall dex_trades stats
  const totalAfter = await (
    await ch.query({
      query: `SELECT count() AS cnt FROM dex_trades`,
      format: "JSONEachRow",
    })
  ).json<{ cnt: string }>();
  console.log(`\n  Total dex_trades rows now: ${Number(totalAfter[0].cnt).toLocaleString()}`);
  console.log(`  Rows deleted: ${targetCount.toLocaleString()}\n`);

  await ch.close();
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
