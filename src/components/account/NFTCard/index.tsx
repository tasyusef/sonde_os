import { useRef, useState } from "react";
import GatewayImage from "@/components/shared/GatewayImage";
import LoadFromHost from "@/components/shared/LoadFromHost";
import { Link } from "react-router";
import { useMediaApproval } from "@/hooks/useMediaApproval";
import { approveMedia } from "@/lib/media-approvals";
import { truncateHash } from "@/lib/xrpl-helpers";

export default function NFTCard({
  nftId,
  serial,
  name,
  imageUrl,
  askHost,
  loading,
}: {
  nftId: string;
  serial: number;
  /** Pre-resolved name from the parent's batch metadata fetch. */
  name: string | null;
  /** Pre-resolved image URL (GatewayImage adds the fallbacks). */
  imageUrl: string | null;
  /** Metadata host waiting for the visitor's OK. */
  askHost: string | null;
  /** True while the parent is still resolving this batch. */
  loading: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const image = useMediaApproval(nftId, imageUrl);
  const showFallback = !loading && (!imageUrl || imgError);
  // Both layouts below share this root <div>, so focus moved here by
  // "Load from" stays put when the card swaps layout.
  const rootRef = useRef<HTMLDivElement>(null);

  const text = (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        {/* A name is third-party data, so it keeps its case and the data face. */}
        <span className="truncate font-mono text-cell text-primary">
          {name ?? `#${serial}`}
        </span>
        <span className="ml-2 shrink-0 rounded-tag tag-nft px-2 py-0.5 font-mono text-label font-medium">
          NFT
        </span>
      </div>
      <p className="mt-0.5 font-mono text-tag text-muted">
        {truncateHash(nftId, 8)}
      </p>
    </div>
  );

  // A button can't sit inside the card's link, so a card that asks
  // links only its text.
  const ask = askHost
    ? { host: askHost, what: "metadata" as const, onLoad: () => approveMedia(nftId, askHost) }
    : !loading && !showFallback && image.askHost
      ? { host: image.askHost, what: "image" as const, onLoad: image.approve }
      : null;
  if (ask) {
    return (
      <div ref={rootRef} tabIndex={-1} className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <div className="flex aspect-square w-full items-center justify-center border-b border-line p-3">
          <LoadFromHost {...ask} focusTarget={rootRef} />
        </div>
        <Link to={`/nft/${nftId}`} className="block -outline-offset-2 hover:bg-dither">
          {text}
        </Link>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="overflow-hidden rounded-2xl bg-surface shadow-card hover:bg-dither"
    >
      {/* Inset outline: the root's `overflow-hidden` would clip it. */}
      <Link to={`/nft/${nftId}`} className="block rounded-2xl -outline-offset-2">
        <div className="relative aspect-square w-full overflow-hidden bg-elevated">
          {loading ? (
            <div className="h-full w-full animate-pulse motion-reduce:animate-none bg-elevated" />
          ) : showFallback ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-mono text-value font-bold text-tx-nft/30">
                #{serial}
              </span>
            </div>
          ) : (
            <GatewayImage
              src={imageUrl!}
              alt={name ?? `NFT #${serial}`}
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
              onFail={() => setImgError(true)}
            />
          )}
        </div>
        {text}
      </Link>
    </div>
  );
}
