import { ACCOUNT_DATA_MAX_AGE_MS, useXrplQuery } from "./useXrplQuery";

/** Big issuers make `gateway_balances` walk every trust line. */
const GATEWAY_BALANCES_TIMEOUT_MS = 25_000;

/** Tokens this account issued: raw currency code → outstanding amount. */
export function useIssuedTokens(address: string) {
  const { data, error, isLoading } = useXrplQuery<Record<string, string>>(
    address ? ["gateway-balances", address] : null,
    async ({ send }) => {
      const res = (await send(
        { command: "gateway_balances", account: address, ledger_index: "validated" },
        { timeoutMs: GATEWAY_BALANCES_TIMEOUT_MS },
      )) as { obligations?: Record<string, string> };
      return res.obligations ?? {};
    },
    { errorRetryCount: 1, maxAgeMs: ACCOUNT_DATA_MAX_AGE_MS },
  );

  return { issuedTokens: data ?? {}, error, isLoading };
}
