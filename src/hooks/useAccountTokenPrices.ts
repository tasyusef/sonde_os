"use client";

/**
 * useAccountTokenPrices — POST /api/account/token-prices for the
 * account's regular (non-LP) trustlines, returning a `${currency}:${issuer}`
 * → TokenListItem map for portfolio math.
 *
 * Keyed on the sorted set of currency:issuer pairs so the SWR cache
 * holds across re-renders whose input array got a new ref but same
 * contents. Empty input → no fetch, returns {}.
 *
 * Part of the per-tab data-ownership refactor (Tier 2).
 */

import useSWR from "swr";
import { useMemo } from "react";
import type { TrustLine } from "@/components/account/TrustLineList";
import type { TokenListItem } from "@/lib/token-types";

interface TokenPair {
  currency: string;
  issuer: string;
}

async function fetchPrices(
  pairs: TokenPair[],
): Promise<Record<string, TokenListItem>> {
  if (pairs.length === 0) return {};
  try {
    const res = await fetch("/api/account/token-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
    });
    if (!res.ok) return {};
    const tokenResults = (await res.json()) as TokenListItem[];
    return Object.fromEntries(
      tokenResults.map((t) => [`${t.currency}:${t.issuer}`, t]),
    );
  } catch {
    return {};
  }
}

export function useAccountTokenPrices(
  regularTrustLines: TrustLine[],
  address: string,
) {
  const pairs = useMemo<TokenPair[]>(
    () =>
      regularTrustLines.map((tl) => {
        const isHigh = tl.HighLimit.issuer === address;
        return {
          currency: tl.Balance.currency,
          issuer: isHigh ? tl.LowLimit.issuer : tl.HighLimit.issuer,
        };
      }),
    [regularTrustLines, address],
  );

  // Stable key on currency:issuer pair set.
  const pairsKey = useMemo(
    () => pairs.map((p) => `${p.currency}:${p.issuer}`).sort().join("|"),
    [pairs],
  );

  const { data, error, isLoading } = useSWR(
    pairs.length > 0 ? `token-prices:${pairsKey}` : null,
    () => fetchPrices(pairs),
    {
      dedupingInterval: 30_000,
      keepPreviousData: true,
      errorRetryCount: 1,
      revalidateOnFocus: false,
    },
  );

  return {
    tokenPriceMap: data ?? {},
    isLoading,
    error,
  };
}
