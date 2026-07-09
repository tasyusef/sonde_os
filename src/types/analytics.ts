export interface FeeBurnPoint {
  timestamp: number;
  txCount: number;
  burnDrops: string;
}

export interface TxVolumePoint {
  timestamp: number;
  families: Record<string, number>;
  total: number;
}

export interface CorridorEntry {
  srcCurrency: string;
  srcName: string | null;
  dstCurrency: string;
  dstName: string | null;
  count: number;
  xrpVolume: number;
}

export interface CorridorStats {
  totalCorridors: number;
  totalPayments: number;
  totalXrpVolume: number;
}

export interface DexTVLPool {
  account: string;
  currency: string;
  issuerName: string | null;
  tvlXrp: number;
  imageUrl: string | null;
  tradingFee: number;
  holders: number;
}

export interface DexTVLData {
  totalTvlXrp: number;
  totalTvlUsd: number;
  poolCount: number;
  topPools: DexTVLPool[];
}

/* ------------------------------------------------------------------ */
/*  DEX Volume                                                         */
/* ------------------------------------------------------------------ */

export interface DexVolumePoint {
  timestamp: number;
  xrpVolume: number;
  tradeCount: number;
}

export interface DexVolumeTotal {
  periodXrpVolume: number;
  periodTradeCount: number;
}

/* ------------------------------------------------------------------ */
/*  NFT Activity                                                       */
/* ------------------------------------------------------------------ */

export interface NFTActivityPoint {
  timestamp: number;
  xrpVolume: number;
  tradeCount: number;
}

export interface NFTActivityTotal {
  periodXrpVolume: number;
  periodTradeCount: number;
}

/* ------------------------------------------------------------------ */
/*  Top Token Movers                                                   */
/* ------------------------------------------------------------------ */

export interface TokenMoverEntry {
  currency: string;
  currencyDisplay: string;
  issuer: string;
  issuerName: string | null;
  icon: string | null;
  currentVolume: number;
  previousVolume: number;
  changePercent: number | null;
  tradeCount: number;
}

/* ------------------------------------------------------------------ */
/*  AMM Fee Revenue                                                    */
/* ------------------------------------------------------------------ */

export interface AMMRevenuePoint {
  timestamp: number;
  estimatedFeeXrp: number;
}

export interface AMMRevenueTotal {
  periodFeeXrp: number;
  topEarners: {
    currency: string;
    issuerName: string | null;
    feeXrp: number;
  }[];
}

/* ------------------------------------------------------------------ */
/*  Top Traders                                                        */
/* ------------------------------------------------------------------ */

export interface TopTraderEntry {
  address: string;
  totalVolumeXrp: number;
  buyVolumeXrp: number;
  sellVolumeXrp: number;
  netProfitXrp: number;
  tradeCount: number;
}

/** Per-pool fee time series for the multi-line chart view */
export interface AMMPoolRevenueSeries {
  currency: string;
  issuerName: string | null;
  data: AMMRevenuePoint[];
}

/* ------------------------------------------------------------------ */
/*  Active Wallets                                                     */
/* ------------------------------------------------------------------ */

export interface ActiveWalletsPoint {
  timestamp: number;
  uniqueWallets: number;
  totalTrades: number;
}

export interface ActiveWalletsTotal {
  periodUniqueWallets: number;
  periodTotalTrades: number;
}

/* ------------------------------------------------------------------ */
/*  XRP Supply / Burn Rate                                             */
/* ------------------------------------------------------------------ */

export interface XRPSupplyPoint {
  timestamp: number;
  cumulativeBurnXrp: number;
  remainingSupplyXrp: number;
}

export interface XRPSupplyTotal {
  totalBurnedXrp: number;
  remainingSupplyXrp: number;
  periodBurnXrp: number;
}

/* ------------------------------------------------------------------ */
/*  Network Growth                                                     */
/* ------------------------------------------------------------------ */

export interface NetworkGrowthMetric {
  label: string;
  current: number;
  previous: number;
  changePercent: number | null;
}

export interface NetworkGrowthData {
  metrics: NetworkGrowthMetric[];
}

/* ------------------------------------------------------------------ */
/*  Token Velocity                                                     */
/* ------------------------------------------------------------------ */

export interface TokenVelocityEntry {
  currency: string;
  currencyDisplay: string;
  issuer: string;
  issuerName: string | null;
  icon: string | null;
  velocity: number;
  volumeXrp: number;
  totalSupply: number;
}
