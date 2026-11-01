import { useMemo } from "react";
import { useAccountAmmPositions } from "@/hooks/useAccountAmmPositions";
import { useAccountNftBids } from "@/hooks/useAccountNftBids";
import { useAccountNfts } from "@/hooks/useAccountNfts";
import { useAccountObjects } from "@/hooks/useAccountObjects";
import { useAccountTrustLines } from "@/hooks/useAccountTrustLines";
import { accountTotalValue } from "@/lib/account-value";

/**
 * What the account's XRP-priced holdings are worth in USD, with its
 * caveat. Null until every source has settled, so a total is never
 * shown while a part of it is still on its way. Each hook SWR-shares
 * with the tab that lists the same data, so this costs no extra calls.
 */
export function useAccountTotalValue(address: string, xrpValueUsd: number, xrpPrice: number) {
  const objectsState = useAccountObjects(address);
  const trustLinesState = useAccountTrustLines(address);
  const ammState = useAccountAmmPositions(trustLinesState.lpTrustLines, address);
  const nftsState = useAccountNfts(address);
  const bids = useAccountNftBids(nftsState.nfts);

  const loading =
    objectsState.isLoading ||
    trustLinesState.isLoading ||
    ammState.isLoading ||
    nftsState.isLoading ||
    bids.isLoading;

  return useMemo(
    () =>
      loading
        ? null
        : accountTotalValue({
            address,
            xrpValueUsd,
            xrpPrice,
            escrows: objectsState.escrows,
            channels: objectsState.channels,
            ammPositions: ammState.ammPositions,
            highestBids: bids.highestBids,
            trustLines: trustLinesState.regularTrustLines,
            sources: {
              objects: objectsState,
              amm: ammState,
              nfts: { ...nftsState, count: nftsState.nfts.length },
              bidsFailed: bids.failed,
            },
          }),
    [loading, address, xrpValueUsd, xrpPrice, objectsState, ammState, bids, trustLinesState, nftsState],
  );
}
