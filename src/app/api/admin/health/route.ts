import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ingestionState } from "@/db/schema";
import { requireAdmin } from "@/lib/admin-auth";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

async function getPostgresHealth() {
  try {
    const [connections] = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM pg_stat_activity
    `);
    const [dbSize] = await db.execute<{ size: string }>(sql`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size
    `);
    const tableSizes = await db.execute<{ table: string; size: string; rows: number }>(sql`
      SELECT
        relname AS table,
        pg_size_pretty(pg_total_relation_size(relid)) AS size,
        n_live_tup::int AS rows
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `);
    return {
      status: "healthy" as const,
      connections: connections?.count ?? 0,
      dbSize: dbSize?.size ?? "?",
      topTables: Array.from(tableSizes).map((t) => ({ name: t.table, size: t.size, rows: t.rows })),
    };
  } catch (err) {
    return { status: "error" as const, error: err instanceof Error ? err.message : "Unknown" };
  }
}

async function getClickhouseHealth() {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return { status: "disconnected" as const, error: "CLICKHOUSE_URL not set" };

  try {
    // Use the @clickhouse/client singleton which already handles auth
    const { query: chQuery } = await import("@/lib/clickhouse-client");
    const dbName = process.env.CLICKHOUSE_DATABASE ?? "sonde";

    // Parameterized — `dbName` is env-controlled, but interpolation is
    // a footgun pattern even when the source isn't user-supplied. CH
    // {db:String} substitution keeps the contract durable.
    const tables = await chQuery<{ name: string; rows: number; size: string }>(
      `SELECT
        table AS name,
        sum(rows) AS rows,
        formatReadableSize(sum(bytes_on_disk)) AS size
      FROM system.parts
      WHERE database = {db:String} AND active
      GROUP BY table
      ORDER BY rows DESC`,
      { db: dbName },
    );

    const [diskRow] = await chQuery<{ size: string }>(
      `SELECT formatReadableSize(sum(bytes_on_disk)) AS size
      FROM system.parts
      WHERE database = {db:String} AND active`,
      { db: dbName },
    );

    return { status: "healthy" as const, tables, totalDisk: diskRow?.size ?? "0 B" };
  } catch (err) {
    return { status: "error" as const, error: err instanceof Error ? err.message : "Unknown" };
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const [postgres, clickhouse] = await Promise.all([
      getPostgresHealth(),
      getClickhouseHealth(),
    ]);

    // Ingestion status — pulled from ClickHouse `ledger_metadata`.
    // Replaces the old PG `ingested_ledgers` lookup; CH is now the source
    // of truth for ledger ingestion.
    let lastLedger: number | null = null;
    try {
      const { query: chQuery } = await import("@/lib/clickhouse-client");
      const [row] = await chQuery<{ ledger_index: number | string }>(
        `SELECT max(ledger_index) AS ledger_index FROM ledger_metadata`,
      );
      const value = row?.ledger_index;
      lastLedger = value != null ? Number(value) || null : null;
    } catch { /* ignore */ }

    // Chain-tip pointer — `latest_ledger` in PG is updated by the live
    // runner on every `ledgerClosed` event (whether or not the ledger
    // has been ingested yet). Compare against `lastLedger` from CH for
    // the real ingester-lag signal.
    let chainTip: number | null = null;
    let chainTipUpdatedAt: string | null = null;
    try {
      const tipRows = await db
        .select()
        .from(ingestionState)
        .where(sql`${ingestionState.key} = 'latest_ledger'`)
        .limit(1);
      const v = tipRows[0]?.value;
      chainTip = v != null ? Number(v) || null : null;
      chainTipUpdatedAt = tipRows[0]?.updatedAt?.toISOString() ?? null;
    } catch { /* ignore */ }

    const lagLedgers =
      chainTip != null && lastLedger != null ? chainTip - lastLedger : null;

    return NextResponse.json({
      postgres,
      clickhouse,
      lastIngestedLedger: lastLedger,
      chainTipLedger: chainTip,
      chainTipUpdatedAt,
      lagLedgers,
    });
  } catch (err) {
    logger.error({ err }, "[admin/health]");
    return NextResponse.json({ error: "Failed to fetch health" }, { status: 500 });
  }
}
