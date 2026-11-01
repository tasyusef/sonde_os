import { useLiveData } from "./useLiveData";
import { useXrplQuery } from "./useXrplQuery";

/** Mainnet's reserves since Dec 2024; used until a node says otherwise. */
const DEFAULT_RESERVES = { base: 1, owner: 0.2 };

interface ServerInfo {
  info?: { validated_ledger?: { reserve_base_xrp?: number; reserve_inc_xrp?: number } };
}

/** Account reserves in XRP: the relay snapshot, else `server_info`
 *  over the browser socket, else mainnet's current values. */
export function useReserves(): { base: number; owner: number } {
  const { stats } = useLiveData();
  const { data } = useXrplQuery(
    stats ? null : ["server-info:reserves"],
    async ({ send }) => {
      const v = ((await send({ command: "server_info" })) as ServerInfo).info?.validated_ledger;
      return v?.reserve_base_xrp != null && v.reserve_inc_xrp != null
        ? { base: v.reserve_base_xrp, owner: v.reserve_inc_xrp }
        : null;
    },
    { errorRetryCount: 1 },
  );
  if (stats) return { base: stats.reserveBase, owner: stats.reserveIncrement };
  return data ?? DEFAULT_RESERVES;
}
