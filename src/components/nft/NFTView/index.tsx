import type { ReactNode } from "react";
import NFTDetails from "@/components/nft/NFTDetails";
import NFTHistoryLoader from "@/components/nft/NFTHistoryLoader";
import NFTIdentity from "@/components/nft/NFTIdentity";
import NFTMetadata from "@/components/nft/NFTMetadata";
import NFTOffersLoader from "@/components/nft/NFTOffersLoader";
import NFTProperties from "@/components/nft/NFTProperties";
import NFTSkeleton from "@/components/nft/NFTSkeleton";
import NFTStage from "@/components/nft/NFTStage";
import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import PageTitle from "@/components/shared/PageTitle";
import StageRail from "@/components/shared/StageRail";
import { useNftInfo } from "@/hooks/useNft";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

/**
 * NFT page body: `nft_info` plus offers and history, all loaded in the
 * browser. Laid out as Toolbox lays out a tool: the artwork on a stage,
 * what it is and its facts in a rail beside it, then the offer and
 * history tables across the full width. Stacks stage-first on mobile.
 */
export default function NFTView({ id }: { id: string }) {
  const { nft, valid, notFound, unreachable, retry } = useNftInfo(id);
  const detail = `NFTokenID: ${id}`;

  if (!valid) return <Shell><PageAlert message="Invalid NFT ID format" detail={detail} /></Shell>;
  if (notFound) return <Shell><PageAlert message="NFT not found" detail={detail} /></Shell>;
  if (!nft) {
    if (unreachable) {
      return (
        <Shell>
          <PageAlert message={UNREACHABLE_MESSAGE} detail={detail} onRetry={retry} />
        </Shell>
      );
    }
    return <NFTSkeleton />;
  }

  return (
    <div className="min-h-screen">
      <PageTitle>{`NFT ${id.slice(0, 8)}...${id.slice(-6)} — XRPL | Sonde`}</PageTitle>
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        <StageRail
          stage={<NFTStage uri={nft.uri} nftId={nft.nft_id} />}
          rail={
            <>
              <NFTIdentity nft={nft} />
              <NFTDetails nft={nft} />
              <NFTProperties uri={nft.uri} nftId={nft.nft_id} />
              <NFTMetadata uri={nft.uri} nftId={nft.nft_id} />
            </>
          }
        />
        <NFTOffersLoader nftId={nft.nft_id} className="mt-16" />
        <NFTHistoryLoader nftId={nft.nft_id} className="mt-16" />
      </main>
    </div>
  );
}
