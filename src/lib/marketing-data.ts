import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  getFeeBurnTimeSeries,
  getFeeBurnTotal,
  getPaymentCorridors,
} from "@/lib/analytics-queries";
import { query as chQuery } from "@/lib/clickhouse-client";
import { detectAnomalies } from "@/lib/anomaly-detection";
import { getDexTVL } from "@/lib/amm-data";
import { getXrpPrice } from "@/lib/price-data";
import {
  getTopGainers24h,
  getTopDexPairs,
  getTrustlineWinners,
} from "@/lib/top-tokens";
import logger from "@/lib/logger";
import type { MarketingData } from "@/components/admin/Marketing/types";

/**
 * Marketing data snapshot — pulls high-signal on-chain metrics from
 * Postgres, ClickHouse, and the anomaly engine.
 *
 * Each subsection is wrapped in try/catch so one failing source doesn't
 * kill the entire response. Consumed by:
 *   1. /api/admin/marketing/data (JSON for the admin panel)
 *   2. /marketing/card/[slug]    (server-side SSR for screenshot pages)
 */
export async function fetchMarketingData(): Promise<MarketingData> {
  // ── Smart money top 10 (Postgres) ─────────────────────────────────
  let smartMoneyTop10: MarketingData["smartMoneyTop10"] = [];
  try {
    const rows = await db.execute<{
      address: string;
      composite_score: string;
      total_pnl_xrp: string | null;
      total_trades: number | null;
      win_rate: string | null;
      tokens_traded: number | null;
    }>(sql`
      SELECT address, composite_score, total_pnl_xrp, total_trades, win_rate, tokens_traded
      FROM smart_money_scores
      WHERE wash_trading_flag = false
      ORDER BY composite_score DESC
      LIMIT 10
    `);
    smartMoneyTop10 = Array.from(rows);
  } catch (err) {
    logger.error({ err }, "[marketing-data] smart money query failed");
  }

  // ── Biggest XRP transactions (24h, ClickHouse) ────────────────────
  // Filters applied:
  //   - amount_drops < 1e17 — excludes Partial Payment sentinels. XRPL
  //     payments with tfPartialPayment use a max-supply sentinel (1e17
  //     drops = 100B XRP) in Amount and the real delivered value lives
  //     in meta.delivered_amount. Our ingestion sometimes stores the
  //     sentinel when delivered_amount isn't resolvable at ingest time.
  //   - account != destination — self-payments are almost always path-
  //     finding or sequence-refresh ops, not whale moves worth flagging.
  //   - destination != '' — guards against non-Payment rows that somehow
  //     carry an XRP amount (OfferCreate amendments, etc).
  let biggestTxs24h: MarketingData["biggestTxs24h"] = [];
  try {
    biggestTxs24h = (await chQuery(`
      SELECT tx_hash, account, destination, amount_drops, timestamp
      FROM sonde.transactions
      WHERE timestamp > now() - INTERVAL 24 HOUR
        AND currency = 'XRP'
        AND amount_drops > 0
        AND amount_drops < 100000000000000000
        AND account != destination
        AND destination != ''
      ORDER BY amount_drops DESC
      LIMIT 5
    `)) as unknown as MarketingData["biggestTxs24h"];
  } catch (err) {
    logger.error({ err }, "[marketing-data] biggest txs query failed");
  }

  // ── Top DEX pairs by XRP volume (7d, via shared lib/top-tokens) ──
  const topDexPairs7d: MarketingData["topDexPairs7d"] = (
    await getTopDexPairs(7, 5)
  ).map((p) => ({
    base_currency: p.baseCurrency,
    base_issuer: p.baseIssuer,
    quote_currency: p.quoteCurrency,
    quote_issuer: p.quoteIssuer,
    trades: String(p.trades),
    xrp_volume_drops: p.xrpVolumeDrops,
  }));

  // ── Active accounts trend (28d window, ClickHouse) ────────────────
  // 28 days so the card can compare the current 14-day avg against the
  // prior 14-day avg. Sparkline renders only the most recent 14.
  let activeAccountsTrend28d: MarketingData["activeAccountsTrend28d"] = [];
  try {
    activeAccountsTrend28d = (await chQuery(`
      SELECT day, uniqExactMerge(unique_accounts) AS active_accounts
      FROM sonde.mv_daily_active_accounts
      WHERE day > today() - 28
      GROUP BY day
      ORDER BY day DESC
    `)) as unknown as MarketingData["activeAccountsTrend28d"];
  } catch (err) {
    logger.error({ err }, "[marketing-data] active accounts query failed");
  }

  // ── Trustline growth winners (7d, via shared lib/top-tokens) ─────
  const trustlineWinners7d: MarketingData["trustlineWinners7d"] = (
    await getTrustlineWinners(7, 10, 10)
  ).map((t) => ({
    currency: t.currency,
    issuer: t.issuer,
    added: String(t.added),
    removed: String(t.removed),
    net_new: String(t.netNew),
  }));

  // ── Network anomalies (live detection) ────────────────────────────
  let anomalies: MarketingData["anomalies"] = [];
  try {
    anomalies = (await detectAnomalies()) as unknown as MarketingData["anomalies"];
  } catch (err) {
    logger.error({ err }, "[marketing-data] anomaly detection failed");
  }

  // ── Fee burn timeseries (7d, Postgres via analytics-queries) ─────
  let feeBurn7d: MarketingData["feeBurn7d"] = [];
  try {
    const ts = await getFeeBurnTimeSeries("7d");
    const totals7d = await getFeeBurnTotal("7d");
    const totals30d = await getFeeBurnTotal("30d");
    feeBurn7d = ts.map((p, i) => ({
      timestamp: p.timestamp,
      burnDrops: p.burnDrops,
      txCount: p.txCount,
      // Include totals on the first row for easy client access
      ...(i === 0
        ? { periodXrp: totals7d.periodXrp, last30dXrp: totals30d.periodXrp }
        : {}),
    })) as unknown as MarketingData["feeBurn7d"];
  } catch (err) {
    logger.error({ err }, "[marketing-data] fee burn query failed");
  }

  // ── Payment corridors (7d, Postgres via analytics-queries) ───────
  let topCorridors7d: MarketingData["topCorridors7d"] = [];
  try {
    const corridors = await getPaymentCorridors("7d", 5);
    topCorridors7d = corridors.map((c) => ({
      srcCurrency: c.srcCurrency,
      dstCurrency: c.dstCurrency,
      count: c.count,
      xrpVolumeDrops: String(Math.round(c.xrpVolume * 1_000_000)),
    }));
  } catch (err) {
    logger.error({ err }, "[marketing-data] corridors query failed");
  }

  // ── Top AMM liquidity pools (point-in-time, XRPL amm_info + DB) ──
  // Distinct from Top DEX Pairs — this ranks AMM pools by XRP TVL,
  // not order-book trading volume. Uses the cached amm-data helper so
  // repeated card loads don't hammer the rippled amm_info endpoint.
  let topLiquidityPools: MarketingData["topLiquidityPools"] = [];
  try {
    const xrpPrice = await getXrpPrice().catch(() => null);
    const tvl = await getDexTVL(xrpPrice?.price ?? 0);
    if (tvl?.topPools?.length) {
      topLiquidityPools = tvl.topPools.slice(0, 5).map((p) => ({
        account: p.account,
        token: p.currency,
        tokenIssuer: p.issuerName ?? "",
        tvlXrp: p.tvlXrp,
        tradingFee: p.tradingFee,
        holders: p.holders,
      }));
    }
  } catch (err) {
    logger.error({ err }, "[marketing-data] liquidity pools query failed");
  }

  // ── Top 24h gainers (via shared lib/top-tokens) ──────────────────
  const topGainers24h: MarketingData["topGainers24h"] =
    await getTopGainers24h(5);

  return {
    generatedAt: new Date().toISOString(),
    windowNotes:
      "Data depth is limited — do not claim historical performance beyond the ingestion window (~30 days).",
    smartMoneyTop10,
    biggestTxs24h,
    topDexPairs7d,
    activeAccountsTrend28d,
    trustlineWinners7d,
    anomalies,
    feeBurn7d,
    topCorridors7d,
    topLiquidityPools,
    topGainers24h,
  };
}
