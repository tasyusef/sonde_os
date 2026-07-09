import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { xrplClient } from "@/lib/xrpl-client";
import { getXrpPrice } from "@/lib/price-data";
import { getNetworkStats } from "@/lib/xrpl-data";
import { getTokensForPriceMap } from "@/lib/token-data";
import { partitionTrustLines, processAMMPositions } from "@/lib/amm-helpers";
import { dropsToXrp, decodeCurrency } from "@/lib/xrpl-helpers";
import { MOCK_CURRENT } from "@/lib/mock-portfolio";
import {
  getAccountTrustLines,
  getNftOwnedCount,
} from "@/lib/clickhouse-queries";
import type { TokenListItem } from "@/lib/token-types";
import logger from "@/lib/logger";

/**
 * GET /api/portfolio/current
 * Returns live portfolio data for the authenticated user.
 */
export async function GET() {
  if (process.env.MOCK_PORTFOLIO === "true") {
    return NextResponse.json(MOCK_CURRENT);
  }

  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = session.address;

  try {
    // Parallel: account info + XRP price + network stats (price + stats non-fatal)
    const [infoResult, priceResult, statsResult] = await Promise.allSettled([
      xrplClient.getAccountInfo(address),
      getXrpPrice(),
      getNetworkStats(),
    ]);

    if (infoResult.status === "rejected") {
      logger.error({ err: infoResult.reason }, "[api/portfolio/current] Failed account info");
      throw infoResult.reason;
    }

    const xrpPriceUsd = priceResult.status === "fulfilled" ? priceResult.value.price : 0;
    if (priceResult.status === "rejected") {
      logger.warn({ err: priceResult.reason }, "[api/portfolio/current] Price unavailable, using 0");
    }

    // Live reserves from server_info, with current mainnet defaults as fallback.
    const reserveBase = statsResult.status === "fulfilled" ? statsResult.value.reserveBase : 1;
    const reserveIncrement = statsResult.status === "fulfilled" ? statsResult.value.reserveIncrement : 0.2;
    if (statsResult.status === "rejected") {
      logger.warn({ err: statsResult.reason }, "[api/portfolio/current] Network stats unavailable, using defaults");
    }

    const accountData = infoResult.value.account_data;
    const xrpBalance = parseFloat(dropsToXrp(accountData.Balance));
    const ownerCount = accountData.OwnerCount ?? 0;

    // Parallel: trustlines + NFT count from CH state mirrors, escrows
    // and paychannels from rippled (those types aren't mirrored yet).
    // Replaces the old paginate-all on `account_objects` (up to 50 pages
    // for whales) + paginate-all on `account_nfts`. With the type
    // filter on account_objects, rippled returns only the matching
    // entries — most accounts have 0 escrows / 0 channels so this is
    // typically a single empty page each.
    const [trustLinesResult, nftCountResult, escrows, channels] =
      await Promise.all([
        getAccountTrustLines(address).catch((err) => {
          logger.error({ err }, "[api/portfolio/current] CH trustlines failed");
          return [];
        }),
        getNftOwnedCount(address).catch(() => 0),
        paginateAccountObjectType(address, "escrow"),
        paginateAccountObjectType(address, "payment_channel"),
      ]);

    const allTrustLines = trustLinesResult;
    const nftCount = nftCountResult;

    const { regularTrustLines, lpTrustLines } = partitionTrustLines(
      allTrustLines,
      address,
    );

    // Token prices
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

    // Token values
    let tokenValueUsd = 0;
    const tokenBreakdown: {
      currency: string;
      issuer: string;
      name: string;
      balance: number;
      usd: number;
    }[] = [];

    for (const tl of regularTrustLines) {
      const isHigh = tl.HighLimit.issuer === address;
      const balance = parseFloat(tl.Balance.value);
      const displayBalance = isHigh ? -balance : balance;
      if (displayBalance <= 0) continue;

      const issuer = isHigh ? tl.LowLimit.issuer : tl.HighLimit.issuer;
      const currency = tl.Balance.currency;
      const key = `${currency}:${issuer}`;
      const tokenInfo = tokenPriceMap[key];
      // Price from orderbook is XRP-denominated — convert to USD
      const priceXrp = tokenInfo?.metrics.price ?? 0;
      const valueUsd = displayBalance * priceXrp * xrpPriceUsd;

      tokenValueUsd += valueUsd;
      tokenBreakdown.push({
        currency,
        issuer,
        name: tokenInfo?.meta.name ?? decodeCurrency(currency),
        balance: displayBalance,
        usd: valueUsd,
      });
    }

    // AMM value
    let ammValueUsd = 0;
    if (lpTrustLines.length > 0) {
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
      for (const pos of positions) {
        const share = pos.sharePercent / 100;
        if (pos.asset1IsXrp) {
          ammValueUsd += pos.asset1Value * share * xrpPriceUsd;
        } else {
          // Token price is XRP-denominated — convert to USD
          const key = `${pos.asset1Currency}:${pos.asset1Issuer}`;
          const priceXrp = tokenPriceMap[key]?.metrics.price ?? 0;
          ammValueUsd += pos.asset1Value * share * priceXrp * xrpPriceUsd;
        }
        if (pos.asset2IsXrp) {
          ammValueUsd += pos.asset2Value * share * xrpPriceUsd;
        } else {
          const key = `${pos.asset2Currency}:${pos.asset2Issuer}`;
          const priceXrp = tokenPriceMap[key]?.metrics.price ?? 0;
          ammValueUsd += pos.asset2Value * share * priceXrp * xrpPriceUsd;
        }
      }
    }

    // Locked XRP from escrows + paychannels. Filtered fetches above
    // mean these arrays only contain the relevant types.
    let lockedXrp = 0;
    for (const obj of escrows) {
      if (typeof obj.Amount === "string" && obj.Account === address) {
        lockedXrp += parseFloat(dropsToXrp(obj.Amount));
      }
    }
    for (const obj of channels) {
      if (
        typeof obj.Amount === "string" &&
        typeof obj.Balance === "string" &&
        obj.Account === address
      ) {
        const remaining =
          parseFloat(dropsToXrp(obj.Amount)) -
          parseFloat(dropsToXrp(obj.Balance));
        if (remaining > 0) lockedXrp += remaining;
      }
    }

    const xrpValueUsd = xrpBalance * xrpPriceUsd;
    const totalValueUsd = xrpValueUsd + tokenValueUsd + ammValueUsd + lockedXrp * xrpPriceUsd;

    return NextResponse.json({
      xrpBalance,
      xrpPriceUsd,
      tokenValueUsd,
      nftCount,
      ammValueUsd,
      lockedXrp,
      totalValueUsd,
      tokenBreakdown,
      ownerCount,
      reserveBase,
      reserveIncrement,
    });
  } catch (err) {
    logger.error({ err }, "[api/portfolio/current] Error");
    return NextResponse.json(
      { error: "Failed to fetch portfolio data" },
      { status: 500 },
    );
  }
}

/** Paginate `account_objects` for a single LedgerEntryType. With the
 *  type filter, rippled only returns matching entries — typical
 *  accounts have 0 escrows + 0 paychannels, so this is usually one
 *  empty page each. The 50-page cap is a safety against runaway
 *  iteration; real accounts never approach it for these types. */
async function paginateAccountObjectType(
  address: string,
  type: "escrow" | "payment_channel",
): Promise<Array<Record<string, unknown>>> {
  let out: Array<Record<string, unknown>> = [];
  let marker: unknown = undefined;
  let page = 0;
  do {
    try {
      const result = await xrplClient.getAccountObjects(address, type, marker);
      out = out.concat(result.account_objects ?? []);
      marker = result.marker;
    } catch (err) {
      logger.warn(
        { err, type, page },
        "[api/portfolio/current] account_objects page failed",
      );
      break;
    }
    page++;
  } while (marker && page < 50);
  return out;
}
