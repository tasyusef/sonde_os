"use client";

import { dropsToXrp, decodeCurrency, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";

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

export default function OfferList({ offers }: { offers: Offer[] }) {
  const { visible, hasMore, loadMore, showAll } = usePagination(offers.length, 15);
  const pageOffers = offers.slice(0, visible);

  if (offers.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">No open offers</p>
      </div>
    );
  }

  const hasExpiration = offers.some((o) => o.expiration != null);

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-elevated">
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Seq
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Type
              </th>
              <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                Taker Pays
              </th>
              <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                Taker Gets
              </th>
              <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                Rate
              </th>
              {hasExpiration && (
                <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                  Expiration
                </th>
              )}
            </tr>
          </thead>
          <tbody>
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
                  className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
                >
                  <td className="px-4 py-row font-mono text-cell text-muted tabular-nums">
                    {offer.seq}
                  </td>
                  <td className="px-4 py-row">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 font-mono text-label font-semibold uppercase ${
                        isSell ? "bg-error/8 text-error" : "bg-success/8 text-success"
                      }`}
                    >
                      {isSell ? "Sell" : "Buy"}
                    </span>
                  </td>
                  <td className="px-4 py-row text-right font-mono text-cell text-primary tabular-nums">
                    {formatAmount(offer.taker_pays)}
                  </td>
                  <td className="px-4 py-row text-right font-mono text-cell text-primary tabular-nums">
                    {formatAmount(offer.taker_gets)}
                  </td>
                  <td className="px-4 py-row text-right font-mono text-cell text-secondary tabular-nums">
                    {rateDisplay}
                  </td>
                  {hasExpiration && (
                    <td className="px-4 py-row text-right font-mono text-cell tabular-nums">
                      {expiry ? (
                        <span className={expiry.expired ? "text-error" : "text-muted"}>
                          {expiry.text}
                          {expiry.expired && (
                            <span className="ml-1.5 rounded-tag bg-error/10 px-1 py-0.5 text-tag font-medium uppercase text-error">
                              Expired
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  );
}
