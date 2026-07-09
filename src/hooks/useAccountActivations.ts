"use client";

/**
 * useAccountActivations — lifetime activations BY this account, fetched
 * from `/api/account/[address]/activations` (CH-backed).
 *
 * Replaces the legacy derivation that walked `meta.AffectedNodes` over
 * the loaded tx window. The old approach silently undercounted: an
 * account that activated 50 others a year ago and now has unrelated
 * recent activity would show 0 activations because none of those
 * Payments were in the 20-50-tx window. CH gives the full lifetime
 * list (capped at 500) in one fetch.
 *
 * Bounded by the VTE backfill window — same caveat as ancestry.
 *
 * Part of the per-tab data-ownership refactor (Tier 2). Used by
 * ProfileTab.
 */

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { Activation } from "./useAccountData";

interface ActivationsResponse {
  activations: Activation[];
  error?: string;
}

export function useAccountActivations(address: string) {
  const { data, error, isLoading } = useSWR<ActivationsResponse>(
    address ? `/api/account/${address}/activations` : null,
    fetcher,
    {
      dedupingInterval: 60_000,
      keepPreviousData: true,
      errorRetryCount: 1,
      revalidateOnFocus: false,
    },
  );

  return {
    activations: data?.activations ?? [],
    isLoading,
    error,
  };
}
