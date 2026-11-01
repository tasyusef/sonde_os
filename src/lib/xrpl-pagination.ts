/**
 * The WS `send` signature plus a shared marker pager for XRPL list
 * commands (account_objects, account_nfts, nft_buy_offers, …).
 *
 *   - XRPL_MAX_LIMIT — rippled's accepted upper bound. 400 cuts
 *     round-trips 8× vs. the default 50 on heavy accounts.
 *   - PAGE_CAP — bounds runaway loops on pathological accounts.
 *     50 × 400 = 20,000 item ceiling per command.
 */
import { isAbortError, isNotFoundError } from "./xrpl-errors";

export const XRPL_MAX_LIMIT = 400;
export const PAGE_CAP = 50;

export interface SendOptions {
  /** Reply timeout. Default 8 s; expanded ledgers and heavy
   *  `gateway_balances` need ~25 s. */
  timeoutMs?: number;
  /** Drop the request: it rejects with `signal.reason` and, if not sent
   *  yet, never goes out. */
  signal?: AbortSignal;
  /** Ask a full-history node (Clio) instead of the active one. */
  fullHistory?: boolean;
}

export type SendFn = (command: Record<string, unknown>, opts?: SendOptions) => Promise<unknown>;

export interface PageResult<T> {
  items: T[];
  /** Marker for the next page; undefined when the list is complete. */
  marker?: unknown;
  /** The error that stopped paging early, if any. Items fetched before
   *  it are kept. */
  error?: unknown;
  /** `signal` fired before the walk finished. */
  aborted?: boolean;
  /** The ledger every page came from, when the node reported one. */
  ledgerIndex?: number;
}

export interface CollectOptions<T> extends Pick<SendOptions, "timeoutMs" | "signal"> {
  maxPages: number;
  /** Resume from this marker instead of the first page. */
  marker?: unknown;
  /** Called after each page with everything collected so far. */
  onPage?: (items: T[]) => void;
}

/**
 * Follow `marker` through up to `maxPages` pages of `command`, picking
 * each page's rows with `pick`. Never throws: a failed page ends the
 * walk and is reported in `error`; an abort ends it with `aborted`.
 *
 * When `command` names a `ledger_index` ("validated"), pages after the
 * first ask for the exact ledger page 1 came from. A marker only makes
 * sense against the ledger it was cut from; without the pin, rows that
 * move between ledgers get skipped or repeated.
 */
export async function collectPages<T>(
  send: SendFn,
  command: Record<string, unknown>,
  pick: (page: Record<string, unknown>) => T[] | undefined,
  { maxPages, marker: start, onPage, timeoutMs, signal }: CollectOptions<T>,
): Promise<PageResult<T>> {
  const items: T[] = [];
  const opts = timeoutMs || signal ? { timeoutMs, signal } : undefined;
  let marker = start;
  let base = command;
  let ledgerIndex: number | undefined;
  const result = (extra: Partial<PageResult<T>> = {}): PageResult<T> => ({
    items,
    marker,
    ...(ledgerIndex === undefined ? {} : { ledgerIndex }),
    ...extra,
  });

  for (let page = 0; page < maxPages; page++) {
    if (signal?.aborted) return result({ aborted: true });
    try {
      const res = (await send(marker === undefined ? base : { ...base, marker }, opts)) as Record<
        string,
        unknown
      >;
      if (signal?.aborted) return result({ aborted: true });
      if (ledgerIndex === undefined && command.ledger_index !== undefined && typeof res.ledger_index === "number") {
        ledgerIndex = res.ledger_index;
        base = { ...command, ledger_index: ledgerIndex };
      }
      items.push(...(pick(res) ?? []));
      marker = res.marker ?? undefined;
      onPage?.(items.slice());
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return result({ aborted: true });
      return result({ error });
    }
    if (marker === undefined) break;
  }
  return result();
}

/** A finished walk as data. */
export interface Walk<T> {
  items: T[];
  /** Stopped at the page cap with more left. */
  truncated: boolean;
  /** A page failed after earlier ones loaded. */
  partial: boolean;
}

/** Read a walk's result as data, or throw its error when not even the
 *  first page loaded. */
export function walkOutcome<T>(res: PageResult<T>): Walk<T> {
  if (res.error !== undefined && res.items.length === 0) throw res.error;
  return {
    items: res.items,
    truncated: res.error === undefined && !res.aborted && res.marker !== undefined,
    partial: res.error !== undefined,
  };
}

/** `walkOutcome` for commands that answer "none" with a not-found error
 *  (`nft_buy_offers`, `nft_sell_offers`): that's an empty, complete walk.
 *  Any other failure still throws or marks the walk partial. */
export function walkOrNone<T>(res: PageResult<T>): Walk<T> {
  if (isNotFoundError(res.error)) return { items: res.items, truncated: false, partial: false };
  return walkOutcome(res);
}

/**
 * `Promise.allSettled` over `items`, at most `limit` requests in flight.
 * Public nodes answer a burst of 50 with `tooBusy`; a small pool keeps
 * fan-outs (one request per NFT, per amendment…) under that.
 *
 * Once `signal` fires no new item starts; the ones never started settle
 * as rejected with `signal.reason`.
 */
export async function settledPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal?.aborted) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  for (let i = next; i < items.length; i++) results[i] = { status: "rejected", reason: signal?.reason };
  return results;
}
