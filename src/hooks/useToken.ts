import type { MPTokenIssuance } from "@/components/account/MPTokenList";
import { isNotFoundError } from "@/lib/xrpl-errors";
import type { AMMInfoResult } from "@/types/amm";
import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

/** An IOU's AMM pool against XRP: null when it has none. */
export function useXrpPool(currency: string, issuer: string) {
  const { data, error, retry } = useXrplQuery<AMMInfoResult["amm"] | null>(
    ["amm-xrp", currency, issuer],
    async ({ send }) => {
      try {
        const res = (await send({
          command: "amm_info",
          asset: { currency: "XRP" },
          asset2: { currency, issuer },
          ledger_index: "validated",
        })) as AMMInfoResult;
        return res.amm;
      } catch (err) {
        if (isNotFoundError(err)) return null;
        throw err;
      }
    },
    { errorRetryCount: 1, maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );
  return { pool: data, failed: !!error, retry };
}

/** An MPT's issuance (`ledger_entry`): supply, scale, fee, flags, metadata. */
export function useMptIssuance(id: string) {
  const { data, error, unreachable, isValidating, retry } = useXrplQuery<MPTokenIssuance>(
    ["mpt-issuance", id],
    async ({ send }) => {
      const res = (await send({ command: "ledger_entry", mpt_issuance: id, ledger_index: "validated" })) as {
        node: MPTokenIssuance;
      };
      return res.node;
    },
    { shouldRetryOnError: (err) => !isNotFoundError(err), maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );
  const notFound = isNotFoundError(error);
  return {
    issuance: data ?? null,
    notFound,
    failed: !!error && !notFound && !isValidating,
    unreachable,
    retry,
  };
}
