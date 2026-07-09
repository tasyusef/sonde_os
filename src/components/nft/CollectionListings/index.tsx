import Link from "next/link";
import { getCollectionListings } from "@/lib/db-queries";
import AddressLink from "@/components/shared/AddressLink";
import NftThumbnail from "@/components/nft/NftThumbnail";
import { dropsToXrp, truncateHash } from "@/lib/xrpl-helpers";

function proxyImageUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `/api/nft-image?url=${encodeURIComponent(url)}`;
}

function timeAgoUnix(unixSeconds: number | null): string {
  if (unixSeconds == null) return "";
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s ago`;
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Listings tab content — open sell-offers for the collection, lowest
 * price first (floor sort). XRP-denominated offers rank above
 * IOU-denominated ones because their amounts are directly comparable;
 * IOU listings show "—" for price since cross-currency floor math is
 * out of scope for the MVP table.
 */
export default async function CollectionListings({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const listings = await getCollectionListings(issuer, taxon, 25).catch(
    () => [],
  );

  if (listings.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-cell text-muted">No active listings.</p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl bg-surface shadow-card">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Listings
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="h-9 border-b border-elevated">
              <th
                scope="col"
                className="px-4 text-left font-display text-tag font-medium uppercase tracking-header text-muted"
              >
                Item
              </th>
              <th
                scope="col"
                className="px-4 text-right font-display text-tag font-medium uppercase tracking-header text-muted"
              >
                Price
              </th>
              <th
                scope="col"
                className="hidden px-4 text-left font-display text-tag font-medium uppercase tracking-header text-muted sm:table-cell"
              >
                Seller
              </th>
              <th
                scope="col"
                className="px-4 text-right font-display text-tag font-medium uppercase tracking-header text-muted"
              >
                Listed
              </th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => {
              const label = l.nftName ?? truncateHash(l.nftokenId, 8);
              const thumb = l.nftImageUrl ? proxyImageUrl(l.nftImageUrl) : null;
              return (
                <tr
                  key={l.nftOfferIndex}
                  className="h-[52px] border-b border-elevated last:border-b-0"
                >
                  <td className="px-4">
                    <Link
                      href={`/nft/${l.nftokenId}`}
                      className="group flex items-center gap-3 min-w-0"
                    >
                      <NftThumbnail src={thumb} />
                      <span
                        className={`truncate ${
                          l.nftName
                            ? "font-display text-cell font-medium text-brand group-hover:text-brand-light"
                            : "font-mono text-cell text-brand group-hover:text-brand-light"
                        }`}
                      >
                        {label}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 text-right font-mono text-cell tabular-nums text-primary">
                    {l.amountDrops != null && l.isXrp
                      ? `${dropsToXrp(l.amountDrops)} XRP`
                      : "—"}
                  </td>
                  <td className="hidden px-4 sm:table-cell">
                    <AddressLink address={l.owner} />
                  </td>
                  <td className="px-4 text-right font-mono text-tag tabular-nums text-muted">
                    {timeAgoUnix(l.createdAtUnix)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
