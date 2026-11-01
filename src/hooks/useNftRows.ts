import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getNftRow,
  getNftsVersion,
  requestNfts,
  subscribeNfts,
  type NftRequest,
  type ResolvedNFT,
} from "@/lib/nft-metadata";
import { useApprovalsVersion } from "./useMediaApproval";
import { useXrpl } from "./useXrplWs";

/**
 * Settled NFT rows (name, image, collection) for `ids`, re-rendering as
 * more resolve. A missing key means still loading; failed lookups
 * settle with null fields.
 */
export function useNftRows(ids: readonly string[]): Map<string, ResolvedNFT> {
  const version = useSyncExternalStore(subscribeNfts, getNftsVersion, () => 0);
  // An approval hides the row it unblocks until the refetch settles.
  const approvals = useApprovalsVersion();
  return useMemo(() => {
    void version;
    void approvals;
    const out = new Map<string, ResolvedNFT>();
    for (const id of ids) {
      const row = getNftRow(id);
      if (row) out.set(id, row);
    }
    return out;
  }, [ids, version, approvals]);
}

/** Resolve `items` while mounted, once the XRPL socket is up (`nft_info`
 *  for unknown URIs). `priority` puts them ahead of background work.
 *  Unmounting drops work that hasn't started yet; an approved host
 *  refetches the rows it held back. */
export function useRequestNfts(
  items: readonly NftRequest[],
  { enabled = true, priority = false }: { enabled?: boolean; priority?: boolean } = {},
): void {
  const { send, ready } = useXrpl();
  const approvals = useApprovalsVersion();
  useEffect(() => {
    void approvals;
    if (!enabled || !ready || items.length === 0) return;
    return requestNfts(items, send, { priority });
  }, [items, enabled, priority, ready, send, approvals]);
}
