/**
 * useAccountTrustLines — the account's trust lines: the RippleState
 * entries of the `useAccountObjects` walk (no second walk), split into
 * regular tokens and LP positions. They fill in page by page.
 */

import { useMemo } from "react";
import { partitionTrustLines } from "@/lib/amm-helpers";
import type { TrustLine } from "@/components/account/TrustLineList";
import { useAccountObjects } from "./useAccountObjects";

export interface AccountTrustLinesViews {
  isLoading: boolean;
  error: unknown;
  truncated: boolean;
  partial: boolean;
  retry: () => void;
  /** Every trustline — regular + LP. */
  allTrustLines: TrustLine[];
  /** RippleState minus LP tokens. Use for portfolio math + Holdings. */
  regularTrustLines: TrustLine[];
  /** LP token lines with a positive balance. Empty until paging ends,
   *  so AMM lookups run once, not once per page. */
  lpTrustLines: TrustLine[];
}

const NO_LINES: TrustLine[] = [];

export function useAccountTrustLines(address: string): AccountTrustLinesViews {
  const { trustLines, isLoading, error, truncated, partial, retry } = useAccountObjects(address);
  return useMemo(() => {
    const { regularTrustLines, lpTrustLines } = partitionTrustLines(trustLines, address);
    return {
      isLoading,
      error,
      truncated,
      partial,
      retry,
      allTrustLines: trustLines,
      regularTrustLines,
      lpTrustLines: isLoading ? NO_LINES : lpTrustLines,
    };
  }, [trustLines, isLoading, error, truncated, partial, retry, address]);
}
