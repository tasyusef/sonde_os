import { useNftHistory } from "@/hooks/useNft";
import { findBurn } from "@/lib/nft-history";
import { formatDate } from "@/lib/xrpl-helpers";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import PixelIcon from "@/components/shared/PixelIcon";

/** One sentence on a burned NFT: who burned it, when, and in which
 *  transaction, from the same `nft_history` fetch the history table
 *  uses. Omitted when history is unavailable; the status still reads
 *  "Burned". */
export default function NFTBurnNote({ nftId }: { nftId: string }) {
  const { rows } = useNftHistory(nftId);
  const burnTx = rows ? findBurn(rows) : undefined;
  if (!burnTx) return null;

  return (
    <p className="mt-4 flex items-start gap-2 font-mono text-cell text-primary">
      <PixelIcon name="flame" size="sm" className="mt-1 shrink-0 text-error" />
      <span className="min-w-0">
        Burned by <AddressLink address={burnTx.account} />
        {burnTx.date != null && <> on {formatDate(burnTx.date)}</>}, in{" "}
        <HashLink hash={burnTx.hash} />.
      </span>
    </p>
  );
}

export { NFTBurnNote };
