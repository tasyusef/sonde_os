import { getNFTHistory } from "@/lib/nft-history";
import NFTHistoryTable from "@/components/nft/NFTHistoryTable";

export default async function NFTHistoryLoader({
  nftId,
}: {
  nftId: string;
}) {
  let transactions;
  try {
    transactions = await getNFTHistory(nftId);
  } catch {
    // nft_history is Clio-only — gracefully degrade
    return (
      <div className="rounded-2xl bg-surface shadow-card p-6 text-center">
        <p className="font-mono text-body text-muted">
          Transaction history unavailable
        </p>
        <p className="mt-1 font-mono text-label text-muted">
          Requires a Clio server connection
        </p>
      </div>
    );
  }

  return <NFTHistoryTable transactions={transactions} />;
}

export { NFTHistoryLoader };
