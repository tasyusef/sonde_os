import type { NFTInfo } from "@/types/nft";
import { buttonClasses } from "@/components/shared/Button";
import CopyButton from "@/components/shared/CopyButton";
import Decode from "@/components/shared/Decode";
import PixelIcon from "@/components/shared/PixelIcon";
import Skeleton from "@/components/shared/Skeleton";
import NFTBurnNote from "@/components/nft/NFTBurnNote";
import { useNFTMetadata } from "@/hooks/useNFTMetadata";

/**
 * The top of the NFT page's right column: what it is (the name from
 * its metadata, else its serial), its ID, its description, and the
 * one way to act on it.
 */
export default function NFTIdentity({ nft }: { nft: NFTInfo }) {
  const { metadata, isLoading } = useNFTMetadata(nft.uri, nft.nft_id);
  const name = metadata?.name;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 font-display text-caps uppercase">
        <span className="text-muted">{name ? `NFT #${nft.nft_serial}` : "NFT"}</span>
        {nft.is_burned ? (
          <span className="text-error">Burned</span>
        ) : (
          <span className="text-success">Active</span>
        )}
      </div>

      {/* A name is third-party data, so it keeps its case and the data face. */}
      {name ? (
        <h1 className="mt-3 break-words font-mono text-value text-primary">{name}</h1>
      ) : isLoading ? (
        <>
          <h1 className="sr-only">NFT #{nft.nft_serial}</h1>
          <Skeleton className="mt-3 h-8 w-2/3" />
        </>
      ) : (
        <h1 className="mt-3 font-display text-heading font-bold text-primary sm:text-title">
          NFT #{nft.nft_serial}
        </h1>
      )}

      <div className="mt-2 flex items-start gap-2">
        <span className="sr-only">NFT Token ID: </span>
        <span className="min-w-0 break-all font-mono text-cell text-primary">
          <Decode text={nft.nft_id} />
        </span>
        <CopyButton text={nft.nft_id} />
      </div>

      {metadata?.description && (
        <p className="mt-4 font-body text-ui leading-read-sm text-primary">
          {metadata.description}
        </p>
      )}

      {nft.is_burned && <NFTBurnNote nftId={nft.nft_id} />}

      <a
        href={`https://xrp.cafe/nft/${nft.nft_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-6" })}
      >
        <PixelIcon name="external" size="sm" />
        Trade on xrp.cafe
      </a>
    </div>
  );
}

export { NFTIdentity };
