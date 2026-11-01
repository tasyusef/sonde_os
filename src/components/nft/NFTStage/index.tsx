import { type ReactNode, useRef, useState } from "react";
import GatewayImage from "@/components/shared/GatewayImage";
import LoadFromHost from "@/components/shared/LoadFromHost";
import LoadingDots from "@/components/shared/LoadingDots";
import { useMediaApproval } from "@/hooks/useMediaApproval";
import { useNFTMetadata } from "@/hooks/useNFTMetadata";

/**
 * The NFT's artwork on a dither mat, as Toolbox frames artwork. The
 * mat is square, capped to the viewport's height on desktop (it then
 * goes wide), and the image fits inside it at its own ratio, so the
 * page never jumps when the image's size becomes known.
 *
 * Two waits get their own line, so a slow IPFS gateway reads as the
 * gateway, not a broken page: the metadata JSON, then the image.
 */
export default function NFTStage({ uri, nftId }: { uri: string | null; nftId: string }) {
  const { metadata, isLoading, askHost, approve } = useNFTMetadata(uri, nftId);
  const imageUrl = metadata?.imageUrl ?? null;
  const image = useMediaApproval(nftId, imageUrl);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The mat stays one node across every state below, so focus moved
  // there by "Load from" survives the swap to loading, then the image.
  const matRef = useRef<HTMLDivElement>(null);

  // Reset per-image state when the URI changes (state derived from
  // props, not an effect).
  const [prevUri, setPrevUri] = useState(uri);
  if (uri !== prevUri) {
    setPrevUri(uri);
    setFailed(false);
    setLoaded(false);
  }

  // Media on a host that waits for a click (metadata first, then image).
  const ask = askHost
    ? { host: askHost, what: "metadata" as const, onLoad: approve }
    : !isLoading && image.askHost
      ? { host: image.askHost, what: "image" as const, onLoad: image.approve }
      : null;

  let content: ReactNode;
  if (!uri) content = <Plate>No metadata URI</Plate>;
  else if (ask) {
    content = (
      <Plate>
        <LoadFromHost {...ask} focusTarget={matRef} explain />
      </Plate>
    );
  } else if (isLoading) {
    content = <Wait label="Fetching NFT metadata" title="Fetching metadata from IPFS" />;
  } else if (!imageUrl || failed) content = <Plate>No image</Plate>;
  else {
    content = (
      <>
        <GatewayImage
          src={imageUrl}
          alt={metadata?.name ?? "NFT"}
          className="absolute inset-0 size-full object-contain"
          onFail={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
        />
        {!loaded && <Wait label="Fetching NFT image" title="Fetching image from IPFS" />}
      </>
    );
  }

  return (
    <div
      ref={matRef}
      tabIndex={-1}
      className="aspect-square w-full bg-dither p-4 sm:p-6 lg:max-h-[calc(100dvh-10rem)]"
    >
      <div className="relative size-full">{content}</div>
    </div>
  );
}

/** A plain field in the mat for text, which the dither would break up. */
function Plate({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black p-6 text-center font-mono text-body text-muted">
      {children}
    </div>
  );
}

function Wait({ label, title }: { label: string; title: string }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black px-6 text-center"
      role="status"
      aria-label={label}
    >
      <LoadingDots className="text-brand" size={8} gap={6} />
      <p className="font-mono text-cell text-primary">{title}</p>
      <p className="font-mono text-label text-muted">Cold gateway responses can take a few seconds.</p>
    </div>
  );
}

export { NFTStage };
