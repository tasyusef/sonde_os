import { describe, expect, it } from "vitest";
import { asciiToHex } from "./hex";
import {
  formatPercent,
  formatTokenAmount,
  issuerFlags,
  mptFeePercent,
  mptFlags,
  parseMptMetadata,
  poolPrice,
  transferRatePercent,
  webUrl,
} from "./token-info";

const hexJson = (o: unknown) => asciiToHex(JSON.stringify(o));
const ISSUER = "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz";

describe("flags", () => {
  it("names an issuer's token settings, clawback's high bit too", () => {
    expect(issuerFlags(0x00400000 | 0x80000000 | 0x00800000)).toEqual(["Frozen", "Clawback"]);
    expect(issuerFlags(0)).toEqual([]);
  });

  it("names an MPT's", () => {
    expect(mptFlags(0x20 | 0x10 | 0x01)).toEqual(["Locked", "Tradable", "Transferable"]);
  });
});

describe("fees", () => {
  it.each([
    [undefined, 0],
    [0, 0],
    [1_000_000_000, 0],
    [1_002_000_000, 0.2],
    [1_250_000_000, 25],
  ])("TransferRate %s → %s%", (rate, pct) => {
    expect(transferRatePercent(rate)).toBeCloseTo(pct);
  });

  it("reads an MPT's fee and prints it short", () => {
    expect(formatPercent(mptFeePercent(1250))).toBe("1.25%");
    expect(formatPercent(transferRatePercent(1_002_000_000))).toBe("0.2%");
    expect(formatPercent(mptFeePercent(undefined))).toBe("0%");
  });
});

describe("poolPrice", () => {
  const amm = (amount: unknown, amount2: unknown) =>
    ({ account: "r", amount, amount2, lp_token: { currency: "03", issuer: "r", value: "1" }, trading_fee: 0 }) as never;

  it("prices the token in XRP, whichever side the XRP is", () => {
    const token = { currency: "SOL", issuer: ISSUER, value: "200" };
    expect(poolPrice(amm("50000000", token))).toEqual({ xrp: 50, tokens: 200, price: 0.25 });
    expect(poolPrice(amm(token, "50000000"))).toEqual({ xrp: 50, tokens: 200, price: 0.25 });
  });

  it("is null for an empty pool or one without XRP", () => {
    const token = { currency: "SOL", issuer: ISSUER, value: "0" };
    expect(poolPrice(amm("50000000", token))).toBeNull();
    expect(poolPrice(amm(token, token))).toBeNull();
  });
});

describe("formatTokenAmount", () => {
  it.each([
    ["399999999.567", "399,999,999.57"],
    ["1", "1"],
    ["0", "0"],
    ["0.000123456", "0.0001235"],
    ["1e-7", "0.0000001"],
    ["abc", "—"],
  ])("%s → %s", (value, out) => {
    expect(formatTokenAmount(value)).toBe(out);
  });
});

describe("parseMptMetadata", () => {
  it("reads the long keys", () => {
    const meta = parseMptMetadata(
      hexJson({
        ticker: "TBILL",
        name: "T-Bill Token",
        desc: "A yield-bearing stablecoin.",
        asset_class: "rwa",
        asset_subclass: "treasury",
        issuer_name: "Example Yield Co.",
        uris: [{ uri: "https://exampleyield.co", category: "website", title: "Home" }],
      }),
    );
    expect(meta).toEqual({
      ticker: "TBILL",
      name: "T-Bill Token",
      desc: "A yield-bearing stablecoin.",
      icon: undefined,
      assetClass: "rwa",
      assetSubclass: "treasury",
      issuerName: "Example Yield Co.",
      links: [{ uri: "https://exampleyield.co", category: "website", title: "Home" }],
    });
  });

  it("reads the compact keys, dropping links without a URI", () => {
    const meta = parseMptMetadata(hexJson({ t: "GOLD", n: "Gold", us: [{ u: "gold.example", c: "docs" }, { t: "no uri" }] }));
    expect(meta?.ticker).toBe("GOLD");
    expect(meta?.name).toBe("Gold");
    expect(meta?.links).toEqual([{ uri: "gold.example", category: "docs", title: undefined }]);
  });

  it.each([
    ["nothing", undefined],
    ["not JSON", asciiToHex("plain text")],
    ["an array", hexJson(["x"])],
  ])("is null for %s", (_, hex) => {
    expect(parseMptMetadata(hex)).toBeNull();
  });
});

describe("webUrl", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["example.com", "https://example.com/"],
    ["javascript:alert(1)", null],
    ["ipfs://bafy", null],
  ])("%s → %s", (uri, out) => {
    expect(webUrl(uri)).toBe(out);
  });
});
