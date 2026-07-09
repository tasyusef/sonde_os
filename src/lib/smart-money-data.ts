import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Smart-money detail payload — matches the response shape that
 *  /api/smart-money/[address] returns. Shared between the API route
 *  and the server-side pre-fetch in app/(app)/smart-money/[address]/page.tsx
 *  so SWR's fallbackData type lines up with what the route delivers. */
export interface SmartMoneyDetail {
  address: string;
  compositeScore: number;
  profitabilityScore: number;
  roiScore: number;
  winRateScore: number;
  consistencyScore: number;
  earlyBuyerScore: number;
  smartExitScore: number;
  seasoningScore: number;
  penalties: { type: string; amount: number; reason: string }[];
  totalPnlXrp: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  tokensTraded: number;
  washTradingFlag: boolean;
  scoredAt: string;
}

/**
 * Fetch a single wallet's smart-money detail row from Postgres.
 * Returns null if the wallet hasn't been scored.
 */
export async function getSmartMoneyDetail(
  address: string,
): Promise<SmartMoneyDetail | null> {
  const rows = await db.execute<{
    address: string;
    composite_score: string;
    profitability_score: string | null;
    roi_score: string | null;
    win_rate_score: string | null;
    consistency_score: string | null;
    early_buyer_score: string | null;
    smart_exit_score: string | null;
    seasoning_score: string | null;
    penalties: unknown;
    total_pnl_xrp: string | null;
    total_trades: number | null;
    win_rate: string | null;
    sharpe_ratio: string | null;
    tokens_traded: number | null;
    wash_trading_flag: boolean | null;
    scored_at: string;
  }>(sql`
    SELECT
      address, composite_score, profitability_score, roi_score,
      win_rate_score, consistency_score, early_buyer_score, smart_exit_score,
      seasoning_score,
      penalties, total_pnl_xrp, total_trades, win_rate, sharpe_ratio,
      tokens_traded, wash_trading_flag, scored_at
    FROM smart_money_scores
    WHERE address = ${address}
      AND total_pnl_xrp::numeric > 0
  `);

  if (!rows.length) return null;

  const r = rows[0];
  return {
    address: r.address,
    compositeScore: Number(r.composite_score),
    profitabilityScore: Number(r.profitability_score) || 0,
    roiScore: Number(r.roi_score) || 0,
    winRateScore: Number(r.win_rate_score) || 0,
    consistencyScore: Number(r.consistency_score) || 0,
    earlyBuyerScore: Number(r.early_buyer_score) || 0,
    smartExitScore: Number(r.smart_exit_score) || 0,
    seasoningScore: Number(r.seasoning_score) || 0,
    penalties:
      (r.penalties as { type: string; amount: number; reason: string }[]) ?? [],
    totalPnlXrp: Number(r.total_pnl_xrp) || 0,
    totalTrades: r.total_trades ?? 0,
    winRate: Number(r.win_rate) || 0,
    sharpeRatio: Number(r.sharpe_ratio) || 0,
    tokensTraded: r.tokens_traded ?? 0,
    washTradingFlag: r.wash_trading_flag ?? false,
    scoredAt: r.scored_at,
  };
}
