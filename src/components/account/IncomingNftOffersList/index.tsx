"use client";

import Link from "next/link";
import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import { decodeCurrency, truncate, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import type { NFTOffer } from "@/types/nft";

const thClass =
  "px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

export interface IncomingNftOffer {
  /** NFTokenID the offer targets — used for the row's link to the NFT detail page. */
  nftId: string;
  offer: NFTOffer;
}

/**
 * IncomingNftOffersList — buy offers other accounts have placed on
 * this account's NFTs. Rendered inside OffersTab → Incoming.
 *
 * Mobile-first per the rule in CLAUDE.md:
 *   - Mobile (<sm): two columns. NFT id (with offerer stacked below as
 *     text-tag muted), and Amount right-aligned (with expiration stacked
 *     below).
 *   - Desktop (sm+): four columns — NFT | Offerer | Amount | Expires.
 */
export default function IncomingNftOffersList({
  offers,
}: {
  offers: IncomingNftOffer[];
}) {
  const { visible, hasMore, loadMore, showAll } = usePagination(
    offers.length,
    15,
  );
  const pageOffers = offers.slice(0, visible);

  if (offers.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-body text-muted">
          No NFT buy offers received
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <table className="w-full table-fixed">
          <colgroup>
            {/* NFT id — primary identifier, takes remaining width */}
            <col className="w-auto" />
            {/* Mobile: Amount + Expires stacked. Desktop: Offerer */}
            <col className="w-[42%] sm:w-[24%]" />
            {/* Amount — sm+ only */}
            <col className="hidden sm:table-column sm:w-[22%]" />
            {/* Expires — sm+ only */}
            <col className="hidden sm:table-column sm:w-[18%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-elevated">
              <th scope="col" className={`${thClass} text-left`}>
                NFT
              </th>
              <th
                scope="col"
                className={`${thClass} text-right sm:text-left`}
              >
                <span className="sm:hidden">Bid</span>
                <span className="hidden sm:inline">Offerer</span>
              </th>
              <th
                scope="col"
                className={`${thClass} hidden text-right sm:table-cell`}
              >
                Amount
              </th>
              <th
                scope="col"
                className={`${thClass} hidden text-right sm:table-cell`}
              >
                Expires
              </th>
            </tr>
          </thead>
          <tbody>
            {pageOffers.map(({ nftId, offer }, i) => {
              const expiry = formatExpiry(offer.expiration);
              return (
                <tr
                  key={`${offer.nft_offer_index}-${i}`}
                  className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
                >
                  {/* NFT (with mobile-only offerer beneath) */}
                  <td className="px-4 py-row">
                    <Link
                      href={`/nft/${nftId}`}
                      className="font-mono text-cell font-medium text-brand transition-colors hover:text-brand-light"
                    >
                      {truncate(nftId, 6)}
                    </Link>
                    <span className="mt-0.5 block sm:hidden">
                      <AddressLink address={offer.owner} chars={5} />
                    </span>
                  </td>
                  {/* Mobile: Amount + Expires stacked. Desktop: Offerer */}
                  <td className="px-4 py-row text-right sm:text-left">
                    <span className="block sm:hidden">
                      <OfferAmount amount={offer.amount} />
                    </span>
                    <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                      {expiry}
                    </span>
                    <span className="hidden sm:inline">
                      <AddressLink address={offer.owner} chars={5} />
                    </span>
                  </td>
                  {/* Amount — sm+ only */}
                  <td className="hidden px-4 py-row text-right sm:table-cell">
                    <OfferAmount amount={offer.amount} />
                  </td>
                  {/* Expires — sm+ only */}
                  <td className="hidden px-4 py-row text-right font-mono text-cell text-muted sm:table-cell">
                    {expiry}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore && (
          <LoadMoreFooter
            visible={visible}
            total={offers.length}
            onLoadMore={loadMore}
            onShowAll={showAll}
            label="offers"
          />
        )}
      </div>
    </div>
  );
}

function OfferAmount({ amount }: { amount: NFTOffer["amount"] }) {
  if (typeof amount === "string") {
    return <AmountDisplay drops={amount} />;
  }
  return (
    <span className="font-mono text-cell tabular-nums">
      {parseFloat(amount.value).toLocaleString(undefined, {
        maximumFractionDigits: 6,
      })}{" "}
      {decodeCurrency(amount.currency)}
    </span>
  );
}

function formatExpiry(expiration: number | undefined): string {
  if (!expiration) return "—";
  const unixMs = (expiration + XRPL_EPOCH) * 1000;
  if (unixMs < Date.now()) return "Expired";
  const date = new Date(unixMs);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
