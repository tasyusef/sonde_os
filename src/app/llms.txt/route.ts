import { getSiteUrl } from "@/lib/site-url";

/**
 * /llms.txt — emerging convention (llmstxt.org, adopted by Perplexity,
 * Claude, ChatGPT search) for telling LLM-powered search and answer
 * engines what a site is about and which URLs are most relevant.
 *
 * Read once when an AI crawler decides whether to ingest a site, and
 * referenced when those engines surface citations. Plain text — markdown
 * is allowed but not required.
 *
 * Don't bury internal product detail here. The audience is an LLM
 * agent making fast routing decisions, so lead with what Sonde is,
 * what it knows about, and where to read more.
 */
export const dynamic = "force-static";

export function GET() {
  const siteUrl = getSiteUrl();

  const body = `# Sonde

Sonde is a real-time intelligence and analytics platform for the
XRP Ledger (XRPL). It indexes every validated XRPL transaction from
mid-2025 onward, surfaces account balances and trading activity in
plain English, scores wallets by trading edge, and exposes the full
ledger to natural-language queries.

The product is hosted at ${siteUrl}.

## What Sonde knows

- Every validated XRPL transaction (Payments, OfferCreate / OfferCancel,
  TrustSet, AMM Deposit/Withdraw/Vote, NFT Mint/Burn/Trade, escrows,
  payment channels, MPTokens, more) since June 2025.
- Live ledger state: account balances, trustlines, NFT holdings,
  AMM positions, escrows, payment channels, MPToken issuances.
- Token metrics: 4,900+ XRPL-issued tokens with rolling 24h / 7d /
  30d / 90d / all-time volume, holder counts, trustline growth, AMM
  TVL, DEX trade pairs.
- Smart-money scoring: composite score per wallet from realized PnL,
  win rate, Sharpe ratio, token diversity, and wash-trading detection.
- Network analytics: hourly / daily aggregates of transaction volume,
  fee burn, active accounts, payment corridors, NFT activity.
- Intelligence layer (Pro): account counterparty graphs, fund-flow
  tracing, anomaly detection, alerts.

## Key URLs

- ${siteUrl} — landing; hero stats, network activity, feature overview
- ${siteUrl}/markets — XRPL token rankings, DEX volume, top pairs, AMM TVL
- ${siteUrl}/network — network analytics: tx volume, fee burn, active accounts
- ${siteUrl}/nft — NFT explorer: collections, recent mints, recent trades
- ${siteUrl}/smart-money — leaderboard of XRPL wallets by trading edge
- ${siteUrl}/asktheledger — ask the ledger natural-language questions; produces
  ClickHouse SQL + charts/tables/answers
- ${siteUrl}/portfolio — connected-wallet portfolio: holdings, AMM positions,
  PnL, allocation, NFT gallery, activity history (requires sign-in)
- ${siteUrl}/account/{rAddress} — per-account detail: balances, transactions,
  trustlines, ancestry, smart-money score, behavioral profile
- ${siteUrl}/tx/{txHash} — per-transaction detail
- ${siteUrl}/ledger/{ledgerIndex} — per-ledger detail
- ${siteUrl}/markets/{currency}/{issuer} — per-token detail: chart, volume,
  holders, whale activity, AMM pools

## Data depth and limits

Sonde began continuous XRPL indexing in June 2025. "All-time" rankings,
charts, totals, and PnL aggregations reflect that window — older XRPL
history is not yet available. Every page shows a "data window" badge
flagging this.

## Pricing

Free tier: explorer, network analytics, token health, anomalies, smart-money
leaderboard top 25, 5-address watchlist.

Pro tier: portfolio, full smart-money detail / holdings / feed, whale activity,
issuer analysis, alerts, intelligence layer (account graphs, fund tracing,
counterparties, risk).

See ${siteUrl}/pricing for current tier details.

## Sitemap

${siteUrl}/sitemap.xml lists every public page including all docs and the
top-level analytics surfaces. Dynamic per-entity URLs (account / tx /
ledger / token detail pages) are not enumerated in the sitemap due to
volume but are crawlable via in-app links and the global search bar
in the top navigation.

## Brand

Built and operated by Timothy Ali (https://timothyali.com).
Twitter / X: @sonde_xrpl.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
