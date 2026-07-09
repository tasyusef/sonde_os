export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Fetch failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const CACHE_KEYS = {
  feeBurn: (period: string) => `/api/analytics/fee-burn?period=${period}`,
  txVolume: (period: string) => `/api/analytics/tx-volume?period=${period}`,
  dexVolume: (period: string) => `/api/analytics/dex-volume?period=${period}`,
  corridors: (period: string, limit = 15) =>
    `/api/analytics/corridors?period=${period}&limit=${limit}`,
  nftActivity: (period: string) => `/api/analytics/nft-activity?period=${period}`,
  ammRevenue: (period: string) => `/api/analytics/amm-revenue?period=${period}`,
  tokenMovers: (period: string) => `/api/analytics/token-movers?period=${period}&limit=10`,
  topGainers: (limit = 10, direction: "gainers" | "losers" = "gainers") =>
    `/api/analytics/top-gainers?limit=${limit}&direction=${direction}`,
  topDexPairs: (limit = 10) => `/api/analytics/top-dex-pairs?limit=${limit}`,
  trustlineWinners: (limit = 10) => `/api/analytics/trustline-winners?limit=${limit}`,
  dexTvl: () => `/api/analytics/dex-tvl`,
  tokenList: (offset: number, limit = 100) =>
    `/api/tokens/list?offset=${offset}&limit=${limit}`,
  ammList: (offset: number, limit = 100) =>
    `/api/amms/list?offset=${offset}&limit=${limit}`,
  tokenSearch: (q: string, limit = 20) =>
    `/api/tokens/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  tokenOhlc: (c: string, i: string, p: string) =>
    `/api/tokens/ohlc?currency=${encodeURIComponent(c)}&issuer=${encodeURIComponent(i)}&period=${p}`,
  tokenHolders: (c: string, i: string, p: string) =>
    `/api/tokens/holders?currency=${encodeURIComponent(c)}&issuer=${encodeURIComponent(i)}&period=${p}`,
  topTraders: (mode: string, period: string) =>
    `/api/analytics/top-traders?mode=${mode}&period=${period}`,
  priceHistory: (days: number | "max", tsym: string) =>
    `/api/price-history?days=${days}&tsym=${tsym}`,
  tradingPairs: (period: string, limit = 5) =>
    `/api/rankings/token-pairs?period=${period}&limit=${limit}`,
  nftMarketplaces: (period: string, limit = 5) =>
    `/api/rankings/nft-marketplaces?period=${period}&limit=${limit}`,
  nftCollections: (period: string, limit = 5) =>
    `/api/rankings/nft-collections?period=${period}&limit=${limit}`,
  activeWallets: (period: string) =>
    `/api/analytics/active-wallets?period=${period}`,
  xrpSupply: (period: string) =>
    `/api/analytics/xrp-supply?period=${period}`,
  networkGrowth: (period: string) =>
    `/api/analytics/network-growth?period=${period}`,
  tokenVelocity: (period: string) =>
    `/api/analytics/token-velocity?period=${period}`,
  portfolioHistory: (period: string) =>
    `/api/portfolio/history?period=${period}`,
  portfolioHistoryWithTokens: (period: string) =>
    `/api/portfolio/history?period=${period}&includeTokenBreakdown=first`,
  portfolioCurrent: () => `/api/portfolio/current`,
  portfolioTokens: () => `/api/portfolio/tokens`,
  portfolioNfts: () => `/api/portfolio/nfts`,
  portfolioAmm: () => `/api/portfolio/amm`,
  portfolioActivity: (type?: string) =>
    `/api/portfolio/activity?limit=50${type ? `&type=${encodeURIComponent(type)}` : ""}`,
  tokenHealth: (c: string, i: string) =>
    `/api/intel/token-health?currency=${encodeURIComponent(c)}&issuer=${encodeURIComponent(i)}`,
  counterparties: (account: string) =>
    `/api/intel/counterparties?account=${encodeURIComponent(account)}`,
  anomalies: () => `/api/intel/anomalies`,
  smartMoneyLeaderboard: (limit = 10, offset = 0) =>
    `/api/smart-money/leaderboard?limit=${limit}&offset=${offset}`,
  smartMoneyDetail: (address: string) =>
    `/api/smart-money/${encodeURIComponent(address)}`,
  smartMoneyHistory: (address: string) =>
    `/api/smart-money/${encodeURIComponent(address)}/history`,
  smartMoneyFeed: (direction?: string) =>
    `/api/smart-money/feed?limit=50${direction && direction !== "all" ? `&direction=${direction}` : ""}`,
  smartMoneyHoldings: (address: string) =>
    `/api/smart-money/${encodeURIComponent(address)}/holdings`,
};
