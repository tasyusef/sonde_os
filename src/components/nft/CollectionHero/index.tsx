import type { ReactNode } from "react";
import AddressLink from "@/components/shared/AddressLink";
import CollectionCover from "@/components/nft/CollectionCover";
import DesktopCover from "@/components/nft/CollectionCover/DesktopCover";
import { type CollectionMeta } from "@/lib/db-queries";

function proxyImageUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `/api/nft-image?url=${encodeURIComponent(url)}`;
}

/**
 * Collection detail page header.
 *
 * Renders two completely separate layouts at the lg breakpoint:
 *   - Mobile (< lg): one unified card with a compact list-item row
 *     (small cover + title block) and the stats slot below with a
 *     top divider.
 *   - Desktop (lg+): three independent cards side-by-side — cover
 *     image card, info card (name/description/metadata), and the
 *     stats card. Each is its own bordered surface so they read as
 *     three peers, not one stacked block.
 *
 * The stats slot is rendered into both branches; only one is visible
 * at a time via `lg:hidden` / `hidden lg:flex`. `useSWR` inside
 * CollectionStats dedupes the network call between the two
 * instances.
 *
 * Falls back to an "Untitled collection" stub when the metadata
 * hasn't been resolved yet so the rest of the page can still render.
 */
export default function CollectionHero({
  meta,
  issuer,
  taxon,
  bottomSlot,
}: {
  meta: CollectionMeta | null;
  issuer: string;
  taxon: number;
  /** Stats content — rendered into the mobile card's bottom strip
   *  AND the desktop standalone stats card. */
  bottomSlot?: ReactNode;
}) {
  const name = meta?.name ?? "Untitled collection";
  const description = meta?.description ?? null;
  const cover = meta?.imageUrl ? proxyImageUrl(meta.imageUrl) : null;

  return (
    <>
      {/* ── Mobile (< lg): single unified card ─────────────────────── */}
      <section
        aria-label="Collection overview"
        className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card lg:hidden"
      >
        <div className="flex flex-row items-start gap-4 p-4">
          {/* Cover */}
          <div className="shrink-0">
            {cover ? (
              <CollectionCover src={cover} alt={`${name} cover`} />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-xl bg-elevated">
                <span className="font-mono text-label font-bold text-tx-nft/40">
                  NFT
                </span>
              </div>
            )}
          </div>

          {/* Title block */}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-heading font-bold tracking-[-0.3px] text-primary">
              {name}
            </h1>

            {description && (
              <p className="mt-2 font-body text-tag text-secondary">
                {description}
              </p>
            )}

            <div className="mt-3 flex flex-col gap-1.5">
              <span className="flex items-center gap-2 font-mono text-tag text-muted">
                <span className="uppercase tracking-header">Created by</span>
                <AddressLink address={issuer} />
              </span>
              <span className="font-mono text-tag uppercase tracking-header text-muted">
                Taxon #{taxon}
              </span>
            </div>
          </div>
        </div>

        {bottomSlot && <div className="border-t border-elevated">{bottomSlot}</div>}
      </section>

      {/* ── Desktop (lg+): three separate cards ─────────────────────── */}
      <div className="hidden lg:flex lg:items-stretch lg:gap-6">
        {/* Cover card — fixed 224×224 square. items-stretch on the
             flex row makes the info + stats cards match this height. */}
        <section
          aria-label="Collection cover"
          className="size-56 shrink-0 overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
        >
          {cover ? (
            <DesktopCover src={cover} alt={`${name} cover`} />
          ) : (
            <div className="flex size-full items-center justify-center bg-elevated">
              <span className="font-mono text-heading font-bold text-tx-nft/40">
                NFT
              </span>
            </div>
          )}
        </section>

        {/* Info card — name + description + issuer + taxon stacked
             vertically, each on its own line. flex-1 fills the
             middle. */}
        <section
          aria-label="Collection details"
          className="flex min-w-0 flex-1 flex-col rounded-2xl border border-elevated bg-surface p-8 shadow-card"
        >
          <h1 className="font-display text-display font-bold tracking-[-0.3px] text-primary">
            {name}
          </h1>

          {description && (
            <p className="mt-2 max-w-2xl font-body text-body text-secondary">
              {description}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <span className="flex items-center gap-2 font-mono text-tag text-muted">
              <span className="uppercase tracking-header">Created by</span>
              <AddressLink address={issuer} />
            </span>
            <span className="font-mono text-tag uppercase tracking-header text-muted">
              Taxon #{taxon}
            </span>
          </div>
        </section>

        {/* Stats card — same content as the mobile bottom slot, but
             with its own card chrome instead of an internal divider. */}
        {bottomSlot && (
          <section
            aria-label="Collection stats card"
            className="w-80 shrink-0 overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card"
          >
            {bottomSlot}
          </section>
        )}
      </div>
    </>
  );
}
