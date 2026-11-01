import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetchCoinGeckoPrice } from "@/lib/xrp-price";
import type { PriceData } from "@/types/live-data";
import { useLiveData } from "./useLiveData";

const RELAY_CONFIGURED = !!import.meta.env.VITE_LIVE_RELAY_URL;
/** How long to wait for a relay snapshot with a price before asking
 *  CoinGecko instead. */
const RELAY_GRACE_MS = 8_000;
const FALLBACK_REFRESH_MS = 5 * 60_000;

/** XRP/USD from the relay snapshot; CoinGecko from the browser when the
 *  relay has none. Null until one of them answers. */
export function useXrpPrice(): PriceData | null {
  const { price } = useLiveData();
  const [graceOver, setGraceOver] = useState(!RELAY_CONFIGURED);

  useEffect(() => {
    if (graceOver) return;
    const timer = setTimeout(() => setGraceOver(true), RELAY_GRACE_MS);
    return () => clearTimeout(timer);
  }, [graceOver]);

  const { data } = useSWR(!price && graceOver ? "xrp-price:coingecko" : null, fetchCoinGeckoPrice, {
    refreshInterval: FALLBACK_REFRESH_MS,
    dedupingInterval: FALLBACK_REFRESH_MS,
    revalidateOnFocus: false,
    errorRetryCount: 1,
  });

  return price ?? data ?? null;
}
