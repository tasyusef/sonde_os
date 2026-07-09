"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { decodeCurrency, truncate } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";
import Toggle from "@/components/shared/Toggle";
import LoadingDots from "@/components/shared/LoadingDots";
import { usePortfolioRefresh } from "@/components/portfolio/PortfolioRefreshProvider";

interface TokenEntry {
  currency: string;
  issuer: string;
  name: string;
  balance: number;
  priceUsd: number;
  valueUsd: number;
  costBasisUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  realizedPnlUsd: number | null;
}

interface TokensResponse {
  tokens: TokenEntry[];
}

type SortKey = "value" | "pnl" | "balance" | "name";

export default function TokensPanel() {
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [search, setSearch] = useState("");
  const { isRefreshing } = usePortfolioRefresh();

  const { data, isLoading, error } = useSWR<TokensResponse>(
    CACHE_KEYS.portfolioTokens(),
    fetcher,
  );

  const tokens = useMemo(() => {
    let list = data?.tokens ?? [];

    // Filter
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          decodeCurrency(t.currency).toLowerCase().includes(q),
      );
    }

    // Sort
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "pnl":
          return (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0);
        case "balance":
          return b.balance - a.balance;
        case "name":
          return (a.name || decodeCurrency(a.currency)).localeCompare(
            b.name || decodeCurrency(b.currency),
          );
        default:
          return b.valueUsd - a.valueUsd;
      }
    });
  }, [data, sortBy, search]);

  if (isLoading) {
    return (
      <section className="rounded-2xl shadow-card bg-surface">
        <div
          className="flex h-32 items-center justify-center"
          role="status"
          aria-label="Loading token holdings"
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      </section>
    );
  }

  // Render an explicit error block — without this, SWR's 500 falls
  // through to the empty state below and falsely tells the user they
  // hold nothing.
  if (error) {
    return (
      <section className="rounded-2xl shadow-card bg-surface">
        <div role="alert" className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="font-mono text-cell text-error">Couldn&apos;t load token holdings.</p>
          <p className="font-mono text-tag text-muted">Try refreshing the page.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl shadow-card bg-surface">
      {/* Refresh indicator strip — only renders while the portfolio
           dashboard's POST /api/portfolio/refresh is in flight. Mirrors
           the account-page "Refreshing live balances…" pattern so users
           can tell the data is being reconciled against live XRPL state
           rather than served from the last 5-min snapshot. */}
      {isRefreshing && (
        <div
          className="flex items-center gap-1.5 border-b border-elevated px-4 py-2 font-mono text-tag text-muted"
          role="status"
          aria-live="polite"
        >
          <LoadingDots className="text-brand" />
          Refreshing live balances…
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-3 border-b border-elevated px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          placeholder="Search tokens..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search tokens"
          className="rounded-lg border border-elevated bg-elevated px-3 py-1.5 font-body text-body text-primary placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:w-56"
        />
        <Toggle
          options={[
            { value: "value" as SortKey, label: "Value" },
            { value: "pnl" as SortKey, label: "PnL" },
            { value: "balance" as SortKey, label: "Balance" },
            { value: "name" as SortKey, label: "Name" },
          ]}
          active={sortBy}
          onChange={setSortBy}
        />
      </div>

      {tokens.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <p className="font-mono text-body text-muted">
            {search ? "No matching tokens" : "No token holdings"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-elevated">
                <th
                  scope="col"
                  className="px-4 py-2.5 text-left font-display text-label font-medium uppercase tracking-header text-muted"
                >
                  Token
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted"
                >
                  Balance
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted sm:table-cell"
                >
                  Price
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted"
                >
                  Value
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted md:table-cell"
                >
                  Cost Basis
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted sm:table-cell"
                >
                  Unrealized
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 text-right font-display text-label font-medium uppercase tracking-header text-muted lg:table-cell"
                >
                  Realized
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr
                  key={`${token.currency}:${token.issuer}`}
                  className="border-b border-elevated last:border-b-0"
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={`text-cell font-bold text-primary ${
                          token.name ? "font-display" : "font-mono"
                        }`}
                      >
                        {token.name || decodeCurrency(token.currency)}
                      </span>
                      <Link
                        href={`/account/${token.issuer}`}
                        className="font-mono text-label text-brand hover:underline"
                      >
                        {truncate(token.issuer, 5)}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-cell tabular-nums text-secondary">
                    {token.balance.toLocaleString("en-US", {
                      maximumFractionDigits: 4,
                    })}
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono text-cell tabular-nums text-muted sm:table-cell">
                    {token.priceUsd > 0
                      ? `$${token.priceUsd.toFixed(token.priceUsd < 0.01 ? 6 : 4)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-cell font-medium tabular-nums text-primary">
                    {token.valueUsd > 0 ? formatVolume(token.valueUsd) : "—"}
                  </td>
                  <td className="hidden px-4 py-3 text-right font-mono text-cell tabular-nums text-muted md:table-cell">
                    {token.costBasisUsd != null && token.costBasisUsd > 0
                      ? formatVolume(token.costBasisUsd)
                      : "—"}
                  </td>
                  <td className="hidden px-4 py-3 text-right sm:table-cell">
                    {token.pnlPct != null ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span
                          className={cn(
                            "font-mono text-cell font-medium tabular-nums",
                            token.pnlUsd != null && token.pnlUsd >= 0
                              ? "text-success"
                              : "text-error",
                          )}
                        >
                          {token.pnlUsd != null && token.pnlUsd >= 0
                            ? "+"
                            : ""}
                          {formatVolume(token.pnlUsd ?? 0)}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-label tabular-nums",
                            token.pnlPct >= 0 ? "text-success" : "text-error",
                          )}
                        >
                          {token.pnlPct >= 0 ? "+" : ""}
                          {Math.abs(token.pnlPct) >= 100
                            ? `${token.pnlPct.toFixed(0)}%`
                            : `${token.pnlPct.toFixed(2)}%`}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-cell text-muted">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-right lg:table-cell">
                    {token.realizedPnlUsd != null ? (
                      <span
                        className={cn(
                          "font-mono text-cell font-medium tabular-nums",
                          token.realizedPnlUsd >= 0
                            ? "text-success"
                            : "text-error",
                        )}
                      >
                        {token.realizedPnlUsd >= 0 ? "+" : ""}
                        {formatVolume(token.realizedPnlUsd)}
                      </span>
                    ) : (
                      <span className="font-mono text-cell text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
