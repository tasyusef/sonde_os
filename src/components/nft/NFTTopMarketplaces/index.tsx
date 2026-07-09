"use client";

import { useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { type NFTMarketplace } from "@/lib/nft-volumes";
import { formatXrp } from "@/lib/format";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { cn } from "@/lib/utils";

type Period = "24h" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "all", label: "All" },
];

interface MarketplacesResponse {
  marketplaces: NFTMarketplace[] | null;
}

/**
 * Top NFT marketplaces by XRP volume — self-fetching analytics
 * card. Period toggle drives a fresh SWR fetch of
 * `/api/rankings/nft-marketplaces` (CH-backed via
 * `mv_nft_volume_hourly`, enriched with favicon URLs server-side).
 *
 * Layout matches `NFTTopCollections`: 3-column table (rank /
 * marketplace / volume) with sales count as muted inline metadata
 * under the marketplace name. Marketplace name doubles as the
 * external-link affordance when we have a real host (rendered as
 * a `target="_blank"` anchor with a small external-link glyph
 * after it); `unknown` rows render the name as plain text.
 */
export default function NFTTopMarketplaces() {
  const [period, setPeriod] = useState<Period>("24h");
  const { data, isLoading } = useSWR<MarketplacesResponse>(
    CACHE_KEYS.nftMarketplaces(period, 5),
    fetcher,
    { keepPreviousData: true },
  );

  const marketplaces = data?.marketplaces ?? null;

  // Max volume across the visible rows — scales the right-column
  // bar in each row, same pattern as NFTTopCollections / Velocity.
  const maxVolume =
    marketplaces && marketplaces.length > 0
      ? Math.max(...marketplaces.map((m) => m.volumeXrp), 1)
      : 1;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Top Marketplaces"
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={cn("transition-opacity", isLoading && "opacity-40")}>
        {isLoading && !marketplaces ? (
          <div className="space-y-2 px-4 py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse motion-reduce:animate-none rounded bg-elevated"
              />
            ))}
          </div>
        ) : marketplaces && marketplaces.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-elevated">
                  <th
                    scope="col"
                    className="pl-4 pr-0 py-2 text-left font-display text-label font-medium uppercase tracking-header text-muted"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="pl-3 pr-4 py-2 text-left font-display text-label font-medium uppercase tracking-header text-muted"
                  >
                    Marketplace
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-right font-display text-label font-medium uppercase tracking-header text-muted"
                  >
                    Volume
                  </th>
                </tr>
              </thead>
              <tbody>
                {marketplaces.map((m, i) => {
                  const barPct = (m.volumeXrp / maxVolume) * 100;
                  const isKnown = m.name !== "unknown";
                  const nameClasses =
                    "block truncate font-mono text-cell font-medium text-primary";
                  return (
                    <tr
                      key={m.name}
                      className="border-b border-elevated last:border-b-0"
                    >
                      <td className="pl-4 pr-0 py-2.5 font-mono text-cell text-muted">
                        {i + 1}
                      </td>
                      <td className="pl-3 pr-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {m.logoUrl ? (
                            <Image
                              src={m.logoUrl}
                              alt=""
                              width={28}
                              height={28}
                              className="size-7 shrink-0 rounded-full object-contain"
                              unoptimized
                            />
                          ) : (
                            <div className="size-7 shrink-0 rounded-full bg-elevated" />
                          )}
                          <div className="min-w-0">
                            {isKnown ? (
                              <a
                                href={`https://${m.name}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                  nameClasses,
                                  "transition-colors hover:text-brand",
                                )}
                              >
                                {/* Inline external-link glyph so the
                                     name reads clearly as a clickthrough
                                     to a different domain. Small,
                                     muted, sits right after the name. */}
                                <span className="inline-flex items-center gap-1">
                                  {m.name}
                                  <svg
                                    width="9"
                                    height="9"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="shrink-0 opacity-60"
                                    aria-hidden="true"
                                  >
                                    <path d="M7 17L17 7M17 7H7M17 7v10" />
                                  </svg>
                                </span>
                              </a>
                            ) : (
                              <span className={nameClasses}>{m.name}</span>
                            )}
                            {/* Sales count as muted metadata under the
                                 marketplace name — same pattern as the
                                 Floor + sales line on Top Collections. */}
                            <div className="mt-0.5 truncate font-mono text-label text-muted tabular-nums">
                              {m.sales.toLocaleString()} sales
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="relative px-4 py-2.5 text-right">
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 right-0 bg-brand/10"
                          style={{ width: `${barPct}%` }}
                        />
                        <span className="relative font-mono text-cell font-medium tabular-nums text-primary">
                          {formatXrp(m.volumeXrp)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-3 font-mono text-body text-muted">—</p>
        )}
      </div>
    </div>
  );
}
