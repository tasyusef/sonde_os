import { describe, expect, it } from "vitest";
import { accountTotalValue, totalValueIncomplete, type TotalValueSources } from "./account-value";
import { BID_SCAN_LIMIT } from "./nft-bids";
import type { AMMPosition } from "@/types/amm";

const ME = "rMe";

const done: TotalValueSources = {
  objects: { partial: false, truncated: false },
  amm: { partial: false, capped: false },
  nfts: { partial: false, truncated: false, count: 3 },
  bidsFailed: 0,
};

const xrpPool: AMMPosition = {
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
};

const base = {
  address: ME,
  xrpValueUsd: 100,
  xrpPrice: 2,
  escrows: [],
  channels: [],
  ammPositions: [],
  highestBids: {},
  trustLines: [],
  sources: done,
};

describe("accountTotalValue", () => {
  it("adds XRP-priced holdings to the balance", () => {
    const total = accountTotalValue({
      ...base,
      ammPositions: [xrpPool], // 100 XRP side → 200 XRP
      escrows: [
        { Account: ME, Amount: "5000000" },
        { Account: ME, Amount: { value: "9", currency: "USD", issuer: "rI" } }, // IOU
        { Account: "rOther", Destination: ME, Amount: "70000000" }, // incoming
      ],
      channels: [
        { Account: ME, Amount: "10000000", Balance: "4000000" }, // 6 XRP left
        { Account: "rOther", Amount: "99000000" }, // not ours
      ],
      highestBids: { A: 1.5, B: 2.5 },
    });
    // 100 USD + (200 + 5 + 6 + 4) XRP × 2
    expect(total).toEqual({ valueUsd: 100 + 215 * 2, note: undefined });
  });

  it("notes held tokens from either side of the line", () => {
    const low = { Balance: { value: "3" }, HighLimit: { issuer: "rIssuer" } };
    const high = { Balance: { value: "-3" }, HighLimit: { issuer: ME } };
    const owed = { Balance: { value: "-3" }, HighLimit: { issuer: "rIssuer" } };
    expect(accountTotalValue({ ...base, trustLines: [low] }).note).toBe("excl. tokens");
    expect(accountTotalValue({ ...base, trustLines: [high] }).note).toBe("excl. tokens");
    expect(accountTotalValue({ ...base, trustLines: [owed] }).note).toBeUndefined();
  });

  it("puts partial first when a source didn't fully load", () => {
    const low = { Balance: { value: "3" }, HighLimit: { issuer: "rIssuer" } };
    const sources = { ...done, bidsFailed: 2 };
    expect(accountTotalValue({ ...base, trustLines: [low], sources }).note).toBe(
      "partial · excl. tokens",
    );
  });
});

describe("totalValueIncomplete", () => {
  it("is false when everything loaded", () => {
    expect(totalValueIncomplete(done)).toBe(false);
  });

  it.each<[string, TotalValueSources]>([
    ["objects failed", { ...done, objects: { error: { error: "tooBusy" } } }],
    ["objects partial", { ...done, objects: { partial: true } }],
    ["objects capped", { ...done, objects: { truncated: true } }],
    ["an AMM pool failed", { ...done, amm: { partial: true, capped: false } }],
    ["too many LP lines", { ...done, amm: { capped: true } }],
    ["NFTs failed", { ...done, nfts: { error: new Error("timeout"), count: 0 } }],
    ["NFTs past the bid scan", { ...done, nfts: { count: BID_SCAN_LIMIT + 1 } }],
    ["a bid lookup failed", { ...done, bidsFailed: 1 }],
  ])("is true when %s", (_, sources) => {
    expect(totalValueIncomplete(sources)).toBe(true);
  });
});
