import { NextResponse, type NextRequest } from "next/server";
import * as ch from "@/lib/clickhouse-client";
import { computeGraphFeatures } from "@/lib/intel-graph-features";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-profile", 20);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  const account = request.nextUrl.searchParams.get("account");

  if (!account || !XRPL_ADDRESS_RE.test(account)) {
    return NextResponse.json({ error: "Valid account address required" }, { status: 400 });
  }

  // Three parallel queries:
  //   1. graph features (degree, counterparties, first/last) via the
  //      shared CH-backed computeGraphFeatures helper
  //   2. tx volume stats from CH transactions table
  //   3. top counterparties — UNION ALL of vte + dex_trades, grouped
  //      by (counterparty, type). One counterparty can appear twice
  //      with different types if they have both payment and DEX
  //      activity, matching the prior Cypher's grouping by
  //      (address, rel_type). total_amount is XRP-drops only (IOU
  //      values omitted) to match the column type and keep the sum
  //      meaningful when mixed across rows.
  const [features, txStats, topCounterparties] = await Promise.all([
    computeGraphFeatures(account).catch(() => null),

    ch.query<{
      tx_count: string;
      total_fee_drops: string;
      first_tx: string;
      last_tx: string;
      tx_types: string;
    }>(
      `SELECT
         count() AS tx_count,
         sum(fee_drops) AS total_fee_drops,
         min(timestamp) AS first_tx,
         max(timestamp) AS last_tx,
         groupArray(DISTINCT tx_type) AS tx_types
       FROM transactions
       WHERE account = {account:String}`,
      { account },
    ).catch(() => []),

    ch.query<{
      address: string;
      tx_count: number | string;
      total_amount: number | string;
      rel_type: string;
    }>(
      `SELECT address, tx_count, total_amount, rel_type
       FROM (
         SELECT
           counterparty AS address,
           count() AS tx_count,
           sum(amount_drops) AS total_amount,
           'PAYMENT' AS rel_type
         FROM (
           SELECT to_account AS counterparty, amount_drops FROM value_transfer_events
             WHERE from_account = {account:String}
               AND to_account != ''
               AND to_account != {account:String}
           UNION ALL
           SELECT from_account AS counterparty, amount_drops FROM value_transfer_events
             WHERE to_account = {account:String}
               AND from_account != ''
               AND from_account != {account:String}
         )
         GROUP BY counterparty
         UNION ALL
         SELECT
           counterparty AS address,
           count() AS tx_count,
           sum(xrp_volume_drops) AS total_amount,
           'DEX_TRADE' AS rel_type
         FROM (
           SELECT maker AS counterparty, xrp_volume_drops FROM dex_trades
             WHERE taker = {account:String}
               AND maker != ''
               AND maker != {account:String}
           UNION ALL
           SELECT taker AS counterparty, xrp_volume_drops FROM dex_trades
             WHERE maker = {account:String}
               AND taker != ''
               AND taker != {account:String}
         )
         GROUP BY counterparty
       )
       ORDER BY tx_count DESC
       LIMIT 10`,
      { account },
    ).catch(() => []),
  ]);

  const stats = txStats[0];

  // Per-account aggregates over the full account history — graph
  // features + tx volume + top counterparties. Result is per-account
  // immutable enough for a 2 min cache; a wallet's lifetime stats
  // don't shift meaningfully on shorter timescales.
  return cachedJson(
    {
      account,
      graph: features
        ? {
            firstSeen: features.firstSeen,
            lastActive: features.lastActive,
            paymentsIn: features.inDegree,
            paymentsOut: features.outDegree,
            dexTrades: features.tradeCount,
            uniqueCounterparties: features.uniqueCounterparties,
          }
        : null,
      timeSeries: stats
        ? {
            txCount: Number(stats.tx_count),
            totalFeeDrops: stats.total_fee_drops,
            firstTx: stats.first_tx,
            lastTx: stats.last_tx,
            txTypes: typeof stats.tx_types === "string" ? JSON.parse(stats.tx_types) : stats.tx_types,
          }
        : null,
      topCounterparties: topCounterparties.map((row) => ({
        address: row.address,
        txCount: Number(row.tx_count) || 0,
        totalAmount: row.total_amount,
        type: row.rel_type,
      })),
    },
    120,
    600,
  );
}
