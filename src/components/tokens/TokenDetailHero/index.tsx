import Link from "next/link";
import type { TokenDetail } from "@/types/token";
import TokenIcon from "@/components/tokens/TokenIcon";
import AddressLink from "@/components/shared/AddressLink";
import CopyButton from "@/components/shared/CopyButton";
import { HeroBackground } from "@/components/shared/PageHero";

function formatPrice(price: number): string {
  if (price < 0.000001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(4);
}

export default function TokenDetailHero({ token }: { token: TokenDetail }) {
  const { meta, metrics } = token;
  const displayName = meta.name ?? token.currencyDisplay;

  return (
    <section className="relative overflow-hidden md:-ml-18">
      <HeroBackground />

      <div className="relative mx-auto max-w-container px-6 pt-6 pb-8 sm:pt-8 sm:pb-10 md:pl-24">
        <Link
          href="/markets"
          className="mb-4 inline-flex items-center gap-1.5 font-display text-label uppercase tracking-header text-muted transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="size-3.5"
          >
            <path
              fillRule="evenodd"
              d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
              clipRule="evenodd"
            />
          </svg>
          Tokens
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <TokenIcon
              src={meta.icon}
              currency={token.currencyDisplay}
              size={48}
            />
            <div>
              <h1 className="font-display text-heading font-bold tracking-[-0.5px] text-primary sm:text-title">
                {displayName}
                {meta.name && (
                  <span className="ml-3 font-mono text-heading font-medium text-muted">
                    {token.currencyDisplay}
                  </span>
                )}
              </h1>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-display text-tag uppercase tracking-header text-muted">
                  Issuer
                </span>
                <AddressLink address={token.issuer} />
                <CopyButton text={token.issuer} />
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            {metrics.price != null && (
              <span className="font-mono text-title font-bold tabular-nums text-primary sm:text-display">
                {formatPrice(metrics.price)} XRP
              </span>
            )}
            <a
              href={`https://firstledger.net/token/${token.issuer}/${encodeURIComponent(token.currency)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-elevated px-3 py-1.5 font-mono text-label font-medium text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Trade on First Ledger
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
