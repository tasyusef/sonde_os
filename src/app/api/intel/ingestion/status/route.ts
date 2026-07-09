import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { ingestionState } from "@/db/schema";
import * as ch from "@/lib/clickhouse-client";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession(await cookies());
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let intelRow: { value: string | null; updatedAt: Date | null } | undefined;
  let mainRow: { value: string | null } | undefined;
  try {
    const [intelRows, mainRows] = await Promise.all([
      db.select().from(ingestionState).where(sql`${ingestionState.key} = 'intel_latest_ledger'`).limit(1),
      db.select().from(ingestionState).where(sql`${ingestionState.key} = 'latest_ledger'`).limit(1),
    ]);
    intelRow = intelRows[0];
    mainRow = mainRows[0];
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/intel/ingestion/status] Postgres query failed");
    return NextResponse.json({ error: "Failed to fetch ingestion status" }, { status: 500 });
  }

  const intelLatest = intelRow ? Number(intelRow.value) : 0;
  const mainLatest = mainRow ? Number(mainRow.value) : 0;
  const lag = mainLatest - intelLatest;

  // ClickHouse row counts. value_transfer_events is what used to back
  // the Neo4j PAYMENT-edge count; reporting it here so admins can see
  // the same magnitude of edge volume that Neo4j was tracking.
  let chTransactions = 0;
  let chDexTrades = 0;
  let chValueTransfers = 0;
  try {
    const [txRows, dexRows, vteRows] = await Promise.all([
      ch.query<{ count: string }>("SELECT count() AS count FROM transactions"),
      ch.query<{ count: string }>("SELECT count() AS count FROM dex_trades"),
      ch.query<{ count: string }>("SELECT count() AS count FROM value_transfer_events"),
    ]);
    chTransactions = Number(txRows[0]?.count ?? 0);
    chDexTrades = Number(dexRows[0]?.count ?? 0);
    chValueTransfers = Number(vteRows[0]?.count ?? 0);
  } catch {
    // ClickHouse may not be available
  }

  return NextResponse.json({
    intelLatestLedger: intelLatest,
    mainLatestLedger: mainLatest,
    lag,
    updatedAt: intelRow?.updatedAt?.toISOString() ?? null,
    clickhouse: {
      transactions: chTransactions,
      dexTrades: chDexTrades,
      valueTransferEvents: chValueTransfers,
    },
  });
}
