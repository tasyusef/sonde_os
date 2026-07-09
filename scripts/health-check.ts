import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";
import { createClient } from "@clickhouse/client";

type Result = { name: string; ok: boolean; ms: number; detail: string };
const results: Result[] = [];

async function time<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const v = await fn();
  return [v, Date.now() - t0];
}

async function checkPostgres() {
  if (!process.env.DATABASE_URL) {
    results.push({ name: "Postgres", ok: false, ms: 0, detail: "DATABASE_URL not set" });
    return;
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  try {
    const [ping, pingMs] = await time(() => sql`SELECT 1 as ok`);
    if (!ping[0] || ping[0].ok !== 1) throw new Error("ping mismatch");

    const [sizeRows] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) as size, current_database() as db`;
    const [versionRow] = await sql`SELECT version() as v`;
    const tables = await sql<{ table_name: string; row_count: number; total_size: string }[]>`
      SELECT relname as table_name, n_live_tup::int as row_count,
             pg_size_pretty(pg_total_relation_size(relid)) as total_size
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `;

    const freshness: { table: string; latest: string | null }[] = [];
    try {
      const [row] = await sql`SELECT ledger_index FROM ingested_ledgers ORDER BY ledger_index DESC LIMIT 1`;
      freshness.push({ table: "ingested_ledgers", latest: row?.ledger_index ? `ledger ${row.ledger_index}` : null });
    } catch { freshness.push({ table: "ingested_ledgers", latest: "N/A" }); }
    try {
      const [row] = await sql`SELECT MAX(created_at) as mx FROM page_views`;
      freshness.push({ table: "page_views", latest: row?.mx ? String(row.mx) : null });
    } catch { freshness.push({ table: "page_views", latest: "N/A" }); }
    try {
      const [row] = await sql`SELECT MAX(captured_at) as mx FROM portfolio_snapshots`;
      freshness.push({ table: "portfolio_snapshots", latest: row?.mx ? String(row.mx) : null });
    } catch { freshness.push({ table: "portfolio_snapshots", latest: "N/A" }); }

    const detail = [
      `db=${sizeRows.db} size=${sizeRows.size} ping=${pingMs}ms`,
      `version=${(versionRow.v as string).split(",")[0]}`,
      `top tables:`,
      ...tables.slice(0, 5).map((t) => `    - ${t.table_name.padEnd(34)} ${t.total_size.padStart(10)}  (${t.row_count.toLocaleString()} rows)`),
      `freshness:`,
      ...freshness.map((f) => `    - ${f.table.padEnd(16)} latest=${f.latest ?? "empty"}`),
    ].join("\n  ");

    results.push({ name: "Postgres", ok: true, ms: pingMs, detail });
  } catch (err) {
    results.push({ name: "Postgres", ok: false, ms: 0, detail: String(err instanceof Error ? err.message : err) });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function checkClickHouse() {
  if (!process.env.CLICKHOUSE_URL) {
    results.push({ name: "ClickHouse", ok: false, ms: 0, detail: "CLICKHOUSE_URL not set" });
    return;
  }
  const ch = createClient({
    url: process.env.CLICKHOUSE_URL,
    database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
    request_timeout: 15_000,
  });
  try {
    const [ping, pingMs] = await time(async () => {
      const r = await ch.query({ query: "SELECT 1 as ok", format: "JSONEachRow" });
      return r.json<{ ok: number }>();
    });
    if (ping[0]?.ok !== 1) throw new Error("ping mismatch");

    const versionRes = await ch.query({ query: "SELECT version() as v", format: "JSONEachRow" });
    const [ver] = await versionRes.json<{ v: string }>();

    const tblRes = await ch.query({
      query: `SELECT name, total_rows, formatReadableSize(total_bytes) AS size
              FROM system.tables
              WHERE database = currentDatabase()
              ORDER BY total_bytes DESC
              LIMIT 10`,
      format: "JSONEachRow",
    });
    const tables = await tblRes.json<{ name: string; total_rows: string; size: string }>();

    const freshQueries = [
      { name: "transactions", q: "SELECT toString(max(timestamp)) AS mx FROM transactions" },
      { name: "trustline_events", q: "SELECT toString(max(timestamp)) AS mx FROM trustline_events" },
      { name: "dex_trades", q: "SELECT toString(max(timestamp)) AS mx FROM dex_trades" },
    ];
    const freshness: { name: string; latest: string }[] = [];
    for (const { name, q } of freshQueries) {
      try {
        const r = await ch.query({ query: q, format: "JSONEachRow" });
        const [row] = await r.json<{ mx: string }>();
        freshness.push({ name, latest: row?.mx ?? "empty" });
      } catch {
        freshness.push({ name, latest: "N/A" });
      }
    }

    const detail = [
      `version=${ver.v} ping=${pingMs}ms`,
      `top tables:`,
      ...tables.slice(0, 5).map((t) => `    - ${t.name.padEnd(34)} ${t.size.padStart(10)}  (${Number(t.total_rows).toLocaleString()} rows)`),
      `freshness:`,
      ...freshness.map((f) => `    - ${f.name.padEnd(20)} latest=${f.latest}`),
    ].join("\n  ");

    results.push({ name: "ClickHouse", ok: true, ms: pingMs, detail });
  } catch (err) {
    results.push({ name: "ClickHouse", ok: false, ms: 0, detail: String(err instanceof Error ? err.message : err) });
  } finally {
    await ch.close();
  }
}

async function main() {
  console.log("Sonde DB health check\n" + "=".repeat(40));

  await Promise.allSettled([checkPostgres(), checkClickHouse()]);

  for (const r of results) {
    const status = r.ok ? "OK " : "FAIL";
    console.log(`\n[${status}] ${r.name}`);
    console.log("  " + r.detail);
  }

  const allOk = results.every((r) => r.ok);
  console.log("\n" + "=".repeat(40));
  console.log(allOk ? "All databases healthy." : "One or more databases unhealthy.");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
