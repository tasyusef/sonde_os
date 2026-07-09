/**
 * Backfill smart money scores — seeds initial data by scoring all
 * active DEX accounts from ClickHouse.
 *
 * Run after:
 *   1. scripts/migrate-smart-money-scores.ts (Postgres tables)
 *   2. scripts/setup-clickhouse.ts (wallet_token_pnl table)
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-smart-money.ts
 *
 * Requires .env.local with DATABASE_URL and CLICKHOUSE_URL.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { createClient as createCH } from "@clickhouse/client";
import {
  smartMoneyScores,
  accountLabels,
  ammPools,
  jobState,
} from "../src/db/schema";
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
  type WalletScore,
  type DexTradeRow,
  type DailyPrice,
} from "../src/lib/smart-money";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!CLICKHOUSE_URL) { console.error("CLICKHOUSE_URL required"); process.exit(1); }

const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";
// Aligned with smart-money-scorer.ts MIN_TOKENS_TRADED. Was 10 (drift bug
// caught in 2026-05-04 audit) — backfill writes 10-token wallets that
// the live scorer rejects, leaving stale low-quality rows on the
// leaderboard until the next live run cleared them.
const MIN_TOKENS = 25;
// 5000 XRP volume floor — same rationale as scorer. Without this,
// dust-volume wallets that touched 25+ tokens get scored with $32
// PnLs and contaminate the leaderboard.
const MIN_VOLUME_DROPS = 5_000 * 1_000_000;
const SCORING_WINDOW_DAYS = 90;
const BATCH_SIZE = 50;

const pg = postgres(DATABASE_URL, { max: 5, idle_timeout: 30 });
// Drizzle wraps the same postgres-js client. Used for inserts into
// jsonb-bearing tables to avoid the `${JSON.stringify(x)}::jsonb`
// double-encoding trap that bites the raw-template-literal path
// (CLAUDE.md / 2026-05-04 audit).
const db = drizzle(pg);
const ch = createCH({ url: CLICKHOUSE_URL, database: DATABASE, request_timeout: 300_000 });

async function chQuery<T>(query: string): Promise<T[]> {
  const result = await ch.query({ query, format: "JSONEachRow" });
  return result.json() as Promise<T[]>;
}

/* ── Shared data ── */

async function getTokenFirstTrades(): Promise<Map<string, Date>> {
  console.log("  Loading token first-trade timestamps...");
  // Token-side normalization (matches scorer): IOU is the "token"
  // whether it sits in base or quote. Without this, tokens that only
  // ever traded as XRP-base/IOU-quote silently miss the early-buyer
  // lookup. Caught in 2026-05-04 audit.
  const rows = await chQuery<{ token_currency: string; token_issuer: string; first_trade: string }>(
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
  const map = new Map<string, Date>();
  for (const r of rows) {
    map.set(`${r.token_currency}:${r.token_issuer}`, new Date(r.first_trade));
  }
  console.log(`  → ${map.size} tokens`);
  return map;
}

async function getDailyPriceRanges(): Promise<Map<string, DailyPrice[]>> {
  console.log("  Loading daily price ranges...");
  // Same normalization. Price is flipped (1/price) for XRP-base trades
  // so values are always XRP-per-token, matching computeWAVGForWallet.
  const rows = await chQuery<{
    token_currency: string; token_issuer: string; day: string; low: number; high: number;
  }>(
    `SELECT token_currency, token_issuer, day,
       min(token_price) AS low, max(token_price) AS high
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
  const map = new Map<string, DailyPrice[]>();
  for (const r of rows) {
    const key = `${r.token_currency}:${r.token_issuer}`;
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push({ day: r.day, low: Number(r.low), high: Number(r.high) });
  }
  console.log(`  → ${map.size} tokens with price data`);
  return map;
}

/** AMM pool pseudo-accounts — exclude from the trader universe. They
 *  are deterministic protocol accounts, not human/bot wallets, but they
 *  appear as makers on every AMM swap and would otherwise sail through
 *  the activity filter. Caught in the 2026-05-04 audit. */
async function getAmmPoolAccounts(): Promise<Set<string>> {
  const rows = await db.select({ account: ammPools.account }).from(ammPools);
  return new Set(rows.map((r) => r.account));
}

async function detectWashTrading(): Promise<Set<string>> {
  console.log("  Detecting wash trading...");
  const flagged = new Set<string>();

  try {
    const rows = await chQuery<{ account: string }>(
      `SELECT t1.taker AS account
       FROM dex_trades t1
       INNER JOIN dex_trades t2 ON
         t1.taker = t2.maker
         AND t1.base_currency = t2.base_currency
         AND t1.base_issuer = t2.base_issuer
         AND t2.ledger_index BETWEEN t1.ledger_index AND t1.ledger_index + 25
         AND abs(t1.base_amount - t2.base_amount) / greatest(t1.base_amount, 0.0001) < 0.01
       WHERE t1.timestamp > now() - INTERVAL 30 DAY AND t1.taker != ''
       GROUP BY t1.taker
       HAVING count(*) >= 3`,
    );
    for (const r of rows) flagged.add(r.account);
  } catch (err) {
    console.warn("  ⚠ Cross-trade detection failed:", (err as Error).message);
  }

  try {
    const rows = await chQuery<{ taker: string }>(
      `SELECT taker, count(*) AS cnt
       FROM dex_trades
       WHERE taker = maker AND taker != '' AND timestamp > now() - INTERVAL 30 DAY
       GROUP BY taker
       HAVING cnt >= 3`,
    );
    for (const r of rows) flagged.add(r.taker);
  } catch (err) {
    console.warn("  ⚠ Self-trade detection failed:", (err as Error).message);
  }

  console.log(`  → ${flagged.size} flagged accounts`);
  return flagged;
}

/* ── Main ── */

async function main() {
  console.log("Smart Money Backfill\n");

  // 1. Find all active DEX accounts meeting minimum threshold.
  //    Mirrors smart-money-scorer.ts/filterByMinimumActivity: token-side
  //    normalization, IOU-IOU exclusion, and a 5000 XRP volume floor.
  console.log("[1/7] Finding active DEX accounts...");
  const walletRows = await chQuery<{ account: string; token_count: number; total_volume_drops: string | number }>(
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
       WHERE taker != ''
         AND ((base_currency = 'XRP' AND base_issuer = '') OR (quote_currency = 'XRP' AND quote_issuer = ''))
         AND timestamp > now() - INTERVAL 30 DAY
       UNION ALL
       SELECT
         maker AS account,
         if(base_currency = 'XRP' AND base_issuer = '', quote_currency, base_currency) AS token_currency,
         if(base_currency = 'XRP' AND base_issuer = '', quote_issuer, base_issuer) AS token_issuer,
         xrp_volume_drops AS xrp_vol
       FROM dex_trades
       WHERE maker != ''
         AND ((base_currency = 'XRP' AND base_issuer = '') OR (quote_currency = 'XRP' AND quote_issuer = ''))
         AND timestamp > now() - INTERVAL 30 DAY
     )
     GROUP BY account
     HAVING token_count >= ${MIN_TOKENS}
        AND total_volume_drops >= ${MIN_VOLUME_DROPS}`,
  );

  // Strip AMM pool pseudo-accounts before scoring.
  const ammPoolAccounts = await getAmmPoolAccounts();
  const wallets = walletRows
    .map((r) => r.account)
    .filter((w) => !ammPoolAccounts.has(w));
  const skippedAmm = walletRows.length - wallets.length;
  console.log(`  → ${wallets.length} wallets qualify (excluded ${skippedAmm} AMM pool accounts)\n`);

  if (wallets.length === 0) {
    console.log("No wallets to score. Exiting.");
    await cleanup();
    return;
  }

  // 2. Pre-compute shared data
  console.log("[2/7] Loading shared data...");
  const [washFlags, firstTradeMap, dailyPriceMap] = await Promise.all([
    detectWashTrading(),
    getTokenFirstTrades(),
    getDailyPriceRanges(),
  ]);

  // Per-token min observed price — used by computeWAVGForWallet to
  // impute cost basis for uncovered sells (pre-ingestion holdings).
  // Backfill was previously skipping this; scorer was already passing
  // it. Without it, OG holders' realized PnL is undercounted.
  const tokenMinPrices = new Map<string, number>();
  for (const [key, days] of dailyPriceMap.entries()) {
    let min = Infinity;
    for (const d of days) if (d.low > 0 && d.low < min) min = d.low;
    if (min !== Infinity) tokenMinPrices.set(key, min);
  }
  console.log();

  // 3. Score wallets in batches
  console.log("[3/7] Scoring wallets...");
  const rawScores: WalletScore[] = [];
  let processed = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (wallet) => {
        const trades = await chQuery<DexTradeRow>(
          `SELECT tx_hash, timestamp, ledger_index, taker, maker,
             base_currency, base_issuer, base_amount,
             quote_currency, quote_issuer, quote_amount,
             price, xrp_volume_drops
           FROM dex_trades
           WHERE (taker = '${wallet}' OR maker = '${wallet}')
             AND timestamp > now() - INTERVAL ${SCORING_WINDOW_DAYS} DAY
           ORDER BY timestamp ASC, ledger_index ASC`,
        );

        if (trades.length === 0) return null;

        const { tokens, sells } = computeWAVGForWallet(trades, wallet, tokenMinPrices);
        if (tokens.length === 0) return null;

        const totalPnl = tokens.reduce((s, t) => s + t.realizedPnl, 0);
        const totalTrades = tokens.reduce((s, t) => s + t.tradeCount, 0);
        const winRateValue = computeWinRate(tokens);
        const { sharpe, score: consistencyScore } = computeConsistency(tokens);

        const score: WalletScore = {
          wallet,
          profitabilityScore: 0,
          roiScore: computeROI(tokens),
          winRateScore: winRateValue,
          consistencyScore,
          earlyBuyerScore: computeEarlyBuyer(tokens, firstTradeMap),
          smartExitScore: computeSmartExits(sells, dailyPriceMap),
          seasoningScore: computeSeasoning(trades, wallet),
          compositeScore: 0,
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
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) rawScores.push(r.value);
    }

    processed += batch.length;
    if (processed % 200 === 0 || processed === wallets.length) {
      console.log(`  ${processed}/${wallets.length} processed (${rawScores.length} scored)`);
    }
  }

  // Positive-PnL universe gate. A wallet that lost money over the
  // scoring window cannot be smart money. Filter BEFORE percentile
  // ranking so the rank reflects standing among profitable wallets.
  const allScores = rawScores.filter((s) => s.totalPnl > 0);
  const droppedNegativePnl = rawScores.length - allScores.length;
  console.log(`  → ${rawScores.length} wallets scored, ${allScores.length} kept after positive-PnL filter (${droppedNegativePnl} dropped)\n`);

  if (allScores.length === 0) {
    console.log("No profitable wallets produced. Exiting.");
    await cleanup();
    return;
  }

  // 4. Assign percentile scores
  console.log("[4/7] Computing percentile rankings...");
  assignPercentileScores(allScores);
  for (const score of allScores) {
    computeCompositeScore(score);
  }

  // Tier thresholds match the recalibrated scorer (peak ~64, p99 ~56,
  // p95 ~42, p90 ~32). The leaderboard UI labels >=50 as "Smart Money"
  // and >=30 as "Emerging".
  const smart = allScores.filter((s) => s.compositeScore >= 50).length;
  const emerging = allScores.filter((s) => s.compositeScore >= 30 && s.compositeScore < 50).length;
  console.log(`  → Smart Money (50+): ${smart}, Emerging (30-49): ${emerging}\n`);

  // 5. Write to Postgres + ClickHouse. Uses Drizzle typed inserts for
  // jsonb-bearing tables to dodge the ${JSON.stringify(x)}::jsonb
  // double-encoding trap.
  console.log("[5/7] Writing to smart_money_scores + score_history...");
  let written = 0;
  for (const score of allScores) {
    await db
      .insert(smartMoneyScores)
      .values({
        address: score.wallet,
        compositeScore: String(score.compositeScore),
        profitabilityScore: String(score.profitabilityScore),
        roiScore: String(score.roiScore),
        winRateScore: String(score.winRateScore),
        consistencyScore: String(score.consistencyScore),
        earlyBuyerScore: String(score.earlyBuyerScore),
        smartExitScore: String(score.smartExitScore),
        seasoningScore: String(score.seasoningScore),
        penalties: score.penalties,
        totalPnlXrp: String(score.totalPnl),
        totalTrades: score.totalTrades,
        winRate: String(score.winRate),
        sharpeRatio: String(score.sharpeRatio),
        tokensTraded: score.tokensTraded,
        washTradingFlag: score.washTradingFlag,
      })
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

    // score_history was migrated PG → CH on 2026-04-28. Reuses the
    // `ch` client created at the top of this script.
    const nowDt = new Date().toISOString().slice(0, 23).replace("T", " ");
    await ch.insert({
      table: "score_history",
      values: [
        {
          scored_at: nowDt,
          address: score.wallet,
          composite_score: score.compositeScore,
        },
      ],
      format: "JSONEachRow",
    });

    // Write derived legacy labels
    const legacyLabels = deriveLegacyLabels(score);
    for (const label of legacyLabels) {
      await db
        .insert(accountLabels)
        .values({
          address: score.wallet,
          label: label.label,
          confidence: String(label.confidence),
          evidenceJson: label.evidence,
        })
        .onConflictDoUpdate({
          target: [accountLabels.address, accountLabels.label],
          set: {
            confidence: sql`EXCLUDED.confidence`,
            evidenceJson: sql`EXCLUDED.evidence_json`,
            scoredAt: sql`NOW()`,
          },
        });
    }

    written++;
    if (written % 200 === 0) {
      console.log(`  ${written}/${allScores.length} written`);
    }
  }
  console.log(`  → ${written} scores written\n`);

  // 6. Write wallet_token_pnl to ClickHouse
  console.log("[6/7] Writing wallet_token_pnl to ClickHouse...");
  const pnlRows: Record<string, unknown>[] = [];
  for (const s of allScores) {
    for (const t of s.tokenStates) {
      pnlRows.push({
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

  if (pnlRows.length > 0) {
    const chunkSize = 5000;
    for (let i = 0; i < pnlRows.length; i += chunkSize) {
      await ch.insert({
        table: "wallet_token_pnl",
        values: pnlRows.slice(i, i + chunkSize),
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 0,
          max_partitions_per_insert_block: 0 as unknown as string,
        },
      });
    }
    console.log(`  → ${pnlRows.length} token PnL rows written\n`);
  }

  // 7. Set job_state timestamp for incremental runs
  console.log("[7/7] Setting job_state for incremental scoring...");
  await db
    .insert(jobState)
    .values({
      jobName: "smart_money_scorer",
      status: "idle",
      nextRunAt: new Date(getNext2amUTC()),
      stateJson: { lastScoredTimestamp: new Date().toISOString() },
    })
    .onConflictDoUpdate({
      target: jobState.jobName,
      set: {
        stateJson: sql`EXCLUDED.state_json`,
        nextRunAt: sql`EXCLUDED.next_run_at`,
        updatedAt: sql`NOW()`,
      },
    });

  console.log("\nBackfill complete.");
  await cleanup();
}

function getNext2amUTC(): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

async function cleanup() {
  await pg.end();
  await ch.close();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
