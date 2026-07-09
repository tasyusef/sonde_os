"use client";

import { useEffect, useState } from "react";
import { useXrpl } from "@/hooks/useXrplWs";
import type { TokenListItem } from "@/lib/token-types";
import type { BookOffersResponse } from "@/types/xrpl-responses";

/**
 * Fetches live DEX prices for a batch of tokens via the client's own
 * browser WebSocket connection. Returns a map of "currency:issuer" → price.
 *
 * Batches requests 10 at a time to avoid flooding the WS.
 * Re-fetches when the token list identity changes.
 */

const BATCH_SIZE = 10;

function parseAmount(
  amount: string | { currency: string; issuer: string; value: string },
): number {
  if (typeof amount === "string") return parseFloat(amount) / 1_000_000;
  return parseFloat(amount.value);
}

export function useTokenPrices(tokens: TokenListItem[]): Map<string, number> {
  const { send, connected } = useXrpl();
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map());

  // Build a stable identity string so we only refetch when the actual token set changes
  const tokenIdentity = tokens
    .map((t) => `${t.currency}:${t.issuer}`)
    .join(",");

  useEffect(() => {
    if (!connected || tokens.length === 0) return;

    // The `cancelled` flag is the only guard we need against stale
    // writes — the previous `fetchingRef` short-circuit had a bug
    // where rapid token-set changes mid-flight skipped the new fetch
    // entirely (fetchingRef stayed true while the cleanup ran in
    // parallel). Letting the old fetch complete + drop its result via
    // `cancelled` is the simpler-and-correct shape.
    let cancelled = false;

    async function fetchPrices() {
      const pairs = tokens.map((t) => ({
        currency: t.currency,
        issuer: t.issuer,
      }));

      const newPrices = new Map<string, number>();

      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        if (cancelled) break;
        const batch = pairs.slice(i, i + BATCH_SIZE);

        const results = await Promise.allSettled(
          batch.map(async (p) => {
            const result = (await send({
              command: "book_offers",
              taker_gets: { currency: p.currency, issuer: p.issuer },
              taker_pays: { currency: "XRP" },
              limit: 1,
            })) as BookOffersResponse;

            const offer = result.offers?.[0];
            if (!offer) return null;

            const tokenAmt = parseAmount(offer.TakerGets);
            const xrpAmt = parseAmount(offer.TakerPays);
            if (tokenAmt <= 0) return null;

            const price = xrpAmt / tokenAmt;
            return isFinite(price) && price > 0
              ? { key: `${p.currency}:${p.issuer}`, price }
              : null;
          }),
        );

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            newPrices.set(r.value.key, r.value.price);
          }
        }
      }

      if (!cancelled) {
        setPriceMap((prev) => {
          // Merge new prices with existing (keeps prices from previous pages)
          const merged = new Map(prev);
          for (const [k, v] of newPrices) merged.set(k, v);
          return merged;
        });
      }
    }

    fetchPrices();

    return () => {
      cancelled = true;
    };
    // `tokens` is intentionally tracked via `tokenIdentity` (the joined
    // currency:issuer string) so identical token sets across renders
    // don't refire — only changes to the token *content* trigger a
    // refetch. eslint can't see the derived equivalence so the disable
    // stays. `send` is in deps for completeness even though it's
    // useCallback-stable from useXrpl().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, tokenIdentity, send]);

  return priceMap;
}
