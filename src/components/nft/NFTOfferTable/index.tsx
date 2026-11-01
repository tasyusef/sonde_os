import { type NFTOffer } from "@/types/nft";
import { dropsToXrp, truncateHash, decodeCurrency } from "@/lib/xrpl-helpers";
import AddressLink from "@/components/shared/AddressLink";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import Section from "@/components/shared/Section";
import { cell, thClass } from "@/lib/table";

function formatOfferAmount(amount: NFTOffer["amount"]): string {
  if (typeof amount === "string") {
    return `${dropsToXrp(amount)} XRP`;
  }
  return `${parseFloat(amount.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${decodeCurrency(amount.currency)}`;
}

/**
 * Every open offer on the NFT in one full-width table, sells first, so
 * a single offer on one side never sits alone in half the page.
 * Mobile-first per CLAUDE.md design rule: `table-fixed` + `<colgroup>`
 * for predictable widths. Pattern matches `NFTHistoryTable`:
 *
 *   Mobile (<sm): Side (+ Owner → Destination) | Amount (+ Offer ID)
 *   sm+:          Side | Owner (+ → Destination) | Amount | Offer ID
 *
 * Destination is set on few offers, so it folds under Owner instead of
 * holding a mostly-empty column. Shows 15 rows, then Load More.
 */
export default function NFTOfferTable({
  sell,
  buy,
  note,
  className,
}: {
  sell: NFTOffer[];
  buy: NFTOffer[];
  /** A caveat under the table, e.g. that a side was cut off. */
  note?: string | null;
  className?: string;
}) {
  const rows = [
    ...sell.map((offer) => ({ side: "Sell", offer })),
    ...buy.map((offer) => ({ side: "Buy", offer })),
  ];
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(rows.length);

  if (rows.length === 0) {
    return (
      <Section title="Offers" note={note} className={className}>
        <p className="font-mono text-cell text-muted">No open offers found.</p>
      </Section>
    );
  }

  return (
    <Section title="Offers" count={rows.length} note={note} className={className}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-auto sm:w-24" />
          <col className="hidden sm:table-column sm:w-auto" />
          <col className="w-[40%] sm:w-[24%]" />
          <col className="hidden sm:table-column sm:w-[24%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>
              Side
            </th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Owner
            </th>
            <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
              Amount
            </th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Offer ID
            </th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {rows.slice(0, visible).map(({ side, offer }) => (
            <tr
              key={offer.nft_offer_index}
              className="border-b border-line last:border-b-0 hover:bg-row-hover"
            >
              <td className={`${cell} align-top`}>
                <span className="font-display text-caps uppercase text-primary">{side}</span>
                {/* Mobile-only Owner; its own column from sm. */}
                <span className="mt-1 block sm:hidden">
                  <OfferParties offer={offer} />
                </span>
              </td>
              <td className={`${cell} hidden align-top sm:table-cell`}>
                <OfferParties offer={offer} />
              </td>
              <td className={`${cell} break-words text-right align-top font-mono text-cell tabular-nums text-primary max-sm:pr-0`}>
                {formatOfferAmount(offer.amount)}
                {/* Mobile-only Offer ID; its own column from sm. */}
                <span className="mt-0.5 block text-tag text-muted sm:hidden">
                  <span className="sr-only">Offer ID </span>
                  {truncateHash(offer.nft_offer_index)}
                </span>
              </td>
              <td className={`${cell} hidden align-top font-mono text-cell text-muted sm:table-cell`}>
                {truncateHash(offer.nft_offer_index)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <LoadMoreFooter
          visible={visible}
          total={rows.length}
          onLoadMore={loadMore}
          onShowAll={showAll}
          label="offers"
        />
      )}
    </Section>
  );
}

/** The offer's owner, and who it's reserved for when it has a destination. */
function OfferParties({ offer }: { offer: NFTOffer }) {
  return (
    <>
      <AddressLink address={offer.owner} />
      {offer.destination && (
        <span className="mt-0.5 block font-mono text-tag text-muted">
          <span aria-hidden="true">→ </span>
          <span className="sr-only">Destination </span>
          <AddressLink address={offer.destination} />
        </span>
      )}
    </>
  );
}

export { NFTOfferTable };
