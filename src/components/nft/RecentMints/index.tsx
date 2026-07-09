"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { truncateHash } from "@/lib/xrpl-helpers";
import { useLiveData } from "@/hooks/useLiveData";
import type { RecentMint } from "@/lib/xrpl-data";

function proxyImageUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `/api/nft-image?url=${encodeURIComponent(url)}`;
}

interface MintMeta {
  imageUrl: string | null;
  name: string | null;
}

function MintCard({ mint }: { mint: RecentMint }) {
  const [meta, setMeta] = useState<MintMeta>({ imageUrl: null, name: null });
  const [loading, setLoading] = useState(!!mint.uri);

  useEffect(() => {
    if (!mint.uri) return;

    const controller = new AbortController();

    fetch(`/api/nft-metadata?uri=${encodeURIComponent(mint.uri)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then((data: { imageUrl?: string | null; name?: string | null }) => {
        setMeta({
          imageUrl: data.imageUrl ? proxyImageUrl(data.imageUrl) : null,
          name: data.name ?? null,
        });
      })
      .catch(() => {
        /* metadata unavailable */
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [mint.uri]);

  return (
    <Link
      href={`/nft/${mint.nftokenId}`}
      className="group block overflow-hidden rounded-2xl shadow-card bg-surface transition-shadow hover:shadow-card-hover"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-elevated">
        {loading ? (
          <div className="h-full w-full animate-pulse motion-reduce:animate-none bg-elevated" />
        ) : meta.imageUrl ? (
          <Image
            src={meta.imageUrl}
            alt={meta.name ?? `NFT ${truncateHash(mint.nftokenId, 6)}`}
            fill
            sizes="(min-width: 1024px) 200px, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
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
              NFT
            </span>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <span
            className={`truncate text-cell font-bold text-primary ${
              meta.name ? "font-display" : "font-mono"
            }`}
          >
            {meta.name ?? truncateHash(mint.nftokenId, 6)}
          </span>
          <span className="ml-2 shrink-0 rounded-tag bg-tx-nft/10 px-1.5 py-0.5 font-mono text-label font-medium text-tx-nft">
            NFT
          </span>
        </div>
        <p className="mt-0.5 font-mono text-tag text-muted">
          {truncateHash(mint.nftokenId, 8)}
        </p>
      </div>
    </Link>
  );
}

export function RecentMints({ mints }: { mints: RecentMint[] }) {
  const { recentMints: liveMints } = useLiveData();

  // Live data takes over once available; fall back to server-rendered props
  const displayMints =
    liveMints && liveMints.length > 0 ? liveMints : mints;

  if (displayMints.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl shadow-card bg-surface">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Recent Mints
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        {displayMints.map((mint) => (
          // Key on nftokenId (always present) rather than hash — the
          // CH-backed initial render doesn't carry the originating tx
          // hash (nft_static_metadata doesn't store it). Live overlay
          // via useLiveData still provides hash for late arrivals but
          // we want a single consistent key.
          <MintCard key={mint.nftokenId} mint={mint} />
        ))}
      </div>
    </div>
  );
}

export default RecentMints;
