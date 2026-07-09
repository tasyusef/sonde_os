export type SearchType =
  | "account"
  | "account-dt"
  | "x-address"
  | "ledger"
  | "transaction"
  | "nft"
  | "ctid"
  | "currency-hash"
  | "currency-code"
  | "paystring"
  | "ledger-object"
  | "hex64"
  | "unknown";

export interface SearchResult {
  type: SearchType;
  redirect: string;
  label?: string;
}
