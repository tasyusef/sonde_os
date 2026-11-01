import { isAbortError } from "./xrpl-errors";

export interface QueryStatusInput {
  /** The caller passed a key (it may still wait on the connection). */
  keyed: boolean;
  hasData: boolean;
  error: unknown;
  isValidating: boolean;
  /** No node has been reachable for a while (`useXrpl().unreachable`). */
  unreachable?: boolean;
}

export interface QueryStatus {
  /** The failure to show: only while there's no data, never an abort. */
  error: unknown;
  /** No data yet and no settled error. */
  isLoading: boolean;
  /** No data, and no node to ask: show "can't reach", not a skeleton. */
  unreachable: boolean;
}

/**
 * What a query's readers see. Loaded data always wins: a failed
 * background refresh (account revisit, pending-tx poll) keeps the data
 * on screen instead of replacing it with an error.
 */
export function queryStatus({
  keyed,
  hasData,
  error,
  isValidating,
  unreachable = false,
}: QueryStatusInput): QueryStatus {
  const shown = hasData || isAbortError(error) ? undefined : error;
  return {
    error: shown,
    isLoading: keyed && !hasData && (shown === undefined || isValidating),
    unreachable: keyed && !hasData && unreachable,
  };
}
