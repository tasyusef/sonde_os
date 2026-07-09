import { NextResponse, type NextRequest } from "next/server";
import { readOnlyQuery } from "@/lib/clickhouse-client";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cachedJson } from "@/lib/api-cache";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("smart-money-holdings", 30);

/**
 * GET /api/smart-money/[address]/holdings
 *
 * All tokens the wallet has traded (held + closed positions) from
 * wallet_token_pnl (ClickHouse), sorted by realized PnL desc so the
 * best historical trades surface first. Current holdings appear
 * alongside closed positions — closed ones have qty = 0 but often
 * hold most of a wallet's realized PnL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid XRPL address" }, { status: 400 });
  }

  try {
    const rows = await readOnlyQuery(
      `SELECT
         currency, issuer, total_qty, cost_basis, total_cost, realized_pnl,
         trade_count, buy_count, sell_count, first_trade_ts, last_trade_ts
       FROM wallet_token_pnl FINAL
       WHERE wallet = {address:String}
         AND trade_count > 0
       ORDER BY realized_pnl DESC, total_qty * cost_basis DESC
       LIMIT 100`,
      { address },
    );

    const holdings = (rows as Array<{
      currency: string; issuer: string;
      total_qty: number; cost_basis: number; total_cost: number;
      realized_pnl: number; trade_count: number; buy_count: number; sell_count: number;
      first_trade_ts: string; last_trade_ts: string;
    }>).map((r) => ({
      currency: r.currency,
      issuer: r.issuer,
      qty: Number(r.total_qty),
      costBasis: Number(r.cost_basis),
      totalCost: Number(r.total_cost),
      realizedPnl: Number(r.realized_pnl),
      tradeCount: Number(r.trade_count),
      buyCount: Number(r.buy_count),
      sellCount: Number(r.sell_count),
      firstTradeTs: r.first_trade_ts,
      lastTradeTs: r.last_trade_ts,
    }));

    // wallet_token_pnl FINAL is one of the slowest CH reads on the
    // smart-money detail page. Aligned with leaderboard cache cadence.
    return cachedJson({ holdings }, 300, 900);
  } catch (err) {
    logger.error({ err }, "[api/smart-money/holdings] Error");
    return NextResponse.json({ holdings: [] });
  }
}
