import type { Metadata } from "next";
import { Suspense } from "react";
import NFTDetailHero from "@/components/nft/NFTDetailHero";
import NFTMiniHeader from "@/components/nft/NFTMiniHeader";
import NFTDescriptionCard from "@/components/nft/NFTDescriptionCard";
import NFTDetailsBar from "@/components/nft/NFTDetailsBar";
import NFTPropertiesCard from "@/components/nft/NFTPropertiesCard";
import NFTBurnBanner from "@/components/nft/NFTBurnBanner";
import NFTImageCard from "@/components/nft/NFTImageCard";
import NFTOffersLoader from "@/components/nft/NFTOffersLoader";
import NFTHistoryLoader from "@/components/nft/NFTHistoryLoader";
import Skeleton from "@/components/shared/Skeleton";
import { xrplClient } from "@/lib/xrpl-client";
import { parseNFTokenID } from "@/lib/nft-utils";
import { type NFTInfo } from "@/types/nft";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const truncated = `${id.slice(0, 8)}...${id.slice(-6)}`;
  return {
    title: `NFT ${truncated}`,
    description: `XRPL NFT details and offers for ${id}`,
    alternates: { canonical: `/nft/${id}` },
  };
}

/**
 * Cache the page-shell render for 60s. NFT static metadata
 * (issuer/taxon/transfer-fee/serial/uri/flags) is immutable per
 * nft_id; ownership + burn status change but stale-by-60s is fine
 * for a detail page. The big offer/history streams sit downstream of
 * `<Suspense>` boundaries that fetch on each render anyway, so
 * cached shell + fresh streams gives us "instant first paint, fresh
 * data."
 */
export const revalidate = 60;

export default async function NFTDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Critical path — only `getNFTInfo` (~50-200ms, cached). Offers and
  // history stream in via Suspense below so the page shell + image
  // render immediately. Pre-streaming this awaited up to 10 pages of
  // buy + sell offers (500/page) which gated TTFB by 1-3s+ on
  // popular NFTs. See NFTOffersLoader for the offer-paginate path.
  let nft: NFTInfo | null = null;
  let error: string | null = null;

  if (!/^[A-Fa-f0-9]{64}$/.test(id)) {
    error = "Invalid NFT ID format";
  } else {
    try {
      nft = await xrplClient.getNFTInfo(id);
    } catch {
      // nft_info is Clio-only — fall back to parsing the NFTokenID so
      // the page still renders for non-Clio servers. Static fields
      // (issuer/taxon/serial/transfer-fee/flags) all decode from the
      // ID; owner + uri stay null and the offer/history streams below
      // handle the gap gracefully.
      const parsed = parseNFTokenID(id);
      if (parsed) {
        nft = {
          nft_id: id,
          owner: "",
          is_burned: false,
          flags: parsed.flags,
          transfer_fee: parsed.transfer_fee,
          issuer: parsed.issuer,
          nft_taxon: parsed.nft_taxon,
          nft_serial: parsed.nft_serial,
          uri: null,
        };
      } else {
        error = "Invalid NFTokenID format";
      }
    }
  }

  if (error || !nft) {
    return (
      <div className="min-h-screen">
        <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
          <div
            role="alert"
            className="rounded-2xl bg-surface p-8 text-center shadow-card"
          >
            <p className="font-mono text-cell text-error">
              {error ?? "NFT not found"}
            </p>
            <p className="mt-2 font-mono text-body text-muted break-all">
              NFTokenID: {id}
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Mobile mini pill — desktop hero is hidden on small viewports. */}
      <NFTMiniHeader nft={nft} />
      <div className="hidden lg:block">
        <NFTDetailHero nft={nft} />
      </div>
      {/* Screen-reader heading so SEO + a11y don't rely on the hidden hero. */}
      <h1 className="sr-only">NFT #{nft.nft_serial}</h1>
      <main id="main-content" className="mx-auto max-w-container space-y-6 px-4 py-4 sm:px-6 sm:py-8">
        {nft.is_burned && (
          <Suspense fallback={null}>
            <NFTBurnBanner nftId={id} />
          </Suspense>
        )}

        {/* Mobile: image stacked above three collapsible cards (image
             first so users see the NFT before the on-chain grid).
             Desktop (lg+): two-column grid — left col is image +
             description (image is the hero, description sits under
             it because it's the narrative companion to the image);
             right col is Details + Properties (on-chain identity +
             traits). Desktop cards pass `lockOpen` so they render
             without a toggle button or chevron. Image column is
             capped at ~560px so cards have enough room on the right
             at every desktop width down to lg (1024px).
             Grid items stretch (default `align-items`) so the left
             column matches the right column's height. The image
             inside the left col uses `fillHeight` to grow into the
             remaining vertical space after the description card. */}
        <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,560px)_1fr] lg:gap-6 lg:space-y-0">
          {/* Left column: image (always) + description (desktop
               only, locked open). On mobile, description renders
               from the mobile cards stack below so it sits next to
               Details + Properties as a collapsible group. On
               desktop, flex-col with the image as flex-1 lets the
               image grow to fill remaining vertical space after the
               description's natural height. */}
          <div className="space-y-6 lg:flex lg:flex-col lg:gap-6 lg:space-y-0">
            <div className="mx-auto w-full max-w-2xl lg:mx-0 lg:max-w-none lg:min-h-0 lg:flex-1">
              <NFTImageCard uri={nft.uri} fillHeight />
            </div>
            {/* `empty:hidden` so when the description card returns
                 null (no name + no description in metadata) the
                 wrapper falls out of the flex layout — otherwise it
                 sits there as a 0-height block with a `gap-6` before
                 it, leaving a phantom 24px below the image. */}
            <div className="hidden empty:hidden lg:block">
              <NFTDescriptionCard uri={nft.uri} lockOpen />
            </div>
          </div>

          {/* Mobile-only: collapsible stack (description on top, then
               on-chain details, then traits). */}
          <div className="space-y-6 lg:hidden">
            <NFTDescriptionCard uri={nft.uri} />
            <NFTDetailsBar nft={nft} />
            <NFTPropertiesCard uri={nft.uri} nftId={id} />
          </div>

          {/* Desktop-only right column: details + properties, locked
               open. */}
          <div className="hidden space-y-6 lg:block">
            <NFTDetailsBar nft={nft} lockOpen />
            <NFTPropertiesCard uri={nft.uri} nftId={id} lockOpen />
          </div>
        </div>

        <Suspense fallback={<OffersSkeleton />}>
          <NFTOffersLoader nftId={id} />
        </Suspense>

        <Suspense
          fallback={
            <div role="status" aria-label="Loading transaction history">
              <Skeleton className="h-[300px] rounded-2xl" />
            </div>
          }
        >
          <NFTHistoryLoader nftId={id} />
        </Suspense>
      </main>
    </div>
  );
}

/** Two-card placeholder matching the offer-table grid shape so the
 *  layout doesn't shift when offers stream in. */
function OffersSkeleton() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2"
      role="status"
      aria-label="Loading NFT offers"
    >
      <Skeleton className="h-[200px] rounded-2xl" />
      <Skeleton className="h-[200px] rounded-2xl" />
    </div>
  );
}
