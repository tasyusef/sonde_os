/**
 * Token Health Score — composite 0-100 (100 = healthy) from three factors:
 *   1. Holder concentration (Postgres — Herfindahl index)
 *   2. Issuer distribution (ClickHouse — depth-1 payment recipients from issuer)
 *   3. Volume authenticity (ClickHouse — unique traders vs total trades)
 *
 * Free tier. Results cached 5 minutes per token.
 *
 * Pre-2026-04-30 Factor 2 read from Neo4j PAYMENT edges. Migrated to
 * CH `value_transfer_events` (the source of record). See
 * `docs/plans/neo4j-removal.md`.
 */

import "server-only";
import { LRUCache, singleflight } from "./cache";
import { getLatestHolderSnapshot } from "./holder-queries";
import { query as chQuery } from "./clickhouse-client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type FactorStatus = "scored" | "insufficient_data" | "unavailable";

interface HealthFactor {
  name: string;
  score: number;
  weight: number;
  status: FactorStatus;
  detail: string;
}

export interface TokenHealthResult {
  /** 0-100 weighted average of scored factors, -1 if none scored */
  compositeScore: number;
  factors: HealthFactor[];
  /** True if any factor is not "scored" */
  limitedData: boolean;
  computedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Cache                                                              */
/* ------------------------------------------------------------------ */

const healthCache = new LRUCache<unknown>(200, 5 * 60_000);

/* ------------------------------------------------------------------ */
/*  Factor 1: Holder Concentration (Postgres)                          */
/* ------------------------------------------------------------------ */

async function computeHolderConcentration(
  currency: string,
  issuer: string,
): Promise<HealthFactor> {
  const factor: HealthFactor = {
    name: "Holder Concentration",
    score: 0,
    weight: 1.0,
    status: "unavailable",
    detail: "",
  };

  try {
    const snapshot = await getLatestHolderSnapshot(currency, issuer);
    if (!snapshot || snapshot.holders.length < 2) {
      factor.status = "insufficient_data";
      factor.detail = "Fewer than 2 holder snapshots available";
      return factor;
    }

    // Herfindahl-Hirschman Index from top holders
    const totalSupply = snapshot.holders[0].totalSupply;
    if (totalSupply <= 0) {
      factor.status = "insufficient_data";
      factor.detail = "Total supply is zero";
      return factor;
    }

    let hhi = 0;
    for (const h of snapshot.holders) {
      const share = h.balance / totalSupply;
      hhi += share * share;
    }
    hhi *= 10_000; // basis points

    // Lower HHI = less concentrated = healthier
    // HHI 10000 = one holder has everything → score 0
    // HHI 0 = perfectly distributed → score 100
    factor.score = Math.round(Math.max(0, Math.min(100, 100 - hhi / 100)));
    factor.status = "scored";
    factor.detail =
      factor.score >= 70
        ? "Well distributed among top holders"
        : factor.score >= 40
          ? "Moderate holder concentration"
          : "Highly concentrated in few wallets";
  } catch {
    factor.status = "unavailable";
    factor.detail = "Could not query holder data";
  }

  return factor;
}

/* ------------------------------------------------------------------ */
/*  Factor 2: Issuer Distribution (ClickHouse)                         */
/* ------------------------------------------------------------------ */

async function computeIssuerDistribution(issuer: string): Promise<HealthFactor> {
  const factor: HealthFactor = {
    name: "Issuer Distribution",
    score: 0,
    weight: 0.8,
    status: "unavailable",
    detail: "",
  };

  try {
    // Two queries in parallel: total distinct recipients (used for the
    // count score) and the top-20 edge counts (used for the Gini-based
    // evenness score). Splitting them is simpler than collecting both
    // shapes in one CH statement and the queries hit the same partition.
    const [countRows, distRows] = await Promise.all([
      chQuery<{ recipient_count: number | string }>(
        `SELECT count(DISTINCT to_account) AS recipient_count
         FROM value_transfer_events
         WHERE from_account = {issuer:String}
           AND to_account != ''`,
        { issuer },
      ),
      chQuery<{ edge_count: number | string }>(
        `SELECT count() AS edge_count
         FROM value_transfer_events
         WHERE from_account = {issuer:String}
           AND to_account != ''
         GROUP BY to_account
         ORDER BY edge_count DESC
         LIMIT 20`,
        { issuer },
      ),
    ]);

    const recipientCount = Number(countRows[0]?.recipient_count) || 0;
    const distribution = distRows.map((r) => ({ count: Number(r.edge_count) || 0 }));

    if (recipientCount === 0) {
      factor.status = "insufficient_data";
      factor.detail = "No payment recipients from issuer";
      return factor;
    }

    if (recipientCount < 5) {
      factor.status = "insufficient_data";
      factor.detail = `Only ${recipientCount} direct recipients from issuer`;
      return factor;
    }

    // Count score: more recipients = better (caps at 50 for 100+ recipients)
    const countScore = Math.min(50, recipientCount / 2);

    // Evenness score via Gini coefficient on distribution
    const counts = distribution.map((d) => d.count).sort((a, b) => a - b);
    const n = counts.length;
    const total = counts.reduce((s, v) => s + v, 0);
    let gini = 0;
    if (total > 0 && n > 1) {
      for (let i = 0; i < n; i++) {
        gini += (2 * (i + 1) - n - 1) * counts[i];
      }
      gini = gini / (n * total);
    }
    const evennessScore = 50 * (1 - Math.max(0, Math.min(1, gini)));

    factor.score = Math.round(Math.max(0, Math.min(100, countScore + evennessScore)));
    factor.status = "scored";
    factor.detail =
      factor.score >= 70
        ? "Broadly distributed from issuer"
        : factor.score >= 40
          ? "Moderate issuer distribution"
          : "Concentrated issuer distribution";
  } catch {
    factor.status = "unavailable";
    factor.detail = "Could not query issuer payment data";
  }

  return factor;
}

/* ------------------------------------------------------------------ */
/*  Factor 3: Volume Authenticity (ClickHouse)                         */
/* ------------------------------------------------------------------ */

async function computeVolumeAuthenticity(
  currency: string,
  issuer: string,
): Promise<HealthFactor> {
  const factor: HealthFactor = {
    name: "Volume Authenticity",
    score: 0,
    weight: 1.0,
    status: "unavailable",
    detail: "",
  };

  try {
    const rows = await chQuery<{
      unique_traders: string;
      total_trades: string;
    }>(
      `SELECT
         uniqExact(taker) AS unique_traders,
         count(*) AS total_trades
       FROM dex_trades
       WHERE base_currency = {currency:String}
         AND base_issuer = {issuer:String}
         AND timestamp >= now() - INTERVAL 30 DAY`,
      { currency, issuer },
    );

    if (rows.length === 0) {
      factor.status = "insufficient_data";
      factor.detail = "No DEX trade data available";
      return factor;
    }

    const uniqueTraders = parseInt(rows[0].unique_traders, 10);
    const totalTrades = parseInt(rows[0].total_trades, 10);

    if (totalTrades < 10) {
      factor.status = "insufficient_data";
      factor.detail = `Only ${totalTrades} trades in last 30 days`;
      return factor;
    }

    // Higher ratio of unique traders to total trades = more authentic
    // 0.5+ ratio → perfect score (many different people trading)
    const ratio = uniqueTraders / totalTrades;
    factor.score = Math.round(Math.max(0, Math.min(100, ratio * 200)));
    factor.status = "scored";
    factor.detail =
      factor.score >= 70
        ? `${uniqueTraders} unique traders across ${totalTrades} trades`
        : factor.score >= 40
          ? "Moderate trader diversity"
          : "Low trader diversity — possible wash trading";
  } catch {
    factor.status = "unavailable";
    factor.detail = "Could not query DEX trade data";
  }

  return factor;
}

/* ------------------------------------------------------------------ */
/*  Composite scoring                                                  */
/* ------------------------------------------------------------------ */

export async function computeTokenHealth(
  currency: string,
  issuer: string,
): Promise<TokenHealthResult> {
  const cacheKey = `token-health:${currency}:${issuer}`;

  return singleflight(cacheKey, healthCache, async () => {
    const [holder, distribution, volume] = await Promise.allSettled([
      computeHolderConcentration(currency, issuer),
      computeIssuerDistribution(issuer),
      computeVolumeAuthenticity(currency, issuer),
    ]);

    const factors: HealthFactor[] = [
      holder.status === "fulfilled"
        ? holder.value
        : { name: "Holder Concentration", score: 0, weight: 1.0, status: "unavailable" as const, detail: "Query failed" },
      distribution.status === "fulfilled"
        ? distribution.value
        : { name: "Issuer Distribution", score: 0, weight: 0.8, status: "unavailable" as const, detail: "Query failed" },
      volume.status === "fulfilled"
        ? volume.value
        : { name: "Volume Authenticity", score: 0, weight: 1.0, status: "unavailable" as const, detail: "Query failed" },
    ];

    // Weighted average of scored factors only
    const scored = factors.filter((f) => f.status === "scored");
    let compositeScore = -1;
    if (scored.length > 0) {
      const totalWeight = scored.reduce((s, f) => s + f.weight, 0);
      const weightedSum = scored.reduce((s, f) => s + f.score * f.weight, 0);
      compositeScore = Math.round(weightedSum / totalWeight);
    }

    return {
      compositeScore,
      factors,
      limitedData: factors.some((f) => f.status !== "scored"),
      computedAt: new Date().toISOString(),
    };
  });
}
