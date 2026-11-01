import useSWR from "swr";
import { fetchPriceHistory, type PriceRange, RANGES } from "@/lib/price-history";

/**
 * XRP/USD candles for one range, refetched as often as its newest
 * candle changes. The last range stays on screen while the next one
 * loads (`switching`), so the chart doesn't blank on every toggle.
 */
export function usePriceHistory(range: PriceRange) {
  const { data, error, mutate } = useSWR(["price-history", range], ([, r]) => fetchPriceHistory(r), {
    refreshInterval: RANGES[range].refreshMs,
    keepPreviousData: true,
    errorRetryCount: 1,
  });
  const current = data?.range === range ? data : null;
  return {
    history: data ?? null,
    switching: !!data && !current && !error,
    failed: !!error && !current,
    retry: () => void mutate(),
  };
}
