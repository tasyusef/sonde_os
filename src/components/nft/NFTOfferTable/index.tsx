import { type NFTOffer } from "@/types/nft";
import { dropsToXrp, truncateHash, decodeCurrency } from "@/lib/xrpl-helpers";
import AddressLink from "@/components/shared/AddressLink";

function formatOfferAmount(amount: NFTOffer["amount"]): string {
  if (typeof amount === "string") {
    return `${dropsToXrp(amount)} XRP`;
  }
  return `${parseFloat(amount.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${decodeCurrency(amount.currency)}`;
}

const thClass =
  "px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

/**
 * Offer table for the NFT detail page. Mobile-first per CLAUDE.md
 * design rule: `table-fixed` + `<colgroup>` so column widths are
 * predictable, and the desktop-only Destination column collapses
 * inline under Owner on mobile (vs. just disappearing). Same pattern
 * as `HoldingsList` and `ActivationsList`.
 *
 * Pre-redesign the table was wrapped in `overflow-x-auto`, which
 * meant long offer IDs / addresses pushed the table past viewport
 * width and the user got a horizontal scroll — exactly the
 * "Don't ship a 4+-column table that just overflows on phones"
 * anti-pattern the design rule prohibits.
 */
export default function NFTOfferTable({
  offers,
  type,
}: {
  offers: NFTOffer[];
  type: "buy" | "sell";
}) {
  const title = type === "buy" ? "Buy Offers" : "Sell Offers";

  // No active offers → render nothing. The empty-state placeholder
  // is just visual noise — most NFTs have no active offer on either
  // side at any given time, so showing two empty "No buy offers" /
  // "No sell offers" cards by default added a card-row's worth of
  // dead space to every detail page.
  if (offers.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          {title}
          <span className="ml-2 text-muted">{offers.length}</span>
        </span>
      </div>
      <table className="w-full table-fixed">
        <colgroup>
          {/* Offer ID is compact-truncated, Owner takes the flex
               space + carries the mobile-folded Destination below
               the address, Amount is right-aligned and fixed-width.
               Destination is its own column on md+ only. */}
          <col className="w-[24%] sm:w-[18%]" />
          <col className="w-auto" />
          <col className="w-[28%] sm:w-[22%]" />
          <col className="hidden md:table-column md:w-[22%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className={`${thClass} text-left`}>
              Offer ID
            </th>
            <th scope="col" className={`${thClass} text-left`}>
              Owner
            </th>
            <th scope="col" className={`${thClass} text-right`}>
              Amount
            </th>
            <th
              scope="col"
              className={`${thClass} hidden text-left md:table-cell`}
            >
              Destination
            </th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr
              key={offer.nft_offer_index}
              className="border-b border-elevated transition-colors last:border-b-0 hover:bg-row-hover"
            >
              <td className="px-4 py-row font-mono text-cell text-muted">
                {truncateHash(offer.nft_offer_index, 6)}
              </td>
              <td className="px-4 py-row">
                <AddressLink address={offer.owner} />
                {/* Mobile-only inline Destination — under md the
                    Destination column is hidden, so we surface its
                    content as a secondary line on the Owner cell
                    rather than dropping the data entirely. */}
                {offer.destination && (
                  <span className="mt-0.5 block font-mono text-tag text-muted md:hidden">
                    → <AddressLink address={offer.destination} />
                  </span>
                )}
              </td>
              <td className="px-4 py-row text-right font-mono text-cell tabular-nums text-primary">
                {formatOfferAmount(offer.amount)}
              </td>
              <td className="hidden px-4 py-row md:table-cell">
                {offer.destination ? (
                  <AddressLink address={offer.destination} />
                ) : (
                  <span className="font-mono text-cell text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
