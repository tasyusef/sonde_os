"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { truncateHash } from "@/lib/xrpl-helpers";
import { type NFTBrowseItem } from "@/types/nft";

function proxyImageUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `/api/nft-image?url=${encodeURIComponent(url)}`;
}

export default function NFTCard({ nft }: { nft: NFTBrowseItem }) {
  const hexUri = nft.URI ?? null;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!hexUri);

  useEffect(() => {
    if (!hexUri) return;

    const controller = new AbortController();

    fetch(`/api/nft-metadata?uri=${encodeURIComponent(hexUri)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then(
        (data: { imageUrl?: string | null; name?: string | null }) => {
          if (data.imageUrl) setImageUrl(proxyImageUrl(data.imageUrl));
          if (data.name) setName(data.name);
        }
      )
      .catch(() => {
        /* metadata unavailable */
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [hexUri]);

  return (
    <Link
      href={`/nft/${nft.NFTokenID}`}
      className="group block overflow-hidden rounded-2xl shadow-card bg-surface transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-elevated">
        {loading ? (
          <div className="h-full w-full animate-pulse motion-reduce:animate-none bg-elevated" />
        ) : imageUrl ? (
          <Image
            src={imageUrl}
            alt={name ?? `NFT #${nft.nft_serial}`}
            fill
            sizes="(min-width: 1024px) 200px, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            // Proxy URL has dynamic `?url=` query string;
            // localPatterns.search doesn't support wildcards. Proxy
            // already caches at the edge, so optimizer adds no value.
            unoptimized
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (
                e.target as HTMLImageElement
              ).parentElement?.classList.add("nft-fallback-active");
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-mono text-heading font-bold text-tx-nft/30">
              #{nft.nft_serial}
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
            {name ?? `#${nft.nft_serial}`}
          </span>
          <span className="ml-2 shrink-0 rounded-tag bg-tx-nft/10 px-1.5 py-0.5 font-mono text-label font-medium text-tx-nft">
            NFT
          </span>
        </div>
        <p className="mt-0.5 font-mono text-tag text-muted">
          {truncateHash(nft.NFTokenID, 8)}
        </p>
      </div>
    </Link>
  );
}
