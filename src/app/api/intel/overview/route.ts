import { NextResponse, type NextRequest } from "next/server";
import { readOnlyQuery } from "@/lib/clickhouse-client";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-overview", 30);

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }
  try {
  const [txStats, recentPayments, topByVolume, topByConnections, dexResult, activeResult, hourlyTxRows, hourlyDexRows] = await Promise.all([
    // 24h network metrics
    readOnlyQuery<{
      tx_count: string;
      total_fees: string;
      unique_types: string;
    }>(
      `SELECT
         count() AS tx_count,
         sum(fee_drops) AS total_fees,
         uniqExact(tx_type) AS unique_types
       FROM transactions
       WHERE timestamp >= now() - INTERVAL 24 HOUR`,
    ).catch(() => []),

    // Recent large payments (last hour, top 15)
    // Filter out partial payment "send max" values (>100B drops = >100K XRP is suspicious)
    readOnlyQuery<{
      tx_hash: string;
      account: string;
      destination: string;
      // Int64 column — CH JSONEachRow returns it as a decimal string to
      // bypass JS Number's 2^53 ceiling. Pass through as-is to JSON.
      amount_drops: string;
      currency: string;
      timestamp: string;
    }>(
      `SELECT tx_hash, account, destination, amount_drops, currency, timestamp
       FROM transactions
       WHERE tx_type = 'Payment'
         AND currency = 'XRP'
         AND amount_drops > 0
         AND amount_drops < 100000000000000
         AND timestamp >= now() - INTERVAL 1 HOUR
       ORDER BY amount_drops DESC
       LIMIT 15`,
    ).catch(() => []),

    // Top accounts by payment volume (24h)
    readOnlyQuery<{
      account: string;
      tx_count: string;
      total_volume: string;
    }>(
      `SELECT account, count() AS tx_count, sum(amount_drops) AS total_volume
       FROM transactions
       WHERE tx_type = 'Payment'
         AND currency = 'XRP'
         AND amount_drops < 100000000000000
         AND timestamp >= now() - INTERVAL 24 HOUR
       GROUP BY account
       ORDER BY total_volume DESC
       LIMIT 10`,
    ).catch(() => []),

    // Top accounts by connection count (24h). Pre-2026-04-30 this came
    // from Neo4j with no time bound, but the rest of the overview panel
    // is 24h-scoped (volume, payments, fee burn, etc.) so 24h fits the
    // framing better and keeps the UNION ALL bounded.
    readOnlyQuery<{ address: string; connections: string }>(
      `SELECT account AS address, count() AS connections
       FROM (
         SELECT from_account AS account FROM value_transfer_events
           WHERE from_account != '' AND timestamp >= now() - INTERVAL 24 HOUR
         UNION ALL
         SELECT to_account AS account FROM value_transfer_events
           WHERE to_account != '' AND timestamp >= now() - INTERVAL 24 HOUR
         UNION ALL
         SELECT taker AS account FROM dex_trades
           WHERE taker != '' AND timestamp >= now() - INTERVAL 24 HOUR
         UNION ALL
         SELECT maker AS account FROM dex_trades
           WHERE maker != '' AND timestamp >= now() - INTERVAL 24 HOUR
       )
       GROUP BY account
       ORDER BY connections DESC
       LIMIT 10`,
    ).catch(() => []),

    // DEX volume (24h)
    readOnlyQuery<{ total: string }>(
      `SELECT sum(xrp_volume_drops) AS total FROM dex_trades WHERE timestamp >= now() - INTERVAL 24 HOUR`,
    ).catch(() => []),

    // Active accounts (24h)
    readOnlyQuery<{ cnt: string }>(
      `SELECT uniqExact(account) AS cnt FROM transactions WHERE timestamp >= now() - INTERVAL 24 HOUR`,
    ).catch(() => []),

    // Hourly tx count + fees (24h)
    readOnlyQuery<{ hour: string; cnt: string; fees: string }>(
      `SELECT
         toStartOfHour(timestamp) AS hour,
         count() AS cnt,
         sum(fee_drops) AS fees
       FROM transactions
       WHERE timestamp >= now() - INTERVAL 24 HOUR
       GROUP BY hour
       ORDER BY hour`,
    ).catch(() => []),

    // Hourly DEX volume (24h)
    readOnlyQuery<{ hour: string; vol: string }>(
      `SELECT
         toStartOfHour(timestamp) AS hour,
         sum(xrp_volume_drops) AS vol
       FROM dex_trades
       WHERE timestamp >= now() - INTERVAL 24 HOUR
       GROUP BY hour
       ORDER BY hour`,
    ).catch(() => []),
  ]);
  const dexVolume = dexResult[0]?.total ?? "0";
  const activeAccounts = Number(activeResult[0]?.cnt ?? 0);

  // Build padded 24-element hourly arrays (oldest → newest)
  const now = new Date();
  const startHour = new Date(now.getTime() - 23 * 3600_000);
  startHour.setMinutes(0, 0, 0);

  const txByHour = new Map(hourlyTxRows.map((r) => [new Date(r.hour).getTime(), { cnt: Number(r.cnt), fees: Number(r.fees) }]));
  const dexByHour = new Map(hourlyDexRows.map((r) => [new Date(r.hour).getTime(), Number(r.vol)]));

  const hourlyTxCount: number[] = [];
  const hourlyFees: number[] = [];
  const hourlyDexVolume: number[] = [];
  for (let i = 0; i < 24; i++) {
    const ts = startHour.getTime() + i * 3600_000;
    const tx = txByHour.get(ts);
    hourlyTxCount.push(tx?.cnt ?? 0);
    hourlyFees.push(tx?.fees ?? 0);
    hourlyDexVolume.push(dexByHour.get(ts) ?? 0);
  }

  // 24h-windowed metrics shared across every viewer of /intel/* — all
  // 8 CH queries are heavy and the result is identical per request.
  // s-maxage=60/swr=240 lets the CDN serve repeat hits without ever
  // touching the runtime; the metrics tolerate ~1 min staleness.
  return cachedJson(
    {
      metrics: {
        txCount24h: Number(txStats[0]?.tx_count ?? 0),
        activeAccounts24h: activeAccounts,
        dexVolumeDrops24h: dexVolume,
        totalFeesDrops24h: txStats[0]?.total_fees ?? "0",
      },
      recentPayments: recentPayments.map((r) => ({
        txHash: r.tx_hash,
        from: r.account,
        to: r.destination,
        amountDrops: r.amount_drops,
        currency: r.currency,
        timestamp: r.timestamp,
      })),
      topByVolume: topByVolume.map((r) => ({
        address: r.account,
        txCount: Number(r.tx_count),
        totalVolumeDrops: r.total_volume,
      })),
      topByConnections: topByConnections.map((r) => ({
        address: r.address,
        connections: Number(r.connections) || 0,
      })),
      hourlyTrends: {
        txCount: hourlyTxCount,
        fees: hourlyFees,
        dexVolume: hourlyDexVolume,
      },
    },
    60,
    240,
  );

  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/intel/overview] Error");
    return NextResponse.json({ error: "Failed to load overview data" }, { status: 500 });
  }
}
