import Image from "next/image";
import Link from "next/link";
import { dropsToXrp, truncateHash } from "@/lib/xrpl-helpers";
import AddressLink from "@/components/shared/AddressLink";
import type { RecentNFTTradeRow } from "@/lib/db-queries";

const RIPPLE_EPOCH = 946684800;

export interface RecentNFTTrade extends RecentNFTTradeRow {
  name: string | null;
  imageUrl: string | null;
}

function timeAgo(xrplDate?: number | null): string {
  if (xrplDate == null) return "";
  const now = Date.now() / 1000;
  const diff = now - (xrplDate + RIPPLE_EPOCH);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function proxyImageUrl(url: string): string {
  if (url.startsWith("/")) return url;
  return `/api/nft-image?url=${encodeURIComponent(url)}`;
}

export function RecentTrades({ trades }: { trades: RecentNFTTrade[] }) {
  if (trades.length === 0) return null;

  return (
    <div className="rounded-2xl shadow-card bg-surface">
      <div className="border-b border-elevated px-4 py-card-header">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Recent Trades
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
                NFT
              </th>
              <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                Amount
              </th>
              <th scope="col" className="hidden px-4 py-2 text-left font-display text-tag font-medium uppercase tracking-header text-muted sm:table-cell">
                Buyer
              </th>
              <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.txHash} className="border-b border-elevated last:border-b-0">
                <td className="px-4 py-2">
                  <Link
                    href={`/nft/${trade.nftokenId}`}
                    className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  >
                    {trade.imageUrl ? (
                      <Image
                        src={proxyImageUrl(trade.imageUrl)}
                        alt=""
                        width={24}
                        height={24}
                        className="size-6 shrink-0 rounded-swatch object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="size-6 shrink-0 rounded-swatch bg-elevated" />
                    )}
                    <span className="min-w-0 flex-1">
                      {/* NFT name is descriptive content (proper nouns,
                           long strings like "KIOSKO Barrio Genesis #135")
                           — font-display fits the title-like role. Mono
                           stays for the truncated NFTokenID below since
                           that's a hash. If we don't have a resolved
                           name, we're falling back to a truncated hash
                           up here too — keep that in mono. */}
                      <span
                        className={`block truncate text-cell font-bold text-brand hover:text-brand-light ${
                          trade.name ? "font-display" : "font-mono"
                        }`}
                      >
                        {trade.name ?? truncateHash(trade.nftokenId, 6)}
                      </span>
                      {trade.name && (
                        <span className="block truncate font-mono text-tag text-muted">
                          {truncateHash(trade.nftokenId, 8)}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-2 text-right font-mono text-cell tabular-nums text-primary">
                  {trade.amountDrops
                    ? `${dropsToXrp(trade.amountDrops)} XRP`
                    : "—"}
                </td>
                <td className="hidden px-4 py-2 sm:table-cell">
                  <AddressLink address={trade.buyer} />
                </td>
                <td className="px-4 py-2 text-right font-mono text-tag tabular-nums text-muted">
                  {timeAgo(trade.date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RecentTrades;
