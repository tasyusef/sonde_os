/** A single offer from the XRPL book_offers response */
export interface BookOffer {
  Account: string;
  TakerGets: string | { currency: string; issuer: string; value: string };
  TakerPays: string | { currency: string; issuer: string; value: string };
  quality: string;
  Sequence: number;
  Flags: number;
  owner_funds?: string;
}

/** Processed orderbook entry ready for display */
export interface OrderbookEntry {
  price: number;
  amount: number;
  total: number;
  xrpTotal: number;
  account: string;
}

/** Aggregated price level for the depth chart */
export interface DepthLevel {
  price: number;
  cumulativeAmount: number;
  cumulativeXrp: number;
}

/** Full token detail — own DB metadata + live orderbook price */
export interface TokenDetail {
  currency: string;
  currencyDisplay: string;
  issuer: string;
  meta: {
    name: string | null;
    icon: string | null;
    issuerName: string | null;
  };
  metrics: {
    price: number | null;
    volume24h: number | null;
    volume7d: number | null;
    marketcap: number | null;
    holders: number | null;
    trustlines: number | null;
  };
}

/** A single holder entry from a snapshot */
export interface HolderEntry {
  address: string;
  balance: number;
  totalSupply: number;
  rank: number;
}

/** Latest holder snapshot result */
export interface HolderSnapshot {
  holders: HolderEntry[];
  snapshotTime: string;
}

/** A single time-series point grouping all holders at one snapshot */
export interface HolderHistoryPoint {
  time: string;
  holders: Array<{ address: string; balance: number; totalSupply: number }>;
}

/** Combined holder data for the UI */
export interface HolderData {
  current: HolderSnapshot | null;
  history: HolderHistoryPoint[];
}

/** OHLC candlestick data point */
export interface OHLCPoint {
  timestamp: number;  // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;     // XRP volume
  tradeCount: number;
  isVwap: boolean;    // true = derived from VWAP, no real OHLC
}

/** AMM pool containing this token */
export interface TokenAMMPool {
  ammAccount: string;
  targetAmount: number;       // the token this page is about
  pairedAmount: number;       // the other asset in the pool
  pairedLabel: string;        // "XRP" or decoded currency name
  pairedIsXrp: boolean;
  pairedCurrency: string;     // raw currency code
  pairedIssuer: string;       // "" for XRP
  tradingFee: number;
  lpHolders: number;
  lpTokenSupply: number;
}
