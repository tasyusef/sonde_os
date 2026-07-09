/**
 * Reusable query functions for reading synthesized data from ClickHouse.
 * Used by the /api/rankings/* routes.
 *
 * Migrated from Postgres aggregation tables to CH materialized views:
 *   - nft_volume_*       → mv_nft_volume_hourly / mv_nft_volume_daily
 *   - token_volume_*     → mv_token_volume_hourly / mv_dex_pair_daily
 *   - recent_nft_trades  → CH `nft_trades` table directly (top 10 by ts)
 *
 * `getRankingMeta` still reads `ingestion_state` from PG for the ledger
 * range — that's a small key/value table not a heavy aggregation.
 *
 * All queries include a 5min in-memory response cache to handle
 * concurrent API consumers without proportional DB load.
 */

import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { LRUCache } from "./cache";
import { query as chQuery } from "@/lib/clickhouse-client";
import { ingestionState, nftCollections, nftMetadata } from "@/db/schema";
import { getNFTMetadataBatch } from "./nft-metadata-resolver";
import { parseNFTokenID } from "./nft-utils";
import type { NFTBrowseItem } from "@/types/nft";

/* ------------------------------------------------------------------ */
/*  Response cache (120s TTL)                                          */
/* ------------------------------------------------------------------ */

const rankingCache = new LRUCache<unknown>(50, 300_000);

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface NFTMarketplaceRanking {
  marketplace: string;
  tradeCount: number;
  xrpVolume: number;
}

export interface NFTCollectionRanking {
  issuer: string;
  taxon: number;
  tradeCount: number;
  xrpVolume: number;
}

export interface TokenVolumeRanking {
  currency: string;
  issuer: string | null;
  pairCurrency: string;
  pairIssuer: string | null;
  tradeCount: number;
  volume: number;
  xrpVolume: number;
}

export interface RankingMeta {
  period: string;
  dataFrom: string | null;
  ledgerRange: [number, number];
}

type Period = "24h" | "7d" | "30d" | "all";

/* ------------------------------------------------------------------ */
/*  NFT Marketplace Rankings                                           */
/* ------------------------------------------------------------------ */

export async function getNFTMarketplaceRankings(
  period: Period = "24h",
  limit = 10,
): Promise<{ rankings: NFTMarketplaceRanking[]; meta: RankingMeta }> {
  const cacheKey = `nft-mp:${period}:${limit}`;
  const cached = rankingCache.get(cacheKey) as
    | { rankings: NFTMarketplaceRanking[]; meta: RankingMeta }
    | undefined;
  if (cached) return cached;

  const meta = await getRankingMeta(period);
  let rankings: NFTMarketplaceRanking[];

  if (period === "24h") {
    const rows = await chQuery<{
      marketplace: string;
      trade_count: string | number;
      xrp_volume_drops: string | number;
    }>(
      `SELECT marketplace,
              sum(trade_count) AS trade_count,
              sum(xrp_volume_drops) AS xrp_volume_drops
       FROM mv_nft_volume_hourly
       WHERE hour >= now() - INTERVAL 24 HOUR
         AND marketplace != ''
       GROUP BY marketplace
       ORDER BY xrp_volume_drops DESC
       LIMIT {limit:UInt32}`,
      { limit },
    );

    rankings = rows.map((r) => ({
      marketplace: r.marketplace,
      tradeCount: Number(r.trade_count),
      xrpVolume: dropsToXrpNumber(String(r.xrp_volume_drops)),
    }));
  } else {
    const cutoffDays = periodDays(period);
    const dayClause = cutoffDays != null ? `AND day > today() - ${cutoffDays}` : "";
    const rows = await chQuery<{
      marketplace: string;
      trade_count: string | number;
      xrp_volume_drops: string | number;
    }>(
      `SELECT marketplace,
              sum(trade_count) AS trade_count,
              sum(xrp_volume_drops) AS xrp_volume_drops
       FROM mv_nft_volume_daily
       WHERE marketplace != ''
         ${dayClause}
       GROUP BY marketplace
       ORDER BY xrp_volume_drops DESC
       LIMIT {limit:UInt32}`,
      { limit },
    );

    rankings = rows.map((r) => ({
      marketplace: r.marketplace,
      tradeCount: Number(r.trade_count),
      xrpVolume: dropsToXrpNumber(String(r.xrp_volume_drops)),
    }));
  }

  const result = { rankings, meta };
  rankingCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  NFT Collection Rankings                                            */
/* ------------------------------------------------------------------ */

export async function getNFTCollectionRankings(
  period: Period = "24h",
  limit = 10,
): Promise<{ rankings: NFTCollectionRanking[]; meta: RankingMeta }> {
  const cacheKey = `nft-col:${period}:${limit}`;
  const cached = rankingCache.get(cacheKey) as
    | { rankings: NFTCollectionRanking[]; meta: RankingMeta }
    | undefined;
  if (cached) return cached;

  const meta = await getRankingMeta(period);

  // Query nft_trades directly rather than the per-issuer MV — the
  // MV doesn't carry taxon, and we need (issuer, taxon) granularity
  // for the collection-detail-page links. nft_trades is 236k rows on
  // prod and partition-pruned by month; GROUP BY runs in <300ms.
  const timeClause =
    period === "24h"
      ? "timestamp >= now() - INTERVAL 24 HOUR"
      : period === "7d"
        ? "timestamp >= today() - 7"
        : period === "30d"
          ? "timestamp >= today() - 30"
          : "true";

  const rows = await chQuery<{
    issuer: string;
    taxon: string | number;
    trade_count: string | number;
    xrp_volume_drops: string | number;
  }>(
    `SELECT issuer,
            taxon,
            count() AS trade_count,
            toString(sumIf(amount_drops, is_xrp = 1)) AS xrp_volume_drops
     FROM nft_trades
     WHERE ${timeClause}
     GROUP BY issuer, taxon
     ORDER BY toInt64(xrp_volume_drops) DESC
     LIMIT {limit:UInt32}`,
    { limit },
  );

  const rankings: NFTCollectionRanking[] = rows.map((r) => ({
    issuer: r.issuer,
    taxon: Number(r.taxon),
    tradeCount: Number(r.trade_count),
    xrpVolume: dropsToXrpNumber(String(r.xrp_volume_drops)),
  }));

  const result = { rankings, meta };
  rankingCache.set(cacheKey, result);
  return result;
}

/**
 * Floor price (minimum active XRP sell offer) for a list of
 * (issuer, taxon) pairs, returned as a map keyed on `${issuer}:${taxon}`.
 * Used to enrich the NFTTopCollections ranking with a floor column.
 *
 * Filters mirror the single-collection floor in getCollectionStats:
 *   - flags & 1 = 1 (tfSellNFToken — sell offer, not a bid)
 *   - currency = 'XRP' (token-denominated floors are excluded by
 *     design — the UI shows "floor in XRP")
 *   - closed_ledger = 0 (still active)
 *   - expiration_xrpl = 0 OR > now-as-ripple-epoch (not expired)
 */
export async function getNFTCollectionFloors(
  pairs: Array<{ issuer: string; taxon: number }>,
): Promise<Map<string, string>> {
  if (pairs.length === 0) return new Map();

  // Build an IN clause over an array of tuples — CH supports
  // `(issuer, taxon) IN ((...), (...))` for compound predicates.
  // Parameterize as JSON-encoded arrays since CH driver doesn't bind
  // tuple arrays directly.
  const issuers = pairs.map((p) => p.issuer);
  const taxons = pairs.map((p) => p.taxon);

  const rows = await chQuery<{
    issuer: string;
    taxon: string | number;
    floor_drops: string | number | null;
  }>(
    `SELECT m.issuer AS issuer,
            m.taxon AS taxon,
            toString(min(o.amount_drops)) AS floor_drops
     FROM nft_offers AS o FINAL
     INNER JOIN nft_static_metadata AS m FINAL
       ON m.nft_id = o.nft_id
     WHERE m.issuer IN {issuers:Array(String)}
       AND m.taxon IN {taxons:Array(UInt32)}
       AND o.closed_ledger = 0
       AND bitAnd(o.flags, 1) = 1
       AND o.currency = 'XRP'
       AND o.amount_drops > 0
       AND (o.expiration_xrpl = 0 OR o.expiration_xrpl > toUInt32(toUnixTimestamp(now()) - 946684800))
     GROUP BY m.issuer, m.taxon`,
    { issuers, taxons },
  );

  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.floor_drops != null && String(row.floor_drops) !== "0") {
      out.set(`${row.issuer}:${row.taxon}`, String(row.floor_drops));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Token Volume Rankings                                              */
/* ------------------------------------------------------------------ */

export async function getTokenVolumeRankings(
  period: Period = "24h",
  limit = 20,
  pairFilter: "xrp" | "all" = "xrp",
): Promise<{ rankings: TokenVolumeRanking[]; meta: RankingMeta }> {
  const cacheKey = `token-vol:${period}:${limit}:${pairFilter}`;
  const cached = rankingCache.get(cacheKey) as
    | { rankings: TokenVolumeRanking[]; meta: RankingMeta }
    | undefined;
  if (cached) return cached;

  const meta = await getRankingMeta(period);
  let rankings: TokenVolumeRanking[];

  // The CH `dex_trades` ingester normalizes token-XRP fills to base=token,
  // quote='XRP'. For "xrp"-only pairs we filter on either base or quote
  // being XRP — token-token pairs are filtered out. For "all", no filter.
  const xrpClause =
    pairFilter === "xrp" ? `AND (base_currency = 'XRP' OR quote_currency = 'XRP')` : "";

  if (period === "24h") {
    const rows = await chQuery<{
      base_currency: string;
      base_issuer: string;
      quote_currency: string;
      quote_issuer: string;
      trade_count: string | number;
      base_volume: string | number;
      xrp_volume_drops: string | number;
    }>(
      `SELECT base_currency, base_issuer, quote_currency, quote_issuer,
              sum(trade_count) AS trade_count,
              sum(base_volume) AS base_volume,
              sum(xrp_volume_drops) AS xrp_volume_drops
       FROM mv_token_volume_hourly
       WHERE hour >= now() - INTERVAL 24 HOUR
         ${xrpClause}
       GROUP BY base_currency, base_issuer, quote_currency, quote_issuer
       ORDER BY xrp_volume_drops DESC
       LIMIT {limit:UInt32}`,
      { limit },
    );

    rankings = rows.map(mapChTokenRow);
  } else {
    const cutoffDays = periodDays(period);
    const dayClause = cutoffDays != null ? `AND day > today() - ${cutoffDays}` : "";
    const rows = await chQuery<{
      base_currency: string;
      base_issuer: string;
      quote_currency: string;
      quote_issuer: string;
      trade_count: string | number;
      base_volume: string | number;
      xrp_volume_drops: string | number;
    }>(
      `SELECT base_currency, base_issuer, quote_currency, quote_issuer,
              sum(trade_count) AS trade_count,
              sum(base_volume) AS base_volume,
              sum(xrp_volume_drops) AS xrp_volume_drops
       FROM mv_dex_pair_daily
       WHERE 1=1
         ${dayClause}
         ${xrpClause}
       GROUP BY base_currency, base_issuer, quote_currency, quote_issuer
       ORDER BY xrp_volume_drops DESC
       LIMIT {limit:UInt32}`,
      { limit },
    );

    rankings = rows.map(mapChTokenRow);
  }

  const result = { rankings, meta };
  rankingCache.set(cacheKey, result);
  return result;
}

/* ------------------------------------------------------------------ */
/*  Top Traded Pairs                                                   */
/* ------------------------------------------------------------------ */

export async function getTopTradedPairs(
  period: Period = "24h",
  limit = 20,
): Promise<{ rankings: TokenVolumeRanking[]; meta: RankingMeta }> {
  // Top traded pairs is the same query as token volume with all pairs
  return getTokenVolumeRankings(period, limit, "all");
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function dropsToXrpNumber(drops: string | null): number {
  if (!drops) return 0;
  return Number(drops) / 1_000_000;
}

/** Period → number of days back, or null for "all". Used to build CH
 *  `today() - N` cutoffs for daily MV queries. */
function periodDays(period: Period): number | null {
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "all":
      return null;
    default:
      return null;
  }
}

/** Map a CH token-volume row to the public TokenVolumeRanking shape.
 *  PG `currency/issuer` ↔ CH `base_currency/base_issuer`;
 *  PG `pairCurrency/pairIssuer` ↔ CH `quote_currency/quote_issuer`. */
function mapChTokenRow(r: {
  base_currency: string;
  base_issuer: string;
  quote_currency: string;
  quote_issuer: string;
  trade_count: string | number;
  base_volume: string | number;
  xrp_volume_drops: string | number;
}): TokenVolumeRanking {
  return {
    currency: r.base_currency,
    issuer: r.base_issuer || null,
    pairCurrency: r.quote_currency,
    pairIssuer: r.quote_issuer || null,
    tradeCount: Number(r.trade_count),
    volume: Number(r.base_volume),
    xrpVolume: dropsToXrpNumber(String(r.xrp_volume_drops)),
  };
}

/* ------------------------------------------------------------------ */
/*  Recent NFT Trades                                                   */
/* ------------------------------------------------------------------ */

export interface RecentNFTTradeRow {
  txHash: string;
  nftokenId: string;
  buyer: string;
  seller: string;
  amountDrops: string | null;
  date: number | null;
}

/** XRPL ripple-epoch offset: 2000-01-01 00:00:00 UTC in unix seconds.
 *  XRPL transaction dates are seconds since this epoch; the `RecentTrades`
 *  component still expects that convention so we re-derive it from CH's
 *  `timestamp` (a unix DateTime). */
const RIPPLE_EPOCH_UNIX = 946684800;

export async function getRecentNFTTrades(): Promise<RecentNFTTradeRow[]> {
  const cached = rankingCache.get("recent-nft-trades") as RecentNFTTradeRow[] | undefined;
  if (cached) return cached;

  // Reads directly from CH `nft_trades` instead of the old PG rolling
  // buffer. The MV-backed table is partitioned by month and ordered by
  // (tx_hash, nft_id), so the 10-row tail is fast via ORDER BY timestamp.
  const rows = await chQuery<{
    tx_hash: string;
    nft_id: string;
    buyer: string;
    seller: string;
    amount_drops: string | number | null;
    is_xrp: number | string;
    timestamp_unix: string | number;
  }>(
    `SELECT tx_hash, nft_id, buyer, seller, amount_drops, is_xrp,
            toUnixTimestamp(timestamp) AS timestamp_unix
     FROM nft_trades
     ORDER BY timestamp DESC
     LIMIT 10`,
  );

  const result: RecentNFTTradeRow[] = rows.map((r) => {
    const tsUnix = Number(r.timestamp_unix);
    return {
      txHash: r.tx_hash,
      nftokenId: r.nft_id,
      buyer: r.buyer,
      seller: r.seller,
      // amount_drops is only meaningful for XRP-denominated trades.
      // Match the previous PG semantics where token-denominated trades
      // returned null here.
      amountDrops: Number(r.is_xrp) === 1 && r.amount_drops != null
        ? String(r.amount_drops)
        : null,
      // Convert unix → XRPL ripple-epoch seconds to keep the UI's
      // `timeAgo()` math unchanged.
      date: Number.isFinite(tsUnix) && tsUnix > RIPPLE_EPOCH_UNIX
        ? tsUnix - RIPPLE_EPOCH_UNIX
        : null,
    };
  });

  rankingCache.set("recent-nft-trades", result);
  return result;
}

/**
 * Recent NFT mints from ClickHouse — replaces the live WebSocket
 * ledger scan that the old `getRecentNFTMints` (in xrpl-data.ts) used.
 *
 * The previous scan would issue a `ledger` command with `expand: true`
 * up to 5 times in parallel batches, walking back ~20 ledgers looking
 * for NFTokenMint transactions. Heavy payloads, real WebSocket round
 * trips, and a 15-second timeout that the page hit regularly on cold
 * cache. Replacing it with this CH read drops the NFT page TTFB from
 * "painfully slow" to ~25ms — `nft_static_metadata` is populated by
 * the ingester at mint time and ordered by `nft_id` with the
 * minted_timestamp readily available.
 *
 * Returned shape matches the existing `RecentMint` contract so the
 * RecentMints component can take this without a UI rewrite. `hash` is
 * empty since `nft_static_metadata` doesn't carry the originating tx
 * hash — the consumer keys on `nftokenId` instead. The live WebSocket
 * still overlays full mints (with hash) once the page is open via
 * useLiveData.
 */
export interface RecentMintRow {
  hash: string;
  account: string;
  nftokenId: string;
  uri: string | null;
  date?: number;
  ledgerIndex?: number;
}

export async function getRecentNFTMintsFromCH(): Promise<RecentMintRow[]> {
  const cached = rankingCache.get("recent-nft-mints") as RecentMintRow[] | undefined;
  if (cached) return cached;

  const rows = await chQuery<{
    nft_id: string;
    uri: string;
    issuer: string;
    minted_ledger: number | string;
    minted_timestamp_unix: number | string;
  }>(
    `SELECT nft_id, uri, issuer, minted_ledger,
            toUnixTimestamp(minted_timestamp) AS minted_timestamp_unix
     FROM nft_static_metadata FINAL
     ORDER BY minted_timestamp DESC
     LIMIT 4`,
  );

  const result: RecentMintRow[] = rows.map((r) => {
    const tsUnix = Number(r.minted_timestamp_unix);
    return {
      // Source table has no originating tx hash — the React key on the
      // RecentMints grid uses nftokenId instead. Live overlay fills hash
      // in once new mints arrive over the WebSocket feed.
      hash: "",
      account: r.issuer,
      nftokenId: r.nft_id,
      uri: r.uri && r.uri.length > 0 ? r.uri : null,
      // Convert unix → XRPL ripple-epoch seconds to match the rest of
      // the UI's timestamp expectations.
      date: Number.isFinite(tsUnix) && tsUnix > RIPPLE_EPOCH_UNIX
        ? tsUnix - RIPPLE_EPOCH_UNIX
        : undefined,
      ledgerIndex: Number(r.minted_ledger),
    };
  });

  rankingCache.set("recent-nft-mints", result);
  return result;
}

/**
 * All live (non-burned) NFTs currently owned by an account, sourced
 * from CH. Returned in the `NFTBrowseItem` shape (capitalized field
 * names, derived flags / taxon / serial / issuer from the NFTokenID
 * via parseNFTokenID — saves a JOIN against nft_static_metadata for
 * everything except URI, which we do need).
 *
 * Coverage caveat: nft_ownership backfill currently starts at ledger
 * ~95.8M (roughly mid-2024). NFTs minted before that are not in the
 * CH table, which means the count this returns can understate what
 * rippled would return for an account that holds older NFTs. Callers
 * should treat a 0-count result as "fall back to XRPL" rather than
 * "this account owns nothing" — that's what NFTOwnerLoader does.
 *
 * Returns `[]` on query error (don't break the page on CH hiccups —
 * the caller's fallback path will pick up).
 */
export async function getNFTsByOwnerFromCH(
  owner: string,
  limit = 4000,
): Promise<NFTBrowseItem[]> {
  try {
    type Row = { nft_id: string; uri: string };
    const rows = await chQuery<Row>(
      `SELECT o.nft_id AS nft_id, COALESCE(m.uri, '') AS uri
       FROM nft_ownership AS o FINAL
       LEFT JOIN nft_static_metadata AS m FINAL
         ON m.nft_id = o.nft_id
       WHERE o.owner = {owner:String}
         AND o.is_burned = 0
       ORDER BY o.acquired_timestamp DESC
       LIMIT {lim:UInt32}`,
      { owner, lim: limit },
    );

    const items: NFTBrowseItem[] = [];
    for (const r of rows) {
      const parsed = parseNFTokenID(r.nft_id);
      if (!parsed) continue;
      items.push({
        NFTokenID: r.nft_id,
        Issuer: parsed.issuer,
        URI: r.uri && r.uri.length > 0 ? r.uri : undefined,
        Flags: parsed.flags,
        NFTokenTaxon: parsed.nft_taxon,
        nft_serial: parsed.nft_serial,
      });
    }
    return items;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Collection detail page                                             */
/* ------------------------------------------------------------------ */

export interface CollectionMeta {
  issuer: string;
  taxon: number;
  name: string | null;
  description: string | null;
  imageUrl: string | null;
  representativeNftokenId: string | null;
}

/**
 * Collection-level metadata for the detail page header. Pulls the
 * resolved name + cover image from `nft_collections` (the dedicated
 * per-(issuer, taxon) cache), then borrows description from a
 * representative NFT's `nft_metadata` row since description is per-NFT
 * but typically identical across a collection.
 */
export async function getCollectionMeta(
  issuer: string,
  taxon: number,
): Promise<CollectionMeta | null> {
  const [coll] = await db
    .select({
      issuer: nftCollections.issuer,
      taxon: nftCollections.taxon,
      name: nftCollections.name,
      imageUrl: nftCollections.imageUrl,
      representativeNftokenId: nftCollections.representativeNftokenId,
    })
    .from(nftCollections)
    .where(and(eq(nftCollections.issuer, issuer), eq(nftCollections.taxon, taxon)))
    .limit(1);

  // No collection row yet — synthesize a stub from any one resolved
  // NFT in the (issuer, taxon) pair so the page can still render
  // something. Useful for collections the cron hasn't visited yet.
  if (!coll) {
    const [fallbackNft] = await db
      .select({
        nftokenId: nftMetadata.nftokenId,
        name: nftMetadata.name,
        collectionName: nftMetadata.collectionName,
        imageUrl: nftMetadata.imageUrl,
        description: nftMetadata.description,
      })
      .from(nftMetadata)
      .where(and(eq(nftMetadata.issuer, issuer), eq(nftMetadata.taxon, taxon)))
      .limit(1);

    if (!fallbackNft) {
      return { issuer, taxon, name: null, description: null, imageUrl: null, representativeNftokenId: null };
    }

    return {
      issuer,
      taxon,
      name: fallbackNft.collectionName ?? fallbackNft.name ?? null,
      description: fallbackNft.description ?? null,
      imageUrl: fallbackNft.imageUrl ?? null,
      representativeNftokenId: fallbackNft.nftokenId,
    };
  }

  // We have the collection row — try to pull description + image
  // from the representative NFT (description lives on per-NFT metadata;
  // image lives on the collection row OR per-NFT metadata).
  //
  // Fallback ladder per field:
  //   1. collection row's column (only applies to image)
  //   2. representative NFT's column
  //   3. any NFT in the same (issuer, taxon) that has the column set
  //
  // Both fall through to (3) because the resolver hasn't back-filled
  // `representative_nftoken_id` on most pre-cutoff collections (as of
  // 2026-05-11) — and description + image are typically identical
  // across a collection, so any NFT will do.
  let description: string | null = null;
  let imageUrl: string | null = coll.imageUrl;
  if (coll.representativeNftokenId) {
    const [rep] = await db
      .select({
        description: nftMetadata.description,
        imageUrl: nftMetadata.imageUrl,
      })
      .from(nftMetadata)
      .where(eq(nftMetadata.nftokenId, coll.representativeNftokenId))
      .limit(1);
    description = rep?.description ?? null;
    if (!imageUrl) imageUrl = rep?.imageUrl ?? null;
  }
  if (!description) {
    const [anyWithDesc] = await db
      .select({ description: nftMetadata.description })
      .from(nftMetadata)
      .where(
        and(
          eq(nftMetadata.issuer, issuer),
          eq(nftMetadata.taxon, taxon),
          isNotNull(nftMetadata.description),
        ),
      )
      .limit(1);
    description = anyWithDesc?.description ?? null;
  }
  if (!imageUrl) {
    const [anyWithImage] = await db
      .select({ imageUrl: nftMetadata.imageUrl })
      .from(nftMetadata)
      .where(
        and(
          eq(nftMetadata.issuer, issuer),
          eq(nftMetadata.taxon, taxon),
          isNotNull(nftMetadata.imageUrl),
        ),
      )
      .limit(1);
    imageUrl = anyWithImage?.imageUrl ?? null;
  }

  return {
    issuer: coll.issuer,
    taxon: Number(coll.taxon),
    name: coll.name,
    description,
    imageUrl,
    representativeNftokenId: coll.representativeNftokenId,
  };
}

export interface CollectionStats {
  /** Total NFTs minted with this (issuer, taxon), live + burned. */
  itemCount: number;
  /** NFTs still live (is_burned = 0). */
  liveCount: number;
  /** Distinct current owners. */
  holderCount: number;
  /** Lowest active XRP sell-offer price in drops, or null if no
   *  live XRP-denominated sell offers exist. */
  floorDrops: string | null;
  /** Total XRP-denominated trade volume across all time, in drops. */
  totalVolumeDrops: string;
  /** Total trade count across all time. */
  totalTrades: number;
}

export async function getCollectionStats(
  issuer: string,
  taxon: number,
): Promise<CollectionStats> {
  // Run the three CH queries in parallel — they hit independent
  // tables so there's no benefit to sequencing them.
  const [counts, floor, volume] = await Promise.all([
    chQuery<{ item_count: number; live_count: number; holder_count: number }>(
      `SELECT
         toUInt64(count()) AS item_count,
         toUInt64(countIf(is_burned = 0)) AS live_count,
         toUInt64(uniqExact(if(is_burned = 0, owner, null))) AS holder_count
       FROM nft_ownership AS o FINAL
       INNER JOIN nft_static_metadata AS m FINAL
         ON m.nft_id = o.nft_id
       WHERE m.issuer = {issuer:String} AND m.taxon = {taxon:UInt32}`,
      { issuer, taxon },
    ),
    // Floor: minimum active XRP sell-offer across all NFTs in the
    // collection. flags & 1 = 1 means tfSellNFToken (sell offer, not
    // bid). closed_ledger = 0 means still active. expiration 0 means
    // no expiration, or > now-as-XRPL-time means not yet expired.
    chQuery<{ floor_drops: string | null }>(
      `SELECT toString(min(o.amount_drops)) AS floor_drops
       FROM nft_offers AS o FINAL
       INNER JOIN nft_static_metadata AS m FINAL
         ON m.nft_id = o.nft_id
       WHERE m.issuer = {issuer:String} AND m.taxon = {taxon:UInt32}
         AND o.closed_ledger = 0
         AND bitAnd(o.flags, 1) = 1
         AND o.currency = 'XRP'
         AND o.amount_drops > 0
         AND (o.expiration_xrpl = 0 OR o.expiration_xrpl > toUInt32(toUnixTimestamp(now()) - 946684800))`,
      { issuer, taxon },
    ),
    chQuery<{ total_volume_drops: string; total_trades: number }>(
      `SELECT
         toString(toInt64(sumIf(amount_drops, is_xrp = 1))) AS total_volume_drops,
         toUInt64(count()) AS total_trades
       FROM nft_trades
       WHERE issuer = {issuer:String} AND taxon = {taxon:UInt32}`,
      { issuer, taxon },
    ),
  ]);

  return {
    itemCount: Number(counts[0]?.item_count ?? 0),
    liveCount: Number(counts[0]?.live_count ?? 0),
    holderCount: Number(counts[0]?.holder_count ?? 0),
    floorDrops:
      floor[0]?.floor_drops && floor[0].floor_drops !== "0"
        ? floor[0].floor_drops
        : null,
    totalVolumeDrops: volume[0]?.total_volume_drops ?? "0",
    totalTrades: Number(volume[0]?.total_trades ?? 0),
  };
}

/**
 * List NFTs in a collection (paginated). Returns the live (not burned)
 * NFTs in the (issuer, taxon) plus current owner + URI. Ordered by
 * `minted_timestamp DESC` so the newest mints surface first; for very
 * old collections an alphabetical-by-name or by-rarity sort would be
 * a follow-up.
 */
export interface CollectionItem {
  nftokenId: string;
  owner: string;
  uri: string | null;
  serial: number;
  isBurned: boolean;
}

export type CollectionItemSort =
  | "recent_mint"
  | "oldest_mint"
  | "recently_acquired";

export type CollectionItemFilter = "live" | "burned" | "all";

const COLLECTION_ITEM_ORDER_BY: Record<CollectionItemSort, string> = {
  recent_mint: "m.minted_timestamp DESC",
  oldest_mint: "m.minted_timestamp ASC",
  recently_acquired: "o.acquired_timestamp DESC",
};

const COLLECTION_ITEM_FILTER: Record<CollectionItemFilter, string> = {
  live: "o.is_burned = 0",
  burned: "o.is_burned = 1",
  all: "true",
};

export async function getCollectionItems(
  issuer: string,
  taxon: number,
  limit = 24,
  offset = 0,
  sort: CollectionItemSort = "recent_mint",
  filter: CollectionItemFilter = "live",
): Promise<CollectionItem[]> {
  const orderBy = COLLECTION_ITEM_ORDER_BY[sort] ?? COLLECTION_ITEM_ORDER_BY.recent_mint;
  const filterClause = COLLECTION_ITEM_FILTER[filter] ?? COLLECTION_ITEM_FILTER.live;
  const rows = await chQuery<{
    nft_id: string;
    owner: string;
    uri: string;
    is_burned: number | string;
  }>(
    `SELECT m.nft_id AS nft_id,
            o.owner AS owner,
            COALESCE(m.uri, '') AS uri,
            o.is_burned AS is_burned
     FROM nft_static_metadata AS m FINAL
     INNER JOIN nft_ownership AS o FINAL
       ON o.nft_id = m.nft_id
     WHERE m.issuer = {issuer:String} AND m.taxon = {taxon:UInt32}
       AND ${filterClause}
     ORDER BY ${orderBy}
     LIMIT {lim:UInt32} OFFSET {off:UInt32}`,
    { issuer, taxon, lim: limit, off: offset },
  );

  return rows.map((r) => {
    const parsed = parseNFTokenID(r.nft_id);
    return {
      nftokenId: r.nft_id,
      owner: r.owner,
      uri: r.uri && r.uri.length > 0 ? r.uri : null,
      serial: parsed?.nft_serial ?? 0,
      isBurned: Number(r.is_burned) === 1,
    };
  });
}

export interface CollectionHolderRow {
  address: string;
  count: number;
}

/**
 * Top holders for a collection — wallets ranked by how many NFTs
 * from (issuer, taxon) they currently own (excluding burned). Used
 * to power the "Top Holders" section on the collection detail page.
 */
export async function getCollectionHolders(
  issuer: string,
  taxon: number,
  limit = 10,
): Promise<CollectionHolderRow[]> {
  const rows = await chQuery<{ owner: string; nft_count: number | string }>(
    `SELECT o.owner AS owner,
            toUInt64(count()) AS nft_count
     FROM nft_ownership AS o FINAL
     INNER JOIN nft_static_metadata AS m FINAL
       ON m.nft_id = o.nft_id
     WHERE m.issuer = {issuer:String} AND m.taxon = {taxon:UInt32}
       AND o.is_burned = 0
     GROUP BY o.owner
     ORDER BY nft_count DESC
     LIMIT {lim:UInt32}`,
    { issuer, taxon, lim: limit },
  );

  return rows.map((r) => ({
    address: r.owner,
    count: Number(r.nft_count),
  }));
}

/**
 * Per-period volume splits for a collection — 24h / 7d / 30d / all.
 * Run as a single CH query using conditional sums so we don't pay
 * for 4 round trips.
 */
export interface CollectionVolumeSplits {
  volume24hDrops: string;
  volume7dDrops: string;
  volume30dDrops: string;
  volumeAllDrops: string;
  trades24h: number;
  trades7d: number;
  trades30d: number;
  tradesAll: number;
}

export async function getCollectionVolumeSplits(
  issuer: string,
  taxon: number,
): Promise<CollectionVolumeSplits> {
  const rows = await chQuery<{
    v_24h: string | number;
    v_7d: string | number;
    v_30d: string | number;
    v_all: string | number;
    t_24h: number | string;
    t_7d: number | string;
    t_30d: number | string;
    t_all: number | string;
  }>(
    `SELECT
       toString(toInt64(sumIf(amount_drops, is_xrp = 1 AND timestamp >= now() - INTERVAL 24 HOUR))) AS v_24h,
       toString(toInt64(sumIf(amount_drops, is_xrp = 1 AND timestamp >= today() - 7))) AS v_7d,
       toString(toInt64(sumIf(amount_drops, is_xrp = 1 AND timestamp >= today() - 30))) AS v_30d,
       toString(toInt64(sumIf(amount_drops, is_xrp = 1))) AS v_all,
       toUInt64(countIf(timestamp >= now() - INTERVAL 24 HOUR)) AS t_24h,
       toUInt64(countIf(timestamp >= today() - 7)) AS t_7d,
       toUInt64(countIf(timestamp >= today() - 30)) AS t_30d,
       toUInt64(count()) AS t_all
     FROM nft_trades
     WHERE issuer = {issuer:String} AND taxon = {taxon:UInt32}`,
    { issuer, taxon },
  );

  const r = rows[0] ?? {
    v_24h: "0", v_7d: "0", v_30d: "0", v_all: "0",
    t_24h: 0, t_7d: 0, t_30d: 0, t_all: 0,
  };

  return {
    volume24hDrops: String(r.v_24h ?? "0"),
    volume7dDrops: String(r.v_7d ?? "0"),
    volume30dDrops: String(r.v_30d ?? "0"),
    volumeAllDrops: String(r.v_all ?? "0"),
    trades24h: Number(r.t_24h ?? 0),
    trades7d: Number(r.t_7d ?? 0),
    trades30d: Number(r.t_30d ?? 0),
    tradesAll: Number(r.t_all ?? 0),
  };
}

export interface CollectionActivityRow {
  txHash: string;
  nftokenId: string;
  /** Resolved NFT name from `nft_metadata`. Null until the resolver
   *  has visited this NFT — the UI falls back to a truncated id. */
  nftName: string | null;
  /** Resolved NFT image URL from `nft_metadata`. The UI proxies this
   *  through `/api/nft-image` so we don't hit IPFS gateways direct
   *  from the browser. */
  nftImageUrl: string | null;
  buyer: string;
  seller: string;
  amountDrops: string | null;
  isXrp: boolean;
  date: number | null;
}

/**
 * Recent trade activity for a collection. Reads nft_trades filtered
 * on (issuer, taxon) which is indexed natively — should answer in
 * milliseconds. Date returned in XRPL ripple-epoch seconds to match
 * the rest of the timeAgo() math elsewhere on the site.
 */
/**
 * Paginated variant of `getCollectionActivity`. `beforeRippleEpoch`
 * is the date (in ripple-epoch seconds — same units we return) of
 * the last row from the previous page; rows strictly older than
 * that timestamp are returned, sorted newest-first.
 *
 * Cursor convention is offset from `RIPPLE_EPOCH_UNIX` to match the
 * `date` field we send to the client — no awkward unix-vs-ripple
 * conversion on the call site.
 */
export async function getCollectionActivityPaginated(
  issuer: string,
  taxon: number,
  beforeRippleEpoch: number,
  limit = 15,
): Promise<CollectionActivityRow[]> {
  const beforeUnix = beforeRippleEpoch + RIPPLE_EPOCH_UNIX;
  return getCollectionActivityRows(issuer, taxon, limit, beforeUnix);
}

export async function getCollectionActivity(
  issuer: string,
  taxon: number,
  limit = 10,
): Promise<CollectionActivityRow[]> {
  return getCollectionActivityRows(issuer, taxon, limit, null);
}

async function getCollectionActivityRows(
  issuer: string,
  taxon: number,
  limit: number,
  beforeUnix: number | null,
): Promise<CollectionActivityRow[]> {
  // Cursor is exclusive — we want rows STRICTLY older than the last
  // row on the previous page. `before = 0` sentinel means "no cursor"
  // (initial page) so the WHERE clause is skipped.
  const rows = await chQuery<{
    tx_hash: string;
    nft_id: string;
    buyer: string;
    seller: string;
    amount_drops: string | number | null;
    is_xrp: number | string;
    timestamp_unix: string | number;
  }>(
    `SELECT tx_hash, nft_id, buyer, seller, amount_drops, is_xrp,
            toUnixTimestamp(timestamp) AS timestamp_unix
     FROM nft_trades
     WHERE issuer = {issuer:String}
       AND taxon = {taxon:UInt32}
       AND ({before:UInt64} = 0 OR timestamp < toDateTime({before:UInt64}))
     ORDER BY timestamp DESC
     LIMIT {lim:UInt32}`,
    {
      issuer,
      taxon,
      lim: limit,
      before: beforeUnix && beforeUnix > 0 ? beforeUnix : 0,
    },
  );

  // Enrich each trade row with the NFT's resolved name + image. We
  // call `getNFTMetadataBatch` instead of a raw select against
  // `nft_metadata` so that NFTs sitting in the `pending` state
  // (placeholder row exists but the resolver never actually fetched
  // the JSON) get resolved on this request. The resolver is reactive
  // — it only runs on API calls — and stale-pending rows for active
  // collections were leaving the activity column with truncated
  // nftoken_ids forever. Wrapped in a 5s timeout so a flaky gateway
  // can't stall the page load; in that case we fall back to whatever
  // happens to be cached already.
  const nftIds = Array.from(new Set(rows.map((r) => r.nft_id)));
  const metaByNftId = new Map<string, { name: string | null; imageUrl: string | null }>();
  if (nftIds.length > 0) {
    try {
      const resolved = await Promise.race([
        getNFTMetadataBatch(nftIds.map((id) => ({ nftokenId: id }))),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("metadata-resolve-timeout")), 5000),
        ),
      ]);
      for (const [id, row] of resolved) {
        metaByNftId.set(id, { name: row.name, imageUrl: row.imageUrl });
      }
    } catch {
      // Timeout or fetch failure — fall back to whatever's cached in PG.
      const cached = await db
        .select({
          nftokenId: nftMetadata.nftokenId,
          name: nftMetadata.name,
          imageUrl: nftMetadata.imageUrl,
        })
        .from(nftMetadata)
        .where(inArray(nftMetadata.nftokenId, nftIds));
      for (const m of cached) {
        metaByNftId.set(m.nftokenId, { name: m.name, imageUrl: m.imageUrl });
      }
    }
  }

  return rows.map((r) => {
    const tsUnix = Number(r.timestamp_unix);
    const meta = metaByNftId.get(r.nft_id);
    return {
      txHash: r.tx_hash,
      nftokenId: r.nft_id,
      nftName: meta?.name ?? null,
      nftImageUrl: meta?.imageUrl ?? null,
      buyer: r.buyer,
      seller: r.seller,
      amountDrops:
        Number(r.is_xrp) === 1 && r.amount_drops != null
          ? String(r.amount_drops)
          : null,
      isXrp: Number(r.is_xrp) === 1,
      date:
        Number.isFinite(tsUnix) && tsUnix > RIPPLE_EPOCH_UNIX
          ? tsUnix - RIPPLE_EPOCH_UNIX
          : null,
    };
  });
}

/* ── Collection tab queries: Mints / Listings / Burns ─────────────── */
//
// All three reuse the PG `nft_metadata` enrichment pattern from
// getCollectionActivity (`name` + `imageUrl` resolved lazily via
// `getNFTMetadataBatch`, with a 5s timeout falling back to whatever
// already exists in cache). Same shape avoids divergent UX between
// the four tabs on the collection detail page.

interface NftEnrichment {
  name: string | null;
  imageUrl: string | null;
}

async function enrichNftIds(
  nftIds: string[],
): Promise<Map<string, NftEnrichment>> {
  const out = new Map<string, NftEnrichment>();
  if (nftIds.length === 0) return out;
  try {
    const resolved = await Promise.race([
      getNFTMetadataBatch(nftIds.map((id) => ({ nftokenId: id }))),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("metadata-timeout")), 5000),
      ),
    ]);
    for (const [id, row] of resolved) {
      out.set(id, { name: row.name, imageUrl: row.imageUrl });
    }
  } catch {
    const cached = await db
      .select({
        nftokenId: nftMetadata.nftokenId,
        name: nftMetadata.name,
        imageUrl: nftMetadata.imageUrl,
      })
      .from(nftMetadata)
      .where(inArray(nftMetadata.nftokenId, nftIds));
    for (const m of cached) {
      out.set(m.nftokenId, { name: m.name, imageUrl: m.imageUrl });
    }
  }
  return out;
}

export interface CollectionMintRow {
  nftokenId: string;
  nftName: string | null;
  nftImageUrl: string | null;
  /** XRPL ledger index the mint happened in. */
  mintedLedger: number;
  /** Unix-seconds timestamp of the mint ledger close. */
  mintedAtUnix: number | null;
}

/**
 * Mints for the collection — every NFT ever minted in (issuer, taxon),
 * newest first. Reads `nft_static_metadata` which is populated by the
 * live ingester for new mints and by the pre-cutoff backfill for old
 * mints (Clio `nfts_by_issuer` walk on 2026-05-11). Enriched with
 * resolved name + image from PG `nft_metadata`.
 */
export async function getCollectionMints(
  issuer: string,
  taxon: number,
  limit = 25,
): Promise<CollectionMintRow[]> {
  const rows = await chQuery<{
    nft_id: string;
    minted_ledger: number;
    minted_at_unix: string | number;
  }>(
    `SELECT toString(nft_id) AS nft_id,
            minted_ledger,
            toUnixTimestamp(minted_timestamp) AS minted_at_unix
     FROM nft_static_metadata FINAL
     WHERE issuer = {issuer:String} AND taxon = {taxon:UInt32}
     ORDER BY minted_ledger DESC
     LIMIT {lim:UInt32}`,
    { issuer, taxon, lim: limit },
  );

  const meta = await enrichNftIds(rows.map((r) => r.nft_id));

  return rows.map((r) => {
    const m = meta.get(r.nft_id);
    const tsUnix = Number(r.minted_at_unix);
    return {
      nftokenId: r.nft_id,
      nftName: m?.name ?? null,
      nftImageUrl: m?.imageUrl ?? null,
      mintedLedger: r.minted_ledger,
      mintedAtUnix: Number.isFinite(tsUnix) && tsUnix > 0 ? tsUnix : null,
    };
  });
}

export interface CollectionListingRow {
  nftOfferIndex: string;
  nftokenId: string;
  nftName: string | null;
  nftImageUrl: string | null;
  owner: string;
  amountDrops: string | null;
  isXrp: boolean;
  createdLedger: number;
  createdAtUnix: number | null;
}

/**
 * Open sell-offers for the collection, lowest price first (floor
 * sort). Reads `nft_offers` JOIN-filtered to the collection via
 * `nft_static_metadata`. `closed_ledger = 0` means the offer is
 * still live on-chain; the `flags & 1` check filters to sell-side
 * (lsfSellNFToken) — buy offers are excluded since this is a
 * "listings" view.
 *
 * IOU-denominated offers are included but their amount is null in
 * the result (UI shows "—" for non-XRP listings to avoid false
 * comparisons against XRP-denominated ones).
 */
export async function getCollectionListings(
  issuer: string,
  taxon: number,
  limit = 25,
): Promise<CollectionListingRow[]> {
  const rows = await chQuery<{
    nft_offer_index: string;
    nft_id: string;
    owner: string;
    amount_drops: string | number;
    currency: string;
    created_ledger: number;
    created_at_unix: string | number;
  }>(
    `SELECT toString(o.nft_offer_index) AS nft_offer_index,
            toString(o.nft_id) AS nft_id,
            o.owner,
            o.amount_drops,
            o.currency,
            o.created_ledger,
            toUnixTimestamp(o.created_timestamp) AS created_at_unix
     FROM nft_offers FINAL AS o
     INNER JOIN (
       SELECT nft_id
       FROM nft_static_metadata FINAL
       WHERE issuer = {issuer:String} AND taxon = {taxon:UInt32}
     ) AS m USING nft_id
     WHERE o.closed_ledger = 0
       AND bitAnd(o.flags, 1) = 1
     ORDER BY (o.currency = 'XRP') DESC, o.amount_drops ASC
     LIMIT {lim:UInt32}`,
    { issuer, taxon, lim: limit },
  );

  const meta = await enrichNftIds(rows.map((r) => r.nft_id));

  return rows.map((r) => {
    const m = meta.get(r.nft_id);
    const tsUnix = Number(r.created_at_unix);
    const isXrp = r.currency === "XRP";
    return {
      nftOfferIndex: r.nft_offer_index,
      nftokenId: r.nft_id,
      nftName: m?.name ?? null,
      nftImageUrl: m?.imageUrl ?? null,
      owner: r.owner,
      amountDrops: isXrp ? String(r.amount_drops) : null,
      isXrp,
      createdLedger: r.created_ledger,
      createdAtUnix: Number.isFinite(tsUnix) && tsUnix > 0 ? tsUnix : null,
    };
  });
}

export interface CollectionBurnRow {
  nftokenId: string;
  nftName: string | null;
  nftImageUrl: string | null;
  /** The address that held the NFT at burn time (XRPL semantics: the
   *  account whose NFTokenBurn tx removed the NFT — usually the
   *  current owner, sometimes the issuer when `tfBurnable` is set
   *  and the issuer burns somebody else's NFT). */
  lastOwner: string;
  burnedLedger: number;
  burnedAtUnix: number | null;
}

/**
 * Burned NFTs for the collection, most recently burned first. Reads
 * `nft_ownership` filtered to is_burned=1 + collection scope via
 * static metadata. `last_updated` on the burn row is the close time
 * of the burning tx — close enough for "burned 3d ago" labels.
 */
export async function getCollectionBurns(
  issuer: string,
  taxon: number,
  limit = 25,
): Promise<CollectionBurnRow[]> {
  const rows = await chQuery<{
    nft_id: string;
    owner: string;
    acquired_ledger: number;
    burned_at_unix: string | number;
  }>(
    `SELECT toString(o.nft_id) AS nft_id,
            o.owner,
            o.acquired_ledger,
            toUnixTimestamp(o.last_updated) AS burned_at_unix
     FROM nft_ownership FINAL AS o
     INNER JOIN (
       SELECT nft_id
       FROM nft_static_metadata FINAL
       WHERE issuer = {issuer:String} AND taxon = {taxon:UInt32}
     ) AS m USING nft_id
     WHERE o.is_burned = 1
     ORDER BY o.last_updated DESC
     LIMIT {lim:UInt32}`,
    { issuer, taxon, lim: limit },
  );

  const meta = await enrichNftIds(rows.map((r) => r.nft_id));

  return rows.map((r) => {
    const m = meta.get(r.nft_id);
    const tsUnix = Number(r.burned_at_unix);
    return {
      nftokenId: r.nft_id,
      nftName: m?.name ?? null,
      nftImageUrl: m?.imageUrl ?? null,
      lastOwner: r.owner,
      burnedLedger: r.acquired_ledger,
      burnedAtUnix: Number.isFinite(tsUnix) && tsUnix > 0 ? tsUnix : null,
    };
  });
}

export interface CollectionSalePoint {
  /** Unix-seconds timestamp of the sale ledger close. */
  timestampUnix: number;
  /** Sale price in XRP (already converted from drops). */
  priceXrp: number;
  txHash: string;
  nftokenId: string;
}

/**
 * XRP-denominated trades for a collection, scoped to the last N days
 * (default 90). Used by the sales-scatter chart in the insights
 * sidebar — each row maps to one dot on the chart (x: time, y: price).
 *
 * IOU-denominated trades are intentionally excluded — mixing
 * cross-currency prices on a single y-axis would be misleading
 * without conversion to a common unit, and conversion at trade-time
 * historical rates is out of scope for this view.
 */
export async function getCollectionSalesScatter(
  issuer: string,
  taxon: number,
  days: number = 90,
  limit: number = 2000,
): Promise<CollectionSalePoint[]> {
  const sinceUnix = Math.floor(Date.now() / 1000) - days * 86_400;
  const rows = await chQuery<{
    tx_hash: string;
    nft_id: string;
    amount_drops: string | number;
    timestamp_unix: string | number;
  }>(
    `SELECT tx_hash,
            toString(nft_id) AS nft_id,
            amount_drops,
            toUnixTimestamp(timestamp) AS timestamp_unix
     FROM nft_trades
     WHERE issuer = {issuer:String}
       AND taxon = {taxon:UInt32}
       AND is_xrp = 1
       AND amount_drops > 0
       AND timestamp >= toDateTime({since:UInt64})
     ORDER BY timestamp DESC
     LIMIT {lim:UInt32}`,
    { issuer, taxon, since: sinceUnix, lim: limit },
  );

  return rows.map((r) => ({
    timestampUnix: Number(r.timestamp_unix),
    priceXrp: Number(r.amount_drops) / 1_000_000,
    txHash: r.tx_hash,
    nftokenId: r.nft_id,
  }));
}

export interface CollectionVolumePoint {
  /** Day bucket as a YYYY-MM-DD string (UTC). */
  day: string;
  /** Trade volume in XRP for that day. */
  volumeXrp: number;
  /** Trade count for that day. */
  tradeCount: number;
}

/**
 * Daily XRP-denominated trade volume for a collection over the past
 * `days` calendar days. One row per UTC day, including days with zero
 * trades (zero-filled below so the bar chart renders a continuous
 * timeline). Used by the volume-over-time chart in the insights
 * sidebar.
 */
export async function getCollectionVolumeOverTime(
  issuer: string,
  taxon: number,
  days: number = 90,
): Promise<CollectionVolumePoint[]> {
  const sinceUnix = Math.floor(Date.now() / 1000) - days * 86_400;
  const rows = await chQuery<{
    day: string;
    volume_drops: string | number;
    trade_count: string | number;
  }>(
    `SELECT toString(toDate(timestamp)) AS day,
            sum(amount_drops) AS volume_drops,
            count() AS trade_count
     FROM nft_trades
     WHERE issuer = {issuer:String}
       AND taxon = {taxon:UInt32}
       AND is_xrp = 1
       AND amount_drops > 0
       AND timestamp >= toDateTime({since:UInt64})
     GROUP BY day
     ORDER BY day ASC`,
    { issuer, taxon, since: sinceUnix },
  );

  // Build a map of day → row, then zero-fill any missing days so the
  // chart shows a continuous timeline.
  const byDay = new Map<string, { volumeXrp: number; tradeCount: number }>();
  for (const r of rows) {
    byDay.set(r.day, {
      volumeXrp: Number(r.volume_drops) / 1_000_000,
      tradeCount: Number(r.trade_count),
    });
  }

  const out: CollectionVolumePoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const dayKey = d.toISOString().slice(0, 10);
    const entry = byDay.get(dayKey);
    out.push({
      day: dayKey,
      volumeXrp: entry?.volumeXrp ?? 0,
      tradeCount: entry?.tradeCount ?? 0,
    });
  }
  return out;
}

export interface CollectionListingPrice {
  priceXrp: number;
}

/**
 * Open XRP-denominated sell-offers for a collection, returned as a
 * flat list of prices. Used by the listing-distribution histogram —
 * the consumer bins client-side into N buckets and renders a
 * horizontal bar per bucket.
 *
 * Filtered to `closed_ledger = 0` (still live) and
 * `bitAnd(flags, 1) = 1` (sell-side, lsfSellNFToken). Capped at
 * 5000 listings — enough density for any real collection's
 * histogram, prevents pathological collections from blowing up
 * the response.
 */
export async function getCollectionListingPrices(
  issuer: string,
  taxon: number,
): Promise<CollectionListingPrice[]> {
  const rows = await chQuery<{ amount_drops: string | number }>(
    `SELECT o.amount_drops
     FROM nft_offers FINAL AS o
     INNER JOIN (
       SELECT nft_id
       FROM nft_static_metadata FINAL
       WHERE issuer = {issuer:String} AND taxon = {taxon:UInt32}
     ) AS m USING nft_id
     WHERE o.closed_ledger = 0
       AND bitAnd(o.flags, 1) = 1
       AND o.currency = 'XRP'
       AND o.amount_drops > 0
     ORDER BY o.amount_drops ASC
     LIMIT 5000`,
    { issuer, taxon },
  );

  return rows.map((r) => ({ priceXrp: Number(r.amount_drops) / 1_000_000 }));
}

export interface CollectionDailySnapshot {
  /** YYYY-MM-DD UTC. */
  day: string;
  /** Floor in XRP. 0 means "no XRP listings that day" (or no snapshot). */
  floorXrp: number;
  listingCount: number;
  holderCount: number;
  volumeXrp24h: number;
  tradeCount24h: number;
}

/**
 * Read the per-day snapshot rows for a collection over the past
 * `days` calendar days. Source is the `nft_collection_daily_snapshots`
 * table populated by `scripts/run-collection-daily-snapshot.ts` on a
 * daily Hetzner timer. Rows are zero-filled below for days that
 * predate the first snapshot run so the chart timeline is
 * continuous.
 */
export async function getCollectionDailySnapshots(
  issuer: string,
  taxon: number,
  days: number = 90,
): Promise<CollectionDailySnapshot[]> {
  const sinceDays = days;
  // NOTE: don't alias `toString(day) AS day` — ClickHouse 26+ resolves
  // the WHERE clause's `day` to the String alias instead of the
  // underlying Date column, throwing NO_COMMON_TYPE on the `day >= ...`
  // comparison. Older CH silently fell back to the original column,
  // which masked the bug. Date is serialized as "YYYY-MM-DD" in
  // JSONEachRow, which is exactly what the chart code wants.
  const rows = await chQuery<{
    day: string;
    floor_drops: string | number;
    listing_count: string | number;
    holder_count: string | number;
    volume_24h_drops: string | number;
    trade_count_24h: string | number;
  }>(
    `SELECT day,
            floor_drops,
            listing_count,
            holder_count,
            volume_24h_drops,
            trade_count_24h
     FROM nft_collection_daily_snapshots FINAL
     WHERE issuer = {issuer:String}
       AND taxon = {taxon:UInt32}
       AND day >= today() - INTERVAL {days:UInt32} DAY
     ORDER BY day ASC`,
    { issuer, taxon, days: sinceDays },
  );

  const byDay = new Map<
    string,
    Omit<CollectionDailySnapshot, "day">
  >();
  for (const r of rows) {
    byDay.set(r.day, {
      floorXrp: Number(r.floor_drops) / 1_000_000,
      listingCount: Number(r.listing_count),
      holderCount: Number(r.holder_count),
      volumeXrp24h: Number(r.volume_24h_drops) / 1_000_000,
      tradeCount24h: Number(r.trade_count_24h),
    });
  }

  const out: CollectionDailySnapshot[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const dayKey = d.toISOString().slice(0, 10);
    const entry = byDay.get(dayKey);
    out.push({
      day: dayKey,
      floorXrp: entry?.floorXrp ?? 0,
      listingCount: entry?.listingCount ?? 0,
      holderCount: entry?.holderCount ?? 0,
      volumeXrp24h: entry?.volumeXrp24h ?? 0,
      tradeCount24h: entry?.tradeCount24h ?? 0,
    });
  }
  return out;
}

async function getRankingMeta(period: Period): Promise<RankingMeta> {
  const [latestRow] = await db
    .select()
    .from(ingestionState)
    .where(sql`${ingestionState.key} = 'latest_ledger'`);
  const [earliestRow] = await db
    .select()
    .from(ingestionState)
    .where(sql`${ingestionState.key} = 'earliest_ledger'`);

  const latest = Number(latestRow?.value ?? 0);
  const earliest = Number(earliestRow?.value ?? 0);

  return {
    period,
    dataFrom: earliest > 0 ? earliestRow?.updatedAt?.toISOString() ?? null : null,
    ledgerRange: [earliest, latest],
  };
}
