"use client";

/**
 * useAccountAmmPositions — fans out `amm_info` per LP trustline this
 * account holds, returning AMMPosition rows the Holdings/Positions tabs
 * render.
 *
 * Input is the LP-only partition from useAccountObjects. Keyed on a
 * stable representation of the LP issuer set so the SWR cache doesn't
 * thrash when the trustline array gets a new ref but represents the
 * same set (common on SWR re-validation).
 *
 * Part of the per-tab data-ownership refactor (Tier 2).
 */

import useSWR from "swr";
import { useEffect, useMemo, useRef } from "react";
import { useXrpl } from "./useXrplWs";
import { processAMMPositions } from "@/lib/amm-helpers";
import type { SendFn } from "@/lib/xrpl-pagination";
import type { TrustLine } from "@/components/account/TrustLineList";
import type { AMMPosition } from "@/types/amm";

async function fetchAmmPositions(
  lpTrustLines: TrustLine[],
  address: string,
  send: SendFn,
): Promise<AMMPosition[]> {
  if (lpTrustLines.length === 0) return [];
  const ammResults = await Promise.allSettled(
    lpTrustLines.map((lp) => {
      const isHigh = lp.HighLimit.issuer === address;
      const ammAccount = isHigh ? lp.LowLimit.issuer : lp.HighLimit.issuer;
      return send({
        command: "amm_info",
        amm_account: ammAccount,
        ledger_index: "validated",
      });
    }),
  );
  return processAMMPositions(lpTrustLines, ammResults, address);
}

export function useAccountAmmPositions(
  lpTrustLines: TrustLine[],
  address: string,
) {
  const { send, connected } = useXrpl();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Stable key on the issuer pair set — invariant under SWR re-validations
  // that hand back a new array ref for the same logical LP positions.
  const lpKey = useMemo(
    () =>
      lpTrustLines
        .map((lp) => `${lp.HighLimit.issuer}:${lp.LowLimit.issuer}`)
        .sort()
        .join("|"),
    [lpTrustLines],
  );

  // Pin the latest LP array in a ref so the fetcher closure stays
  // stable on `lpKey` while seeing fresh data.
  const lpRef = useRef(lpTrustLines);
  useEffect(() => {
    lpRef.current = lpTrustLines;
  }, [lpTrustLines]);

  const { data, error, isLoading } = useSWR(
    connected && lpTrustLines.length > 0
      ? `amm-positions:${address}:${lpKey}`
      : null,
    () => fetchAmmPositions(lpRef.current, address, sendRef.current),
    {
      dedupingInterval: 10_000,
      keepPreviousData: true,
      errorRetryCount: 2,
      revalidateOnFocus: false,
    },
  );

  return {
    ammPositions: data ?? [],
    isLoading,
    error,
  };
}
