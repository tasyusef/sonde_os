/**
 * Portfolio snapshot pipeline — captures balance + USD-value snapshots
 * for every tracked account.
 *
 * Storage moved PG → CH on 2026-05-09 (Phase 3 of the PG → CH
 * migration). Snapshots now write to the CH `portfolio_snapshots`
 * MergeTree partitioned monthly. Retention is a `DROP PARTITION` away —
 * replaces the stepped multi-tier `compactOnce` DELETE queries that
 * the PG implementation had to maintain manually.
 *
 * Runs as a Hetzner systemd timer (`sonde-portfolio-snapshot.timer`,
 * every 5 min) invoking `scripts/run-portfolio-snapshots.ts`.
 *
 * `snapshotNow(address)` stays as a public function because auth.ts
 * fires an immediate snapshot when a user signs in. The CH `MergeTree`
 * tolerates dup writes (rare race with the systemd-timer poll) — they
 * just produce two near-identical rows for the same `(address,
 * snapshot_time)` pair.
 */

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { trackedAccounts } from "@/db/schema";
import { xrplClient, type XrplClient } from "./xrpl-client";
import { getIngestionClient } from "./ingestion";
import { getXrpPrice } from "./price-data";
import { getTokensForPriceMap } from "./token-data";
import { partitionTrustLines, processAMMPositions } from "./amm-helpers";
import { dropsToXrp, decodeCurrency } from "./xrpl-helpers";
import {
  getAccountTrustLines,
  getNftOwnedCount,
} from "./clickhouse-queries";
import { insert as chInsert } from "./clickhouse-client";
import type { TokenListItem } from "@/lib/token-types";
import logger from "@/lib/logger";

import type {
  AccountInfoResponse,
  AccountObjectsResponse,
} from "@/types/xrpl-responses";

/** Delay between account fetches to avoid XRPL rate limits */
const INTER_ACCOUNT_DELAY = 2000;

/** Format a JS Date as a CH-friendly DateTime literal (`YYYY-MM-DD
 *  HH:MM:SS`, UTC, seconds resolution). */
function chDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

interface TokenBreakdownEntry {
  currency: string;
  issuer: string;
  name: string;
  balance: number;
  usd: number;
}

/* ------------------------------------------------------------------ */
/*  Per-account snapshot                                              */
/* ------------------------------------------------------------------ */

/**
 * Snapshot a single account at the given timestamp + XRP price.
 * Pulls live ledger state via XRPL, looks up token prices from PG,
 * computes total USD value, and inserts a row in `portfolio_snapshots`.
 *
 * Used by both `runPollOnce` (timer-driven) and `snapshotNow` (auth-driven).
 */
async function snapshotOneAccount(
  address: string,
  now: Date,
  xrpPriceUsd: number,
  client: XrplClient,
): Promise<void> {
  // 1. Account info — XRP balance
  const infoResult = (await client.sendWithRetry({
    command: "account_info",
    account: address,
    ledger_index: "validated",
  })) as AccountInfoResponse;
  const xrpBalance = parseFloat(dropsToXrp(infoResult.account_data.Balance));
  const ownerCount = infoResult.account_data.OwnerCount ?? 0;

  // 2. Trustlines + NFT count from CH state mirrors; escrows + paychannels
  // from rippled (those types aren't mirrored yet — but type-filtered
  // calls keep the rippled hit small). This replaces the previous
  // unfiltered paginate-all on `account_objects` (up to 50 pages × 50 =
  // 2,500 entries) + paginate-all on `account_nfts` (up to 200 pages).
  // For the snapshot timer running across N tracked accounts every 5
  // minutes, this is a meaningful drop in WS round-trips per cycle.
  const [allTrustLines, nftCount, escrows, channels] = await Promise.all([
    getAccountTrustLines(address).catch((err) => {
      logger.warn({ err, address }, "[portfolio-snapshots] CH trustlines failed");
      return [];
    }),
    getNftOwnedCount(address).catch(() => 0),
    paginateAccountObjectType(client, address, "escrow"),
    paginateAccountObjectType(client, address, "payment_channel"),
  ]);

  const { regularTrustLines, lpTrustLines } = partitionTrustLines(
    allTrustLines,
    address,
  );

  // 5. Token prices from DB
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

  // 6. Compute token values + breakdown
  let tokenValueUsd = 0;
  const tokenBreakdown: TokenBreakdownEntry[] = [];

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

  // 7. AMM positions value
  let ammValueUsd = 0;
  if (lpTrustLines.length > 0) {
    const ammResults = await Promise.allSettled(
      lpTrustLines.map((lp) => {
        const isHigh = lp.HighLimit.issuer === address;
        const ammAccount = isHigh
          ? lp.LowLimit.issuer
          : lp.HighLimit.issuer;
        return client.sendWithRetry({
          command: "amm_info",
          amm_account: ammAccount,
          ledger_index: "validated",
        });
      }),
    );
    const positions = processAMMPositions(lpTrustLines, ammResults, address);

    for (const pos of positions) {
      const share = pos.sharePercent / 100;
      // XRP side value
      if (pos.asset1IsXrp) {
        ammValueUsd += pos.asset1Value * share * xrpPriceUsd;
      } else {
        // Token price is XRP-denominated — convert to USD
        const key = `${pos.asset1Currency}:${pos.asset1Issuer}`;
        const priceXrp = tokenPriceMap[key]?.metrics.price ?? 0;
        ammValueUsd += pos.asset1Value * share * priceXrp * xrpPriceUsd;
      }
      // Second asset side
      if (pos.asset2IsXrp) {
        ammValueUsd += pos.asset2Value * share * xrpPriceUsd;
      } else {
        const key = `${pos.asset2Currency}:${pos.asset2Issuer}`;
        const priceXrp = tokenPriceMap[key]?.metrics.price ?? 0;
        ammValueUsd += pos.asset2Value * share * priceXrp * xrpPriceUsd;
      }
    }
  }

  // 8. Locked XRP — escrows + payment channels (already type-filtered above)
  let lockedXrp = 0;
  for (const obj of escrows) {
    const amount = obj.Amount;
    if (typeof amount === "string") {
      lockedXrp += parseFloat(dropsToXrp(amount));
    }
  }
  for (const obj of channels) {
    const amount = obj.Amount;
    const balance = obj.Balance;
    // Locked = Amount - Balance (remaining in channel)
    if (typeof amount === "string" && typeof balance === "string") {
      const remaining =
        parseFloat(dropsToXrp(amount)) - parseFloat(dropsToXrp(balance));
      if (remaining > 0) lockedXrp += remaining;
    }
  }

  // 9. Total value
  const xrpValueUsd = xrpBalance * xrpPriceUsd;
  const lockedXrpValueUsd = lockedXrp * xrpPriceUsd;
  const totalValueUsd =
    xrpValueUsd + tokenValueUsd + ammValueUsd + lockedXrpValueUsd;

  // 10. Insert snapshot into CH (Phase 3 of PG → CH migration).
  await chInsert("portfolio_snapshots", [
    {
      snapshot_time: chDateTime(now),
      address,
      xrp_balance: xrpBalance,
      xrp_price_usd: xrpPriceUsd,
      token_value_usd: tokenValueUsd,
      amm_value_usd: ammValueUsd,
      locked_xrp: lockedXrp,
      total_value_usd: totalValueUsd,
      nft_count: nftCount,
      owner_count: ownerCount,
      token_breakdown: JSON.stringify(tokenBreakdown),
    },
  ]);

  // 11. Update last_snapshot
  await db
    .update(trackedAccounts)
    .set({ lastSnapshot: now })
    .where(eq(trackedAccounts.address, address));
}

/* ------------------------------------------------------------------ */
/*  Public entry points                                                */
/* ------------------------------------------------------------------ */

/** Iterate every tracked account and write one snapshot per account.
 *  Called by the Hetzner systemd timer (every 5 min). Non-fatal per
 *  account: one failing wallet doesn't kill the cycle. */
export async function runPollOnce(): Promise<{ snapshotted: number; total: number }> {
  const accounts = await db
    .select({ address: trackedAccounts.address })
    .from(trackedAccounts);

  if (accounts.length === 0) {
    return { snapshotted: 0, total: 0 };
  }

  const now = new Date();
  let snapshotted = 0;

  // Fetch XRP price once (non-fatal — snapshot with 0 USD if unavailable)
  let xrpPriceUsd = 0;
  try {
    const priceData = await getXrpPrice();
    xrpPriceUsd = priceData.price;
  } catch (err) {
    logger.warn({ err }, "[portfolio-snapshots] Price unavailable, snapshotting with $0 USD");
  }

  // The systemd-timer-driven path uses the ingestion XRPL client
  // (separate WS singleton from the page-serving xrplClient) so a
  // long-running snapshot poll doesn't compete for slots with user
  // page loads.
  const client = getIngestionClient();

  for (const { address } of accounts) {
    try {
      await snapshotOneAccount(address, now, xrpPriceUsd, client);
      snapshotted++;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        `[portfolio-snapshots] Failed for ${address}`,
      );
    }
    await new Promise((r) => setTimeout(r, INTER_ACCOUNT_DELAY));
  }

  return { snapshotted, total: accounts.length };
}

/** No-op since the PG → CH migration on 2026-05-09. The PG version
 *  ran multi-tier DELETE queries to compact older snapshots; CH's
 *  monthly partitioning makes retention a `DROP PARTITION` operation
 *  instead, scheduled separately via a CH cleanup timer. The
 *  `runPollOnce` callers still invoke this for backward compatibility
 *  with the cron script signature. */
export async function compactOnce(): Promise<void> {
  // Intentionally empty. See header comment + CHANGELOG 2026-05-09.
}

/** Take an immediate snapshot for a single account.
 *  Called from auth.ts on user login so a freshly-authed wallet has
 *  at least one snapshot to render charts against, instead of waiting
 *  up to 5 minutes for the next timer cycle. Uses the page-serving
 *  xrplClient (lower latency for one-shot calls). */
export async function snapshotNow(address: string): Promise<void> {
  let xrpPriceUsd = 0;
  try {
    const priceData = await getXrpPrice();
    xrpPriceUsd = priceData.price;
  } catch {
    /* proceed with 0 USD */
  }
  await snapshotOneAccount(address, new Date(), xrpPriceUsd, xrplClient);
  logger.info(`[portfolio-snapshots] On-demand snapshot for ${address.slice(0, 8)}...`);
}

/** Paginate `account_objects` for a single LedgerEntryType. With the
 *  type filter, rippled only returns matching entries — typical
 *  accounts have 0 escrows + 0 paychannels, so this is usually one
 *  empty page each. The 50-page cap is a safety against runaway
 *  iteration; real accounts never approach it for these types. */
async function paginateAccountObjectType(
  client: XrplClient,
  address: string,
  type: "escrow" | "payment_channel",
): Promise<Array<Record<string, unknown>>> {
  let out: Array<Record<string, unknown>> = [];
  let marker: unknown = undefined;
  let page = 0;
  do {
    try {
      const result = (await client.sendWithRetry({
        command: "account_objects",
        account: address,
        ledger_index: "validated",
        type,
        limit: 50,
        ...(marker ? { marker } : {}),
      })) as AccountObjectsResponse;
      out = out.concat(result.account_objects ?? []);
      marker = result.marker;
    } catch (err) {
      logger.warn(
        { err, address, type, page },
        "[portfolio-snapshots] account_objects page failed",
      );
      break;
    }
    page++;
  } while (marker && page < 50);
  return out;
}
