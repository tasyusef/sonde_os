import { useMemo } from "react";
import { Link } from "react-router";
import { dropsToXrp, decodeCurrency } from "@/lib/xrpl-helpers";
import { formatVolume } from "@/lib/format";
import AddressLink from "@/components/shared/AddressLink";
import TokenIcon from "@/components/shared/TokenIcon";
import type { TrustLine } from "@/components/account/TrustLineList";
import { lpPositionXrpValue, positionAmounts } from "@/lib/amm-helpers";
import type { AMMPosition } from "@/types/amm";
import { LoadMoreFooter, usePagination } from "@/components/shared/Paginated";
import { cell, thClass } from "@/lib/table";
import { type TokenRef, tokenPath } from "@/lib/token-id";

interface HoldingRow {
  key: string;
  name: string;
  currency: string;
  icon: string | null;
  issuer: string | null;
  issuerName: string | null;
  /** The token page the name opens; issued tokens only. */
  token?: TokenRef;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
  /** When set, this row is an AMM LP position; the balance column
   *  renders the two underlying-asset amounts on separate lines (and
   *  the LP token quantity itself is not shown — it isn't user-
   *  meaningful on its own). */
  lpComposition?: { asset1Line: string; asset2Line: string };
}

export default function HoldingsList({
  address,
  xrpBalance,
  xrpPrice,
  trustLines,
  ammPositions,
}: {
  address: string;
  xrpBalance: string;
  xrpPrice: number;
  trustLines: TrustLine[];
  /** AMM positions held by this account. Surfaced as their own rows
   *  in this list so users see "Holdings" as their full balance sheet
   *  — previously LP positions were only visible under the Positions
   *  tab, which split holdings across two views and hid LP value from
   *  the primary balance summary. */
  ammPositions?: AMMPosition[];
}) {
  // Memoized — whale accounts have 100+ trustlines; the build+sort is
  // ~O(n log n) per render and the parent re-renders on every SWR
  // revalidation tick. Keying on the actual inputs prevents the work
  // from running unless one of them changes.
  const rows = useMemo(() => {
    const xrpAmount = parseFloat(dropsToXrp(xrpBalance));
    const xrpRow: HoldingRow = {
      key: "XRP",
      name: "XRP",
      currency: "XRP",
      icon: null,
      issuer: null,
      issuerName: null,
      balance: xrpAmount,
      priceUsd: xrpPrice,
      valueUsd: xrpAmount * xrpPrice,
    };

    const tokenRows: HoldingRow[] = [];
    for (const tl of trustLines) {
      const isHigh = tl.HighLimit.issuer === address;
      const issuer = isHigh ? tl.LowLimit.issuer : tl.HighLimit.issuer;
      const currency = tl.Balance.currency;
      const balance = parseFloat(tl.Balance.value);
      const displayBalance = isHigh ? -balance : balance;
      if (displayBalance <= 0) continue;

      // No token price feed: issued tokens show balance only.
      const decoded = decodeCurrency(currency);
      tokenRows.push({
        key: `${currency}:${issuer}`,
        name: decoded,
        currency: decoded,
        icon: null,
        issuer,
        issuerName: null,
        token: { kind: "iou", currency, issuer },
        balance: displayBalance,
        priceUsd: null,
        valueUsd: null,
      });
    }

    // AMM LP positions — each one becomes a row showing the account's
    // share of both pool assets. XRP-paired pools get a USD value from
    // their XRP side (see `lpPositionXrpValue`); token/token pools
    // have none.
    if (ammPositions && ammPositions.length > 0) {
      // Compact notation for LP-component amounts. Memecoins routinely
      // hit billions/trillions per LP share; the locale-formatted full
      // number ("9,930,405,678.8706") wraps multi-line on mobile and
      // crowds the Balance column. Compact notation collapses to a
      // tight "9.93B" and lets the row breathe.
      const compactFmt = new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 2,
      });
      const formatAssetAmount = (n: number, isXrp: boolean): string => {
        if (n >= 10_000) return compactFmt.format(n);
        // Smaller values render full so XRP / stablecoin amounts stay
        // readable without compaction noise.
        if (isXrp) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
        return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
      };
      for (const pos of ammPositions) {
        if (pos.lpTokenBalance <= 0) continue;
        const amounts = positionAmounts(pos);
        const valueXrp = lpPositionXrpValue(pos);
        const valueUsd =
          valueXrp != null && xrpPrice > 0 ? valueXrp * xrpPrice : null;
        tokenRows.push({
          key: `lp:${pos.ammAccount}`,
          name: `${pos.asset1Label} / ${pos.asset2Label}`,
          currency: "LP",
          icon: null,
          issuer: pos.ammAccount,
          // Show the user's LP token balance under the pair name. The
          // "LP" badge to the right of the pair already identifies this
          // as an AMM position; "AMM Pool" was redundant. The balance
          // gives an at-a-glance sense of position size.
          issuerName: `${formatAssetAmount(pos.lpTokenBalance, false)} LP`,
          balance: pos.lpTokenBalance,
          priceUsd: null,
          valueUsd,
          lpComposition: {
            asset1Line: `${formatAssetAmount(amounts.asset1, pos.asset1IsXrp)} ${pos.asset1Label}`,
            asset2Line: `${formatAssetAmount(amounts.asset2, pos.asset2IsXrp)} ${pos.asset2Label}`,
          },
        });
      }
    }

    tokenRows.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
    return [xrpRow, ...tokenRows];
  }, [address, xrpBalance, xrpPrice, trustLines, ammPositions]);
  const { visible, hasMore, loadMore, showAll, listRef } = usePagination(rows.length, 15);
  const pageRows = rows.slice(0, visible);

  return (
    <>
      <table className="w-full table-fixed">
        <colgroup>
          {/* Asset takes the rest, Balance is wide enough for compacted
              numbers + LP composition, Price + Value are sm+ only. */}
          <col className="w-auto" />
          <col className="w-[44%] sm:w-[28%]" />
          <col className="hidden sm:table-column sm:w-[18%]" />
          <col className="hidden sm:table-column sm:w-[18%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} text-left`}>Asset</th>
            {/* On mobile this column doubles for Balance + USD Value
                stacked, so the header reads "Balance / Value". On sm+
                we have a dedicated Value column to the right. */}
            <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
              <span className="sm:hidden">Balance / Value</span>
              <span className="hidden sm:inline">Balance</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>Price</th>
            <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>Value</th>
          </tr>
        </thead>
        <tbody ref={listRef}>
          {pageRows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-line last:border-b-0 hover:bg-row-hover"
            >
              <td className={cell}>
                <div className="flex items-center gap-2.5">
                  <TokenIcon
                    src={row.icon}
                    currency={row.currency}
                    size={28}
                    className="size-7 shrink-0"
                  />
                  <div className="min-w-0">
                    {/* Only the name truncates: a clip around it would
                        cut its link's focus ring. */}
                    <span className="flex items-center gap-1.5 font-mono text-cell font-bold text-primary">
                      {row.token ? (
                        <Link to={tokenPath(row.token)} className="link truncate">
                          {row.name}
                        </Link>
                      ) : (
                        <span className="truncate">{row.name}</span>
                      )}
                      {row.lpComposition && (
                        <span className="shrink-0 rounded-tag tag-amm px-1.5 py-0.5 font-mono text-micro font-semibold uppercase tracking-pill">
                          LP
                        </span>
                      )}
                    </span>
                    <span className="block text-tag">
                      {row.issuer ? (
                        row.issuerName ? (
                          <span className="font-mono text-muted">{row.issuerName}</span>
                        ) : (
                          <AddressLink address={row.issuer} chars={6} />
                        )
                      ) : (
                        <span className="font-mono text-muted">Native</span>
                      )}
                    </span>
                  </div>
                </div>
              </td>
              <td className={`${cell} text-right font-mono text-cell tabular-nums text-primary max-sm:pr-0`}>
                {row.lpComposition ? (
                  // LP rows render the two pool components on
                  // separate lines (cleaner than a single combined
                  // string, and lets each amount keep tabular-nums
                  // alignment within its own row).
                  <>
                    <span className="block">{row.lpComposition.asset1Line}</span>
                    <span className="block">{row.lpComposition.asset2Line}</span>
                  </>
                ) : (
                  <span className="block break-words">
                    {row.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                )}
                {/* Mobile-only inline USD value. Sits as the third
                    line under an LP row's two component amounts, or
                    the second line under a regular row's balance.
                    Hidden at sm+ where the dedicated Value column
                    takes over. */}
                <span className="block font-mono text-tag tabular-nums text-muted sm:hidden">
                  {row.valueUsd != null ? formatVolume(row.valueUsd) : "—"}
                </span>
              </td>
              <td className={`${cell} hidden text-right font-mono text-cell tabular-nums text-primary sm:table-cell`}>
                {row.priceUsd != null ? formatVolume(row.priceUsd) : "—"}
              </td>
              <td className={`${cell} hidden text-right font-mono text-cell tabular-nums text-primary sm:table-cell`}>
                {row.valueUsd != null ? formatVolume(row.valueUsd) : "—"}
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
          label="assets"
        />
      )}
    </>
  );
}
