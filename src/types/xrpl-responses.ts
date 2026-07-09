/**
 * Centralized XRPL WebSocket response types.
 *
 * Every convenience method on XrplClient returns one of these.
 * Consumers should import from here instead of defining local interfaces.
 */

import type { BookOffer } from "@/types/token";
import type { NFTOffer, NFTBrowseItem } from "@/types/nft";

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
}

export interface TxMeta {
  TransactionResult: string;
  nftoken_id?: string;
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

/* ---------- ledger ---------- */
export interface LedgerResponse {
  ledger: {
    ledger_index: number;
    close_time: number;
    total_coins: string;
    transactions?: string[];
  };
}

export interface ExpandedLedgerResponse {
  ledger: {
    ledger_index: number;
    close_time: number;
    total_coins: string;
    transactions?: TxResponse[];
  };
}

/* ---------- server_info ---------- */
export interface ServerInfoResponse {
  info: {
    validated_ledger?: {
      base_fee_xrp: number;
      reserve_base_xrp: number;
      reserve_inc_xrp: number;
      seq: number;
      hash?: string;
      close_time?: number;
    };
    load_factor?: number;
    build_version?: string;
    clio_version?: string;
    peers?: number;
    server_state?: string;
    uptime?: number;
    complete_ledgers?: string;
    validation_quorum?: number;
  };
}

/* ---------- fee ---------- */
export interface FeeResponse {
  drops: {
    base_fee: string;
    median_fee: string;
    minimum_fee: string;
    open_ledger_fee: string;
  };
  current_queue_size: number;
  expected_ledger_size: number;
  max_queue_size: number;
}

/* ---------- nft_info ---------- */
export interface NFTInfoResponse {
  nft_id: string;
  owner: string;
  is_burned: boolean;
  flags: number;
  transfer_fee: number;
  issuer: string;
  nft_taxon: number;
  nft_serial: number;
  uri: string | null;
}

/* ---------- nft_buy_offers / nft_sell_offers ---------- */
export interface NFTOffersResponse {
  offers: NFTOffer[];
  marker?: unknown;
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

/* ---------- ledger_entry ---------- */
export interface LedgerEntryResponse {
  node?: Record<string, unknown>;
}

/* ---------- gateway_balances ---------- */
export interface GatewayBalancesResponse {
  obligations?: Record<string, string>;
}

/* ---------- account_lines ---------- */
export interface AccountLinesResponse {
  lines?: Array<{
    account: string;
    balance: string;
    currency: string;
    limit: string;
  }>;
  marker?: unknown;
}

/* ---------- amm_info ---------- */
export interface AMMInfoResponse {
  amm: {
    account: string;
    asset: { currency: string; issuer?: string };
    asset2: { currency: string; issuer?: string };
    amount: string | { currency: string; issuer: string; value: string };
    amount2: string | { currency: string; issuer: string; value: string };
    lp_token: { currency: string; issuer: string; value: string };
    trading_fee: number;
    auction_slot?: unknown;
  };
}

/* ---------- book_offers ---------- */
export interface BookOffersResponse {
  offers?: BookOffer[];
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

/* ---------- subscribe (ledger stream) ---------- */
export interface LedgerStreamMessage {
  type: "ledgerClosed";
  ledger_index: number;
  ledger_hash: string;
  ledger_time: number;
  txn_count: number;
  fee_base: number;
  reserve_base: number;
  reserve_inc: number;
  validated_ledgers: string;
}
