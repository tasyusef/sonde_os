import useSWR from "swr";
import { fetchVoteTally } from "@/lib/amendment-votes";

/** Validators restate their votes every flag ledger (~15 min). */
const REFRESH_MS = 10 * 60_000;

/** UNL votes on open amendments from data.xrpl.org (XRPScan as the
 *  backup). `settled` once either answers or both fail. */
export function useVoteTally() {
  const { data, error } = useSWR("amendment-votes", fetchVoteTally, {
    refreshInterval: REFRESH_MS,
    dedupingInterval: REFRESH_MS,
    errorRetryCount: 1,
  });
  return { tally: data ?? null, settled: !!data || !!error };
}
