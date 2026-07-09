"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * Small NFT thumbnail with graceful failure. Renders the same "NFT"
 * placeholder tile when the image fails to load — used in tables /
 * lists where a broken-image icon would jar the row rhythm.
 *
 * `size` is a Tailwind size token (e.g. "size-8" for 32px).
 */
export default function NftThumbnail({
  src,
  alt = "",
  size = "size-8",
  rounded = "rounded-lg",
  placeholderFontSize = "text-[8px]",
}: {
  src: string | null;
  alt?: string;
  size?: string;
  rounded?: string;
  placeholderFontSize?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex ${size} shrink-0 items-center justify-center ${rounded} bg-elevated`}
      >
        <span
          className={`font-mono ${placeholderFontSize} font-bold text-tx-nft/40`}
        >
          NFT
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative ${size} shrink-0 overflow-hidden ${rounded} bg-elevated`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="32px"
        className="object-cover"
        unoptimized
        onError={() => setFailed(true)}
      />
    </div>
  );
}
