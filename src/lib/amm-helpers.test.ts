import { describe, expect, it } from "vitest";
import { lpPositionXrpValue, positionAmounts } from "./amm-helpers";
import type { AMMPosition } from "@/types/amm";

const pos = (overrides: Partial<AMMPosition> = {}): AMMPosition => ({
  ammAccount: "rAMM",
  asset1Label: "XRP",
  asset1IsXrp: true,
  asset1Issuer: "",
  asset1Currency: "XRP",
  asset1Value: 1_000,
  asset2Label: "USD",
  asset2IsXrp: false,
  asset2Issuer: "rIssuer",
  asset2Currency: "USD",
  asset2Value: 2_500,
  lpTokenBalance: 10,
  lpTokenSupply: 100,
  sharePercent: 10,
  tradingFee: 500,
  ...overrides,
});

describe("positionAmounts", () => {
  it("scales pool totals by the LP share", () => {
    expect(positionAmounts(pos())).toEqual({ asset1: 100, asset2: 250 });
  });
});

describe("lpPositionXrpValue", () => {
  it("is twice the XRP side, whichever side it is", () => {
    expect(lpPositionXrpValue(pos())).toBe(200);
    expect(
      lpPositionXrpValue(
        pos({ asset1IsXrp: false, asset2IsXrp: true, asset2Value: 400 }),
      ),
    ).toBe(80);
  });

  it("is null for token/token pools", () => {
    expect(lpPositionXrpValue(pos({ asset1IsXrp: false }))).toBeNull();
  });
});
