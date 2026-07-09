/** Currency amount object for issued currencies */
export interface CurrencyAmount {
  value: string;
  currency: string;
  issuer: string;
}

/** Raw transaction shape from an expanded XRPL ledger response */
export interface RawLedgerTx {
  TransactionType: string;
  Account: string;
  Destination?: string;
  Fee: string;
  hash: string;
  date?: number;
  ledger_index?: number;

  // Payment fields
  Amount?: string | CurrencyAmount;
  SendMax?: string | CurrencyAmount;

  // NFTokenAcceptOffer fields
  NFTokenSellOffer?: string;
  NFTokenBuyOffer?: string;
  NFTokenBrokerFee?: string | CurrencyAmount;

  // NFTokenMint fields (hex-encoded URI)
  URI?: string;

  // OfferCreate fields
  TakerGets?: string | CurrencyAmount;
  TakerPays?: string | CurrencyAmount;

  meta?: TxMeta;
  metaData?: TxMeta;
}

export interface TxMeta {
  TransactionResult: string;
  nftoken_id?: string;
  AffectedNodes?: AffectedNode[];
  delivered_amount?: string | CurrencyAmount;
}

export interface AffectedNode {
  CreatedNode?: {
    LedgerEntryType: string;
    LedgerIndex?: string;
    NewFields?: Record<string, unknown>;
  };
  ModifiedNode?: {
    LedgerEntryType: string;
    LedgerIndex?: string;
    FinalFields?: Record<string, unknown>;
    PreviousFields?: Record<string, unknown>;
    PreviousTxnID?: string;
    PreviousTxnLgrSeq?: number;
  };
  DeletedNode?: {
    LedgerEntryType: string;
    LedgerIndex?: string;
    FinalFields?: Record<string, unknown>;
    PreviousFields?: Record<string, unknown>;
    PreviousTxnID?: string;
    PreviousTxnLgrSeq?: number;
  };
}

/** Extracted NFT trade ready for DB insertion */
export interface NFTTradeRow {
  txHash: string;
  nftId: string;
  seller: string;
  buyer: string;
  broker: string | null;
  amountDrops: bigint | null;
  amountValue: string | null;
  amountCurrency: string | null;
  amountIssuer: string | null;
  isXrp: boolean;
  issuer: string;
  taxon: number;
  marketplace: string | null;
  ledgerIndex: number;
  date: number;
  dateIso: Date;
}

/** Extracted token trade (one fill) ready for DB insertion */
export interface TokenTradeRow {
  txHash: string;
  account: string;
  makerAccount: string | null;
  takerGetsCurrency: string;
  takerGetsIssuer: string | null;
  takerGetsValue: string;
  takerPaysCurrency: string;
  takerPaysIssuer: string | null;
  takerPaysValue: string;
  isXrpPair: boolean;
  xrpVolumeDrops: bigint | null;
  ledgerIndex: number;
  date: number;
  dateIso: Date;
}

/** Extracted payment corridor ready for DB insertion */
export interface PaymentCorridorRow {
  srcCurrency: string;
  srcIssuer: string;
  dstCurrency: string;
  dstIssuer: string;
  xrpVolumeDrops: bigint;
  dateIso: Date;
}

/** Expanded ledger response from XRPL */
export interface ExpandedLedger {
  ledger: {
    ledger_index: number;
    ledger_hash?: string;
    parent_hash?: string;
    close_time: number;
    close_flags?: number;
    total_coins: string;
    /* Merkle roots of accounts state and tx tree at close. */
    account_hash?: string;
    transaction_hash?: string;
    /* Per-ledger fee + reserve settings (may change via SetFee pseudo-tx). */
    base_fee?: number | string;
    reserve_base?: number | string;
    reserve_increment?: number | string;
    transactions?: RawLedgerTx[];
  };
}
