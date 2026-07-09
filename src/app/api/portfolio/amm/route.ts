import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { xrplClient } from "@/lib/xrpl-client";
import { getXrpPrice } from "@/lib/price-data";
import { getTokensForPriceMap } from "@/lib/token-data";
import { partitionTrustLines, processAMMPositions } from "@/lib/amm-helpers";
import { MOCK_AMM_POSITIONS } from "@/lib/mock-portfolio";
import { getAccountTrustLines } from "@/lib/clickhouse-queries";
import type { TokenListItem } from "@/lib/token-types";
import logger from "@/lib/logger";

/**
 * GET /api/portfolio/amm
 * Returns detailed AMM/LP positions for the authenticated user.
 */
export async function GET() {
  if (process.env.MOCK_PORTFOLIO === "true") {
    return NextResponse.json(MOCK_AMM_POSITIONS);
  }

  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = session.address;

  try {
    // Trustlines + price in parallel — both cheap. Trustlines come
    // from CH (`trustlines` mirror), replacing the previous
    // paginate-all on `account_objects` (up to 50 pages × 250 = 12,500
    // entries for whales, 5–10s wall clock).
    const [priceResult, allTrustLines] = await Promise.all([
      getXrpPrice().catch(() => ({ price: 0 })),
      getAccountTrustLines(address).catch((err) => {
        logger.error({ err }, "[api/portfolio/amm] CH trustlines failed");
        return [];
      }),
    ]);
    const xrpPriceUsd = priceResult.price;

    const { regularTrustLines, lpTrustLines } = partitionTrustLines(
      allTrustLines,
      address,
    );

    if (lpTrustLines.length === 0) {
      return NextResponse.json({ positions: [], totalValueUsd: 0 });
    }

    // Build token price map for non-XRP assets
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
        /* proceed without */
      }
    }

    // Fetch AMM info for each LP position
    const ammResults = await Promise.allSettled(
      lpTrustLines.map((lp) => {
        const isHigh = lp.HighLimit.issuer === address;
        const ammAccount = isHigh
          ? lp.LowLimit.issuer
          : lp.HighLimit.issuer;
        return xrplClient.getAMMInfo(ammAccount);
      }),
    );

    const positions = processAMMPositions(lpTrustLines, ammResults, address);

    // Compute USD values per position
    let totalValueUsd = 0;
    const enriched = positions.map((pos) => {
      const share = pos.sharePercent / 100;

      let asset1Usd = 0;
      if (pos.asset1IsXrp) {
        asset1Usd = pos.asset1Value * share * xrpPriceUsd;
      } else {
        const key = `${pos.asset1Currency}:${pos.asset1Issuer}`;
        const priceXrp = tokenPriceMap[key]?.metrics.price ?? 0;
        asset1Usd = pos.asset1Value * share * priceXrp * xrpPriceUsd;
      }

      let asset2Usd = 0;
      if (pos.asset2IsXrp) {
        asset2Usd = pos.asset2Value * share * xrpPriceUsd;
      } else {
        const key = `${pos.asset2Currency}:${pos.asset2Issuer}`;
        const priceXrp = tokenPriceMap[key]?.metrics.price ?? 0;
        asset2Usd = pos.asset2Value * share * priceXrp * xrpPriceUsd;
      }

      const posValueUsd = asset1Usd + asset2Usd;
      totalValueUsd += posValueUsd;

      return {
        ammAccount: pos.ammAccount,
        asset1Currency: pos.asset1Currency,
        asset1Issuer: pos.asset1Issuer,
        asset1Name: pos.asset1Label,
        asset1Value: pos.asset1Value,
        asset1IsXrp: pos.asset1IsXrp,
        asset2Currency: pos.asset2Currency,
        asset2Issuer: pos.asset2Issuer,
        asset2Name: pos.asset2Label,
        asset2Value: pos.asset2Value,
        asset2IsXrp: pos.asset2IsXrp,
        lpBalance: pos.lpTokenBalance,
        sharePercent: pos.sharePercent,
        totalValueUsd: posValueUsd,
        tradingFee: pos.tradingFee,
      };
    });

    return NextResponse.json({ positions: enriched, totalValueUsd });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/portfolio/amm] Error");
    return NextResponse.json(
      { error: "Failed to fetch AMM positions" },
      { status: 500 },
    );
  }
}
