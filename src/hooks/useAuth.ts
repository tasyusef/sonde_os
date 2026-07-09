"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

interface AuthResponse {
  address: string | null;
}

export function useAuth() {
  const { data, isLoading, mutate } = useSWR<AuthResponse>(
    "/api/auth/me",
    fetcher,
    { revalidateOnFocus: false },
  );

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    mutate({ address: null }, false);
  };

  return {
    address: data?.address ?? null,
    isLoading,
    logout,
  };
}
