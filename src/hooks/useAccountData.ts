"use client";

/**
 * useAccountData — SWR-based hook that fetches the account-page tx
 * history via the client-side XRPL WebSocket, with CH-backed cursor
 * pagination for "load more" when `initialHistory` is provided.
 *
 * Live ledger state lives in dedicated per-tab hooks now:
 *   - useAccountObjects        — account_objects (paginated)
 *   - useAccountOffers         — account_offers
 *   - useAccountNfts           — account_nfts
 *   - useAccountAmmPositions   — amm_info per LP
 *   - useAccountTokenPrices    — POST /api/account/token-prices
 *   - useAccountAncestry       — initial CH ancestry + rippled fallback
 *   - useAccountActivations    — CH lifetime endpoint
 *   - useAccountNftBids        — nft_buy_offers fan-out
 *
 * This hook is now solely the tx-history surface (transactions + cursor
 * paginate). Consumers that previously read other domains off the
 * monolith have all moved to per-tab hooks (Tier 2 PR 2).
 */

import useSWR from "swr";
import { useXrpl } from "./useXrplWs";
import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import type { AccountTxResult } from "@/types/xrpl";

export interface AccountTxCursor {
  timestamp: string;
  txHash: string;
}

/** Server-rendered initial slice. The account page fetches this from
 *  ClickHouse during SSR and threads it through to skip the rippled
 *  history call on first render. `ancestry` is consumed by ProfileTab
 *  + AccountOverview via `useAccountAncestry(address, initialAncestry)`. */
export interface InitialAccountHistory {
  transactions: AccountTxResult["transactions"];
  /** Cursor for the next older page. `null` at the end of history. */
  nextCursor: AccountTxCursor | null;
  /** Latest ledger_index represented in the history. Drives the "as of
   *  ledger N → live" status pill once the live hydrate catches up. */
  asOfLedger: number | null;
  /** Server-derived ancestry from CH's `value_transfer_events`. `null`
   *  falls through to the rippled fallback inside `useAccountAncestry`. */
  ancestry: AncestryData | null;
}

/* ------------------------------------------------------------------ */
/*  Shared types — exported here for back-compat with the per-tab hooks
 *  + their consumers (ProfileTab, ActivationsList, AncestryDisplay,
 *  etc.). Future cleanup may relocate to `src/types/account.ts`.       */
/* ------------------------------------------------------------------ */

export interface Activation {
  activatedAddress: string;
  date: number | null;
  amount: string;
  hash: string;
}

export interface AncestryData {
  parentAddress: string | null;
  activationDate: number | null;
  fundingAmount: string | null;
  activationHash: string | null;
  activationLedgerIndex: number | null;
  activationTxIndex: number | null;
}

export interface AccountData {
  transactions: AccountTxResult["transactions"];
  txMarker: unknown;
}

/* ------------------------------------------------------------------ */
/*  Fetch logic                                                        */
/* ------------------------------------------------------------------ */

type SendFn = (command: Record<string, unknown>) => Promise<unknown>;

async function fetchAccountTxHistory(
  address: string,
  send: SendFn,
  initialHistory?: InitialAccountHistory,
): Promise<AccountData> {
  // When initialHistory is provided, skip the rippled call entirely.
  // The server already has this data from CH.
  if (initialHistory) {
    return {
      transactions: initialHistory.transactions,
      txMarker: null,
    };
  }
  const result = (await send({
    command: "account_tx",
    account: address,
    ledger_index_min: -1,
    ledger_index_max: -1,
    limit: 20,
  })) as AccountTxResult;
  return {
    transactions: result.transactions ?? [],
    txMarker: result.marker ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useAccountData(
  address: string,
  initialHistory?: InitialAccountHistory,
) {
  const { send, connected } = useXrpl();

  // Stable ref to send so SWR fetcher doesn't re-trigger on reconnect.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Pin initial history into a ref — server-rendered + immutable, but
  // prop identity may change between renders.
  const initialHistoryRef = useRef(initialHistory);
  useEffect(() => {
    initialHistoryRef.current = initialHistory;
  }, [initialHistory]);

  const fetcher = useCallback(
    () =>
      fetchAccountTxHistory(
        address,
        sendRef.current,
        initialHistoryRef.current,
      ),
    [address],
  );

  const { data, error, isLoading, isValidating } = useSWR(
    connected ? `account-data:${address}` : null,
    fetcher,
    {
      dedupingInterval: 10_000,
      keepPreviousData: true,
      errorRetryCount: 2,
      revalidateOnFocus: false,
    },
  );

  // Tx pagination — CH-backed cursor when initialHistory was provided
  // (cursor = { timestamp, txHash } against the API route); legacy
  // rippled marker pagination otherwise (back-compat path).
  const [extraTxs, setExtraTxs] = useState<AccountTxResult["transactions"]>(
    [],
  );
  const [currentCursor, setCurrentCursor] = useState<AccountTxCursor | null>(
    initialHistory?.nextCursor ?? null,
  );
  const [currentMarker, setCurrentMarker] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reset extras when address changes — protects against cross-account leak.
  const prevAddressRef = useRef(address);
  useEffect(() => {
    if (address !== prevAddressRef.current) {
      prevAddressRef.current = address;
      setExtraTxs([]);
      setCurrentCursor(initialHistory?.nextCursor ?? null);
      setCurrentMarker(null);
      setLoadingMore(false);
    }
  }, [address, initialHistory]);

  // Also reset when SWR re-validates the same account (data identity changes).
  const prevDataRef = useRef(data);
  useEffect(() => {
    if (data && data !== prevDataRef.current) {
      prevDataRef.current = data;
      setExtraTxs([]);
      setCurrentCursor(initialHistory?.nextCursor ?? null);
      setCurrentMarker(initialHistory ? null : data.txMarker);
    }
  }, [data, initialHistory]);

  const hasMoreTransactions = currentCursor != null || currentMarker != null;

  const loadMoreTransactions = useCallback(async () => {
    if (loadingMore) return;
    if (!currentCursor && !currentMarker) return;
    setLoadingMore(true);
    try {
      if (currentCursor) {
        // CH-backed cursor pagination via the API route. No public-rippled
        // round trip — local CH read.
        const url =
          `/api/account/${encodeURIComponent(address)}/transactions` +
          `?before_ts=${encodeURIComponent(currentCursor.timestamp)}` +
          `&before_hash=${encodeURIComponent(currentCursor.txHash)}` +
          `&limit=50`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as {
          items: AccountTxResult["transactions"];
          nextCursor: AccountTxCursor | null;
        };
        setExtraTxs((prev) => [...prev, ...(json.items ?? [])]);
        setCurrentCursor(json.nextCursor);
      } else if (currentMarker) {
        const result = (await sendRef.current({
          command: "account_tx",
          account: address,
          ledger_index_min: -1,
          ledger_index_max: -1,
          limit: 20,
          marker: currentMarker,
        })) as AccountTxResult;
        setExtraTxs((prev) => [...prev, ...(result.transactions ?? [])]);
        setCurrentMarker(result.marker ?? null);
      }
    } catch {
      /* proceed with what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [address, currentCursor, currentMarker, loadingMore]);

  const mergedData = useMemo(
    () =>
      data
        ? {
            ...data,
            transactions: [...data.transactions, ...extraTxs],
          }
        : null,
    [data, extraTxs],
  );

  return {
    data: mergedData,
    error,
    isLoading,
    isValidating,
    hasMoreTransactions,
    loadMoreTransactions,
    loadingMoreTransactions: loadingMore,
  };
}

/* ------------------------------------------------------------------ */
/*  Issued tokens — server-side fetch                                  */
/*                                                                     */
/*  Routed through /api/account/[address]/issued-tokens so heavy       */
/*  issuers (thousands of trust lines → multi-second gateway_balances  */
/*  response) don't time out on the shared browser WS. Server uses     */
/*  the long-timeout xrplClient and caches for 60s.                    */
/* ------------------------------------------------------------------ */

export function useIssuedTokens(address: string, ready: boolean) {
  const { data, error, isLoading } = useSWR<{
    obligations: Record<string, string>;
  }>(
    ready ? `/api/account/${address}/issued-tokens` : null,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      errorRetryCount: 1,
    },
  );

  return {
    issuedTokens: data?.obligations ?? {},
    error,
    isLoading,
  };
}
