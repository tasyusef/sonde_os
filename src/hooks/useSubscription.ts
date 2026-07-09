"use client";

import useSWR from "swr";
import { useAuth } from "./useAuth";
import { fetcher } from "@/lib/swr-config";

interface SubscriptionStatus {
  tier: "free" | "pro";
  status: "active" | "canceled" | "past_due" | "expired" | null;
  periodEnd: string | null;
  paymentMethod: "xrp" | "rlusd" | "stripe" | null;
  cancelAtPeriodEnd: boolean;
  usage: {
    queriesUsed: number;
    monthlyLimit: number;
  };
}

export function useSubscription() {
  const { address } = useAuth();

  const { data, isLoading, mutate } = useSWR<SubscriptionStatus>(
    address ? "/api/subscription/status" : null,
    fetcher,
    {
      revalidateOnFocus: true,
      refreshInterval: 60_000,
      dedupingInterval: 10_000,
      keepPreviousData: true,
    },
  );

  return {
    tier: data?.tier ?? "free",
    status: data?.status ?? null,
    periodEnd: data?.periodEnd ? new Date(data.periodEnd) : null,
    paymentMethod: data?.paymentMethod ?? null,
    cancelAtPeriodEnd: data?.cancelAtPeriodEnd ?? false,
    usage: data?.usage ?? { queriesUsed: 0, monthlyLimit: 50 },
    isLoading,
    mutate,
  };
}
