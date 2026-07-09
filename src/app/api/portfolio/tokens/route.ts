import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tokenCostBasis } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { MOCK_TOKENS } from "@/lib/mock-portfolio";
import {
  XRP_COST_BASIS_CURRENCY,
  XRP_COST_BASIS_ISSUER,
} from "@/lib/cost-basis-extractor";
import { getAccountTrustLines } from "@/lib/clickhouse-queries";
import { getTokensForPriceMap } from "@/lib/token-data";
import { getXrpPrice } from "@/lib/price-data";
import { xrplClient } from "@/lib/xrpl-client";
import { partitionTrustLines } from "@/lib/amm-helpers";
import { dropsToXrp, decodeCurrency } from "@/lib/xrpl-helpers";
import type { TokenListItem } from "@/lib/token-types";
import type { AccountInfoResponse } from "@/types/xrpl-responses";
import logger from "@/lib/logger";

interface BreakdownEntry {
  currency: string;
  issuer: string;
  name: string;
  balance: number;
  usd: number;
}

/**
 * GET /api/portfolio/tokens
 *
 * Returns the user's per-token breakdown for the current state — XRP +
 * every IOU trustline with a positive balance — along with cost basis
 * + realized PnL from the ingestion pipeline.
 *
 * Live-computed on every request (not read from `portfolio_snapshots`)
 * so phantom holdings reconciled by `POST /api/portfolio/refresh`
 * disappear immediately rather than waiting up to 5 min for the next
 * snapshot cycle. Snapshots are still the source for historical
 * over-time charts (`/api/portfolio/history`); they're just no longer
 * on the read path for current-state token display.
 *
 * Data sources:
 *   - CH `trustlines` for IOU balances (self-healing via /refresh)
 *   - rippled `account_info` for live XRP balance
 *   - PG `tokens` for token prices, names, icons (via getTokensForPriceMap)
 *   - PG `token_cost_basis` + `token_realized_pnl` for cost/PnL
 *
 * Latency budget: typically 200-500ms (single rippled call + CH
 * query + a few PG selects). Slower than the old snapshot read
 * (sub-50ms) but the freshness is real-time.
 */
export async function GET() {
  if (process.env.MOCK_PORTFOLIO === "true") {
    return NextResponse.json(MOCK_TOKENS);
  }

  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const address = session.address;

  try {
    // Fan out: live XRP balance + live token prices + live trustlines +
    // static cost basis + static realized PnL.
    // getAccountTrustLines is fast (single CH partition scan) and the
    // PG selects are indexed. account_info from rippled is the long
    // pole — typically 100-300ms.
    const [accountInfoResult, trustLines, xrpPriceResult, costBasisRows, realizedPnlRows] =
      await Promise.all([
        xrplClient
          .sendWithRetry({
            command: "account_info",
            account: address,
            ledger_index: "validated",
          })
          .then((r) => r as AccountInfoResponse)
          .catch(() => null),
        getAccountTrustLines(address).catch(() => []),
        getXrpPrice().catch(() => ({ price: 0 })),
        db
          .select({
            currency: tokenCostBasis.currency,
            issuer: tokenCostBasis.issuer,
            totalQty: tokenCostBasis.totalQtyAcquired,
            totalCostUsd: tokenCostBasis.totalCostUsd,
          })
          .from(tokenCostBasis)
          .where(sql`${tokenCostBasis.address} = ${address}`),
        db.execute<{ currency: string; issuer: string; realized_pnl: string }>(sql`
          SELECT currency, issuer, SUM(pnl_usd)::text AS realized_pnl
          FROM token_realized_pnl
          WHERE address = ${address}
          GROUP BY currency, issuer
        `),
      ]);

    const xrpBalance = accountInfoResult
      ? parseFloat(dropsToXrp(accountInfoResult.account_data.Balance))
      : 0;
    const xrpPriceUsd = xrpPriceResult.price;

    // Partition out AMM LP tokens — they're handled by /api/portfolio/amm
    // and have their own valuation flow. Regular IOU trustlines feed
    // the token breakdown below.
    const { regularTrustLines } = partitionTrustLines(trustLines, address);

    // Build the price map for the user's specific (currency, issuer)
    // pairs. Same shape the snapshot writer uses — keeps valuation
    // logic consistent.
    const tokenPairs = regularTrustLines.map((tl) => {
      const isHigh = tl.HighLimit.issuer === address;
      return {
        currency: tl.Balance.currency,
        issuer: isHigh ? tl.LowLimit.issuer : tl.HighLimit.issuer,
      };
    });

    let tokenPriceMap: Record<string, TokenListItem> = {};
    if (tokenPairs.length > 0) {
      try {
        const tokens = await getTokensForPriceMap(tokenPairs);
        tokenPriceMap = Object.fromEntries(
          tokens.map((t) => [`${t.currency}:${t.issuer}`, t]),
        );
      } catch {
        /* proceed without token valuations */
      }
    }

    // Compute the token breakdown — same balance + USD math the
    // snapshot writer does in `snapshotOneAccount`. Filter out zero /
    // negative balances (issuer-perspective rows) so only true
    // holdings appear.
    const tokenBreakdown: BreakdownEntry[] = [];
    for (const tl of regularTrustLines) {
      const isHigh = tl.HighLimit.issuer === address;
      const balance = parseFloat(tl.Balance.value);
      const displayBalance = isHigh ? -balance : balance;
      if (displayBalance <= 0) continue;

      const issuer = isHigh ? tl.LowLimit.issuer : tl.HighLimit.issuer;
      const currency = tl.Balance.currency;
      const tokenInfo = tokenPriceMap[`${currency}:${issuer}`];
      const priceXrp = tokenInfo?.metrics.price ?? 0;
      const valueUsd = displayBalance * priceXrp * xrpPriceUsd;

      tokenBreakdown.push({
        currency,
        issuer,
        name: tokenInfo?.meta.name ?? decodeCurrency(currency),
        balance: displayBalance,
        usd: valueUsd,
      });
    }

    // Inject XRP as a synthetic entry at the top of the list (only if
    // balance > 0). XRP gets sorted alongside IOUs by USD value below.
    const allEntries: BreakdownEntry[] = [...tokenBreakdown];
    if (xrpBalance > 0) {
      allEntries.unshift({
        currency: XRP_COST_BASIS_CURRENCY,
        issuer: XRP_COST_BASIS_ISSUER,
        name: "XRP",
        balance: xrpBalance,
        usd: xrpBalance * xrpPriceUsd,
      });
    }

    // Build cost basis map: "currency:issuer" → { totalQty, totalCostUsd }
    const cbMap = new Map<string, { totalQty: number; totalCostUsd: number }>();
    for (const row of costBasisRows) {
      cbMap.set(`${row.currency}:${row.issuer}`, {
        totalQty: Number(row.totalQty),
        totalCostUsd: Number(row.totalCostUsd),
      });
    }

    // Build realized PnL map: "currency:issuer" → total realized USD
    const rpMap = new Map<string, number>();
    for (const row of realizedPnlRows) {
      rpMap.set(`${row.currency}:${row.issuer}`, Number(row.realized_pnl));
    }

    // Sort by USD value descending and overlay cost basis / PnL
    const tokens = allEntries
      .sort((a, b) => b.usd - a.usd)
      .map((t) => {
        const key = `${t.currency}:${t.issuer}`;
        const cb = cbMap.get(key);

        // Weighted average cost per unit from actual trades
        const avgCostPerUnit =
          cb && cb.totalQty > 0 ? cb.totalCostUsd / cb.totalQty : null;

        // Cost basis = current balance × avg acquisition cost
        const costBasisUsd =
          avgCostPerUnit != null ? t.balance * avgCostPerUnit : null;

        // PnL = current value - cost basis
        let pnlUsd: number | null = null;
        let pnlPct: number | null = null;
        if (costBasisUsd != null && costBasisUsd > 0) {
          pnlUsd = t.usd - costBasisUsd;
          pnlPct = (pnlUsd / costBasisUsd) * 100;
        }

        const realizedPnlUsd = rpMap.get(key) ?? null;

        return {
          currency: t.currency,
          issuer: t.issuer,
          name: t.name,
          balance: t.balance,
          priceUsd: t.balance > 0 ? t.usd / t.balance : 0,
          valueUsd: t.usd,
          costBasisUsd,
          pnlUsd,
          pnlPct,
          realizedPnlUsd,
        };
      });

    return NextResponse.json({ tokens });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/portfolio/tokens] Error");
    return NextResponse.json(
      { error: "Failed to fetch token breakdown" },
      { status: 500 },
    );
  }
}
