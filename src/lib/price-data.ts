import "server-only";
import type { PriceData } from "@/types/live-data";
import logger from "./logger";

const log = logger.child({ module: "price" });

export interface PriceHistory {
  timestamp: number;
  price: number;
  marketCap: number;
}

/* ——— CryptoCompare response types ——— */

interface CryptoCompareOHLCV {
  time: number;
  close: number;
  high: number;
  low: number;
  open: number;
  volumefrom: number;
  volumeto: number;
}

interface CryptoCompareHistoryResponse {
  Response: string;
  Data: { Data: CryptoCompareOHLCV[] };
}

interface CryptoCompareRaw {
  RAW: {
    XRP: {
      USD: {
        PRICE: number;
        CHANGEPCT24HOUR: number;
        CIRCULATINGSUPPLYMKTCAP: number;
        TOTALVOLUME24H: number;
        HIGH24HOUR: number;
        LOW24HOUR: number;
        CIRCULATINGSUPPLY: number;
        SUPPLY: number;
      };
    };
  };
}

/* ——— Bitstamp response type ——— */

interface BitstampTicker {
  last: string;
  percent_change_24: string;
  volume: string;
  high: string;
  low: string;
}

/* ——— CoinGecko response type ——— */

interface CoinGeckoPrice {
  market_data: {
    current_price: { usd: number };
    price_change_percentage_24h: number;
    market_cap: { usd: number };
    total_volume: { usd: number };
    high_24h: { usd: number };
    low_24h: { usd: number };
    circulating_supply: number;
    total_supply: number;
  };
}

/* ——— Helpers ——— */

/**
 * Pick the right CryptoCompare endpoint + limit for a given number of days.
 *
 *   histominute  → 1-minute candles  (1D range)
 *   histohour    → 1-hour candles    (5D–3M range)
 *   histoday     → 1-day candles     (6M+ range)
 */
function historyParams(days: number | "max"): { endpoint: string; limit: number | "allData" } {
  if (days === "max") return { endpoint: "histoday", limit: "allData" };
  if (days <= 1) return { endpoint: "histominute", limit: 1440 }; // full 24h
  if (days < 90) return { endpoint: "histohour", limit: days * 24 };
  return { endpoint: "histoday", limit: days };
}

/* ——— In-memory price cache ——— */

/** TTL for the in-memory price cache (5 min) */
const PRICE_CACHE_TTL = 5 * 60 * 1000;

let _cachedPrice: PriceData | null = null;
let _cachedAt = 0;
let _inflight: Promise<PriceData> | null = null;

/* ——— Market data cache (supply/marketcap — separate from spot price) ——— */

interface MarketData {
  marketCap: number;
  circulatingSupply: number;
  totalSupply: number;
}

const MARKET_CACHE_TTL = 10 * 60 * 1000; // 10 min — supply changes slowly
let _cachedMarket: MarketData | null = null;
let _cachedMarketAt = 0;

/* ——— Price history cache ——— */

interface HistoryCacheEntry {
  data: PriceHistory[];
  ts: number;
}

// Keyed by `${days}|${tsym}`. The candle granularity is the only
// dimension that affects fetch cost — minute candles for 1-day windows
// expire fast, daily candles for long ranges expire slowly.
const _historyCache = new Map<string, HistoryCacheEntry>();
const _historyInflight = new Map<string, Promise<PriceHistory[]>>();

function historyCacheKey(days: number | "max", tsym: string): string {
  return `${days}|${tsym}`;
}

function historyTtlMs(days: number | "max"): number {
  if (days === "max") return 30 * 60 * 1000; // daily candles, updates once/day
  if (days <= 1) return 60 * 1000;            // minute candles, freshest tier
  if (days < 90) return 5 * 60 * 1000;        // hourly candles
  return 30 * 60 * 1000;                      // daily candles
}

/* ——— Public API ——— */

const CC_KEY = process.env.CRYPTOCOMPARE_API_KEY ?? "";
const ccParam = CC_KEY ? `&api_key=${CC_KEY}` : "";

/**
 * Get the current XRP price.
 * Primary: Bitstamp (matches TradingView widget) + CryptoCompare for market cap.
 * Fallback: CryptoCompare full → CoinGecko.
 * Shared in-memory cache (5 min TTL) deduplicates calls across all consumers.
 */
export async function getXrpPrice(): Promise<PriceData> {
  // Return cached value if fresh
  if (_cachedPrice && Date.now() - _cachedAt < PRICE_CACHE_TTL) {
    return _cachedPrice;
  }

  // Deduplicate concurrent calls — only one fetch in flight at a time
  if (_inflight) return _inflight;

  _inflight = _fetchWithFallback().finally(() => {
    _inflight = null;
  });

  return _inflight;
}

/** Try Bitstamp+market data → CryptoCompare → CoinGecko fallback chain */
async function _fetchWithFallback(): Promise<PriceData> {
  // Primary: Bitstamp for spot price (matches TradingView) + CryptoCompare for supply data
  try {
    const [bitstamp, market] = await Promise.all([
      _fetchFromBitstamp(),
      _fetchMarketData(),
    ]);

    const result: PriceData = {
      ...bitstamp,
      marketCap: market.marketCap || bitstamp.price * market.circulatingSupply,
      circulatingSupply: market.circulatingSupply,
      totalSupply: market.totalSupply,
    };

    _cachedPrice = result;
    _cachedAt = Date.now();
    return result;
  } catch (err) {
    log.warn(
      { error: err instanceof Error ? err.message : err },
      "Bitstamp primary failed, falling back to CryptoCompare",
    );
  }

  // Fallback 1: CryptoCompare (full data)
  try {
    return await _fetchFromCryptoCompare();
  } catch (err) {
    log.warn(
      { error: err instanceof Error ? err.message : err },
      "CryptoCompare failed, falling back to CoinGecko",
    );
  }

  // Fallback 2: CoinGecko
  try {
    return await _fetchFromCoinGecko();
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : err },
      "All price providers failed",
    );
    throw new Error("All price providers failed");
  }
}

/**
 * Bitstamp XRP/USD ticker — same source as the TradingView widget.
 * Public API, no key required. Returns spot price + 24h stats only (no market cap/supply).
 */
async function _fetchFromBitstamp(): Promise<Omit<PriceData, "marketCap" | "circulatingSupply" | "totalSupply">> {
  const res = await fetch(
    "https://www.bitstamp.net/api/v2/ticker/xrpusd/",
    { signal: AbortSignal.timeout(5000) },
  );

  if (!res.ok) {
    throw new Error(`Bitstamp HTTP ${res.status}`);
  }

  const data: BitstampTicker = await res.json();
  const price = parseFloat(data.last);
  if (!price || !isFinite(price)) {
    throw new Error("Invalid Bitstamp price");
  }

  return {
    price,
    change24h: parseFloat(data.percent_change_24) || 0,
    volume24h: (parseFloat(data.volume) || 0) * price, // Bitstamp volume is in XRP, convert to USD
    high24h: parseFloat(data.high) || 0,
    low24h: parseFloat(data.low) || 0,
  };
}

/**
 * Fetch market cap + supply from CryptoCompare (cached 10 min).
 * This is the only call that uses the API key — kept separate and
 * cached longer since supply data changes slowly.
 */
async function _fetchMarketData(): Promise<MarketData> {
  if (_cachedMarket && Date.now() - _cachedMarketAt < MARKET_CACHE_TTL) {
    return _cachedMarket;
  }

  const res = await fetch(
    `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=XRP&tsyms=USD${ccParam}`,
    { signal: AbortSignal.timeout(8000) },
  );

  if (!res.ok) {
    // Return stale cache if available, otherwise use defaults
    if (_cachedMarket) return _cachedMarket;
    return { marketCap: 0, circulatingSupply: 57e9, totalSupply: 100e9 };
  }

  const data = (await res.json()) as CryptoCompareRaw;
  const raw = data?.RAW?.XRP?.USD;

  const result: MarketData = {
    marketCap: raw?.CIRCULATINGSUPPLYMKTCAP ?? 0,
    circulatingSupply: raw?.CIRCULATINGSUPPLY ?? 57e9,
    totalSupply: raw?.SUPPLY ?? 100e9,
  };

  _cachedMarket = result;
  _cachedMarketAt = Date.now();
  return result;
}

async function _fetchFromCryptoCompare(): Promise<PriceData> {
  const res = await fetch(
    `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=XRP&tsyms=USD${ccParam}`,
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) }
  );

  if (!res.ok) {
    throw new Error(`CryptoCompare HTTP ${res.status}`);
  }

  const data = await res.json();
  if (data?.Response === "Error") {
    throw new Error(`CryptoCompare: ${data.Message}`);
  }

  const raw = (data as CryptoCompareRaw)?.RAW?.XRP?.USD;
  if (!raw?.PRICE) {
    throw new Error("Unexpected CryptoCompare response shape");
  }

  const result: PriceData = {
    price: raw.PRICE,
    change24h: raw.CHANGEPCT24HOUR ?? 0,
    marketCap: raw.CIRCULATINGSUPPLYMKTCAP ?? 0,
    volume24h: raw.TOTALVOLUME24H ?? 0,
    high24h: raw.HIGH24HOUR ?? 0,
    low24h: raw.LOW24HOUR ?? 0,
    circulatingSupply: raw.CIRCULATINGSUPPLY ?? 0,
    totalSupply: raw.SUPPLY ?? 0,
  };

  _cachedPrice = result;
  _cachedAt = Date.now();
  return result;
}

async function _fetchFromCoinGecko(): Promise<PriceData> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/ripple?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false",
    { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) }
  );

  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status}`);
  }

  const data: CoinGeckoPrice = await res.json();
  const m = data.market_data;

  const result: PriceData = {
    price: m.current_price.usd,
    change24h: m.price_change_percentage_24h ?? 0,
    marketCap: m.market_cap.usd ?? 0,
    volume24h: m.total_volume.usd ?? 0,
    high24h: m.high_24h.usd ?? 0,
    low24h: m.low_24h.usd ?? 0,
    circulatingSupply: m.circulating_supply ?? 0,
    totalSupply: m.total_supply ?? 0,
  };

  _cachedPrice = result;
  _cachedAt = Date.now();
  return result;
}

/**
 * Fetch XRP price history from CryptoCompare.
 *
 * Granularity adapts to range:
 *   1 day   → minute candles (1440 points = full 24h)
 *   2–89 d  → hourly candles
 *   90+ d   → daily candles
 *   "max"   → all daily candles (back to 2010)
 *
 * Market cap per point is computed as close × circulating supply.
 */
const VALID_TSYMS = new Set(["USD", "BTC", "EUR", "GBP", "JPY", "KRW"]);

export async function getXrpPriceHistory(
  days: number | "max" = 30,
  tsym: string = "USD"
): Promise<PriceHistory[]> {
  // Validate tsym to prevent URL parameter injection
  if (!VALID_TSYMS.has(tsym)) tsym = "USD";

  const key = historyCacheKey(days, tsym);
  const cached = _historyCache.get(key);
  if (cached && Date.now() - cached.ts < historyTtlMs(days)) {
    return cached.data;
  }

  // Dedup in-flight fetches so concurrent /api/price-history requests
  // for the same window share one upstream round-trip.
  const inflight = _historyInflight.get(key);
  if (inflight) return inflight;

  const promise = _fetchPriceHistory(days, tsym)
    .then((data) => {
      _historyCache.set(key, { data, ts: Date.now() });
      return data;
    })
    .finally(() => {
      _historyInflight.delete(key);
    });
  _historyInflight.set(key, promise);
  return promise;
}

async function _fetchPriceHistory(
  days: number | "max",
  tsym: string,
): Promise<PriceHistory[]> {
  const { endpoint, limit } = historyParams(days);

  const query =
    limit === "allData"
      ? `https://min-api.cryptocompare.com/data/v2/${endpoint}?fsym=XRP&tsym=${tsym}&allData=true${ccParam}`
      : `https://min-api.cryptocompare.com/data/v2/${endpoint}?fsym=XRP&tsym=${tsym}&limit=${limit}${ccParam}`;

  // Market cap only makes sense for USD — skip supply fetch for other pairs
  const isUsd = tsym === "USD";

  const [histRes, priceRes] = await Promise.all([
    fetch(query, { next: { revalidate: days === 1 ? 60 : 300 }, signal: AbortSignal.timeout(8000) }),
    isUsd
      ? fetch(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=XRP&tsyms=USD${ccParam}`, {
          next: { revalidate: 300 },
          signal: AbortSignal.timeout(8000),
        })
      : Promise.resolve(null),
  ]);

  if (!histRes.ok) {
    log.error({ status: histRes.status }, "CryptoCompare history returned error");
    throw new Error(`Failed to fetch price history: ${histRes.status}`);
  }

  const histData: CryptoCompareHistoryResponse = await histRes.json();
  if (histData.Response === "Error") {
    log.error("CryptoCompare history error (rate limit or invalid request)");
    return [];
  }
  const points = histData?.Data?.Data ?? [];

  // Get circulating supply for market cap computation (USD only)
  let supply = 61e9; // fallback
  if (isUsd && priceRes?.ok) {
    const priceData: CryptoCompareRaw = await priceRes.json();
    supply = priceData?.RAW?.XRP?.USD?.CIRCULATINGSUPPLY ?? supply;
  }

  return points
    .filter((p) => p.close > 0)
    .map((p) => ({
      timestamp: p.time * 1000, // CryptoCompare uses seconds, we need ms
      price: p.close,
      marketCap: isUsd ? p.close * supply : 0,
    }));
}
