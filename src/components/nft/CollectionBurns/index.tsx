import Link from "next/link";
import { getCollectionBurns } from "@/lib/db-queries";
import AddressLink from "@/components/shared/AddressLink";
import NftThumbnail from "@/components/nft/NftThumbnail";
import { truncateHash } from "@/lib/xrpl-helpers";

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
 * Burns tab content — NFTs from the collection that have been
 * permanently destroyed on-chain, most recent first. Thumbnail is
 * grayscale-tinted by the parent to signal "no longer exists" since
 * the underlying image URI may still resolve (IPFS doesn't know
 * about burns) and we don't want users thinking they can buy these.
 */
export default async function CollectionBurns({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const burns = await getCollectionBurns(issuer, taxon, 25).catch(() => []);

  if (burns.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-cell text-muted">No burns yet.</p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl bg-surface shadow-card">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Burns
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
                className="hidden px-4 text-left font-display text-tag font-medium uppercase tracking-header text-muted sm:table-cell"
              >
                Last Owner
              </th>
              <th
                scope="col"
                className="px-4 text-right font-display text-tag font-medium uppercase tracking-header text-muted"
              >
                Burned
              </th>
            </tr>
          </thead>
          <tbody>
            {burns.map((b) => {
              const label = b.nftName ?? truncateHash(b.nftokenId, 8);
              const thumb = b.nftImageUrl ? proxyImageUrl(b.nftImageUrl) : null;
              return (
                <tr
                  key={b.nftokenId}
                  className="h-[52px] border-b border-elevated last:border-b-0"
                >
                  <td className="px-4">
                    <Link
                      href={`/nft/${b.nftokenId}`}
                      className="group flex items-center gap-3 min-w-0"
                    >
                      {/* grayscale + reduced opacity signals "destroyed"
                          on the thumb without overlaying a badge that
                          would crowd the small row. */}
                      <span className="opacity-60 grayscale">
                        <NftThumbnail src={thumb} />
                      </span>
                      <span
                        className={`truncate ${
                          b.nftName
                            ? "font-display text-cell font-medium text-brand group-hover:text-brand-light"
                            : "font-mono text-cell text-brand group-hover:text-brand-light"
                        }`}
                      >
                        {label}
                      </span>
                    </Link>
                  </td>
                  <td className="hidden px-4 sm:table-cell">
                    <AddressLink address={b.lastOwner} />
                  </td>
                  <td className="px-4 text-right font-mono text-tag tabular-nums text-muted">
                    {timeAgoUnix(b.burnedAtUnix)}
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
