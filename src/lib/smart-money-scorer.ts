/**
 * SmartMoneyScorer — pipeline for composite smart money scoring.
 *
 * Triggered externally (Railway cron → scripts/run-smart-money-scorer.ts).
 * Fetches active DEX traders from ClickHouse, computes WAVG PnL per wallet
 * per token, derives 6 scoring factors, applies penalties, and upserts
 * results to Postgres + ClickHouse. Uses job_state for mutex locking so
 * overlapping triggers don't double-score.
 *
 * Replaces the old LabelManager with a far more accurate scoring system.
 */

import "server-only";
import { sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { smartMoneyScores, accountLabels, ammPools } from "@/db/schema";
// Scorer queries are hand-written internal SQL with known shapes — they
// pull O(50K) trade rows per scoring pass and are NOT subject to the
// 10K-row LLM safety cap that readOnlyQuery enforces. Using `query()`
// (which runs uncapped) lets scoring queries return their full result
// sets. The scorer is the canonical "trusted-internal large read" path.
import { query, insert } from "./clickhouse-client";
import {
  computeWAVGForWallet,
  computeROI,
  computeWinRate,
  computeConsistency,
  computeEarlyBuyer,
  computeSmartExits,
  computeSeasoning,
  computePenalties,
  computeCompositeScore,
  assignPercentileScores,
  deriveLegacyLabels,
  scoreLegacyLabelsBatch,
  type WalletScore,
  type DexTradeRow,
  type DailyPrice,
} from "./smart-money";
import logger from "./logger";

const log = logger.child({ module: "smart-money-scorer" });

const JOB_NAME = "smart_money_scorer";
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const HEARTBEAT_INTERVAL = 100;
const BATCH_SIZE = 50;
// Minimum distinct tokens a wallet must have traded in the last 30d to
// qualify for scoring. Bumped from 10 to 25 (2026-05-04) — practitioner
// consensus from Nansen + Cielo is that 10-trade wallets are dominated
// by short-streak luck rather than repeatable skill, so they need to
// be filtered out of the universe rather than scored and explained.
const MIN_TOKENS_TRADED = 25;
// Minimum 30-day XRP volume (in drops) for a wallet to qualify.
// 50K XRP (~$150K at $3 XRP) keeps the scored universe to wallets
// actually putting capital to work. The previous floor of 5K XRP let
// micro-traders on the leaderboard who'd traded ~$14K across 400
// tokens, scored perfect on timing factors, and topped the leaderboard
// with $50 of profit (caught in the 2026-05-10 audit). 10x bump
// raises the floor without cutting legitimate active traders.
const MIN_VOLUME_DROPS = 50_000 * 1_000_000;
const SCORING_WINDOW_DAYS = 90;

/* ── Mutex ── */

async function acquireLock(): Promise<boolean> {
  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();

  await db.execute(sql`
    INSERT INTO job_state (job_name, status, updated_at)
    VALUES (${JOB_NAME}, 'idle', NOW())
    ON CONFLICT (job_name) DO NOTHING
  `);

  const result = await db.execute<{ job_name: string }>(sql`
    UPDATE job_state
    SET status = 'running', locked_until = ${lockedUntil}, updated_at = NOW()
    WHERE job_name = ${JOB_NAME}
      AND (status != 'running' OR locked_until < NOW())
    RETURNING job_name
  `);

  return result.length > 0;
}

async function extendLock(): Promise<void> {
  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
  await db.execute(sql`
    UPDATE job_state
    SET locked_until = ${lockedUntil}, updated_at = NOW()
    WHERE job_name = ${JOB_NAME}
  `);
}

async function releaseLock(success: boolean, error?: string): Promise<void> {
  await db.execute(sql`
    UPDATE job_state
    SET
      status = ${success ? "idle" : "failed"},
      locked_until = NULL,
      last_run_at = NOW(),
      run_count = run_count + 1,
      last_error = ${error ?? null},
      updated_at = NOW()
    WHERE job_name = ${JOB_NAME}
  `);
}

/* ── State persistence ── */

async function getLastScoredTimestamp(): Promise<string | null> {
  const rows = await db.execute<{ state_json: { lastScoredTimestamp?: string } | null }>(sql`
    SELECT state_json FROM job_state WHERE job_name = ${JOB_NAME}
  `);
  if (!rows.length) return null;
  return rows[0].state_json?.lastScoredTimestamp ?? null;
}

async function updateLastScoredTimestamp(ts: string): Promise<void> {
  // jsonb_build_object sidesteps the double-encoding trap that
  // ${JSON.stringify(x)}::jsonb can fall into with some driver/version
  // combos (where a pre-stringified JSON string gets re-encoded as a
  // jsonb string instead of parsed into a jsonb object).
  await db.execute(sql`
    UPDATE job_state
    SET state_json = jsonb_build_object('lastScoredTimestamp', ${ts}::text)
    WHERE job_name = ${JOB_NAME}
  `);
}

/* ── Data fetching ── */

/**
 * ClickHouse `DateTime` can't parse ISO 8601 (`2026-04-21T20:52:11.994Z`).
 * Convert to `'2026-04-21 20:52:11'` before interpolating.
 */
function toClickHouseDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

async function getWalletsWithNewTrades(since: string | null): Promise<string[]> {
  const sinceClause = since
    ? `AND timestamp > '${toClickHouseDateTime(since)}'`
    : `AND timestamp > now() - INTERVAL ${SCORING_WINDOW_DAYS} DAY`;

  const rows = await query(
    `SELECT DISTINCT account FROM (
      SELECT taker AS account FROM dex_trades WHERE taker != '' ${sinceClause}
      UNION ALL
      SELECT maker AS account FROM dex_trades WHERE maker != '' ${sinceClause}
    )`,
  );

  return rows.map((r) => (r as { account: string }).account).filter(Boolean);
}

/** AMM pool pseudo-accounts — these are real on-ledger accounts that
 *  appear as makers on every AMM swap, so they sail through the trade-
 *  count universe filter and get scored as if they were traders. They
 *  are deterministic protocol accounts, not human/bot wallets — exclude
 *  before scoring. Caught in the 2026-05-04 audit. */
async function getAmmPoolAccounts(): Promise<Set<string>> {
  const rows = await db.select({ account: ammPools.account }).from(ammPools);
  return new Set(rows.map((r) => r.account));
}

async function filterByMinimumActivity(wallets: string[]): Promise<string[]> {
  if (wallets.length === 0) return [];

  // Query ClickHouse for distinct token count + total XRP volume per
  // wallet in last 30d. Two corrections vs the prior version:
  //
  //   1. Token side coverage. Trades on XRPL come with the IOU as base
  //      OR quote depending on which side led the offer. The old query
  //      only counted base_currency:base_issuer pairs, so a wallet that
  //      traded exclusively as XRP-base/IOU-quote silently failed the
  //      25-token threshold. We normalize: when XRP is the base, the
  //      token IS the quote side.
  //
  //   2. IOU-IOU exclusion. Trades with no XRP leg can't be scored by
  //      WAVG (computeWAVGForWallet skips them) so they shouldn't
  //      qualify a wallet for scoring either.
  //
  //   3. Volume floor. 25 distinct token "touches" with $30 of volume
  //      is a faucet wallet, not smart money — the audit found multiple
  //      $32-PnL wallets sitting on the leaderboard from this gap.
  const qualified: string[] = [];
  const chunkSize = 500;

  for (let i = 0; i < wallets.length; i += chunkSize) {
    const chunk = wallets.slice(i, i + chunkSize);
    const placeholders = chunk.map((w) => `'${w}'`).join(",");

    const rows = await query(
      `SELECT
         account,
         uniqExact(token_currency, token_issuer) AS token_count,
         sum(xrp_vol) AS total_volume_drops
       FROM (
         SELECT
           taker AS account,
           if(base_currency = 'XRP' AND base_issuer = '', quote_currency, base_currency) AS token_currency,
           if(base_currency = 'XRP' AND base_issuer = '', quote_issuer, base_issuer) AS token_issuer,
           xrp_volume_drops AS xrp_vol
         FROM dex_trades
         WHERE taker IN (${placeholders})
           AND ((base_currency = 'XRP' AND base_issuer = '') OR (quote_currency = 'XRP' AND quote_issuer = ''))
           AND timestamp > now() - INTERVAL 30 DAY
         UNION ALL
         SELECT
           maker AS account,
           if(base_currency = 'XRP' AND base_issuer = '', quote_currency, base_currency) AS token_currency,
           if(base_currency = 'XRP' AND base_issuer = '', quote_issuer, base_issuer) AS token_issuer,
           xrp_volume_drops AS xrp_vol
         FROM dex_trades
         WHERE maker IN (${placeholders})
           AND ((base_currency = 'XRP' AND base_issuer = '') OR (quote_currency = 'XRP' AND quote_issuer = ''))
           AND timestamp > now() - INTERVAL 30 DAY
       )
       GROUP BY account
       HAVING token_count >= ${MIN_TOKENS_TRADED}
          AND total_volume_drops >= ${MIN_VOLUME_DROPS}`,
    );

    for (const r of rows) {
      qualified.push((r as { account: string }).account);
    }
  }

  return qualified;
}

/* ── Wash trading detection ── */

async function detectWashTrading(): Promise<Set<string>> {
  const flagged = new Set<string>();

  // Chainalysis heuristic: buy+sell within 25 blocks, volume diff <1%, 3+ occurrences
  try {
    const rows = await query(
      `SELECT t1.taker AS account
       FROM dex_trades t1
       INNER JOIN dex_trades t2 ON
         t1.taker = t2.maker
         AND t1.base_currency = t2.base_currency
         AND t1.base_issuer = t2.base_issuer
         AND t2.ledger_index BETWEEN t1.ledger_index AND t1.ledger_index + 25
         AND abs(t1.base_amount - t2.base_amount) / greatest(t1.base_amount, 0.0001) < 0.01
       WHERE t1.timestamp > now() - INTERVAL 30 DAY
         AND t1.taker != ''
       GROUP BY t1.taker
       HAVING count(*) >= 3`,
    );
    for (const r of rows) flagged.add((r as { account: string }).account);
  } catch (err) {
    log.warn({ err }, "Wash trading detection (cross-trade) failed — continuing");
  }

  // Self-trades: taker = maker
  try {
    const rows = await query(
      `SELECT taker, count(*) AS self_trade_count
       FROM dex_trades
       WHERE taker = maker
         AND taker != ''
         AND timestamp > now() - INTERVAL 30 DAY
       GROUP BY taker
       HAVING self_trade_count >= 3`,
    );
    for (const r of rows) flagged.add((r as { taker: string }).taker);
  } catch (err) {
    log.warn({ err }, "Wash trading detection (self-trade) failed — continuing");
  }

  return flagged;
}

/* ── Shared data pre-computation ── */

async function getTokenFirstTrades(): Promise<Map<string, Date>> {
  // Normalize so the IOU side is always the "token", whether it sits in
  // base or quote. Without this, tokens that only ever traded as
  // XRP-base/IOU-quote silently miss the early-buyer lookup and never
  // score on Factor 5. Caught in the 2026-05-04 audit.
  const map = new Map<string, Date>();
  const rows = await query(
    `SELECT token_currency, token_issuer, min(timestamp) AS first_trade
     FROM (
       SELECT
         if(base_currency = 'XRP' AND base_issuer = '', quote_currency, base_currency) AS token_currency,
         if(base_currency = 'XRP' AND base_issuer = '', quote_issuer, base_issuer) AS token_issuer,
         timestamp
       FROM dex_trades
       WHERE (base_currency = 'XRP' AND base_issuer = '') OR (quote_currency = 'XRP' AND quote_issuer = '')
     )
     GROUP BY token_currency, token_issuer`,
  );

  for (const r of rows) {
    const row = r as { token_currency: string; token_issuer: string; first_trade: string };
    map.set(`${row.token_currency}:${row.token_issuer}`, new Date(row.first_trade));
  }

  return map;
}

async function getDailyPriceRanges(): Promise<Map<string, DailyPrice[]>> {
  // Same normalization as getTokenFirstTrades — IOU-side as the token.
  // For XRP-base trades, price is in tokens-per-XRP, so we flip to
  // XRP-per-token (1/price) to match how WAVG values quote-side tokens.
  const map = new Map<string, DailyPrice[]>();
  const rows = await query(
    `SELECT
       token_currency, token_issuer, day,
       min(token_price) AS low,
       max(token_price) AS high
     FROM (
       SELECT
         if(base_currency = 'XRP' AND base_issuer = '', quote_currency, base_currency) AS token_currency,
         if(base_currency = 'XRP' AND base_issuer = '', quote_issuer, base_issuer) AS token_issuer,
         if(base_currency = 'XRP' AND base_issuer = '', 1.0 / price, price) AS token_price,
         toDate(timestamp) AS day
       FROM dex_trades
       WHERE timestamp > now() - INTERVAL ${SCORING_WINDOW_DAYS} DAY
         AND price > 0
         AND ((base_currency = 'XRP' AND base_issuer = '') OR (quote_currency = 'XRP' AND quote_issuer = ''))
     )
     WHERE token_price > 0
     GROUP BY token_currency, token_issuer, day
     ORDER BY token_currency, token_issuer, day`,
  );

  for (const r of rows) {
    const row = r as { token_currency: string; token_issuer: string; day: string; low: number; high: number };
    const key = `${row.token_currency}:${row.token_issuer}`;
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push({ day: row.day, low: Number(row.low), high: Number(row.high) });
  }

  return map;
}

/* ── Per-wallet scoring ── */

async function fetchWalletTrades(wallet: string): Promise<DexTradeRow[]> {
  const rows = await query(
    `SELECT
       tx_hash, timestamp, ledger_index, taker, maker,
       base_currency, base_issuer, base_amount,
       quote_currency, quote_issuer, quote_amount,
       price, xrp_volume_drops
     FROM dex_trades
     WHERE (taker = {wallet:String} OR maker = {wallet:String})
       AND timestamp > now() - INTERVAL ${SCORING_WINDOW_DAYS} DAY
     ORDER BY timestamp ASC, ledger_index ASC`,
    { wallet },
  );

  return rows as unknown as DexTradeRow[];
}

async function scoreWallet(
  wallet: string,
  washFlags: Set<string>,
  firstTradeMap: Map<string, Date>,
  dailyPriceMap: Map<string, DailyPrice[]>,
  tokenMinPrices: Map<string, number>,
): Promise<WalletScore | null> {
  const trades = await fetchWalletTrades(wallet);
  if (trades.length === 0) return null;

  const { tokens, sells } = computeWAVGForWallet(trades, wallet, tokenMinPrices);
  if (tokens.length === 0) return null;

  const totalPnl = tokens.reduce((s, t) => s + t.realizedPnl, 0);
  const totalTrades = tokens.reduce((s, t) => s + t.tradeCount, 0);
  const winRateValue = computeWinRate(tokens);
  const { sharpe, score: consistencyScore } = computeConsistency(tokens);

  const score: WalletScore = {
    wallet,
    profitabilityScore: 0, // Set later by percentile ranking
    roiScore: computeROI(tokens),
    winRateScore: winRateValue,
    consistencyScore,
    earlyBuyerScore: computeEarlyBuyer(tokens, firstTradeMap),
    smartExitScore: computeSmartExits(sells, dailyPriceMap),
    seasoningScore: computeSeasoning(trades, wallet),
    compositeScore: 0, // Set after penalties
    penalties: [],
    totalPnl,
    totalTrades,
    winRate: winRateValue,
    sharpeRatio: sharpe,
    tokensTraded: tokens.length,
    washTradingFlag: washFlags.has(wallet),
    tokenStates: tokens,
    sellEvents: sells,
  };

  computePenalties(score);
  return score;
}

/* ── Persistence ──────────────────────────────────────────────────────
 * All writes are batched. The previous per-wallet implementation made
 * ~7 round trips per wallet × ~1,800 wallets = ~13K serialized round
 * trips, dominating pipeline runtime (~3 hours). The batched versions
 * collapse to O(1) round trip per chunk per table.
 *
 * Chunk size is conservative (1000 rows) — Postgres has a 65,535
 * placeholder limit per query and our widest table (smart_money_scores)
 * has 16 columns, so 1000 × 16 = 16K placeholders / chunk leaves
 * plenty of headroom. CH inserts have no equivalent limit; we still
 * chunk for memory predictability.
 */

const WRITE_CHUNK_SIZE = 1000;

async function upsertScoresBatch(scores: WalletScore[]): Promise<void> {
  if (scores.length === 0) return;

  // Drizzle's typed insert handles jsonb columns correctly — passing
  // the JS array of penalty objects through Drizzle's serializer
  // sidesteps the `${JSON.stringify(x)}::jsonb` double-encoding trap
  // (CLAUDE.md / 2026-05-04 audit) where the postgres driver could
  // store a JSON-encoded STRING in a jsonb column instead of parsing
  // it into a real jsonb array.
  for (let i = 0; i < scores.length; i += WRITE_CHUNK_SIZE) {
    const chunk = scores.slice(i, i + WRITE_CHUNK_SIZE);
    const rows = chunk.map((s) => ({
      address: s.wallet,
      compositeScore: String(s.compositeScore),
      profitabilityScore: String(s.profitabilityScore),
      roiScore: String(s.roiScore),
      winRateScore: String(s.winRateScore),
      consistencyScore: String(s.consistencyScore),
      earlyBuyerScore: String(s.earlyBuyerScore),
      smartExitScore: String(s.smartExitScore),
      seasoningScore: String(s.seasoningScore),
      penalties: s.penalties,
      totalPnlXrp: String(s.totalPnl),
      totalTrades: s.totalTrades,
      winRate: String(s.winRate),
      sharpeRatio: String(s.sharpeRatio),
      tokensTraded: s.tokensTraded,
      washTradingFlag: s.washTradingFlag,
    }));

    await db
      .insert(smartMoneyScores)
      .values(rows)
      .onConflictDoUpdate({
        target: smartMoneyScores.address,
        set: {
          compositeScore: sql`EXCLUDED.composite_score`,
          profitabilityScore: sql`EXCLUDED.profitability_score`,
          roiScore: sql`EXCLUDED.roi_score`,
          winRateScore: sql`EXCLUDED.win_rate_score`,
          consistencyScore: sql`EXCLUDED.consistency_score`,
          earlyBuyerScore: sql`EXCLUDED.early_buyer_score`,
          smartExitScore: sql`EXCLUDED.smart_exit_score`,
          seasoningScore: sql`EXCLUDED.seasoning_score`,
          penalties: sql`EXCLUDED.penalties`,
          totalPnlXrp: sql`EXCLUDED.total_pnl_xrp`,
          totalTrades: sql`EXCLUDED.total_trades`,
          winRate: sql`EXCLUDED.win_rate`,
          sharpeRatio: sql`EXCLUDED.sharpe_ratio`,
          tokensTraded: sql`EXCLUDED.tokens_traded`,
          washTradingFlag: sql`EXCLUDED.wash_trading_flag`,
          scoredAt: sql`NOW()`,
        },
      });
  }
}

async function appendHistoryBatch(scores: WalletScore[]): Promise<void> {
  if (scores.length === 0) return;

  // CH `score_history` was migrated from PG on 2026-04-28. One CH
  // INSERT for the whole batch — every row shares the same scored_at
  // timestamp (this run's start), which mirrors the per-row NOW()
  // behavior of the old version closely enough for the trend chart.
  const now = new Date().toISOString().slice(0, 23).replace("T", " ");
  for (let i = 0; i < scores.length; i += WRITE_CHUNK_SIZE) {
    const chunk = scores.slice(i, i + WRITE_CHUNK_SIZE);
    await insert(
      "score_history",
      chunk.map((s) => ({
        scored_at: now,
        address: s.wallet,
        composite_score: s.compositeScore,
      })),
    );
  }
}

interface LegacyLabelRow {
  address: string;
  label: string;
  confidence: number;
  evidence: Record<string, unknown>;
}

async function upsertLegacyLabelsBatch(rows: LegacyLabelRow[]): Promise<void> {
  if (rows.length === 0) return;

  // Typed insert — same jsonb-double-encoding fix as upsertScoresBatch.
  for (let i = 0; i < rows.length; i += WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + WRITE_CHUNK_SIZE);
    const values = chunk.map((r) => ({
      address: r.address,
      label: r.label,
      confidence: String(r.confidence),
      evidenceJson: r.evidence,
    }));

    await db
      .insert(accountLabels)
      .values(values)
      .onConflictDoUpdate({
        target: [accountLabels.address, accountLabels.label],
        set: {
          confidence: sql`EXCLUDED.confidence`,
          evidenceJson: sql`EXCLUDED.evidence_json`,
          scoredAt: sql`NOW()`,
        },
      });
  }
}

async function flushWalletTokenPnl(scores: WalletScore[]): Promise<void> {
  const rows: Record<string, unknown>[] = [];

  for (const s of scores) {
    for (const t of s.tokenStates) {
      rows.push({
        wallet: s.wallet,
        currency: t.currency,
        issuer: t.issuer,
        cost_basis: t.costBasis,
        total_qty: t.qty,
        total_cost: t.totalCost,
        realized_pnl: t.realizedPnl,
        trade_count: t.tradeCount,
        buy_count: t.buyCount,
        sell_count: t.sellCount,
        win: t.sellCount > 0 && t.realizedPnl > 0 ? 1 : 0,
        first_trade_ts: t.firstTradeTs || "1970-01-01 00:00:00",
        last_trade_ts: t.lastTradeTs || "1970-01-01 00:00:00",
        xrp_volume_drops: t.xrpVolumeDrops,
        updated_at: new Date().toISOString().replace("T", " ").substring(0, 19),
      });
    }
  }

  if (rows.length > 0) {
    // Insert in chunks to avoid memory issues
    const chunkSize = 5000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await insert("wallet_token_pnl", rows.slice(i, i + chunkSize));
    }
  }
}

/* ── Core pipeline ── */

export async function runScoringPipeline(): Promise<void> {
  const locked = await acquireLock();
  if (!locked) {
    log.debug("SmartMoneyScorer: skipping — not scheduled or another instance running");
    return;
  }

  log.info("SmartMoneyScorer: starting scoring pipeline");
  const startTime = Date.now();

  try {
    // 1. Get incremental state
    const lastRun = await getLastScoredTimestamp();
    log.info({ lastRun }, "SmartMoneyScorer: last run timestamp");

    // 2. Find wallets with new activity, then strip AMM pool pseudo-
    //    accounts. AMM pools appear as makers on every swap and would
    //    otherwise sail through the activity filter and contaminate the
    //    leaderboard.
    let wallets: string[];
    try {
      const [rawWallets, ammPoolAccounts] = await Promise.all([
        getWalletsWithNewTrades(lastRun),
        getAmmPoolAccounts(),
      ]);
      const humanWallets = rawWallets.filter((w) => !ammPoolAccounts.has(w));
      const skipped = rawWallets.length - humanWallets.length;
      if (skipped > 0) {
        log.info({ skipped }, "SmartMoneyScorer: excluded AMM pool accounts from universe");
      }
      wallets = await filterByMinimumActivity(humanWallets);
    } catch (err) {
      log.error({ err }, "SmartMoneyScorer: ClickHouse query failed — aborting");
      await releaseLock(false, "ClickHouse unavailable");
      return;
    }

    if (wallets.length === 0) {
      log.info("SmartMoneyScorer: no wallets with new activity — skipping");
      await releaseLock(true);
      return;
    }

    log.info({ count: wallets.length }, "SmartMoneyScorer: scoring wallets");

    // 3. Pre-compute shared data in parallel
    const [washFlags, firstTradeMap, dailyPriceMap] = await Promise.all([
      detectWashTrading(),
      getTokenFirstTrades(),
      getDailyPriceRanges(),
    ]);

    // Derive per-token minimum observed price from the daily ranges.
    // Used to impute cost basis for uncovered sells (pre-ingestion holdings).
    const tokenMinPrices = new Map<string, number>();
    for (const [key, days] of dailyPriceMap.entries()) {
      let min = Infinity;
      for (const d of days) if (d.low > 0 && d.low < min) min = d.low;
      if (min !== Infinity) tokenMinPrices.set(key, min);
    }

    log.info(
      {
        washFlagged: washFlags.size,
        tokens: firstTradeMap.size,
        tokenMinPrices: tokenMinPrices.size,
      },
      "SmartMoneyScorer: shared data loaded",
    );

    // 4. Score wallets in batches
    const rawScores: WalletScore[] = [];
    let processed = 0;

    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
      const batch = wallets.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map((w) => scoreWallet(w, washFlags, firstTradeMap, dailyPriceMap, tokenMinPrices)),
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) {
          rawScores.push(result.value);
        }
      }

      processed += batch.length;
      if (processed % HEARTBEAT_INTERVAL === 0) {
        await extendLock();
        log.debug({ processed, total: wallets.length }, "SmartMoneyScorer: heartbeat");
      }
    }

    // Positive-PnL universe gate: a wallet that lost money over the
    // scoring window cannot be "smart money" by any definition. Filter
    // BEFORE percentile ranking so the percentile reflects standing
    // among profitable wallets only — otherwise the median sits at the
    // breakeven point and rewards wallets simply for not losing money.
    const allScores = rawScores.filter((s) => s.totalPnl > 0);
    const dropped = rawScores.filter((s) => s.totalPnl <= 0);
    log.info(
      { scored: rawScores.length, kept: allScores.length, droppedNegativePnl: dropped.length },
      "SmartMoneyScorer: positive-PnL filter applied",
    );

    // Evict wallets whose totalPnl flipped to ≤ 0 in this scoring run.
    // The scorer's incremental design means a wallet scored once with
    // positive PnL stays in the table until something rewrites it; so
    // a wallet that traded itself into the red since its last score
    // would have stayed on the leaderboard with a stale positive
    // value. Now: any wallet in this batch that fails the gate gets
    // its row deleted so the leaderboard reflects current standing.
    //
    // Uses Drizzle's typed `inArray()` instead of raw `sql\`= ANY(${...})\``.
    // Per CLAUDE.md / 2026-05-04 audit: the postgres driver expands a
    // raw JS array inside `ANY(${arr})` into a positional tuple
    // `ANY(($1, $2, $3))` which Postgres then errors on with
    // "op ANY/ALL (array) requires array on right side". `inArray()`
    // handles the parameter binding correctly.
    if (dropped.length > 0) {
      const droppedAddresses = dropped.map((s) => s.wallet);
      try {
        await db
          .delete(smartMoneyScores)
          .where(inArray(smartMoneyScores.address, droppedAddresses));
        log.info(
          { evicted: droppedAddresses.length },
          "SmartMoneyScorer: evicted wallets that fell out of the positive-PnL gate",
        );
      } catch (err) {
        // Non-fatal — old rows persisting is the existing behavior;
        // the read-layer gate catches them anyway.
        log.warn(
          { err, count: droppedAddresses.length },
          "SmartMoneyScorer: eviction DELETE failed",
        );
      }
    }

    if (allScores.length === 0) {
      // Even when this batch produced no new scores, run the global
      // re-rank pass below so weight-tuning changes / penalty edits /
      // imported data corrections propagate to existing rows. Without
      // this, a tuning commit + cron trigger on a quiet day (few
      // wallets with new activity, all unprofitable) leaves the
      // leaderboard frozen on old composites until enough profitable
      // batches accumulate to force a recompute. Falls through into
      // the recompute block below.
      log.info("SmartMoneyScorer: no profitable wallets produced this batch");
    }

    // 5. Assign profitability percentile (requires global ranking)
    assignPercentileScores(allScores);

    // 6. Compute composite scores
    for (const score of allScores) {
      computeCompositeScore(score);
    }

    log.info({ scored: allScores.length }, "SmartMoneyScorer: writing results");

    // Long-running batched writes — extend the lock once before
    // starting since the heartbeat loop in step 4 is no longer
    // running.
    await extendLock();

    // 7a. Pre-compute supplementary labels for ALL scored wallets in a
    //     single vectorized pass. Replaces the previous per-wallet
    //     scoreLegacyLabels(...) call that issued 4 CH/Neo4j queries
    //     per wallet (~7,300 round trips for 1,800 wallets).
    const scoredWallets = allScores.map((s) => s.wallet);
    let supplementaryByWallet = new Map<string, ReturnType<typeof deriveLegacyLabels>>();
    try {
      supplementaryByWallet = (await scoreLegacyLabelsBatch(scoredWallets)) as typeof supplementaryByWallet;
    } catch (err) {
      // Supplementary labels are non-critical; pipeline continues
      // with composite scores + derived labels only.
      log.warn({ err }, "SmartMoneyScorer: supplementary label batch failed, continuing without");
    }

    // 7b. Build flat label rows (derived + supplementary) ready for
    //     a single multi-row INSERT.
    const labelRows: LegacyLabelRow[] = [];
    for (const score of allScores) {
      for (const label of deriveLegacyLabels(score)) {
        labelRows.push({
          address: score.wallet,
          label: label.label,
          confidence: label.confidence,
          evidence: label.evidence,
        });
      }
      const supp = supplementaryByWallet.get(score.wallet) ?? [];
      for (const label of supp) {
        labelRows.push({
          address: score.wallet,
          label: label.label,
          confidence: label.confidence,
          evidence: label.evidence,
        });
      }
    }

    // 7c. Three batched writes (PG smart_money_scores, CH score_history,
    //     PG account_labels) instead of ~13K serialized round trips.
    //     Run them in parallel — they target different tables/clusters.
    await Promise.all([
      upsertScoresBatch(allScores),
      appendHistoryBatch(allScores),
      upsertLegacyLabelsBatch(labelRows),
    ]);

    // 8. Write wallet_token_pnl to ClickHouse
    await flushWalletTokenPnl(allScores);

    // 9. Re-rank profitability percentile + composite score globally.
    //
    // The local `assignPercentileScores(allScores)` in step 5 only
    // ranks the wallets scored in THIS batch. Pre-fix, a wallet that
    // was the top of its 942-wallet 2026-05-05 cohort got
    // profitability=100 alongside a wallet that was top of today's
    // 57-wallet batch — same percentile despite incomparable cohorts.
    //
    // This pass re-ranks every existing positive-PnL row by the
    // global PnL distribution and recomputes composite_score using
    // the same formula as `computeCompositeScore` in smart-money.ts
    // (cap profitability at 95, weighted sum, subtract penalty sum,
    // clamp to [0, 100]). Single SQL UPDATE — runs in a few hundred
    // ms even at 10K rows.
    //
    // **Weights MUST match `computeCompositeScore` in smart-money.ts.**
    // Both currently:
    //   profitability 25 / roi 33 / win_rate 12 / consistency 12 /
    //   early_buyer 5 / smart_exits 7 / seasoning 6
    // Profitability cap is 100 (was 95 pre-2026-05-10).
    // (2026-05-10 outcome-heavy reshape — see header doc on
    // computeCompositeScore for rationale.)
    //
    // Penalty sum extracted from the jsonb `penalties` column. The
    // schema-side type is `jsonb` (drizzle's typed insert preserves it
    // as a parsed array — see CLAUDE.md note on the
    // `${JSON.stringify(x)}::jsonb` double-encoding trap).
    try {
      await db.execute(sql`
        WITH ranked AS (
          SELECT
            address,
            percent_rank() OVER (ORDER BY total_pnl_xrp::numeric ASC) * 100 AS pctile,
            COALESCE(
              (
                SELECT SUM((p->>'amount')::numeric)
                FROM jsonb_array_elements(penalties) p
              ),
              0
            ) AS penalty_sum
          FROM smart_money_scores
          WHERE total_pnl_xrp::numeric > 0
        )
        UPDATE smart_money_scores ss
        SET
          profitability_score = LEAST(100, ranked.pctile),
          composite_score = GREATEST(0, LEAST(100,
            LEAST(100, ranked.pctile) * 0.25 +
            ss.roi_score::numeric * 0.33 +
            ss.win_rate_score::numeric * 0.12 +
            ss.consistency_score::numeric * 0.12 +
            ss.early_buyer_score::numeric * 0.05 +
            ss.smart_exit_score::numeric * 0.07 +
            ss.seasoning_score::numeric * 0.06 -
            ranked.penalty_sum
          ))
        FROM ranked
        WHERE ss.address = ranked.address
      `);
      log.info(
        "SmartMoneyScorer: re-ranked profitability + composite globally",
      );
    } catch (err) {
      // Non-fatal — wallets keep their batch-local percentiles. The
      // run still produces useful data; just doesn't get the
      // cross-cohort consistency this pass aims for.
      log.warn(
        { err },
        "SmartMoneyScorer: global re-rank failed, scores remain batch-local",
      );
    }

    // 10. Update timestamp for next incremental run
    await updateLastScoredTimestamp(new Date().toISOString());

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info(
      { scored: allScores.length, elapsed: `${elapsed}s` },
      "SmartMoneyScorer: pipeline complete",
    );
    await releaseLock(true);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error({ err }, "SmartMoneyScorer: pipeline failed");
    await releaseLock(false, message);
  }
}

