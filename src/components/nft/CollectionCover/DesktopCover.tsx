"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Desktop variant of `CollectionCover`. Fills its parent card 100%
 * (parent provides the size + rounded corners) and swaps to the
 * "NFT" placeholder on image load failure, same as the mobile
 * variant. Separated out because the mobile cover is tightly coupled
 * to the bleed-into-unified-card layout; a standalone card just
 * needs a plain fill.
 */
export default function DesktopCover({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex size-full items-center justify-center bg-elevated">
        <span className="font-mono text-heading font-bold text-tx-nft/40">
          NFT
        </span>
      </div>
    );
  }

  return (
    <div className="relative size-full bg-elevated">
      <Image
        src={src}
        alt={alt}
        fill
        sizes="224px"
        className="object-cover"
        unoptimized
        onError={() => setFailed(true)}
      />
    </div>
  );
}
