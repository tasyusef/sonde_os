import { Suspense } from "react";
import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import TokenDetailHero from "@/components/tokens/TokenDetailHero";
import TokenMiniHeader from "@/components/tokens/TokenMiniHeader";
import TokenStatsGrid from "@/components/tokens/TokenStatsGrid";
import Orderbook from "@/components/tokens/Orderbook";
import TokenLiquiditySection from "@/components/tokens/TokenLiquiditySection";
import TokenHealthCard from "@/components/tokens/TokenHealthCard";
import WhaleActivity from "@/components/tokens/WhaleActivity";
import IssuerAnalysis from "@/components/tokens/IssuerAnalysis";

// TokenPriceChart and TokenHoldersLoader both pull recharts. Dynamic-
// importing them code-splits the chart bundle off the markets-detail
// initial chunk, which is one of the highest-traffic pages on the site.
// (Server-component dynamic imports don't support `ssr: false` — that's
// fine, both components SSR cleanly with default chart dimensions.)
const TokenPriceChart = nextDynamic(
  () => import("@/components/tokens/TokenPriceChart"),
);
const TokenHoldersLoader = nextDynamic(
  () => import("@/components/tokens/TokenHoldersLoader"),
);
import {
  getTokenDetail,
  getOrderbook,
  getTokenAMMPools,
  toDepthLevels,
} from "@/lib/token-detail-data";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ currency: string; issuer: string }>;
}): Promise<Metadata> {
  const { currency, issuer } = await params;
  const decoded = safeDecode(currency);
  if (decoded.length > 40 || !/^r[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(issuer)) {
    return { title: "Invalid Token" };
  }
  return {
    title: `${decoded} Token`,
    description: `${decoded} token details, orderbook, and AMM pools on XRPL`,
    alternates: { canonical: `/markets/${encodeURIComponent(decoded)}/${issuer}` },
  };
}

export const dynamic = "force-dynamic";

export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ currency: string; issuer: string }>;
}) {
  const { currency, issuer } = await params;
  const decodedCurrency = safeDecode(currency);

  // Validate issuer format to avoid wasting XRPL/DB queries on garbage
  if (!XRPL_ADDRESS_RE.test(issuer) || decodedCurrency.length > 40) {
    return (
      <div className="min-h-screen">
        <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
          <div role="alert" className="rounded-2xl bg-surface p-8 text-center shadow-card">
            <p className="font-mono text-cell text-error">Invalid token parameters</p>
          </div>
        </main>
      </div>
    );
  }

  const [tokenResult, orderbookResult, poolsResult] =
    await Promise.allSettled([
      getTokenDetail(decodedCurrency, issuer),
      getOrderbook(decodedCurrency, issuer),
      getTokenAMMPools(decodedCurrency, issuer),
    ]);

  const token =
    tokenResult.status === "fulfilled" ? tokenResult.value : null;
  const orderbook =
    orderbookResult.status === "fulfilled"
      ? orderbookResult.value
      : { bids: [], asks: [] };
  const pools =
    poolsResult.status === "fulfilled" ? poolsResult.value : [];

  if (!token) {
    return (
      <div className="min-h-screen">
        <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
          <div
            role="alert"
            className="rounded-2xl bg-surface p-8 text-center shadow-card"
          >
            <p className="font-mono text-cell text-error">Token not found</p>
            <p className="mt-2 font-mono text-body text-muted break-all">
              {decodedCurrency} : {issuer}
            </p>
          </div>
        </main>
      </div>
    );
  }

  const bidDepth = toDepthLevels(orderbook.bids);
  const askDepth = toDepthLevels(orderbook.asks);

  return (
    <div className="min-h-screen">
      {/* Mobile mini header — desktop hero is hidden on small viewports. */}
      <TokenMiniHeader token={token} />
      <div className="hidden lg:block">
        <TokenDetailHero token={token} />
      </div>
      {/* Screen-reader heading so SEO + a11y don't rely on the hidden hero. */}
      <h1 className="sr-only">
        {token.meta.name ?? token.currencyDisplay}{" "}
        {token.meta.name ? token.currencyDisplay : ""}
      </h1>
      <main id="main-content" className="mx-auto max-w-container space-y-6 px-4 py-4 sm:px-6 sm:py-8">
        <TokenStatsGrid token={token} />
        <TokenHealthCard currency={decodedCurrency} issuer={issuer} />
        <TokenPriceChart
          currency={decodedCurrency}
          issuer={issuer}
          currencyDisplay={token.currencyDisplay}
          currentPrice={token.metrics.price}
        />
        <div className="grid items-stretch gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Orderbook
            bids={orderbook.bids}
            asks={orderbook.asks}
            bidDepth={bidDepth}
            askDepth={askDepth}
            currencyDisplay={token.currencyDisplay}
          />
          <Suspense
            fallback={
              <div
                role="status"
                aria-label="Loading holder data"
                className="flex max-h-[700px] flex-col overflow-hidden rounded-2xl bg-surface shadow-card"
              >
                <div className="border-b border-elevated px-4 py-2.5">
                  <span className="font-display text-label font-bold uppercase tracking-header text-brand">
                    Top Holders
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-brand" />
                </div>
              </div>
            }
          >
            <TokenHoldersLoader
              currency={decodedCurrency}
              issuer={issuer}
              currencyDisplay={token.currencyDisplay}
            />
          </Suspense>
        </div>
        <TokenLiquiditySection
          pools={pools}
          currencyDisplay={token.currencyDisplay}
        />
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <WhaleActivity currency={decodedCurrency} issuer={issuer} />
          <IssuerAnalysis currency={decodedCurrency} issuer={issuer} />
        </div>
      </main>
    </div>
  );
}
