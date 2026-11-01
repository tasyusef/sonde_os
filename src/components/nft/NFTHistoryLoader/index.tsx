import NFTHistoryTable from "@/components/nft/NFTHistoryTable";
import ListNotice from "@/components/shared/ListNotice";
import Skeleton from "@/components/shared/Skeleton";
import { HISTORY_CAP, useNftHistory } from "@/hooks/useNft";

export default function NFTHistoryLoader({ nftId, className }: { nftId: string; className?: string }) {
  const { rows, more, failed, retry } = useNftHistory(nftId);

  if (failed) {
    return (
      <div className={className}>
        <ListNotice
          tone="error"
          message="Couldn't load transaction history. The Clio nodes didn't answer."
          action={{ label: "Try again", onClick: retry }}
        />
      </div>
    );
  }
  if (!rows) {
    return (
      <div className={className} role="status" aria-label="Loading transaction history">
        <Skeleton className="h-72" />
      </div>
    );
  }
  return (
    <NFTHistoryTable
      transactions={rows}
      note={more ? `Only the latest ${HISTORY_CAP} are loaded.` : null}
      className={className}
    />
  );
}

export { NFTHistoryLoader };
