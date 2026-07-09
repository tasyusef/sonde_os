import { dropsToXrp, decodeCurrency } from "@/lib/xrpl-helpers";
import type { TrustLine } from "@/components/account/TrustLineList";
import type { AMMInfoResult, AMMPosition } from "@/types/amm";

/** Parsed representation of one side of an AMM pool. */
export interface AMMAsset {
  isXrp: boolean;
  value: number;
  label: string;
  issuer: string;
  currency: string;
}

/** Parses a raw XRPL AMM amount field (drops string or token object) into a display-ready asset. */
export function parseAMMAsset(
  raw: string | { currency: string; issuer: string; value: string }
): AMMAsset {
  if (typeof raw === "string") {
    return {
      isXrp: true,
      value: parseFloat(dropsToXrp(raw)),
      label: "XRP",
      issuer: "",
      currency: "XRP",
    };
  }
  return {
    isXrp: false,
    value: parseFloat(raw.value),
    label: decodeCurrency(raw.currency),
    issuer: raw.issuer,
    currency: raw.currency,
  };
}

/**
 * LP token currencies are 40-char hex strings starting with "03".
 */
function isLPToken(trustLine: TrustLine): boolean {
  const c = trustLine.Balance.currency;
  return c.length === 40 && c.startsWith("03");
}

/**
 * Separates trust lines into regular tokens and LP tokens with positive balance.
 */
export function partitionTrustLines(
  trustLines: TrustLine[],
  address: string
): { regularTrustLines: TrustLine[]; lpTrustLines: TrustLine[] } {
  const regularTrustLines: TrustLine[] = [];
  const lpTrustLines: TrustLine[] = [];

  for (const tl of trustLines) {
    if (isLPToken(tl)) {
      const isHigh = tl.HighLimit.issuer === address;
      const balance = parseFloat(tl.Balance.value);
      const displayBalance = isHigh ? -balance : balance;
      if (displayBalance > 0) {
        lpTrustLines.push(tl);
      }
    } else {
      regularTrustLines.push(tl);
    }
  }

  return { regularTrustLines, lpTrustLines };
}

/**
 * Transforms LP trust lines + amm_info results into display-ready positions.
 */
export function processAMMPositions(
  lpTrustLines: TrustLine[],
  ammResults: PromiseSettledResult<unknown>[],
  address: string
): AMMPosition[] {
  const positions: AMMPosition[] = [];

  for (let i = 0; i < lpTrustLines.length; i++) {
    const result = ammResults[i];
    if (result.status !== "fulfilled" || !result.value) continue;

    const info = result.value as AMMInfoResult;
    const lp = lpTrustLines[i];
    const isHigh = lp.HighLimit.issuer === address;
    const balance = parseFloat(lp.Balance.value);
    const lpTokenBalance = isHigh ? -balance : balance;
    if (lpTokenBalance <= 0) continue;

    const amm = info.amm;
    const lpTokenSupply = parseFloat(amm.lp_token.value);
    if (lpTokenSupply <= 0) continue;

    const asset1 = parseAMMAsset(amm.amount);
    const asset2 = parseAMMAsset(amm.amount2);

    positions.push({
      ammAccount: amm.account,
      asset1Label: asset1.label,
      asset1IsXrp: asset1.isXrp,
      asset1Issuer: asset1.issuer,
      asset1Currency: asset1.currency,
      asset1Value: asset1.value,
      asset2Label: asset2.label,
      asset2IsXrp: asset2.isXrp,
      asset2Issuer: asset2.issuer,
      asset2Currency: asset2.currency,
      asset2Value: asset2.value,
      lpTokenBalance,
      lpTokenSupply,
      sharePercent: (lpTokenBalance / lpTokenSupply) * 100,
      tradingFee: amm.trading_fee,
    });
  }

  return positions;
}
