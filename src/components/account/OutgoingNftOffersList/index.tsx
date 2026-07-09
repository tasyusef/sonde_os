"use client";

import Link from "next/link";
import AddressLink from "@/components/shared/AddressLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import { decodeCurrency, truncate, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";

const thClass =
  "px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

/** lsfSellNFToken — set on NFTokenOffer entries that are sell offers
 *  (offer to sell an NFT the creator already owns). When unset, the
 *  entry is a buy offer on someone else's NFT. */
const LSF_SELL_NFTOKEN = 0x00000001;

export interface OutgoingNftOffer {
  /** Ledger entry index — unique key for the row. */
  index: string;
  /** Tagged NFT — `/nft/{NFTokenID}` link target. */
  NFTokenID: string;
  /** XRP drops as a string, or IOU amount. */
  Amount: string | { value: string; currency: string; issuer: string };
  /** Optional restricted destination. When present, only this account
   *  can accept the offer. */
  Destination?: string;
  /** XRPL `Expiration` — seconds since the XRPL epoch. */
  Expiration?: number;
  /** Bit-flags. `lsfSellNFToken` distinguishes sell from buy. */
  Flags: number;
}

/**
 * OutgoingNftOffersList — NFT offers this account has created.
 *
 *   - Sell offers: the account is offering one of its own NFTs for sale.
 *   - Buy offers: the account has placed a bid on another holder's NFT.
 *
 * Rendered inside OffersTab → Outgoing as the section beneath DEX
 * offers. Mobile-first per the rule in CLAUDE.md.
 *
 *   Mobile (<sm): two columns. NFT id (with type badge inline + optional
 *   destination/expiration stacked beneath as text-tag muted), and
 *   Amount right-aligned.
 *
 *   Desktop (sm+): four columns — NFT | Type | Amount | Expires.
 *
 * Source: `account_objects` filtered to `LedgerEntryType = "NFTokenOffer"`.
 * Already cached via `useAccountObjects`, so the section costs zero
 * extra WS calls.
 */
export default function OutgoingNftOffersList({
  offers,
}: {
  offers: OutgoingNftOffer[];
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
          No outgoing NFT offers
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
            {/* Mobile: Amount + expires stacked. Desktop: Type column */}
            <col className="w-[40%] sm:w-[14%]" />
            {/* Amount — sm+ only */}
            <col className="hidden sm:table-column sm:w-[24%]" />
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
                <span className="sm:hidden">Amount</span>
                <span className="hidden sm:inline">Type</span>
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
            {pageOffers.map((offer) => {
              const isSell = (offer.Flags & LSF_SELL_NFTOKEN) !== 0;
              const expiry = formatExpiry(offer.Expiration);
              return (
                <tr
                  key={offer.index}
                  className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
                >
                  {/* NFT — with mobile-only type badge + destination */}
                  <td className="px-4 py-row">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/nft/${offer.NFTokenID}`}
                        className="font-mono text-cell font-medium text-brand transition-colors hover:text-brand-light"
                      >
                        {truncate(offer.NFTokenID, 6)}
                      </Link>
                      <span className="sm:hidden">
                        <TypeBadge isSell={isSell} />
                      </span>
                    </div>
                    {offer.Destination && (
                      <span className="mt-0.5 block font-mono text-tag text-muted">
                        to <AddressLink address={offer.Destination} chars={5} />
                      </span>
                    )}
                  </td>
                  {/* Mobile: amount + expires stacked. Desktop: Type */}
                  <td className="px-4 py-row text-right sm:text-left">
                    <span className="block sm:hidden">
                      <NftOfferAmount amount={offer.Amount} />
                    </span>
                    <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                      {expiry}
                    </span>
                    <span className="hidden sm:inline">
                      <TypeBadge isSell={isSell} />
                    </span>
                  </td>
                  <td className="hidden px-4 py-row text-right sm:table-cell">
                    <NftOfferAmount amount={offer.Amount} />
                  </td>
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

function TypeBadge({ isSell }: { isSell: boolean }) {
  return (
    <span
      className={`inline-block rounded-tag px-1.5 py-0.5 font-mono text-micro font-semibold uppercase tracking-pill ${
        isSell
          ? "bg-error/10 text-error"
          : "bg-success/10 text-success"
      }`}
    >
      {isSell ? "Sell" : "Buy"}
    </span>
  );
}

function NftOfferAmount({ amount }: { amount: OutgoingNftOffer["Amount"] }) {
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
