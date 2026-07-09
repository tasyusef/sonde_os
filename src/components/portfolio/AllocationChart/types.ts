export interface CurrentPortfolio {
  xrpBalance: number;
  xrpPriceUsd: number;
  tokenValueUsd: number;
  ammValueUsd: number;
  lockedXrp: number;
  totalValueUsd: number;
  tokenBreakdown: {
    currency: string;
    issuer: string;
    name: string;
    balance: number;
    usd: number;
  }[];
}

export interface NFTsResponse {
  totalValueUsd: number;
}

export interface TokenEntry {
  currency: string;
  issuer: string;
  name: string;
  pnlPct: number | null;
  valueUsd: number;
}

export interface TokensResponse {
  tokens: TokenEntry[];
}

export interface TreemapItem {
  name: string;
  value: number;
  pnlPct: number;
  [key: string]: unknown;
}

export interface SliceData {
  name: string;
  value: number;
  color: string;
  percentage: number;
}

export type View = "asset" | "type" | "treemap";
