import Link from "next/link";
import { type TokenListItem, type VolumePeriod } from "@/lib/token-types";
import { formatCompactNumber } from "@/lib/xrpl-helpers";
import AddressLink from "@/components/shared/AddressLink";
import TokenIcon from "@/components/tokens/TokenIcon";

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

export default function TokenRow({
  token,
  rank,
  period = "24h",
}: {
  token: TokenListItem;
  rank: number;
  period?: VolumePeriod;
}) {
  const { meta, metrics } = token;
  const volume = period === "7d" ? metrics.volume7d : metrics.volume24h;

  const priceStr = metrics.price != null ? `${formatPrice(metrics.price)} XRP` : "—";
  const tokenHref = `/markets/${encodeURIComponent(token.currency)}/${token.issuer}`;

  return (
    <tr className="border-b border-elevated transition-colors hover:bg-row-hover">
      <td className="px-3 py-row font-mono text-body text-muted tabular-nums md:px-4">
        {rank}
      </td>
      <td className="px-3 py-row md:px-4">
        <Link
          href={tokenHref}
          className="flex items-center gap-2.5"
        >
          <TokenIcon src={meta.icon} currency={token.currencyDisplay} />
          <div className="min-w-0">
            <span
              className={`text-cell font-bold text-brand ${
                meta.name ? "font-display" : "font-mono"
              }`}
            >
              {meta.name ?? token.currencyDisplay}
            </span>
            {meta.name && meta.name.toLowerCase() !== token.currencyDisplay.toLowerCase() && (
              <span className="ml-1.5 font-mono text-tag text-muted">
                {token.currencyDisplay}
              </span>
            )}
          </div>
        </Link>
      </td>
      <td className="hidden px-4 py-row md:table-cell">
        {meta.issuerName ? (
          <span className="font-mono text-cell text-secondary">
            {meta.issuerName}
          </span>
        ) : (
          <AddressLink address={token.issuer} />
        )}
      </td>
      <td className="px-3 py-row text-right font-mono text-cell text-primary tabular-nums md:px-4 md:text-left">
        {priceStr}
      </td>
      <td className="hidden px-4 py-row text-left font-mono text-cell text-secondary tabular-nums sm:table-cell">
        {metrics.marketcap != null
          ? `${formatCompactNumber(metrics.marketcap)} XRP`
          : "—"}
      </td>
      <td className="hidden px-4 py-row text-left font-mono text-cell text-secondary tabular-nums lg:table-cell">
        {volume != null
          ? `${formatCompactNumber(volume)} XRP`
          : "—"}
      </td>
      <td className="hidden px-4 py-row text-left font-mono text-cell text-secondary tabular-nums md:table-cell">
        {metrics.holders != null
          ? metrics.holders.toLocaleString()
          : "—"}
      </td>
      <td className="hidden px-4 py-row text-left font-mono text-cell text-secondary tabular-nums md:table-cell">
        {metrics.trustlines != null
          ? metrics.trustlines.toLocaleString()
          : "—"}
      </td>
    </tr>
  );
}
