import type { TxData } from "@/components/tx/TransactionDetail/types";
import { isNotFoundError, sendConfirmingNotFound } from "@/lib/xrpl-errors";
import { useXrplQuery } from "./useXrplQuery";

export const TX_HASH_RE = /^[A-Fa-f0-9]{64}$/;

/** One transaction by hash (`tx`). A pending tx refreshes every 4 s
 *  until it's validated; a validated one is immutable. */
export function useTransaction(hash: string) {
  const valid = TX_HASH_RE.test(hash);
  const { data, error, unreachable, retry } = useXrplQuery<TxData>(
    valid ? ["tx", hash.toUpperCase()] : null,
    ({ send }) =>
      sendConfirmingNotFound(send, {
        command: "tx",
        transaction: hash,
        binary: false,
      }) as Promise<TxData>,
    {
      shouldRetryOnError: (err) => !isNotFoundError(err),
      refreshInterval: (latest) => (latest && latest.validated === false ? 4_000 : 0),
    },
  );

  return {
    tx: data ?? null,
    valid,
    notFound: isNotFoundError(error),
    failed: !!error && !isNotFoundError(error),
    unreachable,
    retry,
  };
}
