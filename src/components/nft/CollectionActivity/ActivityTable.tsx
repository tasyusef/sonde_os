"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import AddressLink from "@/components/shared/AddressLink";
import Button from "@/components/shared/Button";
import NftThumbnail from "@/components/nft/NftThumbnail";
import { type CollectionActivityRow } from "@/lib/db-queries";
import { dropsToXrp, truncateHash, XRPL_EPOCH } from "@/lib/xrpl-helpers";

const PAGE_SIZE = 15;

function timeAgo(rippleEpochSeconds: number | null): string {
  if (rippleEpochSeconds == null) return "";
  const ms = (rippleEpochSeconds + XRPL_EPOCH) * 1000;
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function proxyImageUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `/api/nft-image?url=${encodeURIComponent(url)}`;
}

interface ActivityPage {
  rows: CollectionActivityRow[];
  hasMore: boolean;
  nextBefore: number | null;
}

/**
 * Trades table — paginated load-more pattern matching the portfolio
 * activity tab. Initial 15 rows come from a server-rendered prop;
 * `Load more` appends another 15 via `/api/nft/collection/[issuer]/[taxon]/activity?before=<ts>`.
 *
 * Keyset cursor on `timestamp DESC` — the last row's `date`
 * (ripple-epoch seconds) is sent back as `before` to fetch the
 * next page. CH partition + index handles it as a fast range scan,
 * no `LIMIT N OFFSET M` pain.
 */
export default function ActivityTable({
  initialRows,
  issuer,
  taxon,
}: {
  initialRows: CollectionActivityRow[];
  issuer: string;
  taxon: number;
}) {
  const initialHasMore = initialRows.length === PAGE_SIZE;
  const initialBefore =
    initialHasMore && initialRows.length > 0
      ? initialRows[initialRows.length - 1].date
      : null;

  const [appendedPages, setAppendedPages] = useState<ActivityPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // SWR is used for the initial paint so the component stays in
  // sync with the server-rendered tree on revalidation. The
  // appended pages are managed locally — `mutate()` on the initial
  // doesn't blow away the user's already-loaded extra pages.
  const { data } = useSWR<ActivityPage>(
    `/api/nft/collection/${issuer}/${taxon}/activity?limit=${PAGE_SIZE}`,
    fetcher,
    {
      fallbackData: {
        rows: initialRows,
        hasMore: initialHasMore,
        nextBefore: initialBefore,
      },
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
    },
  );

  const firstPage = data ?? {
    rows: initialRows,
    hasMore: initialHasMore,
    nextBefore: initialBefore,
  };

  const allRows = [
    ...firstPage.rows,
    ...appendedPages.flatMap((p) => p.rows),
  ];
  const lastPage =
    appendedPages.length > 0
      ? appendedPages[appendedPages.length - 1]
      : firstPage;
  const hasMore = lastPage.hasMore;

  const loadMore = useCallback(async () => {
    if (!lastPage.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `/api/nft/collection/${issuer}/${taxon}/activity?limit=${PAGE_SIZE}&before=${lastPage.nextBefore}`,
      );
      if (!r.ok) return;
      const next = (await r.json()) as ActivityPage;
      setAppendedPages((prev) => [...prev, next]);
    } finally {
      setLoadingMore(false);
    }
  }, [issuer, taxon, lastPage.nextBefore, loadingMore]);

  return (
    <section className="rounded-2xl bg-surface shadow-card">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Trades
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="h-9 border-b border-elevated">
              <th scope="col" className="px-4 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
                Item
              </th>
              <th scope="col" className="px-4 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                Price
              </th>
              <th scope="col" className="hidden px-4 text-left font-display text-tag font-medium uppercase tracking-header text-muted sm:table-cell">
                Buyer
              </th>
              <th scope="col" className="hidden px-4 text-left font-display text-tag font-medium uppercase tracking-header text-muted sm:table-cell">
                Seller
              </th>
              <th scope="col" className="px-4 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row) => {
              const label = row.nftName ?? truncateHash(row.nftokenId, 8);
              const thumb = row.nftImageUrl ? proxyImageUrl(row.nftImageUrl) : null;
              return (
                <tr
                  key={row.txHash}
                  className="h-[52px] border-b border-elevated last:border-b-0"
                >
                  <td className="px-4">
                    <Link
                      href={`/nft/${row.nftokenId}`}
                      className="group flex items-center gap-3 min-w-0"
                    >
                      <NftThumbnail src={thumb} />
                      <span
                        className={`truncate ${
                          row.nftName
                            ? "font-display text-cell font-medium text-brand group-hover:text-brand-light"
                            : "font-mono text-cell text-brand group-hover:text-brand-light"
                        }`}
                      >
                        {label}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 text-right font-mono text-cell tabular-nums text-primary">
                    {row.amountDrops != null && row.isXrp
                      ? `${dropsToXrp(row.amountDrops)} XRP`
                      : "—"}
                  </td>
                  <td className="hidden px-4 sm:table-cell">
                    <AddressLink address={row.buyer} />
                  </td>
                  <td className="hidden px-4 sm:table-cell">
                    <AddressLink address={row.seller} />
                  </td>
                  <td className="px-4 text-right">
                    <Link
                      href={`/tx/${row.txHash}`}
                      className="font-mono text-tag tabular-nums text-muted hover:text-secondary"
                    >
                      {timeAgo(row.date)}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center border-t border-elevated p-3">
          <Button
            variant="outline"
            onClick={loadMore}
            loading={loadingMore}
            size="md"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </section>
  );
}
