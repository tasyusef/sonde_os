import { AMENDMENTS_OBJECT_INDEX, mergeAmendments } from "@/lib/amendments";
import type { AmendmentInfo, AmendmentsLedgerEntry } from "@/types/amendments";
import type { FeatureResponse } from "@/types/xrpl-responses";
import { useXrplQuery } from "./useXrplQuery";

/** Every amendment the node knows, from `feature` plus the Amendments
 *  ledger entry. Either source alone is enough; both failing is an error. */
export function useAmendments() {
  const { data, error, isValidating, unreachable, retry } = useXrplQuery<AmendmentInfo[]>(
    ["amendments"],
    async ({ send }) => {
      const [features, entry] = await Promise.all([
        send({ command: "feature" })
          .then((r) => (r as { features?: FeatureResponse }).features ?? null)
          .catch(() => null),
        send({ command: "ledger_entry", index: AMENDMENTS_OBJECT_INDEX, ledger_index: "validated" })
          .then((r) => (r as { node?: AmendmentsLedgerEntry }).node ?? null)
          .catch(() => null),
      ]);
      if (!features && !entry) throw new Error("No amendment data from the node");
      return mergeAmendments(features, entry);
    },
    { revalidateIfStale: true, dedupingInterval: 60_000 },
  );
  return {
    amendments: data ?? null,
    failed: !!error && !data && !isValidating,
    unreachable,
    retry,
  };
}
