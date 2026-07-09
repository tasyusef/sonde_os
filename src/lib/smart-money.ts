/**
 * Smart Money scoring — composite 0-100 score with 6 weighted factors,
 * plus legacy label classification for backward compatibility.
 *
 * The new scoring system (WAVG PnL, 6 factors, penalties) is used by
 * SmartMoneyScorer. The legacy label functions (market_maker, early_lp,
 * whale, validator) are preserved for account_labels compat.
 *
 * The `gateway` legacy label was removed 2026-04-30 alongside the Neo4j
 * deprecation — it was the only sub-scorer that depended on Neo4j and
 * isn't part of the composite score. See `docs/plans/neo4j-removal.md`.
 */

import "server-only";
import { readOnlyQuery } from "./clickhouse-client";
import { db } from "@/db";
import { ammPools } from "@/db/schema";
import logger from "./logger";

const log = logger.child({ module: "smart-money" });

/* ══════════════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════════════ */

type LabelKey =
  | "profitable_trader"
  | "market_maker"
  | "early_lp"
  | "whale"
  | "validator";

interface LabelResult {
  label: LabelKey;
  confidence: number; // 0–1
  evidence: Record<string, unknown>;
}

export const LABEL_DISPLAY: Record<LabelKey, { name: string; color: string }> = {
  profitable_trader: { name: "Profitable Trader", color: "var(--color-success)" },
  market_maker: { name: "Market Maker", color: "var(--color-tx-offer)" },
  early_lp: { name: "Early LP", color: "var(--color-tx-amm)" },
  whale: { name: "Whale", color: "var(--color-brand)" },
  validator: { name: "Validator", color: "var(--color-chart-emerald)" },
};

/** Raw DEX trade row from ClickHouse.
 *
 * `xrp_volume_drops` is CH `Int64` and arrives as a decimal **string** via
 * JSONEachRow (Int64 exceeds JS Number's safe integer range — 2^53 — so
 * the CH driver string-encodes it). Consumers must call `Number(x)` for
 * approximate math (lossy past 9 quadrillion drops, ~9B XRP) or
 * `BigInt(x)` for exact arithmetic. Declaring as `number` here was a
 * type lie that worked accidentally because `Number("123")` happens to
 * coerce, but TS would have allowed `row.xrp_volume_drops + 1` which
 * would silently string-concat. */
export interface DexTradeRow {
  tx_hash: string;
  timestamp: string;
  ledger_index: number;
  taker: string;
  maker: string;
  base_currency: string;
  base_issuer: string;
  base_amount: number;
  quote_currency: string;
  quote_issuer: string;
  quote_amount: number;
  price: number;
  xrp_volume_drops: string;
}

/** Per-wallet per-token WAVG state */
interface TokenState {
  currency: string;
  issuer: string;
  qty: number;
  costBasis: number; // WAVG cost per unit (XRP-denominated)
  totalCost: number; // cumulative capital deployed
  realizedPnl: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  xrpVolumeDrops: number; // raw drops, not XRP — sourced directly from dex_trades.xrp_volume_drops
  firstTradeTs: string;
  lastTradeTs: string;
}

/** Individual sell event for smart exit detection */
interface SellEvent {
  currency: string;
  issuer: string;
  timestamp: string;
  price: number;
  qty: number;
}

/** Daily price range for smart exit detection */
export interface DailyPrice {
  day: string;
  low: number;
  high: number;
}

/** Penalty applied to composite score */
export interface Penalty {
  type: string;
  amount: number;
  reason: string;
}

/** Full wallet scoring result */
export interface WalletScore {
  wallet: string;
  profitabilityScore: number;
  roiScore: number;
  winRateScore: number;
  consistencyScore: number;
  earlyBuyerScore: number;
  smartExitScore: number;
  /** Wallet-seasoning factor (0-100). Composite of trading-history depth
   *  (days since first DEX trade) × distinct-counterparty count, both on
   *  log scales. Hard-to-fake signal that complements PnL-derived factors:
   *  bot farms can game win-rate but can't fast-forward time or fake
   *  decades of organic counterparty diversity. */
  seasoningScore: number;
  compositeScore: number;
  penalties: Penalty[];
  totalPnl: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  tokensTraded: number;
  washTradingFlag: boolean;
  tokenStates: TokenState[];
  sellEvents: SellEvent[];
}

/* ══════════════════════════════════════════════════════════════════════
   WAVG Cost Basis Computation
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Process dex_trades for a single wallet and compute WAVG cost basis
 * per token. Returns token states and sell events.
 *
 * Only processes XRP-paired trades (quote_currency = "XRP" or
 * base_currency = "XRP"). IOU-to-IOU trades are skipped.
 */
export function computeWAVGForWallet(
  trades: DexTradeRow[],
  wallet: string,
  tokenMinPrices?: Map<string, number>,
): { tokens: TokenState[]; sells: SellEvent[] } {
  const stateMap = new Map<string, TokenState>();
  const sells: SellEvent[] = [];

  function getState(currency: string, issuer: string): TokenState {
    const key = `${currency}:${issuer}`;
    let s = stateMap.get(key);
    if (!s) {
      s = {
        currency, issuer,
        qty: 0, costBasis: 0, totalCost: 0, realizedPnl: 0,
        tradeCount: 0, buyCount: 0, sellCount: 0, xrpVolumeDrops: 0,
        firstTradeTs: "", lastTradeTs: "",
      };
      stateMap.set(key, s);
    }
    return s;
  }

  function applyBuy(s: TokenState, qty: number, price: number, ts: string, xrpVol: number) {
    if (qty <= 0) return;
    const newQty = s.qty + qty;
    s.costBasis = newQty > 0 ? (s.qty * s.costBasis + qty * price) / newQty : price;
    s.qty = newQty;
    s.totalCost += qty * price;
    s.buyCount++;
    s.tradeCount++;
    s.xrpVolumeDrops += Math.abs(xrpVol);
    if (!s.firstTradeTs) s.firstTradeTs = ts;
    s.lastTradeTs = ts;
  }

  function applySell(s: TokenState, qty: number, price: number, ts: string, xrpVol: number) {
    if (qty <= 0) return;
    const effectiveQty = Math.min(qty, s.qty);

    // Covered portion — tokens we saw them buy in our window.
    if (effectiveQty > 0) {
      s.realizedPnl += (price - s.costBasis) * effectiveQty;
      s.qty -= effectiveQty;
      // WAVG property: costBasis stays the same on sells.
      // totalCost is cumulative capital deployed — don't reset it on full
      // exit, or computeROI / computeConsistency will see 0 capital for
      // wallets that realized PnL and output 0.
      if (s.qty <= 0) {
        s.qty = 0;
        s.costBasis = 0;
      }
    }

    // Uncovered portion — tokens sold with no prior buy in our window.
    // These are almost always pre-ingestion acquisitions (OG holders,
    // airdrops, memecoins held from launch). Impute a conservative cost
    // basis using the token's minimum observed price in our scoring
    // window — treats the wallet as if they had bought at our cheapest
    // visible price, so ROI is finite (not infinite) but still credits
    // the realized gain.
    const uncoveredQty = qty - effectiveQty;
    if (uncoveredQty > 0 && tokenMinPrices) {
      const key = `${s.currency}:${s.issuer}`;
      const minPrice = tokenMinPrices.get(key);
      if (minPrice !== undefined && minPrice > 0) {
        const imputedCost = minPrice * uncoveredQty;
        s.realizedPnl += (price - minPrice) * uncoveredQty;
        s.totalCost += imputedCost;
      }
    }

    s.sellCount++;
    s.tradeCount++;
    s.xrpVolumeDrops += Math.abs(xrpVol);
    if (!s.firstTradeTs) s.firstTradeTs = ts;
    s.lastTradeTs = ts;

    sells.push({ currency: s.currency, issuer: s.issuer, timestamp: ts, price, qty: effectiveQty + uncoveredQty });
  }

  for (const t of trades) {
    const baseAmt = Number(t.base_amount) || 0;
    const quoteAmt = Number(t.quote_amount) || 0;
    const price = Number(t.price) || 0;
    const xrpVol = Number(t.xrp_volume_drops) || 0;
    const ts = t.timestamp;

    if (baseAmt <= 0 || price <= 0) continue;

    const isXrpQuote = t.quote_currency === "XRP" && t.quote_issuer === "";
    const isXrpBase = t.base_currency === "XRP" && t.base_issuer === "";

    if (!isXrpQuote && !isXrpBase) continue; // Skip IOU-to-IOU

    if (isXrpQuote) {
      // Base is the token, quote is XRP. Price = XRP per token unit.
      const s = getState(t.base_currency, t.base_issuer);
      if (wallet === t.taker) {
        // Taker bought base token, paying XRP
        applyBuy(s, baseAmt, price, ts, xrpVol);
      } else if (wallet === t.maker) {
        // Maker sold base token, receiving XRP
        applySell(s, baseAmt, price, ts, xrpVol);
      }
    } else if (isXrpBase) {
      // Base is XRP, quote is the token. This row is from the perspective
      // where XRP is "base". The token is quote_currency.
      // Price here = quote_amount / base_amount (tokens per XRP).
      // We need XRP per token = 1 / price for token valuation.
      const tokenPrice = price > 0 ? 1 / price : 0;
      if (tokenPrice <= 0) continue;
      const tokenQty = quoteAmt;
      const s = getState(t.quote_currency, t.quote_issuer);
      if (wallet === t.taker) {
        // Taker paid XRP (base), receiving tokens (quote) → taker BOUGHT tokens
        applyBuy(s, tokenQty, tokenPrice, ts, xrpVol);
      } else if (wallet === t.maker) {
        // Maker offered tokens (quote), receiving XRP (base) → maker SOLD tokens
        applySell(s, tokenQty, tokenPrice, ts, xrpVol);
      }
    }
  }

  return { tokens: Array.from(stateMap.values()), sells };
}

/* ══════════════════════════════════════════════════════════════════════
   6 Scoring Factors (each returns 0-100)
   ══════════════════════════════════════════════════════════════════════ */

/** Factor 2: ROI — return on capital deployed. Sqrt curve: 14x = 100. */
export function computeROI(tokenStates: TokenState[]): number {
  let totalPnl = 0;
  let totalCapital = 0;
  for (const t of tokenStates) {
    totalPnl += t.realizedPnl;
    totalCapital += t.totalCost;
  }
  if (totalCapital <= 0) return 0;
  const roi = totalPnl / totalCapital;
  if (roi <= 0) return 0;
  // Sqrt curve calibrated for XRPL: 14x return = max score. Solana
  // memecoin platforms calibrate around 10-100x because their tail is
  // wild; XRPL's liquid universe is ~10 issued assets + a memecoin
  // long-tail that rarely runs past 5x. 14x is "best XRPL trader anyone
  // has ever seen" territory — properly aspirational for a 100 score.
  // Curve points: 1x = 27, 2x = 38, 4x = 53, 10x = 85, 14x = 100.
  return Math.min(Math.sqrt(roi / 14) * 100, 100);
}

/** Factor 3: Win Rate — % of tokens sold at profit (per-token, not per-trade). */
export function computeWinRate(tokenStates: TokenState[]): number {
  const tokensWithSells = tokenStates.filter((t) => t.sellCount > 0);
  if (tokensWithSells.length === 0) return 0;
  const wins = tokensWithSells.filter((t) => t.realizedPnl > 0).length;
  return (wins / tokensWithSells.length) * 100;
}

/** Factor 4: Consistency — Sharpe ratio of per-token returns. 4+ = 100. */
export function computeConsistency(tokenStates: TokenState[]): { sharpe: number; score: number } {
  const tokensWithSells = tokenStates.filter((t) => t.sellCount > 0);
  if (tokensWithSells.length < 2) return { sharpe: 0, score: 0 };

  const returns = tokensWithSells.map((t) => {
    const capital = t.totalCost;
    return capital > 0 ? t.realizedPnl / capital : 0;
  });

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  // Sample variance (Bessel's correction): divide by N-1, not N. Matters
  // most at the 2-token floor where the population estimator inflates
  // Sharpe noticeably; converges to the same value as N grows.
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? mean / stdDev : 0;
  // Sharpe of 4 across token returns is genuinely near-impossible — that's
  // mean return = 4 × stdev, i.e. wins consistently dwarf the spread of
  // outcomes. Calibration points: Sharpe 1 = 25, 2 = 50, 3 = 75, 4 = 100.
  const score = Math.min(Math.max((sharpe / 4) * 100, 0), 100);

  return { sharpe: Math.round(sharpe * 1000) / 1000, score };
}

/**
 * Factor 5: Early Buyer — % of PnL from tokens traded within 24h of
 * first-ever DEX trade. 65%+ early PnL ratio = max score.
 */
export function computeEarlyBuyer(
  tokenStates: TokenState[],
  firstTradeMap: Map<string, Date>,
): number {
  let earlyPnl = 0;
  let totalPnl = 0;

  for (const t of tokenStates) {
    if (t.realizedPnl <= 0) continue; // Only count profitable tokens
    totalPnl += t.realizedPnl;

    const key = `${t.currency}:${t.issuer}`;
    const firstEver = firstTradeMap.get(key);
    if (!firstEver || !t.firstTradeTs) continue;

    const walletFirst = new Date(t.firstTradeTs).getTime();
    const tokenFirst = firstEver.getTime();
    const hoursDiff = (walletFirst - tokenFirst) / (1000 * 60 * 60);

    if (hoursDiff >= 0 && hoursDiff <= 24) {
      earlyPnl += t.realizedPnl;
    }
  }

  if (totalPnl <= 0) return 0;
  const ratio = earlyPnl / totalPnl;
  // Squared curve: a wallet whose ENTIRE profitable PnL came from <24h-
  // after-launch buys scores 100; anything less decays sharply. Old
  // calibration (65% = 100) let cherry-picked single-token snipes max
  // out the factor on what was effectively one early hit. Square the
  // ratio so 50% = 25, 70% = 49, 90% = 81, 100% = 100.
  return Math.min(ratio * ratio * 100, 100);
}

/**
 * Factor 7: Wallet seasoning — `log10(age_days) × log10(distinct_counterparties)`,
 * scaled to 0-100. Hard-to-fake signal that complements the PnL-derived
 * factors: a freshly-funded farm wallet can game win-rate + ROI but
 * can't fast-forward time or fake organic counterparty diversity.
 *
 * Sources:
 *   - `ageDays` is days since the wallet's first trade in the trades
 *     array (which is sorted ascending in `fetchWalletTrades`).
 *   - `distinct counterparties` = unique addresses on the OTHER side
 *     of every trade in the array (taker if wallet is maker, maker if
 *     wallet is taker). DEX-side only — payments would broaden coverage
 *     but value_transfer_events is only populated forward from
 *     2026-04-28 (see CLAUDE.md), so trade-side keeps the signal stable
 *     across the historical window.
 *
 * Distribution intuition:
 *   - 30 days × 5 counterparties → log10(30) × log10(5) ≈ 1.03  → ~11
 *   - 1 year × 50 counterparties → 2.56 × 1.70 ≈ 4.35           → ~48
 *   - 3 years × 200 counterparties → 3.04 × 2.30 ≈ 6.99         → ~78
 *   - 5 years × 1000 counterparties → 3.26 × 3.00 ≈ 9.78        → 100 (capped)
 *
 * The /9 scale factor places a "seasoned but not whale" wallet around
 * 50, which is the right neutral point for a 0-100 factor.
 */
export function computeSeasoning(trades: DexTradeRow[], wallet: string): number {
  if (trades.length === 0) return 0;

  const firstTradeMs = new Date(trades[0].timestamp).getTime();
  const ageDays = (Date.now() - firstTradeMs) / 86_400_000;
  if (ageDays < 1) return 0; // Brand-new wallets get no seasoning credit.

  const counterparties = new Set<string>();
  for (const t of trades) {
    const cp = t.taker === wallet ? t.maker : t.taker;
    if (cp && cp !== wallet) counterparties.add(cp);
  }
  if (counterparties.size < 1) return 0;

  const raw = Math.log10(ageDays) * Math.log10(counterparties.size);
  return Math.max(0, Math.min(100, (raw / 9) * 100));
}

/**
 * Factor 6: Smart Exits — % of sells preceding >20% drawdowns within 7d.
 */
export function computeSmartExits(
  sellEvents: SellEvent[],
  dailyPriceMap: Map<string, DailyPrice[]>,
): number {
  if (sellEvents.length === 0) return 0;

  let smartExits = 0;
  let totalSells = 0;

  for (const sell of sellEvents) {
    if (sell.qty <= 0 || sell.price <= 0) continue;
    totalSells++;

    const key = `${sell.currency}:${sell.issuer}`;
    const prices = dailyPriceMap.get(key);
    if (!prices) continue;

    const sellDate = new Date(sell.timestamp);
    const sellMs = sellDate.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Find min price in 7 days after sell
    let minPriceAfter = Infinity;
    for (const dp of prices) {
      const dayMs = new Date(dp.day).getTime();
      if (dayMs > sellMs && dayMs <= sellMs + sevenDaysMs) {
        if (dp.low < minPriceAfter) minPriceAfter = dp.low;
      }
    }

    if (minPriceAfter === Infinity) continue; // No subsequent price data

    const drawdown = (sell.price - minPriceAfter) / sell.price;
    if (drawdown > 0.25) smartExits++;
  }

  if (totalSells === 0) return 0;
  // Squared curve: scoring 100 requires literally every sell preceding a
  // ≥25% drawdown within 7 days. Old `(smart/total) × 100` was too easy —
  // most XRPL memes do ≥20% drawdowns weekly so a meme-trader hit ~100
  // by selling memes at all. Squaring + bumping the threshold to 25%
  // makes 100 actually mean "knew when to get out, every single time."
  // Calibration points: 50% smart = 25, 75% = 56, 90% = 81, 100% = 100.
  const ratio = smartExits / totalSells;
  return ratio * ratio * 100;
}

/* ══════════════════════════════════════════════════════════════════════
   Penalties
   ══════════════════════════════════════════════════════════════════════ */

/** Apply penalties to a WalletScore (mutates the penalties array). */
export function computePenalties(score: WalletScore): void {
  // Wash trading
  if (score.washTradingFlag) {
    score.penalties.push({
      type: "wash_trading",
      amount: 50,
      reason: "Wash trading detected (Chainalysis heuristic)",
    });
  }

  // Suspicious bot activity. Tightened from "win rate > 95% AND total
  // trades > 50" — old thresholds were trivially clearable by any
  // high-frequency human trader (25 tokens × 3 trades = 75). New bar
  // matches industry consensus (>90% win rate is the suspicious zone)
  // and uses the same 25-token universe floor for the count side.
  //
  // Denominator must be tokens-with-sells, NOT total tokensTraded:
  // winRate is computed only over tokens that the wallet actually sold,
  // so checking against the full position count (which includes buy-only
  // bags) lets a wallet with 30 positions and 4 perfect exits hit the
  // penalty on what is actually 4 tokens of evidence.
  const tokensWithSells = score.tokenStates.filter((t) => t.sellCount > 0).length;
  if (score.winRate > 90 && tokensWithSells > 25) {
    score.penalties.push({
      type: "suspicious_bot",
      amount: 30,
      reason: "Win rate >90% across >25 sold tokens — bot pattern",
    });
  }

  // Single-token concentration. Bumped from -5 to -15 because the old
  // amount was barely felt. A wallet with 95%+ of PnL from one token is
  // essentially scoring a single lottery ticket; that should cost real
  // composite points, not a token nudge.
  //
  // Denominator must be the sum of POSITIVE realized PnL, not net total.
  // A wallet with one big winner (10k) and one big loser (-9k) has net
  // PnL of 1k, so maxTokenPnl/totalPnl = 10 — penalty fires on what is
  // actually a 50/50 winner-loser split (i.e. genuine diversification).
  if (score.tokenStates.length > 0) {
    const positivePnl = score.tokenStates.reduce(
      (sum, t) => (t.realizedPnl > 0 ? sum + t.realizedPnl : sum),
      0,
    );
    if (positivePnl > 0) {
      const maxTokenPnl = Math.max(...score.tokenStates.map((t) => t.realizedPnl));
      if (maxTokenPnl / positivePnl > 0.95) {
        score.penalties.push({
          type: "single_token",
          // Reduced 15 → 8 on 2026-05-10. The 15-point hit was
          // pushing genuinely-large-PnL wallets too far down — a
          // wallet with $2.6M from one token still has $2.6M and
          // should rank meaningfully high. Penalty stays so
          // one-pump-pony wallets don't fully outrank diversified
          // skill, but at 8 it's a flag rather than a death sentence.
          amount: 8,
          reason: "95%+ of positive PnL from single token",
        });
      }
    }
  }
}

/** Compute final composite score from factor scores and penalties.
 *
 *  Weighting philosophy: reward *repeatable* skill over single-token luck.
 *  Raw profitability (percentile rank by total PnL) is kept but heavily
 *  de-emphasized — Nansen's research found that returns ABOVE the 20th
 *  percentile actually get *worse*, not better, because the very-top is
 *  luck-dominated. We cap the percentile contribution at 95 so a wallet
 *  ranked 99.9th doesn't outscore one at 90th on this factor alone.
 *
 *  The seasoning factor (7%) carries a hard-to-fake signal — wallet age
 *  × distinct-counterparty count, both on log scales — that bot farms
 *  can't game by tweaking trade frequency. Other factor weights were
 *  trimmed proportionally to make room.
 */
/**
 * Composite weights — outcome-heavy reshape, 2026-05-10. Pre-reshape
 * the formula gave 32% to timing factors (early_buyer 14% + smart_exits
 * 18%) and 37% to outcome (profitability 14% + roi 23%). Net effect:
 * a wallet with 59 XRP profit but perfect timing scored 67 while a
 * wallet with 2.6M XRP profit and average timing scored 33. The
 * leaderboard's headline was a $32-per-token memecoin micro-trader.
 *
 * New split: outcome 58% (profitability 25 + roi 33), timing 12%
 * (early_buyer 5 + smart_exits 7), process factors unchanged
 * (win_rate 12 + consistency 12 + seasoning 6). PnL + ROI become
 * the dominant signals, which is what "smart money" should mean.
 *
 * Profitability cap was 95 (preventing the very-top noise band from
 * single-handedly inflating composite). Lifted to 100 alongside the
 * penalty reduction since the smaller single-token penalty already
 * tempers any "hit one pump and dominate" risk and we want raw-PnL
 * leaders to reach near-100.
 *
 * The SQL re-rank pass at the end of the scorer pipeline mirrors
 * these weights — keep both in sync if they change again.
 */
export function computeCompositeScore(score: WalletScore): void {
  const cappedProfitability = Math.min(100, score.profitabilityScore);
  const raw =
    cappedProfitability * 0.25 +
    score.roiScore * 0.33 +
    score.winRateScore * 0.12 +
    score.consistencyScore * 0.12 +
    score.earlyBuyerScore * 0.05 +
    score.smartExitScore * 0.07 +
    score.seasoningScore * 0.06;

  const totalPenalty = score.penalties.reduce((s, p) => s + p.amount, 0);
  score.compositeScore = Math.max(0, Math.min(100, raw - totalPenalty));
}

/* ══════════════════════════════════════════════════════════════════════
   Profitability Percentile (requires global data)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Assign profitability scores based on percentile ranking across all wallets.
 * Must be called after all wallets are scored but before compositeScore.
 */
export function assignPercentileScores(scores: WalletScore[]): void {
  // Sort by total PnL ascending for percentile calculation
  const sorted = [...scores].sort((a, b) => a.totalPnl - b.totalPnl);
  const n = sorted.length;

  for (let i = 0; i < n; i++) {
    const percentile = n > 1 ? (i / (n - 1)) * 100 : 50;
    sorted[i].profitabilityScore = Math.round(percentile * 100) / 100;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Legacy Label Derivation (backward compat with account_labels)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Derive legacy labels from the new composite score system.
 * This keeps SmartMoneyBadges and /api/intel/labels working.
 */
export function deriveLegacyLabels(score: WalletScore): LabelResult[] {
  const labels: LabelResult[] = [];

  // profitable_trader: composite >= 50 AND strong profitability percentile
  // (top ~5% under recalibrated curves where peak score ~64).
  if (score.compositeScore >= 50 && score.profitabilityScore >= 50) {
    labels.push({
      label: "profitable_trader",
      confidence: Math.round((score.profitabilityScore / 100) * 1000) / 1000,
      evidence: {
        compositeScore: score.compositeScore,
        totalPnl: Math.round(score.totalPnl * 100) / 100,
        winRate: score.winRate,
        period: "30d",
      },
    });
  }

  return labels;
}

/* ══════════════════════════════════════════════════════════════════════
   Legacy Label Scorers (kept for market_maker, early_lp, whale,
   validator — these are supplementary badges, not part of the
   composite score)
   ══════════════════════════════════════════════════════════════════════ */

/* ── Market Maker ── */

async function scoreMarketMaker(account: string): Promise<LabelResult | null> {
  try {
    const rows = await readOnlyQuery(
      `SELECT
         count(*) AS total_trades,
         uniqExact(base_currency, base_issuer, quote_currency, quote_issuer) AS unique_pairs,
         countIf(taker = {account:String}) AS taker_trades,
         countIf(maker = {account:String}) AS maker_trades
       FROM dex_trades
       WHERE (taker = {account:String} OR maker = {account:String})
         AND timestamp > now() - INTERVAL 30 DAY
       LIMIT 1`,
      { account },
    );

    if (!rows.length) return null;
    const r = rows[0] as { total_trades: number; unique_pairs: number; taker_trades: number; maker_trades: number };
    const totalTrades = Number(r.total_trades) || 0;
    const takerTrades = Number(r.taker_trades) || 0;
    const makerTrades = Number(r.maker_trades) || 0;

    if (totalTrades < 100 || takerTrades < 10 || makerTrades < 10) return null;

    const bothSidesRatio = Math.min(takerTrades, makerTrades) / Math.max(takerTrades, makerTrades);
    if (bothSidesRatio < 0.1) return null;

    const confidence = Math.min(1, 0.5 + (totalTrades / 1000) * 0.3 + bothSidesRatio * 0.2);

    return {
      label: "market_maker",
      confidence: Math.round(confidence * 1000) / 1000,
      evidence: { totalTrades, takerTrades, makerTrades, bothSidesRatio: Math.round(bothSidesRatio * 100) / 100, period: "30d" },
    };
  } catch {
    return null;
  }
}

/* ── Early LP ── */

async function scoreEarlyLP(account: string): Promise<LabelResult | null> {
  try {
    const depositRows = await readOnlyQuery(
      `SELECT timestamp, tx_hash
       FROM transactions
       WHERE account = {account:String}
         AND tx_type = 'AMMDeposit'
         AND result = 'tesSUCCESS'
       ORDER BY timestamp ASC
       LIMIT 50`,
      { account },
    );

    if (!depositRows.length) return null;

    const pools = await db
      .select({ account: ammPools.account, createdAt: ammPools.createdAt })
      .from(ammPools);

    if (!pools.length) return null;

    let earlyDeposits = 0;
    for (const deposit of depositRows) {
      const depositTime = new Date((deposit as { timestamp: string }).timestamp).getTime();
      for (const pool of pools) {
        if (!pool.createdAt) continue;
        const poolTime = new Date(pool.createdAt).getTime();
        const hoursAfter = (depositTime - poolTime) / (1000 * 60 * 60);
        if (hoursAfter >= 0 && hoursAfter <= 24) {
          earlyDeposits++;
          break;
        }
      }
    }

    if (earlyDeposits === 0) return null;

    const confidence = Math.min(1, 0.6 + earlyDeposits * 0.1);

    return {
      label: "early_lp",
      confidence: Math.round(confidence * 1000) / 1000,
      evidence: { earlyDeposits, totalDeposits: depositRows.length },
    };
  } catch {
    return null;
  }
}

/* ── Whale ── */

let whaleThreshold = 0;
let whaleThresholdAt = 0;

async function getWhaleThreshold(): Promise<number> {
  if (whaleThreshold > 0 && Date.now() - whaleThresholdAt < 24 * 60 * 60 * 1000) {
    return whaleThreshold;
  }

  const rows = await readOnlyQuery(
    `SELECT quantileExact(0.999)(total_volume) AS threshold
     FROM (
       SELECT
         account,
         sum(abs(amount_drops)) AS total_volume
       FROM transactions
       WHERE timestamp > now() - INTERVAL 30 DAY
         AND tx_type = 'Payment'
         AND account NOT IN ('', '__pseudo_tx__')
       GROUP BY account
     )
     LIMIT 1`,
  );

  whaleThreshold = Number((rows[0] as { threshold: number })?.threshold) || 1e15;
  whaleThresholdAt = Date.now();
  return whaleThreshold;
}

async function scoreWhale(account: string): Promise<LabelResult | null> {
  try {
    const threshold = await getWhaleThreshold();

    const rows = await readOnlyQuery(
      `SELECT sum(abs(amount_drops)) AS total_volume_drops
       FROM transactions
       WHERE account = {account:String}
         AND tx_type = 'Payment'
         AND timestamp > now() - INTERVAL 30 DAY
       LIMIT 1`,
      { account },
    );

    const volume = Number((rows[0] as { total_volume_drops: number })?.total_volume_drops) || 0;
    if (volume < threshold) return null;

    const confidence = Math.min(1, 0.7 + Math.min((volume / threshold - 1) * 0.15, 0.3));

    return {
      label: "whale",
      confidence: Math.round(confidence * 1000) / 1000,
      evidence: { volumeDrops: volume, thresholdDrops: threshold, period: "30d" },
    };
  } catch {
    return null;
  }
}

/* ── Validator ── */

const globalForValidators = globalThis as unknown as { _knownValidators?: Set<string> };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setKnownValidators(addresses: string[]) {
  globalForValidators._knownValidators = new Set(addresses);
}

function getKnownValidators(): Set<string> {
  return globalForValidators._knownValidators ?? new Set();
}

function scoreValidator(account: string): LabelResult | null {
  const validators = getKnownValidators();
  if (!validators.has(account)) return null;

  return {
    label: "validator",
    confidence: 1.0,
    evidence: { source: "xrplf_unl" },
  };
}

/**
 * Score all legacy labels for an account (supplementary badges).
 * Called by SmartMoneyScorer for backward compatibility.
 *
 * **Prefer `scoreLegacyLabelsBatch` for multi-account scoring** — this
 * single-account version makes 3 CH round trips per call. With ~1,800
 * wallets per scoring run that's 5,400+ queries sequentially which
 * dominates the pipeline runtime.
 */
export async function scoreLegacyLabels(account: string): Promise<LabelResult[]> {
  const results = await Promise.allSettled([
    scoreMarketMaker(account),
    scoreEarlyLP(account),
    scoreWhale(account),
    Promise.resolve(scoreValidator(account)),
  ]);

  return results
    .filter((r): r is PromiseFulfilledResult<LabelResult | null> => r.status === "fulfilled" && r.value != null)
    .map((r) => r.value!);
}

/* ══════════════════════════════════════════════════════════════════════
   Batched legacy-label scoring
   ──────────────────────────────────────────────────────────────────────
   Vectorizes scoreLegacyLabels across many accounts. Each underlying
   scorer was independently issuing a per-account query; batching
   collapses 3 × N round trips into 3 round trips total (one per
   sub-scorer), each grouping the result by account on the CH side.
   ══════════════════════════════════════════════════════════════════════ */

/** Wraps a sub-scorer in a try/catch so one failure doesn't poison the
 *  others. Returns an empty Map on failure (mirrors the per-account
 *  catch-and-return-null pattern of the single-scorer functions). */
async function safeBatch<T>(
  label: string,
  fn: () => Promise<Map<string, T>>,
): Promise<Map<string, T>> {
  try {
    return await fn();
  } catch (err) {
    // Surface failures to logs, but don't break the pipeline. Same
    // contract as the per-account scorers' silent `catch { return null }`.
    log.error({ err, label }, "batched legacy-label scorer failed");
    return new Map();
  }
}

interface MarketMakerStats {
  totalTrades: number;
  takerTrades: number;
  makerTrades: number;
}

async function scoreMarketMakerBatch(
  accounts: string[],
): Promise<Map<string, LabelResult>> {
  if (accounts.length === 0) return new Map();

  const rows = await readOnlyQuery<{
    account: string;
    total_trades: string | number;
    taker_trades: string | number;
    maker_trades: string | number;
  }>(
    // arrayJoin(arrayIntersect(...)) emits one row per matching account
    // from the [taker, maker] pair, so wallet-on-wallet trades count
    // for both sides correctly.
    `SELECT
       account,
       count(*)               AS total_trades,
       countIf(taker = account) AS taker_trades,
       countIf(maker = account) AS maker_trades
     FROM (
       SELECT
         taker,
         maker,
         arrayJoin(arrayIntersect([taker, maker], {accounts:Array(String)})) AS account
       FROM dex_trades
       WHERE (taker IN {accounts:Array(String)} OR maker IN {accounts:Array(String)})
         AND timestamp > now() - INTERVAL 30 DAY
     )
     GROUP BY account`,
    { accounts },
  );

  const out = new Map<string, LabelResult>();
  for (const r of rows) {
    const stats: MarketMakerStats = {
      totalTrades: Number(r.total_trades) || 0,
      takerTrades: Number(r.taker_trades) || 0,
      makerTrades: Number(r.maker_trades) || 0,
    };
    if (stats.totalTrades < 100 || stats.takerTrades < 10 || stats.makerTrades < 10) continue;

    const bothSidesRatio =
      Math.min(stats.takerTrades, stats.makerTrades) /
      Math.max(stats.takerTrades, stats.makerTrades);
    if (bothSidesRatio < 0.1) continue;

    const confidence = Math.min(
      1,
      0.5 + (stats.totalTrades / 1000) * 0.3 + bothSidesRatio * 0.2,
    );
    out.set(r.account, {
      label: "market_maker",
      confidence: Math.round(confidence * 1000) / 1000,
      evidence: {
        totalTrades: stats.totalTrades,
        takerTrades: stats.takerTrades,
        makerTrades: stats.makerTrades,
        bothSidesRatio: Math.round(bothSidesRatio * 100) / 100,
        period: "30d",
      },
    });
  }
  return out;
}

async function scoreEarlyLPBatch(
  accounts: string[],
): Promise<Map<string, LabelResult>> {
  if (accounts.length === 0) return new Map();

  // Pull AMMDeposit txs for all accounts in a single query, ordered so
  // the per-account first-50 slice is a sequential read.
  const depositRows = await readOnlyQuery<{
    account: string;
    timestamp: string;
    tx_hash: string;
  }>(
    `SELECT account, timestamp, tx_hash
     FROM transactions
     WHERE account IN {accounts:Array(String)}
       AND tx_type = 'AMMDeposit'
       AND result = 'tesSUCCESS'
     ORDER BY account ASC, timestamp ASC`,
    { accounts },
  );

  // Pool creation times — same query the single-account version makes,
  // but we now reuse the result across all accounts in the batch.
  const pools = await db
    .select({ account: ammPools.account, createdAt: ammPools.createdAt })
    .from(ammPools);

  if (!pools.length) return new Map();

  // Pre-sort pool createdAt timestamps for binary search. Currently
  // O(deposits × pools); sorting + bsearch makes it O(deposits × log(pools)).
  const poolTimes: number[] = [];
  for (const p of pools) {
    if (p.createdAt) poolTimes.push(p.createdAt.getTime());
  }
  poolTimes.sort((a, b) => a - b);

  // For each deposit, "early" means it landed within 24h after some
  // pool's creation. Binary-search the largest pool time ≤ deposit time;
  // if (deposit - pool) <= 24h it counts.
  function depositIsEarly(depositMs: number): boolean {
    let lo = 0;
    let hi = poolTimes.length - 1;
    let bestIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (poolTimes[mid] <= depositMs) {
        bestIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (bestIdx < 0) return false;
    const hoursAfter = (depositMs - poolTimes[bestIdx]) / (1000 * 60 * 60);
    return hoursAfter >= 0 && hoursAfter <= 24;
  }

  // Group deposits by account, take first 50, count "early" ones.
  const perAccount = new Map<string, { early: number; total: number }>();
  let prevAccount = "";
  let count = 0;
  for (const r of depositRows) {
    if (r.account !== prevAccount) {
      prevAccount = r.account;
      count = 0;
    }
    if (count >= 50) continue;
    count++;

    const depositMs = new Date(r.timestamp).getTime();
    const stats = perAccount.get(r.account) ?? { early: 0, total: 0 };
    stats.total++;
    if (depositIsEarly(depositMs)) stats.early++;
    perAccount.set(r.account, stats);
  }

  const out = new Map<string, LabelResult>();
  for (const [account, stats] of perAccount) {
    if (stats.early === 0) continue;
    // Match the per-account scorer's formula exactly: 0.6 base + 0.1
    // per early deposit, capped at 1. Evidence reports earlyDeposits +
    // totalDeposits (the latter capped at 50 by the per-account slice
    // above, same as the original LIMIT 50).
    const confidence = Math.min(1, 0.6 + stats.early * 0.1);
    out.set(account, {
      label: "early_lp",
      confidence: Math.round(confidence * 1000) / 1000,
      evidence: { earlyDeposits: stats.early, totalDeposits: stats.total },
    });
  }
  return out;
}

async function scoreWhaleBatch(
  accounts: string[],
): Promise<Map<string, LabelResult>> {
  if (accounts.length === 0) return new Map();

  const threshold = await getWhaleThreshold(); // already cached for 24h

  const rows = await readOnlyQuery<{
    account: string;
    total_volume_drops: string | number;
  }>(
    `SELECT
       account,
       sum(abs(amount_drops)) AS total_volume_drops
     FROM transactions
     WHERE account IN {accounts:Array(String)}
       AND tx_type = 'Payment'
       AND timestamp > now() - INTERVAL 30 DAY
     GROUP BY account`,
    { accounts },
  );

  const out = new Map<string, LabelResult>();
  for (const r of rows) {
    const volume = Number(r.total_volume_drops) || 0;
    if (volume < threshold) continue;

    const confidence = Math.min(1, 0.7 + Math.min((volume / threshold - 1) * 0.15, 0.3));
    out.set(r.account, {
      label: "whale",
      confidence: Math.round(confidence * 1000) / 1000,
      evidence: { volumeDrops: volume, thresholdDrops: threshold, period: "30d" },
    });
  }
  return out;
}

/**
 * Batched supplementary-label scorer. Returns a map of `address →
 * LabelResult[]`. Accounts with no qualifying labels are absent from
 * the map. ~3 orders of magnitude faster than calling
 * `scoreLegacyLabels(account)` in a loop, because each underlying
 * sub-scorer collapses to a single grouped query.
 */
export async function scoreLegacyLabelsBatch(
  accounts: string[],
): Promise<Map<string, LabelResult[]>> {
  if (accounts.length === 0) return new Map();

  // Each sub-scorer fails independently; partial results are fine.
  const [marketMakers, earlyLPs, whales] = await Promise.all([
    safeBatch("scoreMarketMakerBatch", () => scoreMarketMakerBatch(accounts)),
    safeBatch("scoreEarlyLPBatch", () => scoreEarlyLPBatch(accounts)),
    safeBatch("scoreWhaleBatch", () => scoreWhaleBatch(accounts)),
  ]);

  const knownValidators = getKnownValidators();
  const out = new Map<string, LabelResult[]>();
  for (const account of accounts) {
    const labels: LabelResult[] = [];
    const mm = marketMakers.get(account);
    if (mm) labels.push(mm);
    const lp = earlyLPs.get(account);
    if (lp) labels.push(lp);
    const wh = whales.get(account);
    if (wh) labels.push(wh);
    if (knownValidators.has(account)) {
      labels.push({
        label: "validator",
        confidence: 1.0,
        evidence: { source: "xrplf_unl" },
      });
    }
    if (labels.length > 0) out.set(account, labels);
  }
  return out;
}
