/**
 * Query profiling: check pg_stat_statements for slow queries.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/query-profiling.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function main() {
  // Check if pg_stat_statements is available
  try {
    const rows = await sql`
      SELECT query, calls, mean_exec_time, total_exec_time
      FROM pg_stat_statements
      ORDER BY mean_exec_time DESC
      LIMIT 15
    `;
    console.log("=== Top 15 slowest queries by mean exec time ===\n");
    for (const r of rows) {
      const mean = Number(r.mean_exec_time).toFixed(1);
      const total = Number(r.total_exec_time).toFixed(0);
      console.log(`[${mean}ms avg, ${r.calls} calls, ${total}ms total]`);
      console.log(`  ${(r.query as string)?.slice(0, 120)}`);
      console.log();
    }
  } catch (err) {
    console.log("pg_stat_statements not available:", (err as Error).message);
    console.log("\nFalling back to pg_stat_user_tables for table scan stats...\n");

    const tables = await sql`
      SELECT relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, n_tup_ins, n_tup_upd
      FROM pg_stat_user_tables
      ORDER BY seq_scan DESC
      LIMIT 20
    `;
    console.log("=== Top 20 tables by sequential scans ===\n");
    console.log("Table | Seq Scans | Seq Rows Read | Idx Scans | Inserts | Updates");
    console.log("------|-----------|---------------|-----------|---------|--------");
    for (const t of tables) {
      console.log(
        `${t.relname} | ${t.seq_scan} | ${t.seq_tup_read} | ${t.idx_scan} | ${t.n_tup_ins} | ${t.n_tup_upd}`,
      );
    }
  }

  await sql.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
