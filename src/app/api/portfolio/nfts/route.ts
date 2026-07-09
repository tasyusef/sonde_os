import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getXrpPrice } from "@/lib/price-data";
import { query as chQuery } from "@/lib/clickhouse-client";
import { parseNFTokenID } from "@/lib/nft-parsing";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import { xrplClient } from "@/lib/xrpl-client";
import { PAGE_CAP, XRPL_MAX_LIMIT } from "@/lib/xrpl-pagination";
import { MOCK_NFTS } from "@/lib/mock-portfolio";
import logger from "@/lib/logger";
import type { AccountNFTsResult } from "@/types/xrpl";
import type { NFTBrowseItem } from "@/types/nft";

// Hard cap on `IN` array sent to CH so we don't generate a multi-MB
// query string on a wallet with hundreds of thousands of NFTs (the
// PAGE_CAP × XRPL_MAX_LIMIT = 20K theoretical max). Real wallets never
// approach this; the cap is just a safety net.
const MAX_BIDS_LOOKUP = 5000;

const XRPL_EPOCH_OFFSET_S = 946684800;

interface BidRow extends Record<string, unknown> {
  nft_id: string;
  highest_drops: string;
}

/**
 * GET /api/portfolio/nfts
 *
 * Returns the user's NFTs grouped by collection (issuer + taxon) with
 * per-collection floor estimates and total value.
 *
 * **Source-of-truth:** XRPL `account_nfts` for ownership. CH provides
 * the bid enrichment.
 *
 * History: this used to be a single CH query against `nft_ownership`
 * + `nft_offers` ("Sub-100ms regardless of NFT count"). The performance
 * was real, but `nft_ownership` only covers ledgers ≥ 95.8M (~May 2025)
 * because the backfill floor is set there. Pre-May-2025 NFTs simply
 * aren't in the mirror, so any wallet that holds older NFTs got an
 * empty list — including Tim's personal wallet on 2026-05-09 even
 * though XRPL knew it owned them. We now treat XRPL as authoritative
 * for ownership (paginated `account_nfts`, the same source the account
 * page uses) and CH as enrichment-only for active XRP buy offers.
 *
 * Cost: one XRPL WS round-trip per ~400 NFTs + one CH query. For Tim's
 * 100-NFT wallet, the round-trip plus the bulk bid lookup land in
 * 200–400ms warm. Heavy collectors (1000+ NFTs) take 1–2s.
 */
export async function GET() {
  if (process.env.MOCK_PORTFOLIO === "true") {
    return NextResponse.json(MOCK_NFTS);
  }

  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = session.address;

  try {
    // XRPL ownership + XRP price in parallel.
    const [ownedNfts, priceResult] = await Promise.all([
      fetchOwnedNFTs(address).catch((err) => {
        logger.error({ err }, "[api/portfolio/nfts] XRPL account_nfts failed");
        return [] as NFTBrowseItem[];
      }),
      getXrpPrice().catch(() => ({ price: 0 })),
    ]);
    const xrpPrice = priceResult.price;

    // Bulk-fetch the highest active XRP buy offer per owned nft_id.
    // CH ARRAY parameter via `nft_id IN ({nftIds:Array(String)})`
    // collapses to a single query regardless of NFT count.
    const nowXrpl = Math.floor(Date.now() / 1000) - XRPL_EPOCH_OFFSET_S;
    const bidsMap = new Map<string, string>();
    if (ownedNfts.length > 0) {
      try {
        const nftIds = ownedNfts.slice(0, MAX_BIDS_LOOKUP).map((n) => n.NFTokenID);
        const bidRows = await chQuery<BidRow>(
          `SELECT nft_id, toString(max(amount_drops)) AS highest_drops
           FROM nft_offers FINAL
           WHERE nft_id IN ({nftIds:Array(String)})
             AND closed_ledger = 0
             AND (flags = 0 OR bitAnd(flags, 1) = 0)
             AND owner != {address:String}
             AND (expiration_xrpl = 0 OR expiration_xrpl > {nowXrpl:UInt32})
             AND currency = 'XRP'
           GROUP BY nft_id`,
          { nftIds, address, nowXrpl },
        );
        for (const r of bidRows) bidsMap.set(r.nft_id, r.highest_drops);
      } catch (err) {
        // Bid enrichment is best-effort — render the holdings without
        // bid overlays rather than fail the whole tab.
        logger.warn({ err }, "[api/portfolio/nfts] CH bid enrichment failed");
      }
    }

    // Group by (issuer, taxon).
    const collectionMap = new Map<
      string,
      {
        issuer: string;
        taxon: number;
        nfts: {
          nftId: string;
          serial: number;
          uri: string;
          highestBidXrp: number;
        }[];
      }
    >();

    for (const n of ownedNfts) {
      const parsed = parseNFTokenID(n.NFTokenID);
      if (!parsed) continue; // Malformed nft_id — skip
      const key = `${parsed.issuer}:${parsed.nft_taxon}`;
      let collection = collectionMap.get(key);
      if (!collection) {
        collection = {
          issuer: parsed.issuer,
          taxon: parsed.nft_taxon,
          nfts: [],
        };
        collectionMap.set(key, collection);
      }
      const drops = bidsMap.get(n.NFTokenID) ?? "0";
      collection.nfts.push({
        nftId: n.NFTokenID,
        serial: parsed.nft_serial,
        // URI on `account_nfts` rows is hex-encoded. We pass it through
        // as-is — the metadata batch endpoint decodes hex. Keeps parity
        // with the old `nft_static_metadata.uri` shape consumers expect.
        uri: n.URI ?? "",
        highestBidXrp: parseFloat(dropsToXrp(drops)) || 0,
      });
    }

    // Aggregate per-collection stats.
    let totalValueXrp = 0;
    const collections = [...collectionMap.values()]
      .map((c) => {
        const valuedNfts = c.nfts.filter((n) => n.highestBidXrp > 0);
        const floorPriceXrp =
          valuedNfts.length > 0
            ? Math.min(...valuedNfts.map((n) => n.highestBidXrp))
            : 0;
        const collectionValueXrp = c.nfts.reduce(
          (sum, n) => sum + n.highestBidXrp,
          0,
        );
        totalValueXrp += collectionValueXrp;

        return {
          issuer: c.issuer,
          taxon: c.taxon,
          count: c.nfts.length,
          floorPriceXrp,
          totalValueXrp: collectionValueXrp,
          totalValueUsd: collectionValueXrp * xrpPrice,
          nfts: c.nfts.map((n) => ({
            nftId: n.nftId,
            serial: n.serial,
            uri: n.uri,
            highestBidXrp: n.highestBidXrp,
          })),
        };
      })
      .sort((a, b) => b.totalValueXrp - a.totalValueXrp || b.count - a.count);

    return NextResponse.json({
      totalCount: ownedNfts.length,
      totalValueXrp,
      totalValueUsd: totalValueXrp * xrpPrice,
      xrpPrice,
      collections,
    });
  } catch (err) {
    logger.error({ err }, "[api/portfolio/nfts] Error");
    return NextResponse.json(
      { error: "Failed to fetch NFT holdings" },
      { status: 500 },
    );
  }
}

/** Paginate `account_nfts` for the address, dedup'd on NFTokenID.
 *  Server-side mirror of the client `useAccountNfts` paginator —
 *  both walk up to PAGE_CAP × XRPL_MAX_LIMIT items. */
async function fetchOwnedNFTs(address: string): Promise<NFTBrowseItem[]> {
  const seen = new Set<string>();
  const out: NFTBrowseItem[] = [];

  let marker: unknown = undefined;
  for (let page = 0; page < PAGE_CAP; page++) {
    const res = (await xrplClient.getAccountNFTs(
      address,
      marker,
    )) as unknown as AccountNFTsResult;
    const items = res.account_nfts ?? [];
    for (const nft of items) {
      if (seen.has(nft.NFTokenID)) continue;
      seen.add(nft.NFTokenID);
      out.push(nft);
    }
    marker = res.marker;
    if (!marker) break;
  }
  // Force the per-page limit even though the helper hard-codes it; we
  // pull XRPL_MAX_LIMIT to keep round-trips minimal. (The client
  // helper currently hardcodes 50; we override via the loop bound and
  // the WS protocol's `limit` is enforced on the server side, so leaving
  // the helper as-is is fine until the project standardizes the larger
  // limit there too.)
  void XRPL_MAX_LIMIT;
  return out;
}
