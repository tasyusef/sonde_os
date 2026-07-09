/**
 * Mock data for all API endpoints.
 * Gated by MOCK_DATA=true — the Next.js middleware intercepts /api/* and
 * returns these responses so the UI renders without real services.
 */

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const now = Date.now();
const hour = 3_600_000;
const day = 24 * hour;

/** Generate a time-series array of `count` points going back `span` ms. */
function timeSeries<T>(
  count: number,
  span: number,
  fn: (t: number, i: number, total: number) => T,
): T[] {
  return Array.from({ length: count }, (_, i) =>
    fn(now - span + (i / (count - 1)) * span, i, count),
  );
}

/** Deterministic-ish pseudo-random from index (no Math.random so snapshots are stable). */
function noise(i: number, seed = 0): number {
  return ((Math.sin(i * 127.1 + seed * 311.7) * 43758.5453) % 1 + 1) % 1;
}

function rAddress(seed: number): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let addr = "r";
  for (let i = 0; i < 24 + (seed % 10); i++) {
    addr += chars[Math.floor(noise(i, seed) * chars.length)];
  }
  return addr;
}

function txHash(seed: number): string {
  const hex = "0123456789ABCDEF";
  let hash = "";
  for (let i = 0; i < 64; i++) hash += hex[Math.floor(noise(i, seed) * 16)];
  return hash;
}

/* ------------------------------------------------------------------ */
/*  Token names used across multiple endpoints                         */
/* ------------------------------------------------------------------ */

const TOKENS = [
  { currency: "534F4C4F00000000000000000000000000000000", display: "SOLO", issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWFasRf", name: "Sologenic", icon: null },
  { currency: "CSC\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0", display: "CSC", issuer: "rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr", name: "CasinoCoin", icon: null },
  { currency: "4558504C4F524552000000000000000000000000", display: "EXP", issuer: "rExPLoreRHevH7VN3BTgjSrUuXH1YiYhE", name: "Explorer", icon: null },
  { currency: "584D414E00000000000000000000000000000000", display: "XMAN", issuer: "rXMANokLJnMFjRUSoX3gQDqTvf2UjzHxn", name: "Xaman", icon: null },
  { currency: "47415445485542000000000000000000000000000", display: "GateHub USD", issuer: "rGateHuBuZn4hDF5MBmBYZtSn9YNGq3gL", name: "GateHub USD", icon: null },
  { currency: "5852504C444F4700000000000000000000000000", display: "XDOG", issuer: "rDogXRPLFun6KpBQnZpYVbVu42Ax9hXyz", name: "XRPL Dog", icon: null },
  { currency: "434F524500000000000000000000000000000000", display: "CORE", issuer: "rCoreTokenXRPLedger1234567890abc", name: "Coreum", icon: null },
  { currency: "584150500000000000000000000000000000000000", display: "XAPP", issuer: "rXappDeFiProtocol12345678abcdef", name: "Xapp", icon: null },
  { currency: "4D4F4F4E00000000000000000000000000000000", display: "MOON", issuer: "rMoonShotXRPL12345678901234567", name: "MoonShot", icon: null },
  { currency: "5350414345000000000000000000000000000000", display: "SPACE", issuer: "rSpaceTokenXRPL1234567890abcde", name: "SpaceToken", icon: null },
];

/* ------------------------------------------------------------------ */
/*  Analytics: DEX Volume                                              */
/* ------------------------------------------------------------------ */

export const MOCK_DEX_VOLUME = {
  timeSeries: timeSeries(168, 7 * day, (t, i) => ({
    timestamp: t,
    xrpVolume: 120_000 + Math.sin(i * 0.3) * 40_000 + noise(i) * 20_000,
    tradeCount: 800 + Math.floor(Math.sin(i * 0.4) * 300 + noise(i, 1) * 200),
  })),
  total: {
    periodXrpVolume: 14_500_000,
    periodTradeCount: 142_800,
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: Fee Burn                                                */
/* ------------------------------------------------------------------ */

export const MOCK_FEE_BURN = {
  timeSeries: timeSeries(168, 7 * day, (t, i) => ({
    timestamp: t,
    txCount: 1200 + Math.floor(Math.sin(i * 0.5) * 400 + noise(i) * 300),
    burnDrops: String(Math.floor(12_000_000 + Math.sin(i * 0.3) * 4_000_000 + noise(i) * 2_000_000)),
  })),
  total: {
    periodTxCount: 205_000,
    periodBurnDrops: "2100000000",
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: TX Volume                                               */
/* ------------------------------------------------------------------ */

const TX_FAMILIES = ["Payment", "DEX", "Token", "NFT", "Account", "Other"];

export const MOCK_TX_VOLUME = {
  timeSeries: timeSeries(168, 7 * day, (t, i) => {
    const base = 1500 + Math.sin(i * 0.3) * 500;
    const families: Record<string, number> = {};
    const ratios = [0.35, 0.25, 0.15, 0.1, 0.08, 0.07];
    let total = 0;
    TX_FAMILIES.forEach((f, fi) => {
      const v = Math.floor(base * ratios[fi] * (1 + noise(i, fi) * 0.3));
      families[f] = v;
      total += v;
    });
    return { timestamp: t, families, total };
  }),
  stats: {
    periodTotal: 245_000,
    avgPerHour: 1_460,
    peakHour: 3_280,
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: Corridors                                               */
/* ------------------------------------------------------------------ */

export const MOCK_CORRIDORS = {
  corridors: [
    { srcCurrency: "XRP", srcName: "XRP", dstCurrency: "USD", dstName: "US Dollar", count: 12_400, xrpVolume: 3_450_000 },
    { srcCurrency: "XRP", srcName: "XRP", dstCurrency: "SOLO", dstName: "Sologenic", count: 8_200, xrpVolume: 2_100_000 },
    { srcCurrency: "XRP", srcName: "XRP", dstCurrency: "CSC", dstName: "CasinoCoin", count: 5_600, xrpVolume: 1_400_000 },
    { srcCurrency: "USD", srcName: "US Dollar", dstCurrency: "XRP", dstName: "XRP", count: 4_100, xrpVolume: 980_000 },
    { srcCurrency: "XRP", srcName: "XRP", dstCurrency: "EUR", dstName: "Euro", count: 3_200, xrpVolume: 720_000 },
    { srcCurrency: "SOLO", srcName: "Sologenic", dstCurrency: "XRP", dstName: "XRP", count: 2_800, xrpVolume: 640_000 },
    { srcCurrency: "XRP", srcName: "XRP", dstCurrency: "EXP", dstName: "Explorer", count: 1_900, xrpVolume: 450_000 },
    { srcCurrency: "XRP", srcName: "XRP", dstCurrency: "GBP", dstName: "British Pound", count: 1_200, xrpVolume: 310_000 },
  ],
  stats: {
    totalCorridors: 156,
    totalPayments: 39_400,
    totalXrpVolume: 10_050_000,
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: NFT Activity                                            */
/* ------------------------------------------------------------------ */

export const MOCK_NFT_ACTIVITY = {
  timeSeries: timeSeries(168, 7 * day, (t, i) => ({
    timestamp: t,
    xrpVolume: 8_000 + Math.sin(i * 0.6) * 4_000 + noise(i) * 3_000,
    tradeCount: 40 + Math.floor(Math.sin(i * 0.5) * 20 + noise(i, 2) * 15),
  })),
  total: {
    periodXrpVolume: 1_240_000,
    periodTradeCount: 7_800,
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: Token Movers                                            */
/* ------------------------------------------------------------------ */

export const MOCK_TOKEN_MOVERS = {
  movers: TOKENS.slice(0, 8).map((t, i) => ({
    currency: t.currency,
    currencyDisplay: t.display,
    issuer: t.issuer,
    issuerName: t.name,
    icon: t.icon,
    currentVolume: 50_000 + noise(i) * 200_000,
    previousVolume: 45_000 + noise(i, 1) * 180_000,
    changePercent: [-18.5, 42.3, -7.2, 155.8, 12.4, -32.1, 8.9, -5.6][i],
    tradeCount: 200 + Math.floor(noise(i, 2) * 1500),
  })),
};

/* ------------------------------------------------------------------ */
/*  Analytics: AMM Revenue                                             */
/* ------------------------------------------------------------------ */

export const MOCK_AMM_REVENUE = {
  timeSeries: timeSeries(168, 7 * day, (t, i) => ({
    timestamp: t,
    estimatedFeeXrp: 50 + Math.sin(i * 0.4) * 25 + noise(i) * 15,
  })),
  total: {
    periodFeeXrp: 12_400,
    topEarners: [
      { currency: "SOLO", issuerName: "Sologenic", feeXrp: 4_200 },
      { currency: "CSC", issuerName: "CasinoCoin", feeXrp: 2_800 },
      { currency: "EXP", issuerName: "Explorer", feeXrp: 1_600 },
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: Top Traders                                             */
/* ------------------------------------------------------------------ */

export const MOCK_TOP_TRADERS = {
  traders: Array.from({ length: 10 }, (_, i) => ({
    address: rAddress(i + 100),
    totalVolumeXrp: 500_000 - i * 40_000 + noise(i) * 20_000,
    buyVolumeXrp: 280_000 - i * 22_000,
    sellVolumeXrp: 220_000 - i * 18_000,
    netProfitXrp: (noise(i) > 0.5 ? 1 : -1) * (5_000 + noise(i, 1) * 30_000),
    tradeCount: 800 - i * 60,
  })),
};

/* ------------------------------------------------------------------ */
/*  Analytics: Active Wallets                                          */
/* ------------------------------------------------------------------ */

export const MOCK_ACTIVE_WALLETS = {
  timeSeries: timeSeries(168, 7 * day, (t, i) => ({
    timestamp: t,
    uniqueWallets: 2_200 + Math.floor(Math.sin(i * 0.3) * 600 + noise(i) * 400),
    totalTrades: 3_500 + Math.floor(Math.sin(i * 0.4) * 1_000 + noise(i, 1) * 800),
  })),
  total: {
    periodUniqueWallets: 18_400,
    periodTotalTrades: 142_800,
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: XRP Supply                                              */
/* ------------------------------------------------------------------ */

export const MOCK_XRP_SUPPLY = {
  timeSeries: timeSeries(168, 7 * day, (t, i) => ({
    timestamp: t,
    cumulativeBurnXrp: 12_560_000 + i * 120,
    remainingSupplyXrp: 99_987_440_000 - i * 120,
  })),
  total: {
    totalBurnedXrp: 12_580_000,
    remainingSupplyXrp: 99_987_420_000,
    periodBurnXrp: 20_000,
  },
};

/* ------------------------------------------------------------------ */
/*  Analytics: Network Growth                                          */
/* ------------------------------------------------------------------ */

export const MOCK_NETWORK_GROWTH = {
  metrics: [
    { label: "New Accounts", current: 1_240, previous: 1_080, changePercent: 14.8 },
    { label: "Active Accounts", current: 18_400, previous: 16_200, changePercent: 13.6 },
    { label: "Total Transactions", current: 245_000, previous: 218_000, changePercent: 12.4 },
    { label: "DEX Volume (XRP)", current: 14_500_000, previous: 12_800_000, changePercent: 13.3 },
    { label: "Avg Fee (drops)", current: 12, previous: 12, changePercent: 0 },
  ],
};

/* ------------------------------------------------------------------ */
/*  Analytics: Token Velocity                                          */
/* ------------------------------------------------------------------ */

export const MOCK_TOKEN_VELOCITY = {
  tokens: TOKENS.slice(0, 10).map((t, i) => ({
    currency: t.currency,
    currencyDisplay: t.display,
    issuer: t.issuer,
    issuerName: t.name,
    icon: t.icon,
    velocity: 0.8 + noise(i) * 4.5,
    volumeXrp: 50_000 + noise(i, 1) * 500_000,
    totalSupply: 1_000_000 + noise(i, 2) * 50_000_000,
  })),
};

/* ------------------------------------------------------------------ */
/*  Analytics: DEX TVL                                                 */
/* ------------------------------------------------------------------ */

export const MOCK_DEX_TVL = {
  totalTvlXrp: 48_500_000,
  totalTvlUsd: 116_900_000,
  poolCount: 142,
  topPools: TOKENS.slice(0, 6).map((t, i) => ({
    account: rAddress(i + 200),
    currency: t.display,
    issuerName: t.name,
    tvlXrp: 8_000_000 - i * 1_200_000 + noise(i) * 500_000,
    imageUrl: null,
    tradingFee: [500, 300, 500, 1000, 300, 500][i],
    holders: 200 + Math.floor(noise(i, 3) * 800),
  })),
};

/* ------------------------------------------------------------------ */
/*  Tokens: List                                                       */
/* ------------------------------------------------------------------ */

export const MOCK_TOKEN_LIST = {
  tokens: TOKENS.map((t, i) => ({
    currency: t.currency,
    currencyDisplay: t.display,
    issuer: t.issuer,
    meta: { name: t.name, icon: t.icon, issuerName: t.name },
    metrics: {
      price: [0.16, 0.014, 0.015, 0.017, 1.0, 0.000119, 0.00124, 0.0054, 0.0000442, 0.00062][i],
      volume24h: 50_000 + noise(i) * 200_000,
      volume7d: 350_000 + noise(i, 1) * 1_400_000,
      marketcap: 500_000 + noise(i, 2) * 10_000_000,
      holders: 500 + Math.floor(noise(i, 3) * 5_000),
      trustlines: 1_000 + Math.floor(noise(i, 4) * 10_000),
      supply: 10_000_000 + noise(i, 5) * 100_000_000,
    },
    rank: i + 1,
  })),
  total: 10,
  hasMore: false,
};

/* ------------------------------------------------------------------ */
/*  Tokens: OHLC                                                       */
/* ------------------------------------------------------------------ */

export function getMockOhlc(): { candles: unknown[] } {
  const basePrice = 0.16;
  return {
    candles: timeSeries(168, 7 * day, (t, i) => {
      const drift = Math.sin(i * 0.1) * 0.02;
      const vol = noise(i) * 0.01;
      const open = basePrice + drift;
      const close = open + (noise(i, 1) - 0.5) * 0.008;
      return {
        timestamp: t,
        open,
        high: Math.max(open, close) + vol,
        low: Math.min(open, close) - vol,
        close,
        volume: 5_000 + noise(i, 2) * 50_000,
        tradeCount: 10 + Math.floor(noise(i, 3) * 100),
        isVwap: false,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  Tokens: Holders                                                    */
/* ------------------------------------------------------------------ */

export const MOCK_TOKEN_HOLDERS = {
  current: {
    holders: Array.from({ length: 10 }, (_, i) => ({
      address: rAddress(i + 300),
      balance: 5_000_000 - i * 450_000 + noise(i) * 100_000,
      totalSupply: 25_000_000,
      rank: i + 1,
    })),
    snapshotTime: new Date(now - 2 * hour).toISOString(),
  },
  history: timeSeries(7, 7 * day, (t) => ({
    time: new Date(t).toISOString(),
    holders: Array.from({ length: 10 }, (_, i) => ({
      address: rAddress(i + 300),
      balance: 5_000_000 - i * 450_000,
      totalSupply: 25_000_000,
    })),
  })),
};

/* ------------------------------------------------------------------ */
/*  Rankings: Token Pairs                                              */
/* ------------------------------------------------------------------ */

export const MOCK_TOKEN_PAIRS = [
  { base: "SOLO", quote: "XRP", baseName: "Sologenic", volume24h: 2_100_000, tradeCount: 4_200, priceChange: 3.2 },
  { base: "CSC", quote: "XRP", baseName: "CasinoCoin", volume24h: 1_400_000, tradeCount: 3_100, priceChange: -1.8 },
  { base: "EXP", quote: "XRP", baseName: "Explorer", volume24h: 900_000, tradeCount: 1_800, priceChange: 7.5 },
  { base: "XMAN", quote: "XRP", baseName: "Xaman", volume24h: 720_000, tradeCount: 1_500, priceChange: -4.2 },
  { base: "CORE", quote: "XRP", baseName: "Coreum", volume24h: 540_000, tradeCount: 1_200, priceChange: 0.8 },
];

/* ------------------------------------------------------------------ */
/*  Rankings: Token Volume                                             */
/* ------------------------------------------------------------------ */

export const MOCK_TOKEN_VOLUME_RANKINGS = TOKENS.map((t, i) => ({
  currency: t.currency,
  currencyDisplay: t.display,
  issuer: t.issuer,
  issuerName: t.name,
  icon: t.icon,
  volumeXrp: 2_100_000 - i * 180_000,
  tradeCount: 4_200 - i * 350,
  rank: i + 1,
}));

/* ------------------------------------------------------------------ */
/*  Rankings: NFT Collections & Marketplaces                           */
/* ------------------------------------------------------------------ */

export const MOCK_NFT_COLLECTIONS = [
  { issuer: rAddress(400), name: "XPunks", count: 10_000, floorXrp: 120, volume24h: 24_000, tradeCount: 42 },
  { issuer: rAddress(401), name: "XRPL Bears", count: 5_000, floorXrp: 85, volume24h: 17_000, tradeCount: 28 },
  { issuer: rAddress(402), name: "XRP Apes", count: 8_000, floorXrp: 45, volume24h: 9_000, tradeCount: 35 },
];

export const MOCK_NFT_MARKETPLACES = [
  { name: "onXRP", address: rAddress(500), volume24h: 45_000, tradeCount: 82, listingCount: 1_200 },
  { name: "XPMarket", address: rAddress(501), volume24h: 28_000, tradeCount: 54, listingCount: 800 },
  { name: "Sologenic", address: rAddress(502), volume24h: 12_000, tradeCount: 31, listingCount: 450 },
];

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

export const MOCK_AUTH_ME = { address: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY" };

/* ------------------------------------------------------------------ */
/*  Price History                                                      */
/* ------------------------------------------------------------------ */

export function getMockPriceHistory(days: number) {
  const count = Math.min(days * 24, 500);
  const span = days * day;
  const basePrice = 2.05;
  return timeSeries(count, span, (t, i, total) => ({
    time: Math.floor(t / 1000),
    close: basePrice + (i / total) * 0.36 + Math.sin(i * 0.1) * 0.15,
    high: basePrice + (i / total) * 0.36 + 0.08 + noise(i) * 0.1,
    low: basePrice + (i / total) * 0.36 - 0.06 - noise(i, 1) * 0.08,
    open: basePrice + (i / total) * 0.36 - 0.02 + noise(i, 2) * 0.04,
    volumefrom: 50_000_000 + noise(i, 3) * 100_000_000,
    volumeto: 120_000_000 + noise(i, 4) * 250_000_000,
  }));
}

/* ------------------------------------------------------------------ */
/*  SSE Stream (Live Data)                                             */
/* ------------------------------------------------------------------ */

export function getMockSSESnapshot() {
  const ledgerIndex = 92_400_000 + Math.floor(noise(now / 4000) * 100);
  return {
    ledger: {
      ledger_index: ledgerIndex,
      ledger_hash: txHash(ledgerIndex),
      ledger_time: Math.floor(now / 1000) - 946684800,
      txn_count: 25 + Math.floor(noise(ledgerIndex) * 40),
    },
    transactions: Array.from({ length: 8 }, (_, i) => ({
      hash: txHash(i + ledgerIndex),
      type: ["Payment", "OfferCreate", "Payment", "TrustSet", "NFTokenAcceptOffer", "OfferCreate", "Payment", "AMMDeposit"][i],
      account: rAddress(i + 50),
      destination: i % 3 === 0 ? rAddress(i + 60) : undefined,
      amount: String((10 + noise(i) * 990) * 1_000_000),
      fee: "12",
      result: "tesSUCCESS",
      date: Math.floor(now / 1000) - 946684800,
      ledgerIndex,
    })),
    txCount: 35,
    stats: {
      ledgerIndex,
      txCount: 35,
      closeTime: Math.floor(now / 1000) - 946684800,
      totalCoins: "99987420000000000",
      baseFee: "10",
      reserveBase: 1,
      reserveIncrement: 0.2,
    },
    fee: {
      baseFeeDrops: "10",
      medianFeeDrops: "12",
      minimumFeeDrops: "10",
      openLedgerFeeDrops: "12",
      queueSize: 0,
      expectedLedgerSize: 50,
      maxQueueSize: 2000,
    },
    health: {
      buildVersion: "2.3.0",
      loadFactor: 1,
      serverState: "full",
      quorum: 5,
      completeLedgers: "32570-92400100",
      validatedSeq: ledgerIndex,
    },
    txDistribution: [
      { family: "Payment", count: 12, percentage: 34.3, color: "#3b82f6" },
      { family: "DEX", count: 9, percentage: 25.7, color: "#22c55e" },
      { family: "Token", count: 5, percentage: 14.3, color: "#f59e0b" },
      { family: "NFT", count: 4, percentage: 11.4, color: "#a855f7" },
      { family: "Account", count: 3, percentage: 8.6, color: "#06b6d4" },
      { family: "Other", count: 2, percentage: 5.7, color: "#6b7280" },
    ],
    price: {
      price: 2.41,
      change24h: 3.24,
      marketCap: 138_000_000_000,
      volume24h: 4_200_000_000,
      high24h: 2.48,
      low24h: 2.31,
      circulatingSupply: 57_260_000_000,
      totalSupply: 99_987_420_000,
    },
    recentMints: Array.from({ length: 4 }, (_, i) => ({
      hash: txHash(i + 900),
      account: rAddress(i + 70),
      nftokenId: txHash(i + 1000),
      uri: null,
      date: Math.floor(now / 1000) - 946684800 - i * 10,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Amendments                                                         */
/* ------------------------------------------------------------------ */

export const MOCK_AMENDMENTS = [
  { hash: txHash(600), name: "XChainBridge", status: "enabled", introduced: "1.12.0", threshold: 28, yeas: 30, nays: 1, abstentions: 4 },
  { hash: txHash(601), name: "AMM", status: "enabled", introduced: "1.12.0", threshold: 28, yeas: 32, nays: 0, abstentions: 3 },
  { hash: txHash(602), name: "Clawback", status: "enabled", introduced: "1.12.0", threshold: 28, yeas: 29, nays: 2, abstentions: 4 },
  { hash: txHash(603), name: "DID", status: "voting", introduced: "2.0.0", threshold: 28, yeas: 18, nays: 5, abstentions: 12 },
  { hash: txHash(604), name: "PriceOracle", status: "voting", introduced: "2.1.0", threshold: 28, yeas: 22, nays: 3, abstentions: 10 },
  { hash: txHash(605), name: "MPTokens", status: "voting", introduced: "2.3.0", threshold: 28, yeas: 12, nays: 8, abstentions: 15 },
];

/* ------------------------------------------------------------------ */
/*  Intel: Overview                                                    */
/* ------------------------------------------------------------------ */

/** Stable addresses used across intel tabs so clicking in Overview → Trace works */
const INTEL_ACCOUNTS = Array.from({ length: 15 }, (_, i) => rAddress(i + 80));

export const MOCK_INTEL_OVERVIEW = {
  metrics: {
    txCount24h: 245_000,
    activeAccounts24h: 18_400,
    dexVolumeDrops24h: "14500000000000",
    totalFeesDrops24h: "2100000000",
  },
  recentPayments: Array.from({ length: 10 }, (_, i) => ({
    txHash: txHash(i + 700),
    from: INTEL_ACCOUNTS[i],
    to: INTEL_ACCOUNTS[14 - i],
    amountDrops: (50_000 + noise(i) * 950_000) * 1_000_000,
    currency: "XRP",
    timestamp: new Date(now - i * 360_000).toISOString(),
  })),
  topByVolume: Array.from({ length: 10 }, (_, i) => ({
    address: INTEL_ACCOUNTS[i],
    txCount: 500 - i * 40,
    totalVolumeDrops: String(Math.floor((5_000_000 - i * 400_000) * 1_000_000)),
  })),
  topByConnections: Array.from({ length: 10 }, (_, i) => ({
    address: INTEL_ACCOUNTS[i],
    connections: 800 - i * 70,
  })),
  hourlyTrends: {
    txCount: Array.from({ length: 24 }, (_, i) => Math.floor(8000 + Math.sin(i / 3) * 3000 + noise(i) * 2000)),
    fees: Array.from({ length: 24 }, (_, i) => Math.floor(70_000_000 + Math.sin(i / 4) * 30_000_000 + noise(i + 50) * 20_000_000)),
    dexVolume: Array.from({ length: 24 }, (_, i) => Math.floor(500_000_000_000 + Math.sin(i / 3.5) * 200_000_000_000 + noise(i + 100) * 100_000_000_000)),
  },
};

/* ------------------------------------------------------------------ */
/*  Intel: Health                                                      */
/* ------------------------------------------------------------------ */

export const MOCK_INTEL_HEALTH = {
  postgres: true,
  clickhouse: true,
  message: "All stores connected (mock mode)",
};

/* ------------------------------------------------------------------ */
/*  Intel: Trace — returns a realistic graph with nodes + edges        */
/* ------------------------------------------------------------------ */

export function getMockTrace(account?: string) {
  const root = account || INTEL_ACCOUNTS[0];
  // Build a 3-depth fan-out: root → 4 → 3 each
  const nodes = [
    { address: root, first_seen: now - 90 * day, last_active: now - hour },
  ];
  const edges: {
    from: string; to: string; amount: number; currency: string;
    timestamp: number; tx_hash: string; type: string;
  }[] = [];

  // Tier 1: 4 direct connections
  const tier1 = Array.from({ length: 4 }, (_, i) => rAddress(i + 150));
  for (const [i, addr] of tier1.entries()) {
    nodes.push({ address: addr, first_seen: now - (60 + i * 5) * day, last_active: now - i * 2 * hour });
    edges.push({
      from: i % 2 === 0 ? root : addr,
      to: i % 2 === 0 ? addr : root,
      amount: (100_000 + noise(i) * 900_000) * 1_000_000,
      currency: "XRP",
      timestamp: now - (i + 1) * 6 * hour,
      tx_hash: txHash(i + 800),
      type: i % 3 === 0 ? "DEX_TRADE" : "PAYMENT",
    });
  }

  // Tier 2: 3 connections from each tier-1 node
  const tier2: string[] = [];
  for (const [ti, t1Addr] of tier1.entries()) {
    for (let j = 0; j < 3; j++) {
      const addr = rAddress(160 + ti * 10 + j);
      tier2.push(addr);
      nodes.push({ address: addr, first_seen: now - (30 + j * 3) * day, last_active: now - (ti + j) * 4 * hour });
      edges.push({
        from: j % 2 === 0 ? t1Addr : addr,
        to: j % 2 === 0 ? addr : t1Addr,
        amount: (10_000 + noise(ti * 10 + j, 5) * 200_000) * 1_000_000,
        currency: "XRP",
        timestamp: now - (ti * 3 + j + 1) * 4 * hour,
        tx_hash: txHash(850 + ti * 10 + j),
        type: j % 2 === 0 ? "PAYMENT" : "DEX_TRADE",
      });
    }
  }

  // A few cross-links between tier-2 for visual richness
  for (let k = 0; k < 4; k++) {
    const a = tier2[k];
    const b = tier2[tier2.length - 1 - k];
    if (a && b && a !== b) {
      edges.push({
        from: a, to: b,
        amount: (5_000 + noise(k, 9) * 50_000) * 1_000_000,
        currency: "XRP",
        timestamp: now - (k + 5) * 8 * hour,
        tx_hash: txHash(950 + k),
        type: "PAYMENT",
      });
    }
  }

  return {
    account: root,
    direction: "both",
    depth: 3,
    pathCount: edges.length,
    graph: { nodes, edges },
  };
}

/* ------------------------------------------------------------------ */
/*  Intel: Connections — returns paths between two accounts            */
/* ------------------------------------------------------------------ */

export function getMockConnections(source?: string, target?: string) {
  const src = source || INTEL_ACCOUNTS[0];
  const tgt = target || INTEL_ACCOUNTS[5];
  const mid1 = rAddress(170);
  const mid2 = rAddress(171);
  const mid3 = rAddress(172);

  const allNodes = [
    { address: src, first_seen: now - 120 * day, last_active: now - hour },
    { address: mid1, first_seen: now - 80 * day, last_active: now - 3 * hour },
    { address: mid2, first_seen: now - 60 * day, last_active: now - 5 * hour },
    { address: mid3, first_seen: now - 45 * day, last_active: now - 8 * hour },
    { address: tgt, first_seen: now - 100 * day, last_active: now - 2 * hour },
  ];

  const path1Edges = [
    { from: src, to: mid1, amount: 500_000_000_000, currency: "XRP", timestamp: now - 12 * hour, tx_hash: txHash(1000), type: "PAYMENT" },
    { from: mid1, to: tgt, amount: 480_000_000_000, currency: "XRP", timestamp: now - 10 * hour, tx_hash: txHash(1001), type: "PAYMENT" },
  ];
  const path2Edges = [
    { from: src, to: mid2, amount: 200_000_000_000, currency: "XRP", timestamp: now - 24 * hour, tx_hash: txHash(1002), type: "PAYMENT" },
    { from: mid2, to: mid3, amount: 195_000_000_000, currency: "XRP", timestamp: now - 20 * hour, tx_hash: txHash(1003), type: "DEX_TRADE" },
    { from: mid3, to: tgt, amount: 190_000_000_000, currency: "XRP", timestamp: now - 18 * hour, tx_hash: txHash(1004), type: "PAYMENT" },
  ];

  return {
    source: src,
    target: tgt,
    pathCount: 2,
    connected: true,
    paths: [
      { hops: 2, nodes: [allNodes[0], allNodes[1], allNodes[4]], edges: path1Edges },
      { hops: 3, nodes: [allNodes[0], allNodes[2], allNodes[3], allNodes[4]], edges: path2Edges },
    ],
    graph: { nodes: allNodes, edges: [...path1Edges, ...path2Edges] },
  };
}

/* ------------------------------------------------------------------ */
/*  Intel: Risk — full risk profile for any account                    */
/* ------------------------------------------------------------------ */

export function getMockRisk(account?: string) {
  const addr = account || INTEL_ACCOUNTS[0];
  // Use address char code to vary the profile deterministically
  const seed = addr.charCodeAt(2) + addr.charCodeAt(5);
  const riskScore = 15 + Math.floor(noise(seed) * 55); // 15–70
  const level = riskScore >= 60 ? "high" : riskScore >= 35 ? "medium" : "low";

  return {
    account: addr,
    riskScore,
    riskLevel: level,
    factors: {
      washPatterns: riskScore >= 50 ? 12 + Math.floor(noise(seed, 1) * 10) : 0,
      lowDiversity: riskScore >= 35 ? 5 + Math.floor(noise(seed, 2) * 8) : 0,
      highFrequency: riskScore >= 25 ? 3 + Math.floor(noise(seed, 3) * 12) : 0,
      lowEntropy: riskScore >= 40 ? 4 + Math.floor(noise(seed, 4) * 6) : 0,
      circularPayments: riskScore >= 55 ? 8 + Math.floor(noise(seed, 5) * 10) : 0,
    },
    graphFeatures: {
      degree: 40 + Math.floor(noise(seed, 6) * 200),
      inDegree: 20 + Math.floor(noise(seed, 7) * 100),
      outDegree: 20 + Math.floor(noise(seed, 8) * 100),
      tradeCount: 100 + Math.floor(noise(seed, 9) * 500),
      uniqueCounterparties: 15 + Math.floor(noise(seed, 10) * 80),
      inOutRatio: 0.5 + noise(seed, 11) * 1.5,
      activitySpan: 30 + Math.floor(noise(seed, 12) * 180),
    },
    behavioralFeatures: {
      txCount: 200 + Math.floor(noise(seed, 13) * 2000),
      txTypeDiversity: 3 + Math.floor(noise(seed, 14) * 5),
      avgTxPerDay: 2 + noise(seed, 15) * 30,
      maxTxPerHour: 5 + Math.floor(noise(seed, 16) * 40),
      peakHourUtc: Math.floor(noise(seed, 17) * 24),
      hourEntropy: 2.0 + noise(seed, 18) * 2.5,
      activeDays: 10 + Math.floor(noise(seed, 19) * 120),
    },
    washFlags: riskScore >= 50
      ? [
          { pattern: "circular_payments", confidence: 0.72 + noise(seed, 20) * 0.2, evidence: `Detected ${3 + Math.floor(noise(seed, 21) * 5)} circular payment loops within 48h window involving ${addr.slice(0, 8)}...` },
          { pattern: "rapid_pair_trading", confidence: 0.55 + noise(seed, 22) * 0.3, evidence: `${8 + Math.floor(noise(seed, 23) * 15)} rapid buy/sell cycles on SOLO/XRP within a 2-hour window` },
        ]
      : riskScore >= 35
        ? [{ pattern: "low_diversity", confidence: 0.6 + noise(seed, 24) * 0.2, evidence: `85% of transactions target the same ${2 + Math.floor(noise(seed, 25) * 3)} counterparties` }]
        : [],
  };
}

/** Mock profile endpoint — distinct from risk (different response shape). */
export function getMockProfile(account?: string) {
  const addr = account || INTEL_ACCOUNTS[0];
  const seed = addr.charCodeAt(2) + addr.charCodeAt(5);
  return {
    account: addr,
    graph: {
      firstSeen: 1672531200 + Math.floor(noise(seed) * 31536000),
      lastActive: 1704067200 + Math.floor(noise(seed, 1) * 5000000),
      paymentsIn: 50 + Math.floor(noise(seed, 2) * 500),
      paymentsOut: 30 + Math.floor(noise(seed, 3) * 300),
      dexTrades: 100 + Math.floor(noise(seed, 4) * 1000),
      uniqueCounterparties: 15 + Math.floor(noise(seed, 5) * 80),
    },
    timeSeries: {
      txCount: 200 + Math.floor(noise(seed, 6) * 2000),
      totalFeeDrops: String(50000 + Math.floor(noise(seed, 7) * 500000)),
      firstTx: "2023-01-15T10:30:00Z",
      lastTx: "2024-03-20T14:22:00Z",
      txTypes: ["Payment", "OfferCreate", "TrustSet"],
    },
    topCounterparties: Array.from({ length: 5 }, (_, i) => ({
      address: INTEL_ACCOUNTS[(i + 1) % INTEL_ACCOUNTS.length],
      txCount: 20 + Math.floor(noise(seed, 8 + i) * 80),
      totalAmount: 1000 + Math.floor(noise(seed, 13 + i) * 50000),
      type: i % 2 === 0 ? "PAYMENT" : "DEX_TRADE",
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Intel: Query — mock NL query response                              */
/* ------------------------------------------------------------------ */

export function getMockQuery(question?: string) {
  const q = question?.toLowerCase() ?? "";
  if (q.includes("volume") || q.includes("dex")) {
    return {
      answer: "Over the past 24 hours, the XRPL DEX processed approximately 14.5M XRP in trading volume across 142,800 individual trades. The most active pair was SOLO/XRP with 2.1M XRP volume, followed by CSC/XRP at 1.4M XRP. Volume peaked between 14:00–16:00 UTC, coinciding with US market open.",
      store: "clickhouse",
      query: "SELECT sum(xrp_volume_drops)/1e6 AS volume_xrp, count() AS trades\nFROM dex_trades\nWHERE timestamp >= now() - INTERVAL 24 HOUR",
    };
  }
  if (q.includes("account") || q.includes("active")) {
    return {
      answer: "There are currently 18,400 unique active accounts on the XRPL in the last 24 hours. The most active account made 500 transactions with a total volume of 5M XRP. The top 10 accounts by volume represent approximately 35% of total network activity.",
      store: "clickhouse",
      query: "SELECT uniqExact(account) AS active\nFROM transactions\nWHERE timestamp >= now() - INTERVAL 24 HOUR\n  AND account NOT IN ('', '__pseudo_tx__')",
    };
  }
  if (q.includes("connect") || q.includes("common")) {
    return {
      answer: "To find shared counterparties between accounts, use the Connections tab. Enter a source and target address, and I'll surface every account both have transacted with.",
      store: "clickhouse",
      query: "SELECT counterparty FROM (\n  -- vte + dex_trades counterparties of source\n) WHERE counterparty IN (\n  -- same for target\n)",
    };
  }
  return {
    answer: "The XRP Ledger is currently processing approximately 245,000 transactions per day across all types. Payment transactions make up about 35% of activity, followed by DEX operations at 25%. The network burned 2,100 XRP in fees over the last 24 hours. Active wallet count is trending up 13.6% compared to the previous period.",
    store: "clickhouse",
    query: "SELECT count() AS tx_count, sum(fee_drops) AS total_fees\nFROM transactions\nWHERE timestamp >= now() - INTERVAL 24 HOUR",
  };
}

/* ------------------------------------------------------------------ */
/*  Intel: Ingestion Status                                            */
/* ------------------------------------------------------------------ */

export const MOCK_INTEL_INGESTION_STATUS = {
  mainPipeline: { latestLedger: 92_400_100, isRunning: false },
  intelPipeline: { latestLedger: 92_400_050, isRunning: false, lag: 50 },
  clickhouse: { rowCount: 0 },
};

/* ------------------------------------------------------------------ */
/*  Ingestion Status                                                   */
/* ------------------------------------------------------------------ */

export const MOCK_INGESTION_STATUS = {
  isRunning: false,
  latestLedger: null,
  ledgersIngested: 0,
  message: "Ingestion disabled (mock mode)",
};

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

export const MOCK_SEARCH = { results: [] };

/* ------------------------------------------------------------------ */
/*  Account Token Prices                                               */
/* ------------------------------------------------------------------ */

export const MOCK_TOKEN_PRICES = Object.fromEntries(
  TOKENS.map((t, i) => [
    `${t.currency}:${t.issuer}`,
    {
      currency: t.currency,
      issuer: t.issuer,
      meta: { name: t.name, icon: null, issuerName: t.name },
      metrics: {
        price: [0.16, 0.014, 0.015, 0.017, 1.0, 0.000119, 0.00124, 0.0054, 0.0000442, 0.00062][i],
        volume24h: 50_000 + noise(i) * 200_000,
        volume7d: null,
        marketcap: null,
        holders: null,
        trustlines: null,
      },
    },
  ]),
);

/* ------------------------------------------------------------------ */
/*  Portfolio: Realized History & Correlation & Debug                   */
/* ------------------------------------------------------------------ */

export const MOCK_REALIZED_HISTORY = { points: [] };

export const MOCK_CORRELATION = { matrix: [], tokens: [] };

export const MOCK_PORTFOLIO_DEBUG = { snapshots: 0, costBasis: 0, realized: 0 };
