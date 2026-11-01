/**
 * useAccountAmmPositions — one `amm_info` per LP trust line the account
 * holds (the first AMM_LOOKUP_CAP), a few at a time, as the AMMPosition
 * rows Holdings/Positions render. Keyed on the LP issuer set, not the
 * array identity.
 */

import { useMemo } from "react";
import { processAMMPositions } from "@/lib/amm-helpers";
import { settledPool } from "@/lib/xrpl-pagination";
import type { TrustLine } from "@/components/account/TrustLineList";
import type { AMMPosition } from "@/types/amm";
import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

/** Requests in flight at once; public nodes throttle bigger bursts. */
const CONCURRENCY = 6;
/** Pools looked up per account. Holding more LP tokens is rare; past
 *  this the rest are left out and `capped` says so. */
export const AMM_LOOKUP_CAP = 50;

interface AmmPositions {
  positions: AMMPosition[];
  /** Pools whose `amm_info` failed. */
  failed: number;
}

const NONE: AMMPosition[] = [];

function ammAccountOf(lp: TrustLine, address: string): string {
  return lp.HighLimit.issuer === address ? lp.LowLimit.issuer : lp.HighLimit.issuer;
}

export function useAccountAmmPositions(lpTrustLines: TrustLine[], address: string) {
  const looked = useMemo(() => lpTrustLines.slice(0, AMM_LOOKUP_CAP), [lpTrustLines]);
  const lpKey = useMemo(
    () => looked.map((lp) => `${lp.HighLimit.issuer}:${lp.LowLimit.issuer}`).sort().join("|"),
    [looked],
  );

  const { data, error, isLoading, retry } = useXrplQuery<AmmPositions>(
    lpKey ? ["amm-positions", address, lpKey] : null,
    async ({ send, signal }) => {
      const lines = looked;
      const results = await settledPool(
        lines,
        CONCURRENCY,
        (lp) => send({ command: "amm_info", amm_account: ammAccountOf(lp, address), ledger_index: "validated" }),
        signal,
      );
      return {
        positions: processAMMPositions(lines, results, address),
        failed: results.filter((r) => r.status === "rejected").length,
      };
    },
    { maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );

  return {
    ammPositions: data?.positions ?? NONE,
    /** Some pools couldn't be read; their value is missing. */
    partial: !!data?.failed,
    /** More LP lines than AMM_LOOKUP_CAP; the rest weren't looked up. */
    capped: lpTrustLines.length > AMM_LOOKUP_CAP,
    isLoading,
    error,
    retry,
  };
}
