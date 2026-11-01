/**
 * useXrplQuery — the one way components read the XRP Ledger.
 *
 * SWR caches and shares each key; `query-runs` adds what SWR lacks:
 * - Waits for the first connection (`ready`), not `connected`, so a
 *   reconnect doesn't blank the page.
 * - Fetches once: no revalidation on mount, focus or reconnect, and no
 *   previous key's data shown under a new key.
 * - Cancels: when no component wants a key anymore, its run is aborted
 *   and every request it hasn't sent yet is dropped.
 * - Walks can `progress()` partial results; readers get them until the
 *   final data lands.
 * - `maxAgeMs` (account state, which changes): a mount that finds data
 *   older than this refetches it, keeping the old data on screen.
 *   Tab switches within that window cost nothing.
 * - Loaded data wins over a later failure (`queryStatus`).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import useSWR, { unstable_serialize, type SWRConfiguration } from "swr";
import {
  getQueryProgress,
  isQueryRunning,
  queryFetchedAt,
  retainQuery,
  runQuery,
  subscribeQueryProgress,
} from "@/lib/query-runs";
import { queryStatus } from "@/lib/query-status";
import { isAbortError } from "@/lib/xrpl-errors";
import type { SendFn } from "@/lib/xrpl-pagination";
import { useXrpl } from "./useXrplWs";

export interface QueryContext<P> {
  /** `send` bound to this run's signal. */
  send: SendFn;
  signal: AbortSignal;
  /** Publish a partial result while a long walk runs. */
  progress: (value: P) => void;
}

export interface XrplQuery<T, P> {
  data: T | undefined;
  /** The last failure, while there's no data to show. Never an abort. */
  error: unknown;
  /** Partial result of the run in flight, until `data` arrives. */
  progress: P | undefined;
  /** No data yet and no settled error: connecting, fetching or
   *  retrying. False while the caller passes a null key. */
  isLoading: boolean;
  /** No data, and no XRPL node has been reachable for a while. */
  unreachable: boolean;
  isValidating: boolean;
  /** Refetch, reconnecting first if no node is open. */
  retry: () => void;
}

export const ONE_SHOT: SWRConfiguration = {
  keepPreviousData: false,
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
};

/** Account state (balances, objects, offers) older than this is
 *  refetched when a view mounts. */
export const ACCOUNT_DATA_MAX_AGE_MS = 5 * 60_000;

const noop = () => () => {};

export interface XrplQueryConfig<T> extends SWRConfiguration<T> {
  maxAgeMs?: number;
}

export function useXrplQuery<T, P = never>(
  key: readonly unknown[] | null,
  fetcher: (ctx: QueryContext<P>) => Promise<T>,
  { maxAgeMs, ...config }: XrplQueryConfig<T> = {},
): XrplQuery<T, P> {
  const { send, ready, unreachable, reconnect } = useXrpl();
  const swrKey = ready && key ? key : null;
  const id = swrKey ? unstable_serialize(swrKey) : null;

  useEffect(() => (id ? retainQuery(id) : undefined), [id]);

  const progress = useSyncExternalStore(
    useCallback((cb: () => void) => (id ? subscribeQueryProgress(id, cb) : noop()), [id]),
    () => (id ? (getQueryProgress(id) as P | undefined) : undefined),
    () => undefined,
  );

  const retryOnError = config.shouldRetryOnError;
  const { data, error, isValidating, mutate } = useSWR<T>(
    swrKey,
    () =>
      runQuery(id!, ({ signal, publish }) =>
        fetcher({
          send: (command, opts) => send(command, { ...opts, signal }),
          signal,
          progress: publish,
        }),
      ),
    {
      ...ONE_SHOT,
      ...config,
      shouldRetryOnError: (err) =>
        !isAbortError(err) &&
        (typeof retryOnError === "function" ? retryOnError(err) : retryOnError !== false),
    },
  );

  useEffect(() => {
    if (!id || maxAgeMs === undefined) return;
    const at = queryFetchedAt(id);
    if (at !== undefined && Date.now() - at > maxAgeMs && !isQueryRunning(id)) void mutate();
  }, [id, maxAgeMs, mutate]);

  const status = queryStatus({
    keyed: key !== null,
    hasData: data !== undefined,
    error,
    isValidating,
    unreachable,
  });
  return {
    data,
    error: status.error,
    progress: data === undefined ? progress : undefined,
    isLoading: status.isLoading,
    unreachable: status.unreachable,
    isValidating,
    retry: useCallback(() => {
      reconnect();
      void mutate();
    }, [reconnect, mutate]),
  };
}
