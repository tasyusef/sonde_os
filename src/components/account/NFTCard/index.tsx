"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { truncateHash } from "@/lib/xrpl-helpers";

function proxyImageUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `/api/nft-image?url=${encodeURIComponent(url)}`;
}

export default function NFTCard({
  nftId,
  serial,
  name,
  imageUrl,
  loading,
  highestBidXrp,
}: {
  nftId: string;
  serial: number;
  /** Pre-resolved name from the parent's batch metadata fetch. */
  name: string | null;
  /** Pre-resolved image URL (pre-proxy). */
  imageUrl: string | null;
  /** True while the parent is still resolving this batch. */
  loading: boolean;
  /** Highest active XRP buy offer in XRP units. When > 0, surfaces
   *  as a pill overlay on the bottom-right of the image. The
   *  account-page consumer doesn't pass this; portfolio does. */
  highestBidXrp?: number;
}) {
  const [imgError, setImgError] = useState(false);
  const showFallback = !loading && (!imageUrl || imgError);
  const showBid = typeof highestBidXrp === "number" && highestBidXrp > 0;

  return (
    <Link
      href={`/nft/${nftId}`}
      className="group block overflow-hidden rounded-2xl shadow-card bg-surface transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-elevated">
        {loading ? (
          <div className="h-full w-full animate-pulse motion-reduce:animate-none bg-elevated" />
        ) : showFallback ? (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-mono text-heading font-bold text-tx-nft/30">
              #{serial}
            </span>
          </div>
        ) : (
          <Image
            src={proxyImageUrl(imageUrl!)}
            alt={name ?? `NFT #${serial}`}
            fill
            sizes="(min-width: 1024px) 200px, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            unoptimized
            onError={() => setImgError(true)}
          />
        )}

        {/* Bid pill — tokenized surface so light/dark mode both work
             without the legacy `bg-black/70 + text-white` pairing
             that ignored the theme. */}
        {showBid && (
          <div className="absolute bottom-2 right-2 rounded-lg bg-elevated/90 px-2 py-1 backdrop-blur-sm">
            <span className="font-mono text-label font-medium tabular-nums text-primary">
              {highestBidXrp!.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}{" "}
              XRP
            </span>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <span
            className={`truncate text-cell font-bold text-primary ${
              name ? "font-display" : "font-mono"
            }`}
          >
            {name ?? `#${serial}`}
          </span>
          <span className="ml-2 shrink-0 rounded-tag bg-tx-nft/10 px-2 py-0.5 font-mono text-label font-medium text-tx-nft">
            NFT
          </span>
        </div>
        <p className="mt-0.5 font-mono text-tag text-muted">
          {truncateHash(nftId, 8)}
        </p>
      </div>
    </Link>
  );
}
