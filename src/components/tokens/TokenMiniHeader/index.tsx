import type { TokenDetail } from "@/types/token";
import TokenIcon from "@/components/tokens/TokenIcon";

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(4);
}

/**
 * Mobile-only compact header for the token detail page. Replaces the
 * full TokenDetailHero (name + issuer + trade link + large price) on
 * small viewports with a sticky full-width pill showing just the
 * essentials: token icon, display name, and current XRP price.
 *
 * Issuer address, trade link, and other hero chrome now surface inside
 * the stats grid below the pill — no need to duplicate them here.
 */
export default function TokenMiniHeader({ token }: { token: TokenDetail }) {
  const displayName = token.meta.name ?? token.currencyDisplay;
  const price = token.metrics.price;

  return (
    <div className="sticky top-[60px] z-30 -mt-3 px-4 pt-2 lg:mt-0 lg:hidden">
      <div className="flex items-center justify-between gap-3 rounded-full border border-elevated bg-surface px-3 py-1.5 shadow-card">
        <div className="flex min-w-0 items-center gap-2">
          <TokenIcon src={token.meta.icon} currency={token.currencyDisplay} size={20} />
          <span className="truncate font-mono text-cell font-semibold text-primary">
            {displayName}
          </span>
        </div>
        {price != null && (
          <span className="shrink-0 font-mono text-cell font-semibold tabular-nums text-primary">
            {formatPrice(price)} XRP
          </span>
        )}
      </div>
    </div>
  );
}
