import "server-only";
import logger from "./logger";
import {
  getNFTMarketplaceRankings,
  getNFTCollectionRankings,
  getNFTCollectionFloors,
} from "./db-queries";
import { dropsToXrp, truncate } from "./xrpl-helpers";
import { extractCollectionName } from "./nft-metadata-fetcher";
import { db } from "@/db";
import { nftCollections, nftMetadata } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const log = logger.child({ module: "nft-volumes" });

type NFTVolumePeriod = "day" | "all";

export interface NFTMarketplace {
  name: string;
  logoUrl: string;
  volumeXrp: number;
  sales: number;
}

export interface NFTCollection {
  name: string;
  issuer: string;
  /** XRPL taxon — together with issuer, uniquely identifies a
   *  collection. Used to link to the /nft/collection/[issuer]/[taxon]
   *  detail page. */
  taxon: number;
  imageUrl: string | null;
  volumeXrp: number;
  sales: number;
  /** Minimum active XRP sell-offer across the collection, in XRP
   *  (not drops). Null when no live XRP-denominated sell offer
   *  exists — the UI renders "—" in that case. Token-denominated
   *  offers are excluded by design. */
  floorXrp: number | null;
}

function faviconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

/** Map component period ("day" | "all") to DB period ("24h" | "all") */
function mapPeriod(period: NFTVolumePeriod): "24h" | "all" {
  return period === "day" ? "24h" : "all";
}

export async function getTopNFTMarketplaces(
  limit = 5,
  period: NFTVolumePeriod = "day",
): Promise<NFTMarketplace[] | null> {
  try {
    const { rankings } = await getNFTMarketplaceRankings(
      mapPeriod(period),
      limit,
    );

    return rankings.map((r) => ({
      name: r.marketplace,
      logoUrl: r.marketplace ? faviconUrl(r.marketplace) : "",
      volumeXrp: r.xrpVolume,
      sales: r.tradeCount,
    }));
  } catch (err) {
    log.warn({ err }, "Failed to fetch top NFT marketplaces");
    return null;
  }
}

export async function getTopNFTCollections(
  limit = 5,
  period: NFTVolumePeriod = "day",
): Promise<NFTCollection[] | null> {
  try {
    const { rankings } = await getNFTCollectionRankings(
      mapPeriod(period),
      limit,
    );
    if (rankings.length === 0) return [];

    // Resolve name + image per (issuer, taxon) from the collection
    // cache. PG `nft_collections` is keyed exactly on (issuer, taxon),
    // so the lookup is direct — no per-NFT fallback needed when the
    // cron has visited the collection. For collections the cron
    // hasn't reached yet, fall back to per-NFT metadata.
    const pairs = rankings.map((r) => ({ issuer: r.issuer, taxon: r.taxon }));

    const wantedPairs = new Set(pairs.map((p) => `${p.issuer}:${p.taxon}`));

    const [collRowsRaw, fallbackRows, floors] = await Promise.all([
      // Direct lookup against nft_collections (the dedicated cache).
      // PG doesn't have a clean tuple-IN binding via Drizzle, so we
      // over-fetch with separate IN(...) IN(...) predicates and filter
      // to the exact wanted pairs in JS. For limit=5 the spurious-row
      // overhead is trivial.
      db
        .select({
          issuer: nftCollections.issuer,
          taxon: nftCollections.taxon,
          name: nftCollections.name,
          imageUrl: nftCollections.imageUrl,
        })
        .from(nftCollections)
        .where(
          and(
            inArray(nftCollections.issuer, pairs.map((p) => p.issuer)),
            inArray(nftCollections.taxon, pairs.map((p) => p.taxon)),
          ),
        ),
      // Fallback: at least one resolved NFT per (issuer, taxon) for
      // collections the cron hasn't visited yet. We pick the first
      // resolved row per pair on the JS side after the query.
      db
        .select({
          issuer: nftMetadata.issuer,
          taxon: nftMetadata.taxon,
          name: nftMetadata.name,
          collectionName: nftMetadata.collectionName,
          imageUrl: nftMetadata.imageUrl,
        })
        .from(nftMetadata)
        .where(
          and(
            inArray(nftMetadata.issuer, pairs.map((p) => p.issuer)),
            inArray(nftMetadata.taxon, pairs.map((p) => p.taxon)),
            eq(nftMetadata.fetchStatus, "ok"),
          ),
        ),
      // CH floor lookup runs in parallel with the PG metadata pulls.
      getNFTCollectionFloors(pairs),
    ]);

    const byPair = new Map<
      string,
      { name: string | null; imageUrl: string | null }
    >();
    for (const row of collRowsRaw) {
      const key = `${row.issuer}:${row.taxon}`;
      if (wantedPairs.has(key)) {
        byPair.set(key, { name: row.name, imageUrl: row.imageUrl });
      }
    }
    // Layer the fallback in for pairs missing from nft_collections.
    for (const row of fallbackRows) {
      const key = `${row.issuer}:${row.taxon}`;
      if (wantedPairs.has(key) && !byPair.has(key)) {
        const name = row.collectionName ?? (row.name ? extractCollectionName(row.name) : null);
        byPair.set(key, { name, imageUrl: row.imageUrl });
      }
    }

    return rankings.map((r) => {
      const key = `${r.issuer}:${r.taxon}`;
      const meta = byPair.get(key);
      const floorDrops = floors.get(key);
      return {
        name: meta?.name ?? truncate(r.issuer, 5),
        issuer: r.issuer,
        taxon: r.taxon,
        imageUrl: meta?.imageUrl ?? null,
        volumeXrp: r.xrpVolume,
        sales: r.tradeCount,
        floorXrp: floorDrops ? Number(dropsToXrp(floorDrops)) : null,
      };
    });
  } catch (err) {
    log.warn({ err }, "Failed to fetch top NFT collections");
    return null;
  }
}
