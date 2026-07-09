/**
 * Mock portfolio data for dev preview.
 * Gated by MOCK_PORTFOLIO=true env var — never ships to prod.
 */

import { XRPL_EPOCH } from "@/lib/xrpl-helpers";

export const MOCK_ADDRESS = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";

export const MOCK_CURRENT = {
  xrpBalance: 12_847.32,
  xrpPriceUsd: 2.41,
  tokenValueUsd: 10_153.55,
  nftCount: 47,
  ammValueUsd: 3_215.80,
  lockedXrp: 500,
  totalValueUsd: 44_830.19,
  ownerCount: 14,
  reserveBase: 1,
  reserveIncrement: 0.2,
  tokenBreakdown: [
    { currency: "534F4C4F00000000000000000000000000000000", issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWFasRf", name: "SOLO", balance: 24_500, usd: 3_920.00 },
    { currency: "CSC\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0", issuer: "rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr", name: "CSC", balance: 150_000, usd: 2_100.00 },
    { currency: "4558504C4F524552000000000000000000000000", issuer: "rExPLoreRHevH7VN3BTgjSrUuXH1YiYhE", name: "EXP", balance: 85_000, usd: 1_275.00 },
    { currency: "584D414E00000000000000000000000000000000", issuer: "rXMANokLJnMFjRUSoX3gQDqTvf2UjzHxn", name: "XMAN", balance: 42_000, usd: 714.00 },
    { currency: "47415445485542000000000000000000000000000", issuer: "rGateHuBuZn4hDF5MBmBYZtSn9YNGq3gL", name: "GateHub USD", balance: 280.5, usd: 280.50 },
    { currency: "5852504C444F4700000000000000000000000000", issuer: "rDogXRPLFun6KpBQnZpYVbVu42Ax9hXyz", name: "XDOG", balance: 1_200_000, usd: 142.65 },
    { currency: "434F524500000000000000000000000000000000", issuer: "rCoreTokenXRPLedger1234567890abc", name: "CORE", balance: 500_000, usd: 620.00 },
    { currency: "584150500000000000000000000000000000000000", issuer: "rXappDeFiProtocol12345678abcdef", name: "XAPP", balance: 75_000, usd: 405.00 },
    { currency: "4D4F4F4E00000000000000000000000000000000", issuer: "rMoonShotXRPL12345678901234567", name: "MOON", balance: 2_000_000, usd: 88.40 },
    { currency: "5350414345000000000000000000000000000000", issuer: "rSpaceTokenXRPL1234567890abcde", name: "SPACE", balance: 320_000, usd: 198.50 },
    { currency: "5A454E0000000000000000000000000000000000", issuer: "rZenFinanceXRPL12345678abcdefg", name: "ZEN", balance: 18_000, usd: 342.00 },
    { currency: "464C555800000000000000000000000000000000", issuer: "rFluxProtocolXRPL123456789abcd", name: "FLUX", balance: 45_000, usd: 67.50 },
  ],
};

/** Generate snapshot history with realistic variation */
function generateSnapshots(
  days: number,
  intervalHours: number,
): {
  time: string;
  xrpBalance: number;
  xrpPriceUsd: number;
  tokenValueUsd: number;
  nftCount: number;
  ammValueUsd: number;
  lockedXrp: number;
  totalValueUsd: number;
}[] {
  const now = Date.now();
  const points = Math.floor((days * 24) / intervalHours);
  const snapshots = [];

  // Start values (older = lower to simulate growth)
  const baseXrp = 11_500;
  const basePrice = 2.05;
  const baseTokens = 6_800;
  const baseAmm = 2_600;

  for (let i = 0; i <= points; i++) {
    const t = now - (points - i) * intervalHours * 3600_000;
    const progress = i / points;

    // Simulate gradual growth + noise
    const noise = Math.sin(i * 0.7) * 0.03 + Math.sin(i * 2.1) * 0.015;
    const xrpBalance = baseXrp + progress * 1_347 + Math.sin(i * 0.3) * 200;
    const xrpPrice = basePrice + progress * 0.36 + noise * basePrice;
    const tokenValue = baseTokens + progress * 1_632 + Math.sin(i * 0.5) * 400;
    const ammValue = baseAmm + progress * 616 + Math.sin(i * 0.4) * 150;
    const lockedXrp = 500;

    const totalValueUsd =
      xrpBalance * xrpPrice + tokenValue + ammValue + lockedXrp * xrpPrice;

    snapshots.push({
      time: new Date(t).toISOString(),
      xrpBalance: Math.round(xrpBalance * 100) / 100,
      xrpPriceUsd: Math.round(xrpPrice * 10000) / 10000,
      tokenValueUsd: Math.round(tokenValue * 100) / 100,
      nftCount: 47,
      ammValueUsd: Math.round(ammValue * 100) / 100,
      lockedXrp,
      totalValueUsd: Math.round(totalValueUsd * 100) / 100,
    });
  }

  return snapshots;
}

const PERIOD_CONFIG: Record<string, { days: number; intervalHours: number }> = {
  "24h": { days: 1, intervalHours: 0.25 },
  "7d": { days: 7, intervalHours: 1 },
  "30d": { days: 30, intervalHours: 6 },
  "90d": { days: 90, intervalHours: 12 },
  "1y": { days: 365, intervalHours: 24 },
  all: { days: 730, intervalHours: 24 },
};

export function getMockHistory(period: string) {
  const config = PERIOD_CONFIG[period] ?? PERIOD_CONFIG["30d"];
  return { snapshots: generateSnapshots(config.days, config.intervalHours) };
}

export const MOCK_TOKENS = {
  tokens: MOCK_CURRENT.tokenBreakdown.map((t, i) => {
    // Simulate PnL — 6 gainers, 6 losers (waterfall shows top 5 + bottom 5)
    const pnlPcts = [32.5, 18.2, -12.4, -6.5, -3.8, -45.6, 55.0, -8.1, -72.3, 14.5, 5.8, -28.9];
    const pct = pnlPcts[i] ?? 0;
    const currentPrice = t.balance > 0 ? t.usd / t.balance : 0;
    const initialPrice = currentPrice / (1 + pct / 100);
    const pnlUsd = t.balance * (currentPrice - initialPrice);

    const costBasisUsd = t.balance * initialPrice;

    // Simulate some realized PnL for tokens that were partially sold
    const realizedPnls = [245.30, 0, -85.60, 42.10, 0, 0, 180.20, 0, -32.40, 0, 0, -15.80];
    const realizedPnlUsd = realizedPnls[i] ?? null;

    return {
      currency: t.currency,
      issuer: t.issuer,
      name: t.name,
      balance: t.balance,
      priceUsd: currentPrice,
      valueUsd: t.usd,
      costBasisUsd: Math.round(costBasisUsd * 100) / 100,
      pnlUsd: Math.round(pnlUsd * 100) / 100,
      pnlPct: pct,
      realizedPnlUsd: realizedPnlUsd !== 0 ? realizedPnlUsd : null,
    };
  }),
};

export const MOCK_AMM_POSITIONS = {
  positions: [
    {
      ammAccount: "rAMMPool1XrpSoloK9mNvBzY1nPqDvBz",
      asset1Currency: "XRP",
      asset1Issuer: "",
      asset1Name: "XRP",
      asset1Value: 125_000,
      asset1IsXrp: true,
      asset2Currency: "534F4C4F00000000000000000000000000000000",
      asset2Issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWFasRf",
      asset2Name: "SOLO",
      asset2Value: 840_000,
      asset2IsXrp: false,
      lpBalance: 1_247.5,
      sharePercent: 0.0842,
      totalValueUsd: 2_185.40,
      tradingFee: 500,
    },
    {
      ammAccount: "rAMMPool2XrpCscN7kL8mPqEwBxC3hGj",
      asset1Currency: "XRP",
      asset1Issuer: "",
      asset1Name: "XRP",
      asset1Value: 80_000,
      asset1IsXrp: true,
      asset2Currency: "CSC\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
      asset2Issuer: "rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr",
      asset2Name: "CSC",
      asset2Value: 12_500_000,
      asset2IsXrp: false,
      lpBalance: 892.3,
      sharePercent: 0.0315,
      totalValueUsd: 1_030.40,
      tradingFee: 300,
    },
  ],
  totalValueUsd: 3_215.80,
};

/** Convert a JS Date to Ripple time (seconds since 2000-01-01). */
function toRippleTime(date: Date): number {
  return Math.floor(date.getTime() / 1000) - XRPL_EPOCH;
}

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

export const MOCK_ACTIVITY = {
  transactions: [
    {
      tx: { TransactionType: "Payment", Account: MOCK_ADDRESS, Destination: "rN7n3cS6erQ3ApXU3PdeRKZw8QDjCiPiVK", Amount: "25000000", Fee: "12", hash: "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F60001", date: toRippleTime(hoursAgo(2)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "OfferCreate", Account: MOCK_ADDRESS, Amount: "50000000", Fee: "12", hash: "B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F60002", date: toRippleTime(hoursAgo(5)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "Payment", Account: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", Destination: MOCK_ADDRESS, Amount: "100000000", Fee: "12", hash: "C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6000003", date: toRippleTime(hoursAgo(8)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "TrustSet", Account: MOCK_ADDRESS, Fee: "12", hash: "D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F600000004", date: toRippleTime(hoursAgo(12)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "NFTokenAcceptOffer", Account: MOCK_ADDRESS, Fee: "12", hash: "E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F60000000005", date: toRippleTime(hoursAgo(18)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "OfferCreate", Account: MOCK_ADDRESS, Amount: "15000000", Fee: "12", hash: "F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6000000000006", date: toRippleTime(hoursAgo(24)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "Payment", Account: MOCK_ADDRESS, Destination: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", Amount: "5000000", Fee: "12", hash: "A7B8C9D0E1F2A7B8C9D0E1F2A7B8C9D0E1F2A7B8C9D0E1F2A7B8C9D0000007", date: toRippleTime(hoursAgo(36)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "EscrowCreate", Account: MOCK_ADDRESS, Amount: "500000000", Fee: "12", hash: "B8C9D0E1F2A3B8C9D0E1F2A3B8C9D0E1F2A3B8C9D0E1F2A3B8C9D000000008", date: toRippleTime(hoursAgo(48)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "AMMDeposit", Account: MOCK_ADDRESS, Fee: "12", hash: "C9D0E1F2A3B4C9D0E1F2A3B4C9D0E1F2A3B4C9D0E1F2A3B4C9D0E100000009", date: toRippleTime(hoursAgo(72)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
    {
      tx: { TransactionType: "OfferCancel", Account: MOCK_ADDRESS, Fee: "12", hash: "D0E1F2A3B4C5D0E1F2A3B4C5D0E1F2A3B4C5D0E1F2A3B4C5D0E1F200000010", date: toRippleTime(hoursAgo(96)) },
      meta: { TransactionResult: "tesSUCCESS" },
      validated: true,
    },
  ],
  marker: null,
  hasMore: false,
};

export const MOCK_NFTS = {
  totalCount: 47,
  totalValueXrp: 1_842,
  totalValueUsd: 4_439.22,
  collections: [
    {
      issuer: "rXRPunKs2jK4tN1qLSv8drVb3B2m6aUGd",
      taxon: 1,
      count: 12,
      floorPriceXrp: 45,
      totalValueXrp: 540,
      totalValueUsd: 1_301.40,
      nfts: Array.from({ length: 3 }, (_, i) => ({
        nftId: `000800006D${i.toString().padStart(58, "0")}`,
        serial: i + 1,
        highestBidXrp: 45 + i * 10,
      })),
    },
    {
      issuer: "rBearNFTCollection9xK3mPqDvBzY1n",
      taxon: 0,
      count: 8,
      floorPriceXrp: 85,
      totalValueXrp: 680,
      totalValueUsd: 1_638.80,
      nfts: Array.from({ length: 3 }, (_, i) => ({
        nftId: `000800007E${i.toString().padStart(58, "0")}`,
        serial: i + 100,
        highestBidXrp: 85 + i * 15,
      })),
    },
    {
      issuer: "rArtXRPLGalleryNFTs4bCde7FgH2iJk",
      taxon: 42,
      count: 27,
      floorPriceXrp: 12,
      totalValueXrp: 622,
      totalValueUsd: 1_499.02,
      nfts: Array.from({ length: 3 }, (_, i) => ({
        nftId: `000800008F${i.toString().padStart(58, "0")}`,
        serial: i + 200,
        highestBidXrp: 12 + i * 5,
      })),
    },
  ],
};
