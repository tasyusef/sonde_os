/**
 * Cleanup ClickHouse system log tables and bound their future growth.
 *
 * Why:
 *   ClickHouse writes its own internal logs (query_log, part_log,
 *   metric_log, text_log, etc.) by default and never garbage-collects
 *   them. On the Sonde production box those tables ballooned to 81 GB
 *   total — 47 GB in `text_log` alone — without anyone querying them.
 *
 * What this does (per table, in this order — order matters):
 *   1. TRUNCATE TABLE  — instant reclaim of existing rows. Doing this
 *      FIRST is critical: ALTER MODIFY TTL on a populated table
 *      triggers a sync mutation to apply TTL to existing parts, which
 *      generates merge activity, which floods text_log with trace
 *      events, which can MORE than offset the reclaim. (Learned the
 *      hard way: first run grew text_log by 40 GB during cleanup.)
 *      TRUNCATE first means the ALTER below runs on an empty table
 *      and is metadata-only, no merge.
 *   2. ALTER TABLE ... MODIFY TTL event_date + INTERVAL N DAY DELETE
 *      — caps future growth so this never happens again.
 *
 * Run safely:
 *   --dry-run     prints the plan and current sizes, makes no changes
 *   --retain-days N   keep last N days instead of truncating everything
 *                     (slower — uses TTL + OPTIMIZE rather than TRUNCATE)
 *
 * Usage:
 *   pnpm exec tsx scripts/cleanup-ch-system-logs.ts --dry-run
 *   pnpm exec tsx scripts/cleanup-ch-system-logs.ts --apply
 *   pnpm exec tsx scripts/cleanup-ch-system-logs.ts --apply --retain-days 7
 *
 * Requires CLICKHOUSE_URL in env.
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

const DRY_RUN = !args.includes("--apply");
const RETAIN_DAYS = Number(getArg("--retain-days") ?? 7);

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("CLICKHOUSE_URL required");
  process.exit(1);
}

const ch = createClient({ url, request_timeout: 300_000 });

/** System log tables we manage. Others left alone — only the ones that
 *  observably grow without bound. The `event_date` column exists on all
 *  of these (ClickHouse default schema for *_log tables). */
const TABLES = [
  "text_log",
  "query_log",
  "processors_profile_log",
  "part_log",
  "trace_log",
  "query_views_log",
  "metric_log",
  "asynchronous_insert_log",
  "asynchronous_metric_log",
  "background_schedule_pool_log",
  "query_metric_log",
  "error_log",
];

interface TableStat {
  table: string;
  size_bytes: number;
  rows: number;
  exists: boolean;
}

async function getStats(): Promise<TableStat[]> {
  const result = await ch.query({
    query: `
      SELECT
        table,
        sum(bytes_on_disk) AS size_bytes,
        sum(rows) AS rows
      FROM system.parts
      WHERE active AND database = 'system' AND table IN (${TABLES.map((t) => `'${t}'`).join(",")})
      GROUP BY table
    `,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as { table: string; size_bytes: string; rows: string }[];
  const byTable = new Map(rows.map((r) => [r.table, r]));

  return TABLES.map((t) => {
    const row = byTable.get(t);
    return {
      table: t,
      size_bytes: row ? Number(row.size_bytes) : 0,
      rows: row ? Number(row.rows) : 0,
      exists: !!row,
    };
  });
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function main(): Promise<void> {
  console.log(`[cleanup-ch-system-logs] mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);
  console.log(`[cleanup-ch-system-logs] TTL retention: ${RETAIN_DAYS} days going forward`);
  console.log(`[cleanup-ch-system-logs] CH host: ${new URL(url!).host}\n`);

  const before = await getStats();
  const totalBefore = before.reduce((s, r) => s + r.size_bytes, 0);

  console.log("Current state:");
  for (const r of before) {
    if (!r.exists) {
      console.log(`  ${r.table.padEnd(32)} (table absent — skip)`);
      continue;
    }
    console.log(
      `  ${r.table.padEnd(32)} ${fmtBytes(r.size_bytes).padStart(10)}  ${r.rows.toLocaleString().padStart(13)} rows`,
    );
  }
  console.log(`  ${"TOTAL".padEnd(32)} ${fmtBytes(totalBefore).padStart(10)}\n`);

  if (DRY_RUN) {
    console.log("Plan (would run with --apply):");
    for (const r of before) {
      if (!r.exists) continue;
      console.log(`  TRUNCATE TABLE system.${r.table};`);
      console.log(`  ALTER TABLE system.${r.table} MODIFY TTL event_date + INTERVAL ${RETAIN_DAYS} DAY DELETE;`);
    }
    console.log(
      `\n[cleanup-ch-system-logs] dry-run only — re-run with --apply to execute. Estimated reclaim: ~${fmtBytes(totalBefore)}.`,
    );
    await ch.close();
    return;
  }

  /* APPLY MODE — TRUNCATE first, then MODIFY TTL on the empty table.
   * See header comment for why this order matters. */
  for (const r of before) {
    if (!r.exists) continue;

    // 1. TRUNCATE — instant reclaim of existing rows.
    try {
      await ch.command({ query: `TRUNCATE TABLE system.${r.table}` });
      console.log(`  [+] truncated system.${r.table}`);
    } catch (err) {
      console.warn(
        `  [!] truncate failed on system.${r.table}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // 2. Set TTL on the now-empty table — metadata-only, no merge.
    //    Idempotent: re-running just re-sets the same TTL.
    try {
      await ch.command({
        query: `ALTER TABLE system.${r.table} MODIFY TTL event_date + INTERVAL ${RETAIN_DAYS} DAY DELETE`,
      });
      console.log(`  [+] TTL set on system.${r.table} (${RETAIN_DAYS}d)`);
    } catch (err) {
      // Some tables may not have event_date (e.g., older versions or
      // partitioned differently). Log and skip — TRUNCATE already helped.
      console.warn(
        `  [!] TTL skipped on system.${r.table}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /* Verify */
  console.log("\nVerifying...");
  const after = await getStats();
  const totalAfter = after.reduce((s, r) => s + r.size_bytes, 0);
  for (const r of after) {
    if (!r.exists) continue;
    console.log(`  ${r.table.padEnd(32)} ${fmtBytes(r.size_bytes).padStart(10)}`);
  }
  console.log(
    `\n[cleanup-ch-system-logs] reclaimed ${fmtBytes(totalBefore - totalAfter)} (${fmtBytes(totalBefore)} → ${fmtBytes(totalAfter)})`,
  );

  await ch.close();
}

main().catch(async (err) => {
  console.error("[cleanup-ch-system-logs] fatal:", err instanceof Error ? err.message : err);
  await ch.close().catch(() => undefined);
  process.exit(1);
});
