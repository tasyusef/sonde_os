import { useMemo } from "react";
import { ledgerTxRows, parseLedgerRef, type ExpandedLedger } from "@/lib/ledger-txs";
import { isNotFoundError, sendConfirmingNotFound } from "@/lib/xrpl-errors";
import { useXrplQuery } from "./useXrplQuery";

/** An expanded ledger can be 0.3–0.8 MB; nodes take a while. */
const LEDGER_TIMEOUT_MS = 25_000;

/** A closed ledger by index or hash, with its transactions. Immutable,
 *  so it's fetched once. */
export function useLedger(param: string) {
  const ref = parseLedgerRef(param);
  const key = ref ? ("ledger_index" in ref ? `i:${ref.ledger_index}` : `h:${ref.ledger_hash}`) : null;
  const { data, error, unreachable, retry } = useXrplQuery<ExpandedLedger>(
    key ? ["ledger", key] : null,
    async ({ send }) => {
      const res = (await sendConfirmingNotFound(
        send,
        { command: "ledger", ...ref, transactions: true, expand: true },
        { timeoutMs: LEDGER_TIMEOUT_MS },
      )) as { ledger: ExpandedLedger };
      return res.ledger;
    },
    { shouldRetryOnError: (err) => !isNotFoundError(err) },
  );
  const transactions = useMemo(() => (data ? ledgerTxRows(data) : []), [data]);

  return {
    ledger: data ?? null,
    transactions,
    valid: ref !== null,
    notFound: isNotFoundError(error),
    failed: !!error && !isNotFoundError(error),
    unreachable,
    retry,
  };
}
