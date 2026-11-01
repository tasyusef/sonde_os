import { isNotFoundError, xrplErrorCode } from "@/lib/xrpl-errors";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import type { AccountInfoResponse } from "@/types/xrpl-responses";
import { useXrplQuery } from "./useXrplQuery";

/** Classic r-address, or an X-address by shape. */
export function isPlausibleAddress(s: string): boolean {
  return XRPL_ADDRESS_RE.test(s) || (s.startsWith("X") && s.length === 46);
}

/** `account_info` for the account page header and overview. */
export function useAccountInfo(address: string) {
  const plausible = isPlausibleAddress(address);
  const { data, error, isValidating, unreachable, retry } = useXrplQuery<AccountInfoResponse>(
    plausible ? ["account-info", address] : null,
    ({ send }) =>
      send({ command: "account_info", account: address, ledger_index: "validated" }) as Promise<AccountInfoResponse>,
    {
      // The balance header refreshes on every visit; it's one request.
      revalidateIfStale: true,
      shouldRetryOnError: (err) => !isNotFoundError(err) && xrplErrorCode(err) !== "actMalformed",
    },
  );

  const malformed = xrplErrorCode(error) === "actMalformed";
  const notFound = isNotFoundError(error);
  return {
    info: data ?? null,
    valid: plausible && !malformed,
    notFound,
    failed: !!error && !notFound && !malformed && !isValidating,
    unreachable,
    retry,
  };
}
