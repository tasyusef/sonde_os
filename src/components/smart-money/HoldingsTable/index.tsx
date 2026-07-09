"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { decodeCurrency } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";

/* ── Types ── */

interface Holding {
  currency: string;
  issuer: string;
  qty: number;
  costBasis: number;
  totalCost: number;
  realizedPnl: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  firstTradeTs: string;
  lastTradeTs: string;
}

interface HoldingsResponse {
  holdings: Holding[];
}

/* ── Helpers ── */

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

function formatPnl(n: number): string {
  const abs = Math.abs(n);
  const formatted =
    abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}K` : abs.toFixed(2);
  return n >= 0 ? `+${formatted}` : `-${formatted}`;
}

function isRecent(ts: string): boolean {
  return Date.now() - new Date(ts).getTime() < 24 * 60 * 60 * 1000;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const hrs = Math.floor(diff / (60 * 60 * 1000));
  if (hrs < 1) return "Just now";
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const thClass =
  "px-3 sm:px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted";

/* ── Component ── */

/**
 * Tokens-traded table for the smart-money detail page. Mobile-first
 * per CLAUDE.md design rule: `table-fixed` + `<colgroup>` for
 * predictable widths, and the desktop-only Cost Basis / Trades /
 * Last Trade columns fold inline as secondary lines under the
 * visible cells on phones rather than disappearing or
 * horizontal-scrolling. Same pattern as `HoldingsList` /
 * `ActivationsList` / NFT tables.
 *
 * Renders without its own card chrome — the parent
 * (`WalletDetailPage`) wraps it in a `CollapsibleCard`.
 */
export default function HoldingsTable({ address }: { address: string }) {
  const { data, isLoading } = useSWR<HoldingsResponse>(
    `/api/smart-money/${encodeURIComponent(address)}/holdings`,
    fetcher,
    { dedupingInterval: 30_000, revalidateOnFocus: false },
  );

  const holdings = data?.holdings ?? [];

  if (isLoading) {
    return (
      <div className="space-y-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-4 border-b border-elevated px-3 py-3.5 last:border-b-0 sm:px-4"
          >
            <div className="h-4 w-16 animate-pulse rounded bg-elevated" />
            <div className="h-4 w-20 animate-pulse rounded bg-elevated" />
            <div className="ml-auto h-4 w-16 animate-pulse rounded bg-elevated" />
          </div>
        ))}
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="font-body text-ui text-muted">
          No trade activity detected.
        </p>
      </div>
    );
  }

  return (
    <table className="w-full table-fixed" role="table">
      <colgroup>
        {/* Token name + issuer flexes. Status is a fixed-width pill.
             Balance carries the mobile-folded Cost Basis below the
             qty. PnL right-aligned. Trades + Last Trade are their
             own columns on md+ only; mobile folds them under
             Token + Balance. */}
        <col className="w-auto" />
        <col className="w-[18%] sm:w-[14%] md:w-[10%]" />
        <col className="w-[24%] sm:w-[18%] md:w-[14%]" />
        <col className="hidden sm:table-column sm:w-[16%] md:w-[14%]" />
        <col className="w-[24%] sm:w-[18%] md:w-[14%]" />
        <col className="hidden md:table-column md:w-[10%]" />
        <col className="hidden md:table-column md:w-[14%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-elevated">
          <th scope="col" className={`${thClass} text-left`}>
            Token
          </th>
          <th scope="col" className={`${thClass} text-left`}>
            Status
          </th>
          <th scope="col" className={`${thClass} text-right`}>
            Balance
          </th>
          <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
            Cost Basis
          </th>
          <th scope="col" className={`${thClass} text-right`}>
            PnL
          </th>
          <th scope="col" className={`${thClass} hidden text-right md:table-cell`}>
            Trades
          </th>
          <th scope="col" className={`${thClass} hidden text-right md:table-cell`}>
            Last Trade
          </th>
        </tr>
      </thead>
      <tbody>
        {holdings.map((h) => {
          const isHeld = h.qty > 0;
          return (
            <tr
              key={`${h.currency}:${h.issuer}`}
              className="border-b border-elevated transition-colors last:border-b-0 hover:bg-elevated/50"
            >
              <td className="px-3 py-row align-top sm:px-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cell font-medium text-primary">
                    {decodeCurrency(h.currency)}
                  </span>
                  {isRecent(h.lastTradeTs) && (
                    <span className="rounded-tag bg-success/10 px-1.5 py-0.5 font-mono text-tag font-semibold text-success">
                      NEW
                    </span>
                  )}
                </div>
                {h.issuer && (
                  <Link
                    href={`/account/${h.issuer}`}
                    className="font-mono text-tag text-muted hover:text-brand"
                  >
                    {h.issuer.slice(0, 8)}...{h.issuer.slice(-4)}
                  </Link>
                )}
                {/* Mobile-only inline last-trade — Last Trade column
                    hides under md, so we surface its content here. */}
                <span className="mt-0.5 block font-mono text-tag text-muted md:hidden">
                  {timeAgo(h.lastTradeTs)}
                  {h.tradeCount > 0 && ` · ${h.tradeCount}t`}
                </span>
              </td>
              <td className="px-3 py-row align-top sm:px-4">
                <span
                  className={cn(
                    "rounded-tag px-1.5 py-0.5 font-mono text-tag font-semibold uppercase",
                    isHeld ? "bg-brand/10 text-brand" : "bg-elevated text-muted",
                  )}
                >
                  {isHeld ? "Held" : "Closed"}
                </span>
              </td>
              <td
                className={cn(
                  "px-3 py-row text-right align-top font-mono text-cell sm:px-4",
                  isHeld ? "text-primary" : "text-muted",
                )}
              >
                {isHeld ? formatAmount(h.qty) : "—"}
                {/* Mobile-only inline cost basis — Cost Basis column
                    hides under sm. */}
                {h.costBasis > 0 && (
                  <span className="mt-0.5 block font-mono text-tag text-muted sm:hidden">
                    cb {formatAmount(h.costBasis)}
                  </span>
                )}
              </td>
              <td className="hidden px-4 py-row text-right align-top font-mono text-cell text-muted sm:table-cell">
                {h.costBasis > 0 ? formatAmount(h.costBasis) : "—"}
              </td>
              <td
                className={cn(
                  "px-3 py-row text-right align-top font-mono text-cell font-medium sm:px-4",
                  h.realizedPnl > 0
                    ? "text-success"
                    : h.realizedPnl < 0
                      ? "text-error"
                      : "text-muted",
                )}
              >
                {h.realizedPnl === 0 ? "—" : formatPnl(h.realizedPnl)}
              </td>
              <td className="hidden px-4 py-row text-right align-top font-mono text-cell text-muted md:table-cell">
                {h.tradeCount}
              </td>
              <td className="hidden px-4 py-row text-right align-top font-mono text-cell text-muted md:table-cell">
                {timeAgo(h.lastTradeTs)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
