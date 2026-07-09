"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Mobile-variant cover thumbnail (64px square) used inside the
 * unified hero card on viewports below lg. Desktop uses
 * `DesktopCover` which fills its own standalone card. Both swap to
 * the "NFT" placeholder tile on image load failure to avoid
 * showing the broken-image icon + alt text.
 *
 * Client component because only this leaf needs state for the load
 * error — parent `CollectionHero` stays a server component.
 */
export default function CollectionCover({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex size-16 items-center justify-center rounded-xl bg-elevated">
        <span className="font-mono text-label font-bold text-tx-nft/40">
          NFT
        </span>
      </div>
    );
  }

  return (
    <div className="relative size-16 overflow-hidden rounded-xl bg-elevated">
      <Image
        src={src}
        alt={alt}
        fill
        sizes="64px"
        className="object-cover"
        unoptimized
        onError={() => setFailed(true)}
      />
    </div>
  );
}
