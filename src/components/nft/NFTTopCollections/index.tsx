"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { type NFTCollection } from "@/lib/nft-volumes";
import { formatXrp } from "@/lib/format";
import Toggle from "@/components/shared/Toggle";
import ChartCardHeader from "@/components/shared/ChartCardHeader";
import { cn } from "@/lib/utils";

type Period = "24h" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "all", label: "All" },
];

interface CollectionsResponse {
  collections: NFTCollection[] | null;
}

/**
 * Top NFT collections by XRP volume — self-fetching analytics card.
 * Period toggle drives a fresh SWR fetch of
 * `/api/rankings/nft-collections` (CH-backed via
 * `mv_nft_volume_hourly`, enriched server-side with display name +
 * image URL pulled from PG `nft_metadata`).
 *
 * Layout: 3-column table (rank / collection / volume) with the same
 * chrome + padding rhythm as TokenVelocity / TokenTopVolume. Floor
 * and Sales live as inline metadata under the collection name —
 * Velocity's 5-column layout works because its three metrics are
 * related (Volume / Supply → Velocity); Collections' Floor, Sales,
 * and Volume are independent, so splitting them into separate
 * right-aligned columns made it unclear which one drove the
 * ranking. Volume gets its own column + scale bar so the ranked
 * metric reads at a glance, and Floor / Sales sit in muted small
 * type under the name as supporting context.
 */
export default function NFTTopCollections() {
  const [period, setPeriod] = useState<Period>("24h");
  const { data, isLoading } = useSWR<CollectionsResponse>(
    CACHE_KEYS.nftCollections(period, 5),
    fetcher,
    { keepPreviousData: true },
  );

  const collections = data?.collections ?? null;

  // Max volume across the visible rows — used to scale the
  // volume-column bar in each row, the same pattern Velocity uses
  // on its rightmost column.
  const maxVolume =
    collections && collections.length > 0
      ? Math.max(...collections.map((c) => c.volumeXrp), 1)
      : 1;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl shadow-card bg-surface">
      <ChartCardHeader
        title="Top Collections"
        controls={<Toggle options={PERIODS} active={period} onChange={setPeriod} />}
      />

      <div className={cn("transition-opacity", isLoading && "opacity-40")}>
        {isLoading && !collections ? (
          <div className="space-y-2 px-4 py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse motion-reduce:animate-none rounded bg-elevated"
              />
            ))}
          </div>
        ) : collections && collections.length > 0 ? (
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
                    Collection
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
                {collections.map((c, i) => {
                  const barPct = (c.volumeXrp / maxVolume) * 100;
                  const floorLabel =
                    c.floorXrp != null
                      ? `Floor ${formatXrp(c.floorXrp)} XRP`
                      : "Floor —";
                  return (
                    <tr
                      key={`${c.issuer}:${c.taxon}`}
                      className="border-b border-elevated last:border-b-0"
                    >
                      <td className="pl-4 pr-0 py-2.5 font-mono text-cell text-muted">
                        {i + 1}
                      </td>
                      <td className="pl-3 pr-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {c.imageUrl ? (
                            <Image
                              src={c.imageUrl}
                              alt=""
                              width={28}
                              height={28}
                              className="size-7 shrink-0 rounded-full object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="size-7 shrink-0 rounded-full bg-elevated" />
                          )}
                          <div className="min-w-0">
                            {c.issuer ? (
                              <Link
                                href={`/nft/collection/${c.issuer}/${c.taxon}`}
                                className="block truncate font-mono text-cell font-medium text-primary transition-colors hover:text-brand"
                              >
                                {c.name}
                              </Link>
                            ) : (
                              <span className="block truncate font-mono text-cell font-medium text-primary">
                                {c.name}
                              </span>
                            )}
                            {/* Supporting metadata: Floor + Sales as a
                                 single muted line under the name. Keeps
                                 both metrics visible without splitting
                                 them into separate right-aligned columns
                                 (where the eye couldn't tell which was
                                 the ranking driver). */}
                            <div className="mt-0.5 truncate font-mono text-label text-muted tabular-nums">
                              {floorLabel}
                              <span className="mx-1.5 text-muted/60">·</span>
                              {c.sales.toLocaleString()} sales
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
                          {formatXrp(c.volumeXrp)}
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
