import NFTGrid from "@/components/nft/NFTGrid";
import { xrplClient } from "@/lib/xrpl-client";
import { getNFTsByOwnerFromCH } from "@/lib/db-queries";
import logger from "@/lib/logger";
import { type NFTBrowseItem } from "@/types/nft";

/**
 * Async server component — fetches all NFTs currently owned by an
 * account address (formerly named "NFTIssuerLoader"; the URL param
 * said `?issuer=` but the semantics were always "owner" —
 * `account_nfts` returns NFTs held, not minted).
 *
 * Strategy: CH-first with XRPL fallback.
 *   1. Query CH `nft_ownership` (sub-second). Covers the ~9.15M NFTs
 *      ingested since ledger 95.8M.
 *   2. If CH returned 0 NFTs, fall back to rippled's `account_nfts`
 *      pagination loop. Catches owners whose only holdings are older
 *      NFTs (minted before the ingestion cutoff) and accounts truly
 *      holding zero NFTs (cheap to confirm via XRPL).
 *
 * The fast path (CH > 0) dominates traffic and answers in milliseconds
 * instead of the multi-second WebSocket pagination the old version did.
 *
 * Edge case: an account holding a mix of pre-cutoff and post-cutoff
 * NFTs will return only the post-cutoff slice from CH. The fallback
 * doesn't trigger because CH returned > 0. Closing that gap requires
 * a historical backfill of nft_ownership for ledgers < 95.8M — tracked
 * as a separate task; rare enough in practice to not block shipping.
 */
export default async function NFTOwnerLoader({ owner }: { owner: string }) {
  let nfts: NFTBrowseItem[] | null = null;
  let error: string | null = null;

  try {
    // Fast path: CH lookup.
    const chNfts = await getNFTsByOwnerFromCH(owner);
    if (chNfts.length > 0) {
      nfts = chNfts;
    } else {
      // Cold path: rippled pagination. Triggered when CH returns
      // nothing — either the account holds zero NFTs (cheap to
      // confirm), or only pre-cutoff NFTs (rare).
      const allNfts: NFTBrowseItem[] = [];
      let marker: unknown = undefined;
      let pages = 0;
      const MAX_PAGES = 10;

      do {
        try {
          const result = await xrplClient.getAccountNFTs(owner, marker);
          allNfts.push(...(result.account_nfts ?? []));
          marker = result.marker;
          pages++;
        } catch (pageErr: unknown) {
          logger.warn({ err: pageErr }, `[NFTOwnerLoader] XRPL fallback error on page ${pages + 1} for ${owner}`);
          break; // Keep partial results.
        }
      } while (marker && pages < MAX_PAGES);

      nfts = allNfts;
    }
  } catch (e: unknown) {
    const err = e as { error_message?: string };
    error = err.error_message ?? "Failed to load NFTs for this account";
  }

  if (error || !nfts) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center" role="alert">
        <p className="font-mono text-cell text-error">
          {error ?? "Failed to load NFTs for this account"}
        </p>
      </div>
    );
  }

  return <NFTGrid nfts={nfts} issuer={owner} />;
}
