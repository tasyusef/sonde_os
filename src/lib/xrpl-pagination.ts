/**
 * Shared constants + the WS `send` signature for paginated XRPL
 * commands (account_objects, account_offers, account_nfts).
 *
 * Lives outside the hook files because three of them (and counting)
 * use the same paginate loop. Constants matter:
 *   - XRPL_MAX_LIMIT — rippled's accepted upper bound. 400 cuts
 *     round-trips 8× vs. the default 50 on heavy accounts.
 *   - PAGE_CAP — bounds runaway loops on pathological accounts
 *     (Sologenic-class issuers with hundreds of thousands of
 *     trustlines). 50 × 400 = 20,000 item ceiling per command.
 */
export const XRPL_MAX_LIMIT = 400;
export const PAGE_CAP = 50;

export type SendFn = (command: Record<string, unknown>) => Promise<unknown>;
