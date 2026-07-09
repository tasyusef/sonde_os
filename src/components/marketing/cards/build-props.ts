import type { MarketingData } from "@/components/admin/Marketing/types";
import { decodeCurrency } from "@/lib/xrpl-helpers";

/**
 * Turn an XRPL currency field into a human-readable ticker.
 * - "XRP" passes through.
 * - 40-char hex starting with "03" is an AMM LP token — not a real ticker.
 * - Everything else gets decoded (40-char hex → ASCII, else pass through).
 */
function tickerFromCurrency(currency: string): string {
  if (!currency) return "?";
  if (currency === "XRP") return "XRP";
  if (currency.length === 40 && currency.startsWith("03")) return "LP";
  return decodeCurrency(currency);
}

/* ------------------------------------------------------------------ */
/*  Shared transformers — MarketingData → card-component props         */
/*                                                                     */
/*  Used by both the admin grid (client, preview tiles) and the        */
/*  /marketing/card/[slug] screenshot route (server). Keeping this in  */
/*  one place means both views render the exact same numbers.          */
/* ------------------------------------------------------------------ */

export type SmartMoneyTier = "elite" | "advanced" | "skilled" | "watching";

// Tier thresholds calibrated for the recalibrated scorer (top ~64,
// p99 ~56, p95 ~42, p90 ~32). 4-tier ladder:
//   elite     = top ~1%   (>=55)
//   advanced  = top ~5%   (>=40)
//   skilled   = top ~15%  (>=25)
//   watching  = below
export function scoreToTier(score: number): SmartMoneyTier {
  if (score >= 55) return "elite";
  if (score >= 40) return "advanced";
  if (score >= 25) return "skilled";
  return "watching";
}

function truncateAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatXrpAmount(drops: string | number): string {
  const xrp = Number(drops) / 1_000_000;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(xrp);
}

function mapSeverity(s: string): "low" | "medium" | "high" {
  if (s === "extreme") return "high";
  if (s === "significant") return "medium";
  return "low";
}

function formatMetricValue(v: number, metric: string): string {
  if (metric === "dex_volume" || metric === "fee_burn") {
    const xrp = v / 1_000_000;
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(xrp)} XRP`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
}

const METRIC_LABELS: Record<string, string> = {
  tx_count: "Transaction Volume",
  dex_volume: "DEX Volume",
  active_accounts: "Active Accounts",
  fee_burn: "Fee Burn Rate",
};

const METRIC_UNITS: Record<string, string> = {
  tx_count: "txns/hr",
  dex_volume: "",
  active_accounts: "accounts",
  fee_burn: "",
};

export function buildCardProps(data: MarketingData | null) {
  const whale = data?.biggestTxs24h?.[0];
  const smart = data?.smartMoneyTop10?.[0];
  const anomaly = data?.anomalies?.[0];

  const whaleProps = whale
    ? {
        amountXrp: Number(whale.amount_drops) / 1_000_000,
        currency: "XRP" as const,
        fromAddress: whale.account,
        toAddress: whale.destination,
        timestamp: whale.timestamp,
      }
    : undefined;

  const score = smart ? Number(smart.composite_score) : undefined;
  const spotlightProps =
    smart && score != null
      ? {
          address: smart.address,
          compositeScore: Math.round(score),
          tier: scoreToTier(score),
          totalPnlXrp: Number(smart.total_pnl_xrp ?? 0),
          winRate: Math.round(Number(smart.win_rate ?? 0)),
          totalTrades: smart.total_trades ?? 0,
          tokensTraded: smart.tokens_traded ?? 0,
          windowLabel: "30D" as const,
        }
      : undefined;

  const biggestProps = whale
    ? {
        headline: "Biggest XRPL Transaction",
        value: `${formatXrpAmount(whale.amount_drops)} XRP`,
        context: `${truncateAddr(whale.account)} → ${truncateAddr(whale.destination)}`,
        period: "24H" as const,
      }
    : undefined;

  const unit = anomaly ? METRIC_UNITS[anomaly.metric] : "";
  const anomalyProps = anomaly
    ? {
        pattern: `${METRIC_LABELS[anomaly.metric] ?? anomaly.metric} Spike`,
        severity: mapSeverity(anomaly.severity),
        metrics: [
          { label: "Current", value: `${formatMetricValue(anomaly.currentValue, anomaly.metric)}${unit ? ` ${unit}` : ""}` },
          { label: "Expected", value: `${formatMetricValue(anomaly.expectedValue, anomaly.metric)}${unit ? ` ${unit}` : ""}` },
          { label: "Deviation", value: `${anomaly.deviation >= 0 ? "+" : ""}${anomaly.deviation}%` },
          { label: "Z-Score", value: anomaly.zScore.toFixed(2) },
        ],
        detectedAt: anomaly.detectedAt,
      }
    : undefined;

  // ── DEX pairs ──────────────────────────────────────────────────────
  // XRPL DEX pairs come in as raw currency codes: "XRP", 3-char ASCII, or
  // 40-char hex for custom tokens. Decode to a readable ticker so the tweet
  // card shows "SOLO / XRP" instead of a hex blob.
  const dexPairsProps = data?.topDexPairs7d?.length
    ? {
        pairs: data.topDexPairs7d.slice(0, 5).map((p) => ({
          base: tickerFromCurrency(p.base_currency),
          quote: tickerFromCurrency(p.quote_currency),
          trades: Number(p.trades),
          volumeXrp: Number(p.xrp_volume_drops) / 1_000_000,
        })),
      }
    : undefined;

  // ── Trustline winners ─────────────────────────────────────────────
  const trustlineProps = data?.trustlineWinners7d?.length
    ? {
        tokens: data.trustlineWinners7d.slice(0, 5).map((t) => ({
          currency: t.currency,
          netNew: Number(t.net_new),
          added: Number(t.added),
          removed: Number(t.removed),
        })),
      }
    : undefined;

  // ── Active accounts ───────────────────────────────────────────────
  // Pass the full 28-day series; the card slices into current 14d + prior
  // 14d and computes period-averaged deltas.
  const accountsProps = data?.activeAccountsTrend28d?.length
    ? {
        trend: data.activeAccountsTrend28d.map((d) => ({
          day: d.day,
          count: Number(d.active_accounts),
        })),
      }
    : undefined;

  // ── Fee burn ──────────────────────────────────────────────────────
  type FeeBurnRowExt = {
    timestamp: number;
    burnDrops: string;
    txCount: number;
    periodXrp?: number;
    last30dXrp?: number;
  };
  const burnRows = data?.feeBurn7d as FeeBurnRowExt[] | undefined;
  const burnFirst = burnRows?.[0];
  const feeBurnProps = burnRows?.length
    ? {
        timeSeries: burnRows.map((r) => ({
          timestamp: r.timestamp,
          value: Number(r.burnDrops) / 1_000_000,
        })),
        periodBurnXrp: burnFirst?.periodXrp ?? 0,
        last30dBurnXrp: burnFirst?.last30dXrp ?? 0,
      }
    : undefined;

  // ── Payment corridors ─────────────────────────────────────────────
  const corridorProps = data?.topCorridors7d?.length
    ? {
        corridors: data.topCorridors7d.slice(0, 5).map((c) => ({
          srcCurrency: c.srcCurrency,
          dstCurrency: c.dstCurrency,
          count: c.count,
          volumeXrp: Number(c.xrpVolumeDrops) / 1_000_000,
        })),
      }
    : undefined;

  // ── Top liquidity pools (AMM) ────────────────────────────────────
  // Pool currencies come in pre-decoded from amm-data.ts. All real pools
  // on XRPL are XRP-paired (non-XRP pairs return tvlXrp = 0 from the
  // fetcher and get ranked out). The "paired" side is hardcoded to XRP.
  const liquidityPoolsProps = data?.topLiquidityPools?.length
    ? {
        pools: data.topLiquidityPools.slice(0, 5).map((p) => ({
          token: p.token,
          paired: "XRP",
          tvlXrp: p.tvlXrp,
          tradingFee: p.tradingFee,
        })),
      }
    : undefined;

  // ── Top 24h gainers ──────────────────────────────────────────────
  // Ticker is pre-decoded by the fetcher. LP-token hex (03…) shouldn't
  // reach here because the query filters to pair_currency = 'XRP', but
  // route it through tickerFromCurrency anyway for defense in depth.
  const gainersProps = data?.topGainers24h?.length
    ? {
        gainers: data.topGainers24h.slice(0, 5).map((g) => ({
          token: tickerFromCurrency(g.currency),
          volumeXrp: g.volume24hXrp,
          pctChange: g.pctChange,
        })),
      }
    : undefined;

  return {
    whaleProps,
    spotlightProps,
    biggestProps,
    anomalyProps,
    dexPairsProps,
    trustlineProps,
    accountsProps,
    feeBurnProps,
    corridorProps,
    liquidityPoolsProps,
    gainersProps,
  };
}
