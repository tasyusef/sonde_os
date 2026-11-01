/** Shape of a `tx` reply (API v1, JSON). */

export interface TxMeta {
  TransactionResult: string;
  delivered_amount?: unknown;
  AffectedNodes?: AffectedNodeEntry[];
  [key: string]: unknown;
}

export interface AffectedNodeEntry {
  CreatedNode?: {
    LedgerEntryType: string;
    LedgerIndex: string;
    NewFields?: Record<string, unknown>;
  };
  ModifiedNode?: {
    LedgerEntryType: string;
    LedgerIndex: string;
    FinalFields?: Record<string, unknown>;
    PreviousFields?: Record<string, unknown>;
    PreviousTxnID?: string;
    PreviousTxnLgrSeq?: number;
  };
  DeletedNode?: {
    LedgerEntryType: string;
    LedgerIndex: string;
    FinalFields?: Record<string, unknown>;
  };
}

export interface TxData {
  TransactionType: string;
  Account: string;
  Destination?: string;
  DestinationTag?: number;
  SourceTag?: number;
  Amount?: unknown;
  Fee: string;
  Sequence?: number;
  Flags?: number;
  hash: string;
  date?: number;
  ledger_index?: number;
  inLedger?: number;
  SigningPubKey?: string;
  Signers?: Array<{
    Signer: {
      Account: string;
      SigningPubKey: string;
      TxnSignature: string;
    };
  }>;
  meta?: TxMeta;
  metaData?: TxMeta;
  /** False while the tx is still pending (not in a validated ledger). */
  validated?: boolean;
  [key: string]: unknown;
}
