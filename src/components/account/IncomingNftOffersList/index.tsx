import { Link } from "react-router";
import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import { decodeCurrency, truncate, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";
import type { NFTOffer } from "@/types/nft";

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
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(
    offers.length,
    15,
  );
  const pageOffers = offers.slice(0, visible);

  if (offers.length === 0) {
    return <ListNotice message="No NFT buy offers received." />;
  }

  return (
    <>
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
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              NFT
            </th>
            <th
              scope="col"
              className={`${thClass} text-right max-sm:pr-0 sm:text-left`}
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
        <tbody ref={listRef}>
          {pageOffers.map(({ nftId, offer }, i) => {
            const expiry = formatExpiry(offer.expiration);
            return (
              <tr
                key={`${offer.nft_offer_index}-${i}`}
                className="border-b border-line last:border-b-0 hover:bg-row-hover"
              >
                {/* NFT (with mobile-only offerer beneath) */}
                <td className={cell}>
                  <Link
                    to={`/nft/${nftId}`}
                    className="font-mono text-cell font-medium link text-primary"
                  >
                    {truncate(nftId, 6)}
                  </Link>
                  <span className="mt-0.5 block sm:hidden">
                    <AddressLink address={offer.owner} chars={5} />
                  </span>
                </td>
                {/* Mobile: Amount + Expires stacked. Desktop: Offerer */}
                <td className={`${cell} text-right max-sm:pr-0 sm:text-left`}>
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
                <td className={`${cell} hidden text-right sm:table-cell`}>
                  <OfferAmount amount={offer.amount} />
                </td>
                {/* Expires — sm+ only */}
                <td className={`${cell} hidden text-right font-mono text-cell text-muted sm:table-cell`}>
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
    </>
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
