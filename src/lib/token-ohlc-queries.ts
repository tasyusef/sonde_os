/**
 * Query functions for token OHLC (candlestick) data.
 * Reads from ClickHouse `mv_token_volume_hourly` (AggregatingMergeTree).
 *
 * 7d → hourly buckets directly from MV (one row per hour).
 * 30d/90d/all → daily buckets via `toDate(hour)` aggregation; OHLC is
 * derived in CH using argMinMerge/argMaxMerge so daily candles still
 * have correct first/last prices.
 *
 * Token-XRP convention: dex_trades stores the token on `base_*` and
 * 'XRP' on `quote_*` for token-XRP pairs (see intel-ingestion.ts ~L543).
 */

import "server-only";
import { LRUCache } from "./cache";
import { query as chQuery } from "@/lib/clickhouse-client";
import type { OHLCPoint } from "@/types/token";

const ohlcCache = new LRUCache<OHLCPoint[]>(50, 120_000);

type Period = "7d" | "30d" | "90d" | "all";

type OhlcRow = {
  bucket_ts: string | number;
  trade_count: string | number;
  base_volume: string | number;
  xrp_volume_drops: string | number;
  open_price: string | number | null;
  high_price: string | number | null;
  low_price: string | number | null;
  close_price: string | number | null;
} & Record<string, unknown>;

export async function getTokenOHLC(
  currency: string,
  issuer: string,
  period: Period = "7d",
): Promise<OHLCPoint[]> {
  const cacheKey = `ohlc:${currency}:${issuer}:${period}`;
  const cached = ohlcCache.get(cacheKey);
  if (cached) return cached;

  let points: OHLCPoint[];

  if (period === "7d") {
    // Hourly candles for 7d. Each hour bucket has a single row in the
    // MV (one per (hour, base, quote) tuple), but we still apply the
    // argMin/argMax/max/min merges in case of duplicate ingest writes.
    const rows = await chQuery<OhlcRow>(
      `SELECT toUnixTimestamp(hour) AS bucket_ts,
              sum(trade_count) AS trade_count,
              sum(base_volume) AS base_volume,
              sum(xrp_volume_drops) AS xrp_volume_drops,
              argMinMerge(open_price) AS open_price,
              max(high_price) AS high_price,
              min(low_price) AS low_price,
              argMaxMerge(close_price) AS close_price
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 7 DAY
         AND base_currency = {currency:String}
         AND base_issuer = {issuer:String}
         AND quote_currency = 'XRP'
       GROUP BY hour
       ORDER BY hour`,
      { currency, issuer },
    );

    points = rows.map(toOHLCPointFromCh);
  } else {
    // Daily candles — group hourly MV by toDate(hour). The argMin/argMax
    // state functions stay associative across this rollup, so daily
    // open is the earliest hour's open and daily close is the latest
    // hour's close.
    const cutoffClause = (() => {
      switch (period) {
        case "30d":
          return `AND hour >= toStartOfDay(now() - INTERVAL 30 DAY)`;
        case "90d":
          return `AND hour >= toStartOfDay(now() - INTERVAL 90 DAY)`;
        case "all":
          return ``;
      }
    })();

    const rows = await chQuery<OhlcRow>(
      `SELECT toUnixTimestamp(toDateTime(toDate(hour))) AS bucket_ts,
              sum(trade_count) AS trade_count,
              sum(base_volume) AS base_volume,
              sum(xrp_volume_drops) AS xrp_volume_drops,
              argMinMerge(open_price) AS open_price,
              max(high_price) AS high_price,
              min(low_price) AS low_price,
              argMaxMerge(close_price) AS close_price
       FROM mv_token_volume_hourly
       WHERE base_currency = {currency:String}
         AND base_issuer = {issuer:String}
         AND quote_currency = 'XRP'
         ${cutoffClause}
       GROUP BY toDate(hour)
       ORDER BY toDate(hour)`,
      { currency, issuer },
    );

    points = rows.map(toOHLCPointFromCh);
  }

  ohlcCache.set(cacheKey, points);
  return points;
}

/** Coerce a CH OHLC row (numbers may arrive as strings via JSONEachRow)
 *  to an OHLCPoint, falling back to VWAP when OHLC values are missing
 *  (e.g. a bucket with only AMM-ish trades that lacked a clear price). */
function toOHLCPointFromCh(r: OhlcRow): OHLCPoint {
  const tsSec = Number(r.bucket_ts);
  // bucket_ts is unix seconds (toUnixTimestamp). Multiply to ms.
  const timestamp = tsSec * 1000;
  const xrpDrops = Number(r.xrp_volume_drops ?? 0);
  const xrpVolume = xrpDrops / 1_000_000;
  const tradeCount = Number(r.trade_count ?? 0);

  const o = r.open_price == null ? null : Number(r.open_price);
  const h = r.high_price == null ? null : Number(r.high_price);
  const l = r.low_price == null ? null : Number(r.low_price);
  const c = r.close_price == null ? null : Number(r.close_price);

  if (
    o != null && h != null && l != null && c != null &&
    isFinite(o) && isFinite(h) && isFinite(l) && isFinite(c) &&
    o > 0 && h > 0 && l > 0 && c > 0
  ) {
    return {
      timestamp,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: xrpVolume,
      tradeCount,
      isVwap: false,
    };
  }

  // VWAP fallback: derive from xrpVolumeDrops / base_volume.
  const baseVol = Number(r.base_volume ?? 0);
  const vwap = baseVol > 0 ? xrpVolume / baseVol : 0;

  return {
    timestamp,
    open: vwap,
    high: vwap,
    low: vwap,
    close: vwap,
    volume: xrpVolume,
    tradeCount,
    isVwap: true,
  };
}

