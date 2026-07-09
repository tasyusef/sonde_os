"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import NFTCard from "@/components/account/NFTCard";
import Button from "@/components/shared/Button";
import { truncate } from "@/lib/xrpl-helpers";
import ValuationLine from "./ValuationLine";
import type { CollectionValuation, NormalizedNFT } from "./types";

const CARDS_PER_PAGE = 6;

interface ResolvedRow {
  name: string | null;
  imageUrl: string | null;
}

/**
 * Accordion row for a single (issuer, taxon) collection. Header
 * always visible; expand to reveal the card grid. Optionally shows
 * floor / total XRP / USD on the right when a `valuation` is passed
 * (portfolio path); collapses to inside the open drawer on mobile so
 * the header doesn't get too tight.
 */
export default function CollectionRow({
  collection,
  name,
  resolved,
  loading,
  valuation,
}: {
  collection: { key: string; issuer: string; taxon: number; nfts: NormalizedNFT[] };
  name: string | null;
  resolved: Map<string, ResolvedRow>;
  loading: boolean;
  valuation?: CollectionValuation;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const hasMore = collection.nfts.length > CARDS_PER_PAGE;
  const visible = showAll
    ? collection.nfts
    : collection.nfts.slice(0, CARDS_PER_PAGE);
  const hiddenCount = collection.nfts.length - CARDS_PER_PAGE;

  const thumbUrl = useMemo(() => {
    for (const nft of collection.nfts) {
      const meta = resolved.get(nft.nftId);
      if (meta?.imageUrl) return meta.imageUrl;
    }
    return null;
  }, [collection.nfts, resolved]);

  const displayName = name ?? `Collection #${collection.taxon}`;
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || "·";
  const showValuation = valuation !== undefined && valuation.totalValueXrp > 0;

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-elevated">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/nft-image?url=${encodeURIComponent(thumbUrl)}`}
              alt=""
              className="absolute inset-0 size-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center font-mono text-label font-semibold text-muted">
              {avatarLetter}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Name links to the collection detail page (stopPropagation
               keeps the row's expand-toggle button from also firing).
               Nested anchor-in-button is the same pattern the issuer
               link below uses — valid enough in practice, lets the
               row do double duty as expander + detail-page entry. */}
          <Link
            href={`/nft/collection/${collection.issuer}/${collection.taxon}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-display text-cell font-bold text-primary transition-colors hover:text-brand"
          >
            {displayName}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-tag text-muted">
            <span className="shrink-0">
              {collection.nfts.length} item
              {collection.nfts.length !== 1 ? "s" : ""}
            </span>
            <span aria-hidden="true" className="text-muted/50">
              ·
            </span>
            <Link
              href={`/account/${collection.issuer}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate text-brand transition-colors hover:text-brand-light"
            >
              {truncate(collection.issuer, 5)}
            </Link>
          </div>
        </div>

        {showValuation && (
          <ValuationLine valuation={valuation} className="hidden sm:flex" />
        )}

        <svg
          width="14"
          height="14"
          viewBox="0 0 12 12"
          fill="none"
          className={`shrink-0 text-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-3 pt-3 pb-2">
          {showValuation && (
            <ValuationLine valuation={valuation} className="sm:hidden" />
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {visible.map((nft) => {
              const meta = resolved.get(nft.nftId);
              return (
                <NFTCard
                  key={nft.nftId}
                  nftId={nft.nftId}
                  serial={nft.serial}
                  name={meta?.name ?? null}
                  imageUrl={meta?.imageUrl ?? null}
                  loading={loading && !meta}
                  highestBidXrp={nft.highestBidXrp}
                />
              );
            })}
          </div>

          {hasMore && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setShowAll((v) => !v);
              }}
              variant="secondary"
              size="sm"
              className="self-start"
            >
              {showAll ? "Show less" : `Show ${hiddenCount} more`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
