"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { type NFTBrowseItem } from "@/types/nft";
import NFTCard from "@/components/nft/NFTCard";
import AddressLink from "@/components/shared/AddressLink";
import { cn } from "@/lib/utils";
import { pickCollectionName } from "@/lib/nft-name-helpers";

/** Composite key: Issuer + Taxon = unique collection */
function collectionKey(nft: NFTBrowseItem): string {
  return `${nft.Issuer}:${nft.NFTokenTaxon}`;
}

interface CollectionGroup {
  key: string;
  issuer: string;
  taxon: number;
  nfts: NFTBrowseItem[];
}

/** Group NFTs by Issuer + Taxon */
function groupByCollection(nfts: NFTBrowseItem[]): CollectionGroup[] {
  const map = new Map<string, CollectionGroup>();
  for (const nft of nfts) {
    const key = collectionKey(nft);
    const existing = map.get(key);
    if (existing) {
      existing.nfts.push(nft);
    } else {
      map.set(key, { key, issuer: nft.Issuer, taxon: nft.NFTokenTaxon, nfts: [nft] });
    }
  }
  return [...map.values()];
}

/** Mobile-only collapsible dropdown for collection filtering */
function CollectionDropdown({
  collections,
  collectionNames,
  selectedKeys,
  allSelected,
  showAll,
  onToggleAll,
  onToggle,
}: {
  collections: CollectionGroup[];
  collectionNames: Map<string, string>;
  selectedKeys: Set<string>;
  allSelected: boolean;
  showAll: boolean;
  onToggleAll: () => void;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click/touch and Escape key
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const selectedCount = showAll ? collections.length : selectedKeys.size;
  const label =
    allSelected || showAll
      ? `All ${collections.length} collections`
      : `${selectedCount} of ${collections.length} collections`;

  return (
    <div ref={ref} className="relative mb-4 max-w-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="collection-filter"
        className="flex w-full items-center justify-between rounded-lg border border-elevated bg-surface px-4 py-2.5 font-mono text-cell font-medium text-secondary transition-colors hover:border-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span>{label}</span>
        <svg
          className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id="collection-filter"
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-elevated bg-surface shadow-lg"
          >
            <button
              role="option"
              aria-selected={allSelected || showAll}
              onClick={onToggleAll}
              className={cn(
                "flex w-full items-center gap-3 border-b border-elevated px-4 py-2.5 font-mono text-cell font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                allSelected || showAll ? "text-brand" : "text-muted"
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  allSelected || showAll
                    ? "border-brand bg-brand/20"
                    : "border-elevated"
                )}
              >
                {(allSelected || showAll) && (
                  <svg className="h-3 w-3 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              All
            </button>
            {collections.map((collection) => {
              const name = collectionNames.get(collection.key) ?? `Collection #${collection.taxon}`;
              const isSelected = selectedKeys.has(collection.key);
              const checked = isSelected && !showAll;

              return (
                <button
                  key={collection.key}
                  role="option"
                  aria-selected={checked}
                  onClick={() => onToggle(collection.key)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-elevated px-4 py-2.5 font-mono text-cell transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                    checked ? "text-primary" : "text-muted"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                      checked ? "border-brand bg-brand/20" : "border-elevated"
                    )}
                  >
                    {checked && (
                      <svg className="h-3 w-3 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{name}</span>
                  <span className="ml-auto shrink-0 text-muted">
                    {collection.nfts.length}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function NFTGrid({
  nfts,
  issuer,
}: {
  nfts: NFTBrowseItem[];
  issuer: string;
}) {
  const collections = useMemo(() => groupByCollection(nfts), [nfts]);
  const collectionKeys = useMemo(() => collections.map((c) => c.key), [collections]);
  const hasMultipleCollections = collections.length > 1;

  // All selected by default
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(collectionKeys)
  );

  // Collection names resolved from metadata
  const [collectionNames, setCollectionNames] = useState<Map<string, string>>(
    () => new Map()
  );

  // Reset filter state when the NFT list changes (e.g., different issuer loaded)
  // This is React's recommended pattern for adjusting state during render.
  const [prevNfts, setPrevNfts] = useState(nfts);
  if (prevNfts !== nfts) {
    setPrevNfts(nfts);
    setSelectedKeys(new Set(collectionKeys));
    setCollectionNames(new Map());
  }

  // Fetch metadata for up to N representatives per collection and run
  // consensus via `pickCollectionName`. Single-representative sampling
  // misnamed mixed-name collections (e.g., a "Monkey Phunks" group with
  // one outlier "Timmy Cormier" got the outlier's name) — strict-majority
  // consensus prevents that. The /api/nft-metadata/batch endpoint
  // handles many in one request.
  useEffect(() => {
    if (!hasMultipleCollections) return;

    const controller = new AbortController();
    const SAMPLES_PER_COLLECTION = 10;

    // Build the batch payload: up to N URI'd NFTs per collection.
    const samples: Array<{
      collectionKey: string;
      nftokenId: string;
      uri: string;
    }> = [];
    for (const collection of collections) {
      let taken = 0;
      for (const nft of collection.nfts) {
        if (taken >= SAMPLES_PER_COLLECTION) break;
        if (!nft.URI) continue;
        samples.push({
          collectionKey: collection.key,
          nftokenId: nft.NFTokenID,
          uri: nft.URI,
        });
        taken += 1;
      }
    }
    if (samples.length === 0) return;

    fetch("/api/nft-metadata/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: samples.map((s) => ({ nftokenId: s.nftokenId, uri: s.uri })),
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then(
        (data: {
          results: Record<string, { name?: string | null }>;
        }) => {
          // Group resolved names by collection key, then run consensus.
          const namesByCollection = new Map<string, Array<string | null>>();
          for (const s of samples) {
            const arr = namesByCollection.get(s.collectionKey) ?? [];
            arr.push(data.results[s.nftokenId]?.name ?? null);
            namesByCollection.set(s.collectionKey, arr);
          }
          setCollectionNames((prev) => {
            const next = new Map(prev);
            for (const [key, names] of namesByCollection) {
              const picked = pickCollectionName(names);
              if (picked) next.set(key, picked);
            }
            return next;
          });
        },
      )
      .catch(() => {
        /* metadata unavailable */
      });

    return () => controller.abort();
  }, [collections, hasMultipleCollections]);

  const allSelected = selectedKeys.size === collectionKeys.length;

  function toggleAll() {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(collectionKeys));
    }
  }

  function toggleCollection(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Show all if none selected (prevents empty grid)
  const showAll = selectedKeys.size === 0;
  const filteredNfts = showAll
    ? nfts
    : nfts.filter((nft) => selectedKeys.has(collectionKey(nft)));

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-tag font-medium uppercase tracking-header text-muted">
          NFTs Owned By
        </h2>
        <AddressLink address={issuer} truncate={false} />
        <span className="font-mono text-body text-muted">
          ({nfts.length} NFTs)
        </span>
      </div>

      {/* Collection filter dropdown */}
      {hasMultipleCollections && (
        <CollectionDropdown
          collections={collections}
          collectionNames={collectionNames}
          selectedKeys={selectedKeys}
          allSelected={allSelected}
          showAll={showAll}
          onToggleAll={toggleAll}
          onToggle={toggleCollection}
        />
      )}

      {nfts.length === 0 ? (
        <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
          <p className="font-mono text-body text-muted">No NFTs found for this account</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filteredNfts.map((nft) => (
            <NFTCard key={nft.NFTokenID} nft={nft} />
          ))}
        </div>
      )}
    </div>
  );
}
