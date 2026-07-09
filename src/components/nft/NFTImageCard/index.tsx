"use client";

import Image from "next/image";
import { useState } from "react";
import LoadingDots from "@/components/shared/LoadingDots";
import { useNFTMetadata } from "@/hooks/useNFTMetadata";
import { cn } from "@/lib/utils";

/**
 * Hero image for the NFT detail page. Image-only — name + description
 * live in the dedicated `NFTDescriptionCard`.
 *
 * Container starts at `aspect-square` as a placeholder, then snaps
 * to the loaded image's natural ratio so portrait NFTs render tall
 * and panoramas render wide instead of being letterboxed inside a
 * forced square. One CLS per detail-page load when that snap
 * happens — acceptable for a hero element.
 *
 * Two distinct loading phases get explicit feedback:
 *   1. Metadata fetch — the JSON file is being pulled through our
 *      `/api/nft-metadata` proxy → IPFS gateway chain. Cold loads
 *      can take 5–10s on the slowest gateways.
 *   2. Image fetch — once we have the imageUrl from JSON, the
 *      browser starts loading the image (also through our proxy
 *      → IPFS for ipfs:// urls). Same cold-load tax.
 *
 * Pre-redesign both phases were a generic pulse skeleton, which
 * left users staring at a gray box for 5+ seconds with no
 * explanation. Now: spinner + short blurb so the wait is
 * legibly attributed to IPFS rather than feeling like the page
 * broke.
 */
/**
 * `fillHeight` swaps the aspect-ratio box for `lg:h-full` so the card
 * stretches to its parent's height on desktop instead of being sized
 * by the loaded image's natural ratio. The Image inside still uses
 * `object-contain`, so the actual NFT image keeps its aspect and
 * letterboxes within the box. Mobile still uses the aspect-driven
 * sizing — only the `lg+` breakpoint switches behavior.
 */
export default function NFTImageCard({
  uri,
  fillHeight,
}: {
  uri: string | null;
  fillHeight?: boolean;
}) {
  const { metadata, isLoading } = useNFTMetadata(uri);
  const [imgError, setImgError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset all per-image state when the URI changes — pattern
  // mirrors CollectionsView (avoids `react-hooks/set-state-in-effect`).
  const [prevUri, setPrevUri] = useState(uri);
  if (uri !== prevUri) {
    setPrevUri(uri);
    setAspectRatio(null);
    setImgError(false);
    setImageLoaded(false);
  }

  // Sizing helper: aspect-square on mobile + when not filling; lg:h-full
  // when `fillHeight` so the box stretches to its grid/flex parent on
  // desktop without throwing away the mobile aspect.
  const sizing = fillHeight ? "aspect-square lg:aspect-auto lg:h-full" : "aspect-square";

  if (!uri) {
    return (
      <div className={cn("flex items-center justify-center rounded-2xl bg-surface p-8 shadow-card", sizing)}>
        <p className="font-mono text-body text-muted">No metadata URI</p>
      </div>
    );
  }

  // Metadata fetch in flight — no image URL yet, no <Image> to mount.
  if (isLoading) {
    return (
      <div
        className={cn("relative flex items-center justify-center rounded-2xl bg-elevated shadow-card", sizing)}
        role="status"
        aria-label="Fetching NFT metadata"
      >
        <IpfsLoadingOverlay
          title="Fetching metadata from IPFS"
          blurb="Cold gateway responses can take a few seconds."
        />
      </div>
    );
  }

  const imageUrl = metadata?.imageUrl
    ? `/api/nft-image?url=${encodeURIComponent(metadata.imageUrl)}`
    : null;

  if (!imageUrl || imgError) {
    return (
      <div className={cn("flex items-center justify-center rounded-2xl bg-elevated shadow-card", sizing)}>
        <span className="font-mono text-body text-muted">No image</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-2xl bg-elevated shadow-card",
        fillHeight && "lg:h-full",
      )}
      // Aspect-ratio is the height source on mobile and when not
      // filling. With `lg:h-full` the parent's height wins on desktop,
      // and inline aspect-ratio is treated as a hint (ignored for
      // sizing) — so mobile stays aspect-driven without an extra rule.
      style={aspectRatio ? { aspectRatio: String(aspectRatio) } : undefined}
    >
      {/* Square placeholder until the image loads + we know its
           natural aspect. Forces the parent's height on mobile; when
           `fillHeight`, the parent already has a definite height on
           desktop, so the placeholder is mobile-only there. */}
      {!aspectRatio && (
        <div
          className={cn("aspect-square", fillHeight && "lg:hidden")}
          aria-hidden
        />
      )}
      <Image
        src={imageUrl}
        alt={metadata?.name ?? "NFT"}
        fill
        sizes="(max-width: 1024px) 100vw, 50vw"
        className="object-contain"
        onError={() => setImgError(true)}
        onLoadingComplete={(img) => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setAspectRatio(img.naturalWidth / img.naturalHeight);
          }
          setImageLoaded(true);
        }}
        unoptimized
      />
      {/* Image-fetch overlay — sits on top of the placeholder while
           the browser pulls the actual image bytes. Fades out the
           moment `onLoadingComplete` fires. */}
      {!imageLoaded && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-elevated/80 backdrop-blur-sm"
          role="status"
          aria-label="Fetching NFT image"
        >
          <IpfsLoadingOverlay
            title="Fetching image from IPFS"
            blurb="Cold gateway responses can take a few seconds."
          />
        </div>
      )}
    </div>
  );
}

/**
 * Centered title + blurb + dots. Used for both the metadata-fetch
 * standalone state and the image-fetch overlay; the parent supplies
 * the title so the user knows which stage they're in.
 */
function IpfsLoadingOverlay({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 text-center">
      <LoadingDots className="text-brand" size={8} gap={6} />
      <p className="font-mono text-cell font-medium text-primary">{title}</p>
      <p className="font-mono text-label text-muted">{blurb}</p>
    </div>
  );
}

export { NFTImageCard };
