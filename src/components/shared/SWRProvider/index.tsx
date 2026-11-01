import { SWRConfig } from "swr";

/** Defaults for every SWR hook. Each one brings its own fetcher; XRPL
 *  reads go through `useXrplQuery`, which fetches once per key. */
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 10_000,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        errorRetryCount: 2,
        keepPreviousData: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}
