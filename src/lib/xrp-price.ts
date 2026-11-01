import type { PriceData } from "@/types/live-data";

/** CoinGecko's public markets endpoint. It sends CORS headers, so the
 *  browser can use it when the relay has no price. */
export const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ripple";

interface CoinGeckoMarket {
  current_price?: number | null;
  price_change_percentage_24h?: number | null;
  market_cap?: number | null;
  total_volume?: number | null;
  high_24h?: number | null;
  low_24h?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
}

/** `/coins/markets` response → PriceData, or null without a price. */
export function priceFromCoinGecko(json: unknown): PriceData | null {
  const row = (Array.isArray(json) ? json[0] : null) as CoinGeckoMarket | null | undefined;
  if (!row) return null;
  const price = row.current_price;
  if (typeof price !== "number" || !(price > 0)) return null;
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    price,
    change24h: n(row.price_change_percentage_24h),
    marketCap: n(row.market_cap),
    volume24h: n(row.total_volume),
    high24h: n(row.high_24h),
    low24h: n(row.low_24h),
    circulatingSupply: n(row.circulating_supply),
    totalSupply: n(row.total_supply),
  };
}

export async function fetchCoinGeckoPrice(): Promise<PriceData> {
  const res = await fetch(COINGECKO_MARKETS_URL, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const price = priceFromCoinGecko(await res.json());
  if (!price) throw new Error("CoinGecko: no price");
  return price;
}
