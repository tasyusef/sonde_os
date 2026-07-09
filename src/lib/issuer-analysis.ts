/**
 * Issuer distribution analysis.
 *
 * Primary signal: first-hop payment recipients from the issuer, derived
 * from CH `value_transfer_events` filtered by this specific token currency
 * + issuer. Describes how the issuer seeded the token when one exists.
 *
 * Fallback: when the issuer distributes via AMM/DEX (no direct Payment
 * trail, as is typical for modern meme tokens), we derive the same shape
 * from the current top-holder snapshot so the card still reports Gini,
 * concentration, and a recognizable distribution story.
 *
 * Pre-2026-04-30 the primary path read from Neo4j PAYMENT edges. CH was
 * always the source of record (Neo4j was a downstream projection) so
 * removing the Neo4j hop is lossless and trims one DB dep. See
 * `docs/plans/neo4j-removal.md`.
 */

import "server-only";
import { query as chQuery } from "@/lib/clickhouse-client";
import { toLedgerCurrency } from "./xrpl-helpers";
import { LRUCache } from "./cache";

/* ── Types ── */

export interface IssuerRecipient {
  address: string;
  /** Total amount received directly from issuer */
  amountReceived: number;
  /** Number of payments from issuer */
  paymentCount: number;
  /** Whether this recipient is currently in top 10 holders */
  isTopHolder: boolean;
  /** Current rank in top holders (null if not in top 10) */
  holderRank: number | null;
}

interface IssuerAnalysisResult {
  issuer: string;
  currency: string;
  /** Total unique first-hop recipients from issuer */
  recipientCount: number;
  /** Top recipients by amount */
  topRecipients: IssuerRecipient[];
  /** Proportion of top holders who received directly from issuer */
  insiderRatio: number;
  /** Gini coefficient of distribution (0 = perfect equality, 1 = total concentration) */
  distributionGini: number;
  /** Total token supply (from latest holder snapshot). 0 if unavailable.
   *  Used by the UI to compute per-row "% of supply" and aggregate
   *  "top N share" concentration. */
  totalSupply: number;
  /**
   * How the distribution signal was derived.
   * - `direct_payments`: issuer sent the token directly (old-school issuer → recipient payments)
   * - `holders_snapshot`: no direct-payment trail; using current top holder balances as a proxy
   */
  source: "direct_payments" | "holders_snapshot" | "none";
  /** Status of the analysis */
  status: "scored" | "insufficient_data" | "unavailable";
}

/* ── Cache (5 min) ── */

const issuerCache = new LRUCache<IssuerAnalysisResult>(50, 5 * 60_000);

/* ── Gini coefficient ── */

function computeGini(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  if (mean === 0) return 0;

  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiff += Math.abs(sorted[i] - sorted[j]);
    }
  }
  return sumDiff / (2 * n * n * mean);
}

/* ── Main query ── */

export async function getIssuerAnalysis(
  currencyInput: string,
  issuer: string,
): Promise<IssuerAnalysisResult> {
  // Normalize so display-form ("ARMY") and hex-form currencies hit
  // the same CH rows.
  const currency = toLedgerCurrency(currencyInput);
  const cacheKey = `issuer-analysis:${currency}:${issuer}`;
  const cached = issuerCache.get(cacheKey);
  if (cached) return cached;

  // ── Load current top holders up-front — needed for both paths ──
  const topHolderAddresses = new Set<string>();
  const holderRankMap = new Map<string, number>();
  const holderBalanceMap = new Map<string, number>();
  let holderTotalSupply = 0;

  try {
    const holderRows = await chQuery<{
      holder_address: string;
      rank: number;
      balance: number;
      total_supply: number;
    }>(
      `SELECT holder_address, rank, balance, total_supply
       FROM token_holder_snapshots
       WHERE currency = {currency:String}
         AND issuer = {issuer:String}
         AND snapshot_time = (
           SELECT max(snapshot_time)
           FROM token_holder_snapshots
           WHERE currency = {currency:String} AND issuer = {issuer:String}
         )
       ORDER BY rank ASC`,
      { currency, issuer },
    );

    for (const row of holderRows) {
      topHolderAddresses.add(row.holder_address);
      holderRankMap.set(row.holder_address, row.rank);
      holderBalanceMap.set(row.holder_address, row.balance);
      if (!holderTotalSupply) holderTotalSupply = row.total_supply;
    }
  } catch {
    // ClickHouse unavailable — holder data is optional
  }

  // ── Primary path: first-hop payment recipients filtered by this token ──
  // Aggregates issuer → recipient transfers from `value_transfer_events`.
  // For IOUs the value lives in `amount_iou` (a lossless decimal string);
  // toFloat64OrZero gives chart-grade precision (matches the prior
  // toFloat(r.amount) behavior on the Neo4j edge).
  let recipients: Array<{ address: string; amount: number; count: number }> = [];
  let primaryOk = true;

  try {
    const rows = await chQuery<{
      address: string;
      total_amount: number;
      payment_count: number;
    }>(
      `SELECT
         to_account AS address,
         sum(toFloat64OrZero(amount_iou)) AS total_amount,
         count() AS payment_count
       FROM value_transfer_events
       WHERE from_account = {issuer:String}
         AND currency = {currency:String}
         AND issuer = {issuer:String}
       GROUP BY to_account
       ORDER BY total_amount DESC
       LIMIT 50`,
      { issuer, currency },
    );

    recipients = rows.map((r) => ({
      address: r.address,
      amount: Number(r.total_amount) || 0,
      count: Number(r.payment_count) || 0,
    }));
  } catch {
    primaryOk = false;
  }

  // ── Fallback path: no direct payments → use current holder snapshot ──
  // Most modern XRPL tokens distribute via AMM/DEX, not direct Payment
  // transactions, so the PAYMENT graph for them is empty. In that case,
  // derive concentration from current top-holder balances instead.
  if (recipients.length === 0 && topHolderAddresses.size > 0) {
    const fallbackRecipients: IssuerRecipient[] = Array.from(topHolderAddresses)
      .map((address) => ({
        address,
        amountReceived: holderBalanceMap.get(address) ?? 0,
        paymentCount: 0,
        isTopHolder: true,
        holderRank: holderRankMap.get(address) ?? null,
      }))
      .sort((a, b) => b.amountReceived - a.amountReceived);

    const distributionGini = computeGini(
      fallbackRecipients.map((r) => r.amountReceived),
    );

    const result: IssuerAnalysisResult = {
      issuer,
      currency: currencyInput,
      recipientCount: topHolderAddresses.size,
      topRecipients: fallbackRecipients.slice(0, 20),
      // Insider ratio is undefined without direct-payment data — report 0
      // rather than fabricate a number.
      insiderRatio: 0,
      distributionGini,
      totalSupply: holderTotalSupply,
      source: "holders_snapshot",
      status: "scored",
    };
    issuerCache.set(cacheKey, result);
    return result;
  }

  if (!primaryOk || recipients.length === 0) {
    const result: IssuerAnalysisResult = {
      issuer,
      currency: currencyInput,
      recipientCount: 0,
      topRecipients: [],
      insiderRatio: 0,
      distributionGini: 0,
      totalSupply: holderTotalSupply,
      source: "none",
      status: primaryOk ? "insufficient_data" : "unavailable",
    };
    issuerCache.set(cacheKey, result);
    return result;
  }

  // Get recipient count (may be > 50 since we limit the detail query)
  let totalRecipientCount = recipients.length;
  try {
    const countRows = await chQuery<{ cnt: number }>(
      `SELECT count(DISTINCT to_account) AS cnt
       FROM value_transfer_events
       WHERE from_account = {issuer:String}
         AND currency = {currency:String}
         AND issuer = {issuer:String}`,
      { issuer, currency },
    );
    if (countRows.length > 0) {
      totalRecipientCount = Number(countRows[0].cnt) || recipients.length;
    }
  } catch {
    // Use the limited count
  }

  const topRecipients: IssuerRecipient[] = recipients.map((r) => ({
    address: r.address,
    amountReceived: r.amount,
    paymentCount: r.count,
    isTopHolder: topHolderAddresses.has(r.address),
    holderRank: holderRankMap.get(r.address) ?? null,
  }));

  // Compute insider ratio: what proportion of top holders received directly from issuer?
  const topHoldersFromIssuer = topRecipients.filter((r) => r.isTopHolder).length;
  const insiderRatio = topHolderAddresses.size > 0
    ? topHoldersFromIssuer / topHolderAddresses.size
    : 0;

  // Compute distribution Gini from amounts
  const distributionGini = computeGini(recipients.map((r) => r.amount));

  const result: IssuerAnalysisResult = {
    issuer,
    currency: currencyInput,
    recipientCount: totalRecipientCount,
    topRecipients: topRecipients.slice(0, 20),
    insiderRatio,
    distributionGini,
    totalSupply: holderTotalSupply,
    source: "direct_payments",
    status: "scored",
  };
  issuerCache.set(cacheKey, result);
  return result;
}
