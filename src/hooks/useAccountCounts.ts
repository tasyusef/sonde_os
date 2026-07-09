"use client";

import useSWR from "swr";

interface AccountCounts {
  sentCount: number;
  receivedCount: number;
  totalCount: number;
  firstSeenLedger: number | null;
  lastSeenLedger: number | null;
  /** Earliest ledger present in CH's transactions table. When the
   *  account's `firstSeenLedger` is below this, lifetime activity
   *  predates our retention window and isn't fully servable from CH. */
  indexMinLedger: number | null;
  /** Earliest timestamp in CH (CH `DateTime` literal). Used by the UI
   *  to render a human-readable cutoff like "May 2025". */
  indexMinTimestamp: string | null;
}

/**
 * Fetches lifetime tx counters for an account from /api/account/[address]/counts
 * (Postgres — populated incrementally by ingestion + periodically reconciled
 * from ClickHouse).
 *
 * This is a parallel/lazy path to the monolithic `useAccountData` fetch:
 * counts arrive in ~500ms regardless of how heavy the account is, so the
 * Transactions tab label can show "Transactions (1,234,567)" immediately
 * instead of waiting 6+s for the full XRPL pagination chain.
 *
 * Not available for accounts active only before ingestion started — those
 * return zeros. Once the 12-month backfill completes most real accounts
 * will have accurate lifetime numbers.
 */
export function useAccountCounts(address: string) {
  const { data, error, isLoading } = useSWR<AccountCounts>(
    address ? `/api/account/${address}/counts` : null,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      errorRetryCount: 1,
    },
  );

  return {
    counts: data ?? null,
    error,
    isLoading,
  };
}
