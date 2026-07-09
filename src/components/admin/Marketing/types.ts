/* Typed shapes for the /api/admin/marketing/data response */

export interface SmartMoneyRow {
  address: string;
  composite_score: string;
  total_pnl_xrp: string | null;
  total_trades: number | null;
  win_rate: string | null;
  tokens_traded: number | null;
}

export interface BiggestTxRow {
  tx_hash: string;
  account: string;
  destination: string;
  amount_drops: string;
  timestamp: string;
}

export interface DexPairRow {
  base_currency: string;
  base_issuer: string;
  quote_currency: string;
  quote_issuer: string;
  trades: string;
  xrp_volume_drops: string;
}

export interface ActiveAccountsRow {
  day: string;
  active_accounts: string;
}

export interface TrustlineWinnerRow {
  currency: string;
  issuer: string;
  added: string;
  removed: string;
  net_new: string;
}

export interface FeeBurnRow {
  timestamp: number;
  burnDrops: string;
  txCount: number;
}

export interface CorridorRow {
  srcCurrency: string;
  dstCurrency: string;
  count: number;
  xrpVolumeDrops: string;
}

export interface LiquidityPoolRow {
  account: string;
  token: string;
  tokenIssuer: string;
  /** Total value locked in XRP — both sides of the pool combined. */
  tvlXrp: number;
  /** XRPL-native trading fee units (500 = 0.5%). */
  tradingFee: number;
  holders: number;
}

export interface TopGainerRow {
  currency: string;
  issuer: string;
  /** Decoded ticker (e.g. "SOLO"), ready for display. */
  ticker: string;
  /** Latest close price in XRP. */
  priceNow: number;
  /** Close price ~24h ago in XRP. */
  price24hAgo: number;
  /** 24h volume in XRP (both sides summed). */
  volume24hXrp: number;
  /** Percentage change (priceNow vs price24hAgo). */
  pctChange: number;
}

export interface AnomalyRow {
  id: string;
  metric: string;
  severity: "notable" | "significant" | "extreme";
  confirmation: string;
  confidence: string;
  zScore: number;
  currentValue: number;
  expectedValue: number;
  deviation: number;
  consecutiveHours: number;
  detectedAt: string;
  description: string;
}

export interface MarketingData {
  generatedAt: string;
  windowNotes: string;
  smartMoneyTop10: SmartMoneyRow[];
  biggestTxs24h: BiggestTxRow[];
  topDexPairs7d: DexPairRow[];
  /** 28 days of daily active-account counts — card slices into current 14d
   * and prior 14d to compare period averages. */
  activeAccountsTrend28d: ActiveAccountsRow[];
  trustlineWinners7d: TrustlineWinnerRow[];
  anomalies: AnomalyRow[];
  feeBurn7d: FeeBurnRow[];
  topCorridors7d: CorridorRow[];
  /** Top AMM pools by XRP TVL (point-in-time snapshot, not windowed). */
  topLiquidityPools: LiquidityPoolRow[];
  /** Top tokens by 24h price change %, filtered to tokens with ≥10K XRP 24h volume. */
  topGainers24h: TopGainerRow[];
}
