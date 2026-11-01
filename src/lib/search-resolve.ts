import type { SearchKind } from "./search";
import { isNotFoundError, sendConfirmingNotFound } from "./xrpl-errors";
import type { SendFn } from "./xrpl-pagination";

/**
 * Whether a 64-hex ID could be an NFTokenID: its first two bytes are
 * the flags, which all sit in the low byte, and the next two the
 * transfer fee, at most 50,000. About one random hash in 335 passes,
 * so most transaction and ledger hashes never ask Clio.
 */
export function mightBeNftId(id: string): boolean {
  return id.startsWith("00") && parseInt(id.slice(4, 8), 16) <= 50_000;
}

type Probe = { found: true } | { found: false; error?: unknown };

/**
 * What a 64-hex ID is on the ledger: a transaction, a ledger or an NFT.
 * Asks after all it could be at once; the first of those, in that order,
 * that exists wins, without waiting on the ones after it. Null when none
 * exists. Throws when a lookup failed for another reason and nothing
 * was found, so the caller retries rather than says "none".
 */
export async function resolveHexId(send: SendFn, id: string): Promise<SearchKind | null> {
  const ask = (lookup: Promise<unknown>): Promise<Probe> =>
    lookup.then(
      () => ({ found: true }),
      (error: unknown) => ({ found: false, error: isNotFoundError(error) ? undefined : error }),
    );
  const probes: [SearchKind, Promise<Probe>][] = [
    ["transaction", ask(sendConfirmingNotFound(send, { command: "tx", transaction: id, binary: true }))],
    ["ledger", ask(sendConfirmingNotFound(send, { command: "ledger", ledger_hash: id }))],
  ];
  if (mightBeNftId(id)) probes.push(["nft", ask(send({ command: "nft_info", nft_id: id }))]);

  let failure: unknown;
  for (const [kind, probe] of probes) {
    const result = await probe;
    if (result.found) return kind;
    failure ??= result.error;
  }
  if (failure !== undefined) throw failure;
  return null;
}
