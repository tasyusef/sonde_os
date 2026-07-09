"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { OrderbookEntry, DepthLevel } from "@/types/token";
import Toggle from "@/components/shared/Toggle";
import Skeleton from "@/components/shared/Skeleton";
import { truncate } from "@/lib/xrpl-helpers";

// DepthChart pulls recharts. Lazy-loaded so the orderbook tab's
// initial paint doesn't gate on the chart bundle.
const DepthChart = dynamic(
  () => import("@/components/tokens/DepthChart"),
  { ssr: false, loading: () => <Skeleton className="h-[300px] rounded-2xl" /> },
);

interface OrderbookProps {
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  bidDepth: DepthLevel[];
  askDepth: DepthLevel[];
  currencyDisplay: string;
}

function formatOrderPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(4);
}

function formatOrderAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ */
/*  Mobile section — simpler flat layout for < lg viewports            */
/*                                                                      */
/*  Exchange-style book: asks reversed so lowest price meets the spread */
/*  at the bottom; bids normal so best bid is at the top meeting the    */
/*  spread from below.                                                  */
/* ------------------------------------------------------------------ */

function MobileOrderSection({
  side,
  entries,
  maxTotal,
  currencyDisplay,
}: {
  side: "bid" | "ask";
  entries: OrderbookEntry[];
  maxTotal: number;
  currencyDisplay: string;
}) {
  const priceColor = side === "bid" ? "text-success" : "text-error";
  const barColor =
    side === "bid" ? "var(--color-success)" : "var(--color-error)";

  if (entries.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center">
        <p className="font-mono text-label text-muted">
          No {side === "bid" ? "buy" : "sell"} orders
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Column header — sticky under any scroll so alignment stays clear */}
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-1 border-b border-elevated px-3 py-1.5 font-display text-label font-medium uppercase tracking-header text-muted">
        <span className="text-left">Price (XRP)</span>
        <span className="text-right">Amount ({currencyDisplay})</span>
        <span className="text-right">Total (XRP)</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {entries.slice(0, 25).map((entry, i) => {
          const fill = maxTotal > 0 ? (entry.xrpTotal / maxTotal) * 100 : 0;
          return (
            <div
              key={`${side}-${i}`}
              className="relative grid grid-cols-[1fr_1fr_1fr] gap-1 border-b border-elevated px-3 py-1.5 last:border-b-0"
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.08]"
                style={{ background: barColor, width: `${fill}%` }}
                aria-hidden="true"
              />
              <span className={`relative font-mono text-cell font-medium tabular-nums ${priceColor}`}>
                {formatOrderPrice(entry.price)}
              </span>
              <span className="relative text-right font-mono text-cell text-primary tabular-nums">
                {formatOrderAmount(entry.amount)}
              </span>
              <span className="relative text-right font-mono text-cell text-secondary tabular-nums">
                {formatOrderAmount(entry.xrpTotal)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrderTable({
  entries,
  side,
  maxTotal,
  currencyDisplay,
}: {
  entries: OrderbookEntry[];
  side: "bid" | "ask";
  maxTotal: number;
  currencyDisplay: string;
}) {
  const colorClass = side === "bid" ? "text-success" : "text-error";
  const barColor =
    side === "bid" ? "var(--color-success)" : "var(--color-error)";
  const align = side === "bid" ? "text-right" : "text-left";

  if (entries.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="font-mono text-body text-muted">
          No {side === "bid" ? "buy" : "sell"} orders
        </p>
      </div>
    );
  }

  const isBid = side === "bid";
  const thBase = `px-3 py-2 ${align} font-display text-label font-medium uppercase tracking-header text-muted`;
  const thHidden = `hidden px-3 py-2 ${align} font-display text-label font-medium uppercase tracking-header text-muted md:table-cell`;

  const priceCol = (
    <th scope="col" className={thBase}>
      Price (XRP)
    </th>
  );
  const amountCol = (
    <th scope="col" className={thBase}>
      Amount ({currencyDisplay})
    </th>
  );
  const totalCol = (
    <th scope="col" className={thBase}>
      Total (XRP)
    </th>
  );
  const accountCol = (
    <th scope="col" className={thHidden}>
      Account
    </th>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-elevated">
              {isBid ? (
                <>
                  {accountCol}
                  {totalCol}
                  {amountCol}
                  {priceCol}
                </>
              ) : (
                <>
                  {priceCol}
                  {amountCol}
                  {totalCol}
                  {accountCol}
                </>
              )}
            </tr>
          </thead>
        </table>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
        <table className="w-full">
          <tbody>
            {entries.slice(0, 25).map((entry, i) => {
              const fill =
                maxTotal > 0 ? (entry.xrpTotal / maxTotal) * 100 : 0;

              const priceCell = (
                <td className={`relative px-3 py-2 ${align}`}>
                  <div
                    className="pointer-events-none absolute inset-0 opacity-[0.07]"
                    style={{
                      background: barColor,
                      width: `${fill}%`,
                      ...(isBid ? { right: 0, left: "auto" } : {}),
                    }}
                  />
                  <span
                    className={`relative font-mono text-cell font-medium tabular-nums ${colorClass}`}
                  >
                    {formatOrderPrice(entry.price)}
                  </span>
                </td>
              );
              const amountCell = (
                <td className={`px-3 py-2 ${align} font-mono text-cell text-primary tabular-nums`}>
                  {formatOrderAmount(entry.amount)}
                </td>
              );
              const totalCell = (
                <td className={`px-3 py-2 ${align} font-mono text-cell text-secondary tabular-nums`}>
                  {formatOrderAmount(entry.xrpTotal)}
                </td>
              );
              const accountCell = (
                <td className={`hidden px-3 py-2 ${align} font-mono text-cell text-muted md:table-cell`}>
                  {truncate(entry.account)}
                </td>
              );

              return (
                <tr
                  key={`${side}-${i}`}
                  className="relative border-b border-elevated last:border-b-0"
                >
                  {isBid ? (
                    <>
                      {accountCell}
                      {totalCell}
                      {amountCell}
                      {priceCell}
                    </>
                  ) : (
                    <>
                      {priceCell}
                      {amountCell}
                      {totalCell}
                      {accountCell}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Orderbook({
  bids,
  asks,
  bidDepth,
  askDepth,
  currencyDisplay,
}: OrderbookProps) {
  const [view, setView] = useState<"table" | "depth">("table");
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const tableRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setContentHeight(node.offsetHeight);
  }, []);

  const maxBidTotal = bids.length > 0 ? bids[bids.length - 1].xrpTotal : 0;
  const maxAskTotal = asks.length > 0 ? asks[asks.length - 1].xrpTotal : 0;
  const maxTotal = Math.max(maxBidTotal, maxAskTotal);

  const spread =
    bids.length > 0 && asks.length > 0
      ? asks[0].price - bids[0].price
      : null;

  const viewOptions: { value: "table" | "depth"; label: string }[] = [
    { value: "table", label: "Table" },
    { value: "depth", label: "Depth" },
  ];

  return (
    <div className="flex max-h-[700px] flex-col overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="flex flex-col items-start gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Orderbook
        </span>
        <Toggle options={viewOptions} active={view} onChange={setView} />
      </div>

      {spread != null && (
        <div className="hidden border-b border-elevated px-4 py-2 lg:block">
          <span className="font-mono text-label text-muted">Spread: </span>
          <span className="font-mono text-cell font-medium text-primary">
            {formatOrderPrice(spread)} XRP
          </span>
        </div>
      )}

      {view === "table" ? (
        <div ref={tableRef} className="flex min-h-0 flex-1 flex-col">
          {/* Mobile / tablet: exchange-style single column — asks on top
               (highest price first, meeting the spread at the bottom),
               spread row in the middle, bids below (best bid at the top
               just under the spread, descending). */}
          <div className="flex min-h-0 flex-1 flex-col lg:hidden">
            <MobileOrderSection
              side="ask"
              entries={[...asks].reverse()}
              maxTotal={maxTotal}
              currencyDisplay={currencyDisplay}
            />
            {spread != null && (
              <div className="border-y border-elevated bg-elevated/40 px-4 py-2 text-center">
                <span className="font-mono text-label text-muted">Spread </span>
                <span className="font-mono text-cell font-medium text-primary tabular-nums">
                  {formatOrderPrice(spread)} XRP
                </span>
              </div>
            )}
            <MobileOrderSection
              side="bid"
              entries={bids}
              maxTotal={maxTotal}
              currencyDisplay={currencyDisplay}
            />
          </div>

          {/* Desktop (lg+): classic two-column book with bids | asks. */}
          <div className="hidden min-h-0 flex-1 gap-0 lg:grid lg:grid-cols-2 lg:divide-x lg:divide-elevated">
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-elevated px-4 py-2 text-right">
                <span className="font-display text-label font-medium uppercase tracking-header text-success">
                  Bids
                </span>
              </div>
              <OrderTable
                entries={bids}
                side="bid"
                maxTotal={maxTotal}
                currencyDisplay={currencyDisplay}
              />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-elevated px-4 py-2">
                <span className="font-display text-label font-medium uppercase tracking-header text-error">
                  Asks
                </span>
              </div>
              <OrderTable
                entries={asks}
                side="ask"
                maxTotal={maxTotal}
                currencyDisplay={currencyDisplay}
              />
            </div>
          </div>
        </div>
      ) : (
        <div
          className="p-4"
          style={{ height: contentHeight }}
        >
          <DepthChart bids={bidDepth} asks={askDepth} />
        </div>
      )}
    </div>
  );
}

export { Orderbook };
