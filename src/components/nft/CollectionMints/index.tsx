import Link from "next/link";
import { getCollectionMints } from "@/lib/db-queries";
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
 * Mints tab content — latest 25 NFTs minted in (issuer, taxon),
 * newest first. Shares the same row rhythm as
 * `CollectionActivity` / `CollectionListings` / `CollectionBurns`
 * so the tabs read as a consistent log of collection events.
 */
export default async function CollectionMints({
  issuer,
  taxon,
}: {
  issuer: string;
  taxon: number;
}) {
  const mints = await getCollectionMints(issuer, taxon, 25).catch(() => []);

  if (mints.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-cell text-muted">No mints yet.</p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl bg-surface shadow-card">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Mints
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
                Ledger
              </th>
              <th
                scope="col"
                className="px-4 text-right font-display text-tag font-medium uppercase tracking-header text-muted"
              >
                Minted
              </th>
            </tr>
          </thead>
          <tbody>
            {mints.map((m) => {
              const label = m.nftName ?? truncateHash(m.nftokenId, 8);
              const thumb = m.nftImageUrl ? proxyImageUrl(m.nftImageUrl) : null;
              return (
                <tr
                  key={m.nftokenId}
                  className="h-[52px] border-b border-elevated last:border-b-0"
                >
                  <td className="px-4">
                    <Link
                      href={`/nft/${m.nftokenId}`}
                      className="group flex items-center gap-3 min-w-0"
                    >
                      <NftThumbnail src={thumb} />
                      <span
                        className={`truncate ${
                          m.nftName
                            ? "font-display text-cell font-medium text-brand group-hover:text-brand-light"
                            : "font-mono text-cell text-brand group-hover:text-brand-light"
                        }`}
                      >
                        {label}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 text-right font-mono text-tag tabular-nums text-muted">
                    {m.mintedLedger.toLocaleString()}
                  </td>
                  <td className="px-4 text-right font-mono text-tag tabular-nums text-muted">
                    {timeAgoUnix(m.mintedAtUnix)}
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
