"use client";

import { useEffect, useMemo, useState } from "react";
import LoadingDots from "@/components/shared/LoadingDots";
import { pickCollectionName } from "@/lib/nft-name-helpers";
import { formatVolume } from "@/lib/format";
import CollectionRow from "./CollectionRow";
import SingleCollectionView from "./SingleCollectionView";
import type {
  CollectionsViewProps,
  NormalizedNFT,
} from "./types";

export type {
  CollectionsViewProps,
  CollectionValuation,
  NFTGridTotals,
  NormalizedNFT,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface ResolvedRow {
  name: string | null;
  imageUrl: string | null;
  /** Canonical collection name from the JSON metadata's `collection`
   *  field. Authoritative when non-null — preferred over per-NFT-name
   *  consensus. */
  collectionName: string | null;
  issuer: string;
  taxon: number;
}

interface CollectionGroup {
  key: string;
  issuer: string;
  taxon: number;
  nfts: NormalizedNFT[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function groupByCollection(nfts: NormalizedNFT[]): CollectionGroup[] {
  const map = new Map<string, CollectionGroup>();
  for (const nft of nfts) {
    const key = `${nft.issuer}:${nft.taxon}`;
    const existing = map.get(key);
    if (existing) {
      existing.nfts.push(nft);
    } else {
      map.set(key, {
        key,
        issuer: nft.issuer,
        taxon: nft.taxon,
        nfts: [nft],
      });
    }
  }
  return [...map.values()].sort((a, b) => b.nfts.length - a.nfts.length);
}

/** Page size for the batch metadata endpoint. Stays under the
 *  server's MAX_BATCH (250). Splitting also lets the UI progressively
 *  fill in for very large wallets. */
const BATCH_SIZE = 80;

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

/**
 * Shared NFT-collections grid for both the account page (`/account/[address]`)
 * and the portfolio page (`/portfolio`). Both pages render the same
 * accordion-of-collections structure with the same metadata-resolution
 * pipeline; the differences are additive — portfolio passes
 * `valuations` (per-collection floor / total) and `totals` (header
 * with title + grand total), and individual NFTs may carry a
 * `highestBidXrp` that surfaces as a pill on the card.
 *
 * Data resolution pipeline:
 *   1. `nft_collections` cron cache (PG, populated by the Hetzner
 *      timer) — canonical when present.
 *   2. JSON `collection` field on per-NFT metadata, surfaced by the
 *      batch endpoint as `collectionName`. Set by mainstream issuers.
 *   3. `pickCollectionName` strict-majority consensus over per-NFT
 *      `name` fields. Strips "{Foo} #{N}" patterns.
 * Falls through to "Collection #{taxon}" when all three are null.
 *
 * Per-NFT metadata (image + name) comes from one batched call to
 * `/api/nft-metadata/batch`. The progress ticker reflects how much of
 * the wallet has resolved so far.
 */
export default function CollectionsView({
  nfts,
  loadingList = false,
  valuations,
  totals,
  title,
}: CollectionsViewProps) {
  const collections = useMemo(() => groupByCollection(nfts), [nfts]);

  const [resolved, setResolved] = useState<Map<string, ResolvedRow>>(
    () => new Map(),
  );
  const [resolvedCollections, setResolvedCollections] = useState<
    Map<string, { name: string; imageUrl: string | null }>
  >(() => new Map());
  const [loading, setLoading] = useState(nfts.length > 0);

  // Reset when the NFT set changes — the new wallet's data shouldn't
  // inherit the previous wallet's resolved-cache.
  const [prevNfts, setPrevNfts] = useState(nfts);
  if (prevNfts !== nfts) {
    setPrevNfts(nfts);
    setResolved(new Map());
    setResolvedCollections(new Map());
    setLoading(nfts.length > 0);
  }

  // Tier 1: cron-resolved collection names from `nft_collections`.
  useEffect(() => {
    if (collections.length === 0) return;
    const controller = new AbortController();
    const pairs = collections.map((c) => ({
      issuer: c.issuer,
      taxon: c.taxon,
    }));
    fetch("/api/nft/collections/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : {}))
      .then(
        (
          data: Record<
            string,
            { name: string; imageUrl: string | null } | undefined
          >,
        ) => {
          const next = new Map<
            string,
            { name: string; imageUrl: string | null }
          >();
          for (const [key, val] of Object.entries(data)) {
            if (val?.name) next.set(key, val);
          }
          setResolvedCollections(next);
        },
      )
      .catch(() => {
        /* fall back to JSON / consensus */
      });
    return () => controller.abort();
  }, [collections]);

  // Per-NFT metadata batch fetch. Chunked + parallel: every batch
  // request fires concurrently and merges into `resolved` via a
  // functional update, so out-of-order completions don't clobber.
  useEffect(() => {
    if (nfts.length === 0) return;
    const controller = new AbortController();

    async function resolveAll() {
      const chunks: Array<{ nftokenId: string; uri: string | null }[]> = [];
      for (let i = 0; i < nfts.length; i += BATCH_SIZE) {
        chunks.push(
          nfts.slice(i, i + BATCH_SIZE).map((nft) => ({
            nftokenId: nft.nftId,
            uri: nft.uri || null,
          })),
        );
      }

      await Promise.all(
        chunks.map(async (chunk) => {
          if (controller.signal.aborted) return;
          try {
            const res = await fetch("/api/nft-metadata/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: chunk }),
              signal: controller.signal,
            });
            if (!res.ok) return;
            const data = (await res.json()) as {
              results: Record<string, ResolvedRow>;
            };
            setResolved((prev) => {
              const next = new Map(prev);
              for (const [id, row] of Object.entries(data.results)) {
                next.set(id, row);
              }
              return next;
            });
          } catch {
            /* one batch failed — keep going */
          }
        }),
      );

      if (!controller.signal.aborted) setLoading(false);
    }

    resolveAll();
    return () => controller.abort();
  }, [nfts]);

  // Three-tier collection-name resolution (cron → JSON → consensus).
  const collectionNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const col of collections) {
      const fromCron = resolvedCollections.get(col.key)?.name;
      if (fromCron) {
        out.set(col.key, fromCron);
        continue;
      }
      const rows = col.nfts.map((n) => resolved.get(n.nftId));
      const fromJson = rows.find((r) => r?.collectionName)?.collectionName;
      if (fromJson) {
        out.set(col.key, fromJson);
        continue;
      }
      const picked = pickCollectionName(rows.map((r) => r?.name ?? null));
      if (picked) out.set(col.key, picked);
    }
    return out;
  }, [collections, resolved, resolvedCollections]);

  // Empty / loading states. Loading takes precedence so we don't flash
  // "no NFTs" before the upstream paginator finishes.
  if (nfts.length === 0) {
    if (loadingList) {
      return (
        <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
          <span
            className="inline-flex items-center gap-2 font-mono text-body text-muted"
            role="status"
            aria-live="polite"
          >
            <LoadingDots className="text-brand" />
            Loading NFTs…
          </span>
        </div>
      );
    }
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-body text-muted">No NFTs held</p>
      </div>
    );
  }

  // Body: progress ticker + collection accordions or single-collection grid.
  const body = (
    <div className="space-y-3">
      <MetadataProgressRow
        resolvedCount={resolved.size}
        totalCount={nfts.length}
        loading={loading}
      />
      {collections.length === 1 ? (
        <SingleCollectionView
          collection={collections[0]}
          name={collectionNames.get(collections[0].key) ?? null}
          resolved={resolved}
          loading={loading}
          valuation={valuations?.get(collections[0].key)}
        />
      ) : (
        <div className="space-y-1 rounded-2xl bg-surface p-2 shadow-card">
          {collections.map((col) => (
            <CollectionRow
              key={col.key}
              collection={col}
              name={collectionNames.get(col.key) ?? null}
              resolved={resolved}
              loading={loading}
              valuation={valuations?.get(col.key)}
            />
          ))}
        </div>
      )}
    </div>
  );

  // When `totals` is passed (portfolio), wrap the grid in a section
  // with a header band carrying the title + grand totals. Account
  // omits the header — its NFT tab already has its own toggle/header.
  if (totals) {
    return (
      <section className="overflow-hidden rounded-2xl shadow-card bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-elevated px-4 py-card-header">
          <h2 className="font-display text-label font-medium uppercase tracking-header text-muted">
            {title ?? "NFTs"}
            <span className="ml-2 normal-case text-secondary">
              {totals.totalCount}
            </span>
          </h2>
          {totals.totalValueXrp > 0 && (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-cell font-medium tabular-nums text-primary">
                {totals.totalValueXrp.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}{" "}
                XRP
              </span>
              <span className="font-mono text-label tabular-nums text-muted">
                {formatVolume(totals.totalValueUsd)}
              </span>
            </div>
          )}
        </div>
        <div className="p-2">{body}</div>
      </section>
    );
  }

  return body;
}

/** Pattern C — progressive count of NFT-metadata batches resolving.
 *  Hidden once metadata finishes loading; while in flight reads as
 *  "Resolved 240 of 800 NFTs" so the user sees a real, ticking number
 *  instead of a generic spinner. */
function MetadataProgressRow({
  resolvedCount,
  totalCount,
  loading,
}: {
  resolvedCount: number;
  totalCount: number;
  loading: boolean;
}) {
  if (!loading) return null;
  return (
    <div
      className="flex min-h-5 items-center gap-2 px-1 font-mono text-tag text-muted"
      role="status"
      aria-live="polite"
    >
      <LoadingDots className="text-brand" />
      <span>
        Resolved {resolvedCount.toLocaleString()} of{" "}
        {totalCount.toLocaleString()} NFTs
      </span>
    </div>
  );
}
