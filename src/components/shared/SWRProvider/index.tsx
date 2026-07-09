"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/swr-config";

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        dedupingInterval: 10_000,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        errorRetryCount: 2,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
