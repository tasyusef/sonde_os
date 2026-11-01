import { dropsToXrp, decodeCurrency, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import ListNotice from "@/components/shared/ListNotice";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";

export interface Offer {
  flags: number;
  taker_pays: string | { value: string; currency: string; issuer: string };
  taker_gets: string | { value: string; currency: string; issuer: string };
  seq: number;
  quality?: string;
  expiration?: number;
}

function getAmountValue(amt: string | { value: string; currency: string; issuer: string }): number {
  if (typeof amt === "string") return parseFloat(dropsToXrp(amt));
  return parseFloat(amt.value);
}

function getCurrency(amt: string | { value: string; currency: string; issuer: string }): string {
  if (typeof amt === "string") return "XRP";
  return decodeCurrency(amt.currency);
}

function formatAmount(amt: string | { value: string; currency: string; issuer: string }): string {
  if (typeof amt === "string") return `${dropsToXrp(amt)} XRP`;
  return `${parseFloat(amt.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${decodeCurrency(amt.currency)}`;
}

function formatExpiration(expiration: number): { text: string; expired: boolean } {
  const unixMs = (expiration + XRPL_EPOCH) * 1000;
  const expired = unixMs < Date.now();
  const date = new Date(unixMs);
  const text = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { text, expired };
}

/**
 * The account's open DEX offers. Mobile-first, same pattern as
 * `EscrowList`:
 *
 *   Mobile (<sm): Type (+ seq, expiry) | Taker Pays (+ gets, rate)
 *   sm:           Seq | Type (+ expiry) | Taker Pays | Taker Gets (+ rate)
 *   lg+:          Seq | Type | Taker Pays | Taker Gets | Rate | Expiration
 *
 * Expiration only appears when some offer has one.
 */
export default function OfferList({ offers }: { offers: Offer[] }) {
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(offers.length, 15);
  const pageOffers = offers.slice(0, visible);

  if (offers.length === 0) {
    return <ListNotice message="No open offers." />;
  }

  const hasExpiration = offers.some((o) => o.expiration != null);

  return (
    <>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="hidden sm:table-column sm:w-20" />
          <col className="w-auto" />
          <col className="w-[60%] sm:w-[27%] lg:w-[19%]" />
          <col className="hidden sm:table-column sm:w-[27%] lg:w-[19%]" />
          <col className="hidden lg:table-column lg:w-[19%]" />
          {hasExpiration && <col className="hidden lg:table-column lg:w-[19%]" />}
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Seq
            </th>
            <th scope="col" className={`${thClass} text-left max-sm:pl-0`}>
              Type
            </th>
            <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
              <span className="sm:hidden">Pays / Gets</span>
              <span className="hidden sm:inline">Taker Pays</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-right max-lg:pr-0 sm:table-cell`}>
              Taker Gets
            </th>
            <th scope="col" className={`${thClass} hidden text-right lg:table-cell`}>
              Rate
            </th>
            {hasExpiration && (
              <th scope="col" className={`${thClass} hidden text-right lg:table-cell`}>
                Expiration
              </th>
            )}
          </tr>
        </thead>
        <tbody ref={listRef}>
          {pageOffers.map((offer, i) => {
            const isSell = (offer.flags & 0x00020000) !== 0;

            // Compute readable exchange rate: "X PaysUnit per GetsUnit"
            const paysValue = getAmountValue(offer.taker_pays);
            const getsValue = getAmountValue(offer.taker_gets);
            const paysCurrency = getCurrency(offer.taker_pays);
            const getsCurrency = getCurrency(offer.taker_gets);
            const rate = getsValue > 0 ? paysValue / getsValue : 0;
            const rateDisplay = rate > 0
              ? `${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${paysCurrency}/${getsCurrency}`
              : "—";

            const expiry = offer.expiration != null
              ? formatExpiration(offer.expiration)
              : null;

            return (
              <tr
                key={offer.seq ? `${offer.seq}-${i}` : i}
                className="border-b border-line last:border-b-0 hover:bg-row-hover"
              >
                <td className={`${cell} hidden align-top font-mono text-cell text-muted tabular-nums sm:table-cell`}>
                  {offer.seq}
                </td>
                <td className={`${cell} align-top max-sm:pl-0`}>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 font-mono text-label font-semibold uppercase ${
                      isSell ? "tag-error" : "tag-success"
                    }`}
                  >
                    {isSell ? "Sell" : "Buy"}
                  </span>
                  {/* Mobile-only Seq; its own column from sm. */}
                  <span className="mt-0.5 block font-mono text-tag tabular-nums text-muted sm:hidden">
                    Seq {offer.seq}
                  </span>
                  {/* Expiration folds here until its own column appears at lg. */}
                  {expiry && (
                    <span className="mt-0.5 block font-mono text-tag tabular-nums lg:hidden">
                      <Expiry expiry={expiry} />
                    </span>
                  )}
                </td>
                <td className={`${cell} break-words text-right align-top font-mono text-cell text-primary tabular-nums max-sm:pr-0`}>
                  {formatAmount(offer.taker_pays)}
                  {/* Mobile-only Taker Gets and Rate; their own columns from sm / lg. */}
                  <span className="mt-0.5 block text-tag text-muted sm:hidden">
                    <span className="sr-only">Taker gets </span>
                    {formatAmount(offer.taker_gets)}
                  </span>
                  <span className="mt-0.5 block text-tag text-muted sm:hidden">
                    <span className="sr-only">Rate </span>
                    {rateDisplay}
                  </span>
                </td>
                <td className={`${cell} hidden break-words text-right align-top font-mono text-cell text-primary tabular-nums max-lg:pr-0 sm:table-cell`}>
                  {formatAmount(offer.taker_gets)}
                  {/* Rate folds here from sm until its own column appears at lg. */}
                  <span className="mt-0.5 block text-tag text-muted lg:hidden">
                    <span className="sr-only">Rate </span>
                    {rateDisplay}
                  </span>
                </td>
                <td className={`${cell} hidden break-words text-right align-top font-mono text-cell text-primary tabular-nums lg:table-cell`}>
                  {rateDisplay}
                </td>
                {hasExpiration && (
                  <td className={`${cell} hidden text-right align-top font-mono text-cell tabular-nums lg:table-cell`}>
                    {expiry ? <Expiry expiry={expiry} /> : <span className="text-muted">—</span>}
                  </td>
                )}
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

function Expiry({ expiry }: { expiry: { text: string; expired: boolean } }) {
  return (
    <span className={expiry.expired ? "text-error" : "text-muted"}>
      {expiry.text}
      {expiry.expired && (
        <span className="ml-1.5 rounded-tag tag-error px-1 py-0.5 text-tag font-medium uppercase">
          Expired
        </span>
      )}
    </span>
  );
}
