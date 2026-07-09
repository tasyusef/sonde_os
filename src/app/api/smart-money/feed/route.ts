import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readOnlyQuery } from "@/lib/clickhouse-client";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("smart-money-feed", 30);

const WINDOWS = {
  "1h": "INTERVAL 1 HOUR",
  "24h": "INTERVAL 24 HOUR",
  "7d": "INTERVAL 7 DAY",
} as const;

type WindowKey = keyof typeof WINDOWS;

function parseWindow(raw: string | null): WindowKey {
  return raw && raw in WINDOWS ? (raw as WindowKey) : "24h";
}

/**
 * GET /api/smart-money/feed
 *
 * Recent DEX trades from smart money wallets (composite score >= 50).
 *
 * Query params:
 *   ?window=1h|24h|7d     — timeframe (default 24h; 1h is usually empty)
 *   ?direction=buy|sell   — filter by trade direction
 *   ?minScore=50          — minimum composite score
 *   ?limit=20             — page size (default 20, max 100)
 *   ?offset=0             — skip this many trades for "show more" pagination
 *
 * Response:
 *   { trades, total, totalInWindow, hasMore, window }
 *
 * Pre-2026-05-01 the route was tiered (free: 3 trades, no pagination;
 * Pro: full). Gate retired in the Pro = AI only reshape.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const windowKey = parseWindow(searchParams.get("window"));
  const windowSql = WINDOWS[windowKey];
  const direction = searchParams.get("direction") as "buy" | "sell" | null;
  const minScore = Number(searchParams.get("minScore")) || 50;
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
  const requestedLimit = Math.max(1, Number(searchParams.get("limit")) || 20);
  const limit = Math.min(requestedLimit, 100);

  try {
    const scoreRows = await db.execute<{ address: string; composite_score: string }>(sql`
      SELECT address, composite_score
      FROM smart_money_scores
      WHERE composite_score >= ${minScore}
      ORDER BY composite_score DESC
      LIMIT 200
    `);

    if (scoreRows.length === 0) {
      return NextResponse.json({
        trades: [],
        total: 0,
        totalInWindow: 0,
        hasMore: false,
        window: windowKey,
      });
    }

    const scoreMap = new Map(scoreRows.map((r) => [r.address, Number(r.composite_score)]));
    const addresses = scoreRows.map((r) => r.address);
    const placeholders = addresses.map((a) => `'${a}'`).join(",");

    // Direction filter gets applied in ClickHouse via which side the smart
    // money wallet sits on: direction === "buy" means a smart wallet was
    // the taker; "sell" means they were the maker. Push this into the
    // query so pagination + totalInWindow stay consistent with what the
    // client renders.
    const sideFilter =
      direction === "buy"
        ? `AND taker IN (${placeholders})`
        : direction === "sell"
          ? `AND maker IN (${placeholders})`
          : `AND (taker IN (${placeholders}) OR maker IN (${placeholders}))`;

    const [trades, totalWindow] = await Promise.all([
      readOnlyQuery(
        `SELECT
           tx_hash, timestamp, taker, maker,
           base_currency, base_issuer, base_amount,
           quote_currency, quote_issuer, quote_amount,
           price, xrp_volume_drops
         FROM dex_trades
         WHERE timestamp > now() - ${windowSql}
           ${sideFilter}
         ORDER BY timestamp DESC
         LIMIT ${limit}
         OFFSET ${offset}`,
      ),
      readOnlyQuery(
        `SELECT count() AS total
         FROM dex_trades
         WHERE timestamp > now() - ${windowSql}
           ${sideFilter}`,
      ),
    ]);

    const totalInWindow = Number(
      (totalWindow[0] as { total: number | string } | undefined)?.total ?? 0,
    );

    // `xrp_volume_drops` is CH Int64 → arrives as decimal string via
    // JSONEachRow (Int64 exceeds JS Number safe range). Consumer below
    // immediately Number()-casts which is fine for display (UI rounds);
    // BigInt arithmetic isn't needed here because xrpVolume is just for
    // sort/render, not for downstream sums.
    const enriched = (trades as Array<{
      tx_hash: string; timestamp: string; taker: string; maker: string;
      base_currency: string; base_issuer: string; base_amount: number;
      quote_currency: string; quote_issuer: string; quote_amount: number;
      price: number; xrp_volume_drops: string;
    }>).map((t) => {
      const isTakerSmart = scoreMap.has(t.taker);
      const wallet = isTakerSmart ? t.taker : t.maker;
      const dir = isTakerSmart ? "buy" : "sell";

      return {
        txHash: t.tx_hash,
        timestamp: t.timestamp,
        wallet,
        score: scoreMap.get(wallet) ?? 0,
        direction: dir,
        baseCurrency: t.base_currency,
        baseIssuer: t.base_issuer,
        baseAmount: Number(t.base_amount),
        quoteCurrency: t.quote_currency,
        price: Number(t.price),
        xrpVolume: Number(t.xrp_volume_drops),
      };
    });

    const hasMore = offset + enriched.length < totalInWindow;

    return NextResponse.json({
      trades: enriched,
      total: enriched.length,
      totalInWindow,
      hasMore,
      window: windowKey,
    });
  } catch (err) {
    if ((err as Error).message?.includes("smart_money_scores")) {
      return NextResponse.json({
        trades: [],
        total: 0,
        totalInWindow: 0,
        hasMore: false,
        window: windowKey,
      });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch feed" },
      { status: 500 },
    );
  }
}
