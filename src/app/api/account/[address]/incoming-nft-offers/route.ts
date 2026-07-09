import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import {
  getIncomingNftOffers,
  getNftOwnedCount,
  type IncomingNftOfferRow,
} from "@/lib/clickhouse-queries";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";
import type { NFTOffer } from "@/types/nft";

export const dynamic = "force-dynamic";

const log = logger.child({ module: "api/account/incoming-nft-offers" });

/**
 * Returns NFT buy offers OTHER accounts have placed on NFTs this account
 * owns. Powered by the `nft_offers` + `nft_ownership` ClickHouse tables
 * populated by the live ingester (NFTokenCreateOffer / Cancel / Accept /
 * Mint / Burn) and the historical backfill.
 *
 * Replaces the per-NFT WS fan-out the prior implementation used:
 *   - Old: N parallel `nft_buy_offers` server-side calls per request,
 *          capped at 500 NFTs (later 60s wall-clock budget). Cold first
 *          hit was 1-15s on real collections.
 *   - New: single CH query, sub-100ms regardless of NFT count, no cap.
 *
 * The response shape is unchanged from the prior fan-out implementation,
 * so the client (`useAccountIncomingNftOffers`) needs no update. Fields:
 *   - `offers[]`: array of { nftId, offer } pairs where offer matches
 *     the rippled `NFTOffer` shape used elsewhere in the app
 *   - `totalNfts`: how many NFTs this account owns (per nft_ownership)
 *   - `scannedNfts`: same as totalNfts (no cap with the indexed path)
 *   - `truncated`: false (no cap)
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json(
      { error: "Invalid XRPL address" },
      { status: 400 },
    );
  }

  try {
    const [rows, totalNfts] = await Promise.all([
      getIncomingNftOffers(address),
      getNftOwnedCount(address),
    ]);

    // Map CH rows to the response shape the client expects. The client
    // already accepts `{ nftId, offer }` where `offer` is rippled's
    // NFTOffer shape — emit exactly that.
    const offers = rows.map((r: IncomingNftOfferRow) => {
      const offer: NFTOffer = {
        nft_offer_index: r.nft_offer_index,
        owner: r.owner,
        amount:
          r.currency === "XRP"
            ? r.amount_drops
            : { value: r.amount_iou, currency: r.currency, issuer: r.issuer },
        flags: r.flags,
        ...(r.destination ? { destination: r.destination } : {}),
        ...(r.expiration_xrpl > 0 ? { expiration: r.expiration_xrpl } : {}),
      };
      return { nftId: r.nft_id, offer };
    });

    return cachedJson(
      {
        offers,
        totalNfts,
        scannedNfts: totalNfts,
        truncated: false,
      },
      60,
      300,
    );
  } catch (err) {
    log.error({ err, address }, "incoming-nft-offers fetch failed");
    return NextResponse.json(
      {
        offers: [],
        totalNfts: 0,
        scannedNfts: 0,
        truncated: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 200 },
    );
  }
}
