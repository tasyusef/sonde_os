/**
 * Re-exports from @/types/xrpl-responses with legacy names for backward
 * compatibility. New code should import directly from xrpl-responses.
 */
export type { AccountInfoResponse as AccountInfo } from "./xrpl-responses";
export type { AccountTxResponse as AccountTxResult } from "./xrpl-responses";
export type { AccountObjectsResponse as AccountObjectsResult } from "./xrpl-responses";
export type { AccountOffersResponse as AccountOffersResult } from "./xrpl-responses";

export type { AccountNFTsResponse as AccountNFTsResult } from "./xrpl-responses";

export interface AccountSettings {
  flags: number;
  domain?: string;
  regularKey?: string;
  transferRate?: number;
  tickSize?: number;
  nfTokenMinter?: string;
  mintedNFTokens?: number;
  burnedNFTokens?: number;
}
