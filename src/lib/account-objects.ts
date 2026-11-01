import type { TrustLine } from "@/components/account/TrustLineList";
import { XRPL_MAX_LIMIT } from "./xrpl-pagination";

/**
 * One `account_objects` walk feeds the whole account page: trust lines
 * are its RippleState entries, next to escrows, channels, MPTs, checks
 * and NFT offers. `account_lines` would page through the same owner
 * directory a second time, and `type`-filtered walks don't help: the
 * node's `limit` counts every directory entry it steps over, not just
 * the matches, so each filtered walk costs as many pages as the full one.
 */

/** 100 pages × 400 = 40,000 objects. The biggest issuers have more;
 *  past the cap the walk is marked truncated. */
export const OBJECT_PAGE_CAP = 100;
export const OBJECT_CAP = OBJECT_PAGE_CAP * XRPL_MAX_LIMIT;

export type LedgerObject = Record<string, unknown>;

export interface AccountObjectGroups {
  /** RippleState entries, from either side. */
  trustLines: TrustLine[];
  escrows: LedgerObject[];
  channels: LedgerObject[];
  mpTokens: LedgerObject[];
  mpTokenIssuances: LedgerObject[];
  checks: LedgerObject[];
  nftOffers: LedgerObject[];
}

const GROUP_BY_TYPE: Record<string, keyof AccountObjectGroups> = {
  RippleState: "trustLines",
  Escrow: "escrows",
  PayChannel: "channels",
  MPToken: "mpTokens",
  MPTokenIssuance: "mpTokenIssuances",
  Check: "checks",
  NFTokenOffer: "nftOffers",
};

/** Split objects by type in one pass. */
export function groupAccountObjects(objects: readonly LedgerObject[]): AccountObjectGroups {
  const groups: AccountObjectGroups = {
    trustLines: [],
    escrows: [],
    channels: [],
    mpTokens: [],
    mpTokenIssuances: [],
    checks: [],
    nftOffers: [],
  };
  for (const o of objects) {
    const group = GROUP_BY_TYPE[String(o.LedgerEntryType)];
    if (group) (groups[group] as LedgerObject[]).push(o);
  }
  return groups;
}
