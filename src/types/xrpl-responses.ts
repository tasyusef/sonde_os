/**
 * Centralized XRPL WebSocket response types.
 *
 * Shapes of the rippled / Clio responses the browser reads.
 * Import from here instead of defining local interfaces.
 */

import type { NFTBrowseItem } from "@/types/nft";

/* ---------- account_info ---------- */
export interface AccountInfoResponse {
  account_data: {
    Account: string;
    Balance: string;
    Sequence: number;
    OwnerCount: number;
    Flags: number;
    Domain?: string;
    EmailHash?: string;
    RegularKey?: string;
    TransferRate?: number;
    TickSize?: number;
    MessageKey?: string;
    NFTokenMinter?: string;
    MintedNFTokens?: number;
    BurnedNFTokens?: number;
  };
}

/* ---------- account_tx ---------- */
export interface AccountTxResponse {
  transactions: Array<{
    tx: Record<string, unknown>;
    meta: Record<string, unknown>;
    validated: boolean;
  }>;
  marker?: unknown;
}

/* ---------- account_objects ---------- */
export interface AccountObjectsResponse {
  account_objects: Array<Record<string, unknown>>;
  marker?: unknown;
}

/* ---------- account_offers ---------- */
export interface AccountOffersResponse {
  offers: Array<Record<string, unknown>>;
  marker?: unknown;
}

/* ---------- account_nfts ---------- */
export interface AccountNFTsResponse {
  account_nfts: NFTBrowseItem[];
  marker?: unknown;
}

/* ---------- tx ---------- */
export interface TxResponse {
  TransactionType: string;
  Account: string;
  Destination?: string;
  Amount?: unknown;
  Fee: string;
  hash: string;
  date?: number;
  ledger_index?: number;
  URI?: string;
  meta?: TxMeta;
  metaData?: TxMeta;
  /** `tx` responses only: true once the tx is in a validated ledger. */
  validated?: boolean;
}

export interface TxMeta {
  TransactionResult: string;
  /** What a Payment, CheckCash or AccountDelete actually delivered. */
  delivered_amount?: unknown;
  DeliveredAmount?: unknown;
  nftoken_id?: string;
  /** Position of the tx in its ledger. */
  TransactionIndex?: number;
  AffectedNodes?: AffectedNode[];
}

export interface AffectedNode {
  CreatedNode?: {
    LedgerEntryType: string;
    NewFields?: { NFTokenID?: string; NFTokens?: { NFToken: { NFTokenID: string } }[] };
  };
  ModifiedNode?: {
    LedgerEntryType: string;
    FinalFields?: { NFTokens?: { NFToken: { NFTokenID: string } }[] };
    PreviousFields?: { NFTokens?: { NFToken: { NFTokenID: string } }[] };
  };
}

/* ---------- nft_history ---------- */
export interface NFTHistoryResponse {
  transactions?: Array<{
    tx?: {
      hash?: string;
      TransactionType?: string;
      Account?: string;
      Amount?: string | { value: string; currency: string; issuer: string };
      date?: number;
      ledger_index?: number;
    };
    meta?: {
      TransactionResult?: string;
    };
    hash?: string;
    close_time_iso?: string;
  }>;
  marker?: unknown;
}

/* ---------- feature ---------- */
export interface FeatureResponse {
  [hash: string]: {
    name: string;
    enabled: boolean;
    supported: boolean;
    vetoed?: boolean;
    count?: number;
    threshold?: number;
    validations?: number;
  };
}

