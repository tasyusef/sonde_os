import type { SendFn, SendOptions } from "./xrpl-pagination";

/** Node replies that mean "this object doesn't exist", as opposed to a
 *  network failure worth retrying. */
const NOT_FOUND = new Set([
  "txnNotFound",
  "lgrNotFound",
  "actNotFound",
  "objectNotFound",
  "entryNotFound",
  "notFound",
]);

/** The `error` code of an XRPL error reply, or null. */
export function xrplErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

export function isNotFoundError(err: unknown): boolean {
  const code = xrplErrorCode(err);
  return code != null && NOT_FOUND.has(code);
}

/** The rejection of an aborted request (`AbortSignal.reason`). */
export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/**
 * Send a lookup by hash or index (`tx`, `ledger`) whose "not found" is
 * only final from a full-history node. The main socket can fail over to
 * a pruned node, so its not-found is re-asked of the full-history
 * socket. That reply is the answer: not-found there is final, any other
 * failure is a retryable error.
 */
export async function sendConfirmingNotFound(
  send: SendFn,
  command: Record<string, unknown>,
  opts: SendOptions = {},
): Promise<unknown> {
  try {
    return await send(command, opts);
  } catch (err) {
    if (!isNotFoundError(err) || opts.fullHistory) throw err;
    return send(command, { ...opts, fullHistory: true });
  }
}
