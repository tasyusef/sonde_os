/**
 * useAccountOffers — the account's open DEX offers (`account_offers`).
 * Only the Offers tab reads them, so they load when it opens.
 */

import { useMemo } from "react";
import { collectPages, PAGE_CAP, walkOutcome, XRPL_MAX_LIMIT, type Walk } from "@/lib/xrpl-pagination";
import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

type Offer = Record<string, unknown>;
const NONE: Offer[] = [];

export function useAccountOffers(address: string) {
  const { data, error, isLoading, retry } = useXrplQuery<Walk<Offer>>(
    address ? ["account-offers", address] : null,
    async ({ send, signal }) =>
      walkOutcome(
        await collectPages<Offer>(
          send,
          { command: "account_offers", account: address, ledger_index: "validated", limit: XRPL_MAX_LIMIT },
          (page) => page.offers as Offer[] | undefined,
          { maxPages: PAGE_CAP, signal },
        ),
      ),
    { maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );

  return useMemo(
    () => ({
      offers: data?.items ?? NONE,
      isLoading,
      error,
      truncated: !!data?.truncated,
      partial: !!data?.partial,
      retry,
    }),
    [data, error, isLoading, retry],
  );
}
