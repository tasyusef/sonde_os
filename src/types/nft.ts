export interface NFTInfo {
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

export interface NFTOffer {
  amount: string | { value: string; currency: string; issuer: string };
  owner: string;
  destination?: string;
  expiration?: number;
  nft_offer_index: string;
  flags: number;
}

export interface NFTBrowseItem {
  NFTokenID: string;
  Issuer: string;
  URI?: string;
  Flags: number;
  NFTokenTaxon: number;
  nft_serial: number;
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
}

export interface NFTHistoryTransaction {
  hash: string;
  type: string;
  account: string;
  date?: number;
  ledger_index?: number;
  result: string;
  amount?: string | { value: string; currency: string; issuer: string };
}
