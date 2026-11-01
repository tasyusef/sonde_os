/**
 * useAccountObjects — every `account_objects` entry for an address,
 * grouped by type (`groupAccountObjects`). One walk per address feeds
 * the overview and every tab, trust lines included; pages publish as
 * they arrive so whales (~75 pages) render while loading.
 */

import { useMemo } from "react";
import { groupAccountObjects, OBJECT_PAGE_CAP, type AccountObjectGroups, type LedgerObject } from "@/lib/account-objects";
import { collectPages, walkOutcome, XRPL_MAX_LIMIT, type Walk } from "@/lib/xrpl-pagination";
import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

export interface AccountObjectsViews extends AccountObjectGroups {
  /** The walk hasn't finished (groups may hold the pages so far). */
  isLoading: boolean;
  error: unknown;
  /** Stopped at the page cap with more left. */
  truncated: boolean;
  /** A page failed after earlier ones loaded. */
  partial: boolean;
  retry: () => void;
  /** Every ledger object the account owns, all types. */
  objects: LedgerObject[];
}

const NONE: LedgerObject[] = [];

export function useAccountObjects(address: string): AccountObjectsViews {
  const { data, error, progress, isLoading, retry } = useXrplQuery<Walk<LedgerObject>, LedgerObject[]>(
    address ? ["account-objects", address] : null,
    async ({ send, signal, progress: publish }) =>
      walkOutcome(
        await collectPages<LedgerObject>(
          send,
          { command: "account_objects", account: address, ledger_index: "validated", limit: XRPL_MAX_LIMIT },
          (page) => page.account_objects as LedgerObject[] | undefined,
          { maxPages: OBJECT_PAGE_CAP, signal, onPage: publish },
        ),
      ),
    { maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );

  const objects = data?.items ?? progress ?? NONE;
  const groups = useMemo(() => groupAccountObjects(objects), [objects]);
  return useMemo(
    () => ({
      ...groups,
      isLoading,
      error,
      truncated: !!data?.truncated,
      partial: !!data?.partial,
      retry,
      objects,
    }),
    [groups, objects, data, error, isLoading, retry],
  );
}
