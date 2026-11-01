import { describe, expect, it } from "vitest";
import {
  XRPL_EPOCH,
  decodeCurrency,
  deliveredAmount,
  deliveredDrops,
  detectSearchType,
  dropsToXrp,
  formatDate,
  formatDateCompact,
  getTypeColor,
  getTypeColorKey,
  getTypeFamily,
  parseAddressDT,
  toLedgerCurrency,
  truncate,
} from "./xrpl-helpers";

const ADDRESS = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const TX_HASH = "E3FE6EA3D48F0C2B639448020EA4F03D4F4F8FFDB243A852A0F59177921B4879";
const ARMY_HEX = "41524D5900000000000000000000000000000000";

describe("dropsToXrp", () => {
  it("handles zero and a single drop", () => {
    expect(dropsToXrp("0")).toBe("0");
    expect(dropsToXrp(0)).toBe("0");
    expect(dropsToXrp("1")).toBe("0.000001");
    expect(dropsToXrp(1)).toBe("0.000001");
  });

  it("converts whole XRP without a trailing fraction", () => {
    expect(dropsToXrp("1000000")).toBe("1");
    expect(dropsToXrp(25_000_000)).toBe("25");
  });

  it("strips trailing zeros from the fraction", () => {
    expect(dropsToXrp("1500000")).toBe("1.5");
    expect(dropsToXrp("1000010")).toBe("1.00001");
  });

  it("stays exact above Number.MAX_SAFE_INTEGER (100B XRP supply in drops)", () => {
    expect(dropsToXrp("100000000000000000")).toBe("100000000000");
    expect(dropsToXrp("99999999999999999")).toBe("99999999999.999999");
  });

  it("handles negative drops (balance deltas)", () => {
    expect(dropsToXrp("-1")).toBe("-0.000001");
    expect(dropsToXrp("-2500000")).toBe("-2.5");
  });

  it("truncates a stray fractional drop instead of throwing", () => {
    expect(dropsToXrp("1000000.9")).toBe("1");
    expect(dropsToXrp(1_000_000.9)).toBe("1");
  });

  it("returns '0' for unparseable input", () => {
    expect(dropsToXrp("abc")).toBe("0");
    expect(dropsToXrp("1e6")).toBe("0");
  });

  it("gives the same answer for string and number input", () => {
    for (const n of [0, 1, 12, 999_999, 1_000_001, 123_456_789]) {
      expect(dropsToXrp(n)).toBe(dropsToXrp(String(n)));
    }
  });
});

describe("deliveredAmount", () => {
  // Same cases as `row_amount_is_what_was_delivered` in relay/src/snapshot.rs.
  const PARTIAL = 0x00020000;
  const pay = (Flags: number, meta: Record<string, unknown>) => [
    { TransactionType: "Payment", Amount: "1000000", Flags },
    meta,
  ] as const;
  const USD = { currency: "USD", issuer: "rI", value: "1" };

  it.each([
    ["delivered beats the requested ceiling", pay(PARTIAL, { delivered_amount: "5" }), "5"],
    ["the metadata field works too", pay(PARTIAL, { DeliveredAmount: "7" }), "7"],
    ["unknown partial delivery is unknown", pay(PARTIAL, { delivered_amount: "unavailable" }), undefined],
    ["a failed partial payment delivered nothing", pay(PARTIAL, { TransactionResult: "tecPATH_PARTIAL" }), undefined],
    ["a full payment delivers exactly Amount", pay(0, { delivered_amount: "unavailable" }), "1000000"],
    ["issued tokens aren't drops", pay(0, { delivered_amount: USD }), undefined],
    ["API v2 names Amount DeliverMax", [{ TransactionType: "Payment", DeliverMax: "9" }, {}] as const, "9"],
    ["types without delivery use Amount", [{ TransactionType: "EscrowCreate", Amount: "3" }, {}] as const, "3"],
    ["AccountDelete only has delivered", [{ TransactionType: "AccountDelete" }, { delivered_amount: "20" }] as const, "20"],
  ])("%s", (_, [tx, meta], drops) => {
    expect(deliveredDrops(tx, meta)).toBe(drops);
  });

  it("keeps issued-token amounts whole", () => {
    expect(deliveredAmount(...pay(PARTIAL, { delivered_amount: USD }))).toEqual(USD);
  });

  it("falls back to Amount without meta, unless partial", () => {
    expect(deliveredDrops({ TransactionType: "Payment", Amount: "4" }, undefined)).toBe("4");
    expect(deliveredDrops({ TransactionType: "Payment", Amount: "4", Flags: PARTIAL }, undefined)).toBeUndefined();
  });
});

describe("detectSearchType", () => {
  it("detects a classic r-address", () => {
    expect(detectSearchType(ADDRESS)).toBe("account");
    expect(detectSearchType(`  ${ADDRESS}  `)).toBe("account");
  });

  it("detects an address with a destination tag", () => {
    expect(detectSearchType(`${ADDRESS}:12345`)).toBe("account-dt");
    expect(detectSearchType(`${ADDRESS} DT:12345`)).toBe("account-dt");
    expect(detectSearchType(`${ADDRESS} dt 12345`)).toBe("account-dt");
  });

  // Regression: the account-dt regex used the `i` flag, so the base58 class
  // went case-insensitive and I, O, l and an uppercase `R` prefix slipped
  // through. Only the `dt` keyword is case-insensitive now.
  it("rejects non-base58 characters in the address+tag form", () => {
    const bad = "rIIIIIIIIIIIIIIIIIIIIIIIIIII"; // `I` is not in the base58 alphabet
    expect(detectSearchType(bad)).not.toBe("account");
    expect(detectSearchType(`${bad}:5`)).not.toBe("account-dt");
    expect(detectSearchType(`R${ADDRESS.slice(1)}:5`)).not.toBe("account-dt");
    expect(parseAddressDT(`${bad}:5`)).toBeNull();
  });

  it("treats pure digits as a ledger index", () => {
    expect(detectSearchType("95812345")).toBe("ledger");
    expect(detectSearchType("1")).toBe("ledger");
  });

  it("treats 64-hex as ambiguous (tx hash, NFT ID or ledger object)", () => {
    expect(detectSearchType(TX_HASH)).toBe("hex64");
    expect(detectSearchType(TX_HASH.toLowerCase())).toBe("hex64");
  });

  it("detects a CTID (16 hex chars starting with C)", () => {
    expect(detectSearchType("C005523E00000000")).toBe("ctid");
    expect(detectSearchType("c005523e00000000")).toBe("ctid");
    expect(detectSearchType("D005523E00000000")).toBe("unknown");
  });

  // Regression: X-addresses are 47 chars (XLS-5d), but the old check required
  // length 46, so every real one fell through. Now checksum-validated.
  it("detects a real X-address", () => {
    // classicAddressToXAddress("rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", false, false)
    expect(detectSearchType("XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2gYsjNFQLKYW33DzBm")).toBe("x-address");
  });

  it("rejects X-shaped strings that fail the checksum, and testnet T-addresses", () => {
    expect(detectSearchType("XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2gYsjNFQLKYW33DzBn")).toBe("unknown");
    expect(detectSearchType("X".repeat(47))).toBe("unknown");
    // classicAddressToXAddress(ADDRESS, 4294967295, true)
    expect(detectSearchType("TVd2rqMkYL2AyS97NdELcpeiprNBjwWNP7fVL4imBuSa4mF")).toBe("unknown");
  });

  it("detects a PayString", () => {
    expect(detectSearchType("alice$example.com")).toBe("paystring");
  });

  it("returns unknown for junk and currency codes", () => {
    expect(detectSearchType("USD")).toBe("unknown");
    expect(detectSearchType(ARMY_HEX)).toBe("unknown");
    expect(detectSearchType("hello world")).toBe("unknown");
    expect(detectSearchType("")).toBe("unknown");
  });
});

describe("parseAddressDT", () => {
  it("splits address and tag", () => {
    expect(parseAddressDT(`${ADDRESS}:42`)).toEqual({ address: ADDRESS, dt: 42 });
    expect(parseAddressDT(`${ADDRESS} DT:0`)).toEqual({ address: ADDRESS, dt: 0 });
  });

  it("accepts the UInt32 max tag and rejects anything above it", () => {
    expect(parseAddressDT(`${ADDRESS}:4294967295`)?.dt).toBe(4294967295);
    expect(parseAddressDT(`${ADDRESS}:4294967296`)).toBeNull();
  });

  it("returns null when there is no tag", () => {
    expect(parseAddressDT(ADDRESS)).toBeNull();
  });
});

describe("currency codes", () => {
  it("leaves 1-3 char tickers verbatim (case-sensitive on ledger)", () => {
    expect(toLedgerCurrency("USD")).toBe("USD");
    expect(toLedgerCurrency("usd")).toBe("usd");
    expect(decodeCurrency("USD")).toBe("USD");
  });

  it("hex-encodes 4+ char tickers and zero-pads to 40 chars", () => {
    expect(toLedgerCurrency("ARMY")).toBe(ARMY_HEX);
    expect(toLedgerCurrency("ARMY")).toHaveLength(40);
  });

  it("uppercases a lowercase 40-hex code", () => {
    expect(toLedgerCurrency(ARMY_HEX.toLowerCase())).toBe(ARMY_HEX);
  });

  it("decodes 40-hex to the display ticker, stripping zero padding", () => {
    expect(decodeCurrency(ARMY_HEX)).toBe("ARMY");
    expect(decodeCurrency(ARMY_HEX.toLowerCase())).toBe("ARMY");
    expect(decodeCurrency("534F4C4F00000000000000000000000000000000")).toBe("SOLO");
  });

  it("round-trips display → ledger → display", () => {
    for (const ticker of ["USD", "ARMY", "SOLO", "Bitcoin", "ABCDEFGHIJKLMNOPQRST"]) {
      expect(decodeCurrency(toLedgerCurrency(ticker))).toBe(ticker);
    }
  });

  it("round-trips ledger → display → ledger for 40-hex", () => {
    expect(toLedgerCurrency(decodeCurrency(ARMY_HEX))).toBe(ARMY_HEX);
  });

  it("passes through tickers it can't encode (over 20 chars or non-ASCII)", () => {
    expect(toLedgerCurrency("ABCDEFGHIJKLMNOPQRSTU")).toBe("ABCDEFGHIJKLMNOPQRSTU");
    expect(toLedgerCurrency("€URO")).toBe("€URO");
    expect(toLedgerCurrency("")).toBe("");
  });

  it("falls back to the raw hex when the bytes aren't printable", () => {
    const binary = "0000000000000000000000000000000000000000";
    expect(decodeCurrency(binary)).toBe(binary);
  });
});

describe("truncate", () => {
  it("keeps short strings intact", () => {
    expect(truncate("rShort")).toBe("rShort");
    expect(truncate("a".repeat(13))).toBe("a".repeat(13));
  });

  it("truncates with the first and last N chars", () => {
    expect(truncate(ADDRESS)).toBe("rPEPP...c6GDY");
    expect(truncate(ADDRESS, 4)).toBe("rPEP...6GDY");
  });
});

describe("formatDate / formatDateCompact", () => {
  it("renders Ripple epoch 0 as 2000-01-01 UTC", () => {
    expect(XRPL_EPOCH).toBe(946684800);
    expect(formatDate(0)).toBe("2000-01-01 00:00:00 UTC");
    expect(formatDateCompact(0)).toBe("2000-01-01 00:00");
  });

  it("offsets Ripple time from Unix time", () => {
    // 2025-07-30T15:10:20Z
    const ripple = Date.UTC(2025, 6, 30, 15, 10, 20) / 1000 - XRPL_EPOCH;
    expect(formatDate(ripple)).toBe("2025-07-30 15:10:20 UTC");
    expect(formatDateCompact(ripple)).toBe("2025-07-30 15:10");
  });
});

describe("tx type helpers", () => {
  it("maps known types to a color and family", () => {
    expect(getTypeColor("Payment")).toBe("var(--color-tx-payment-mark)");
    expect(getTypeFamily("AMMDeposit")).toBe("AMM");
    expect(getTypeFamily("NFTokenAcceptOffer")).toBe("NFToken");
  });

  it("falls back for unknown types", () => {
    expect(getTypeColor("SomeFutureTx")).toBe("var(--color-tx-other-mark)");
    expect(getTypeFamily("SomeFutureTx")).toBe("Other");
  });

  it("maps each type to its colour family key", () => {
    expect(getTypeColorKey("NFTokenBurn")).toBe("nft");
    expect(getTypeColorKey("PaymentChannelFund")).toBe("check");
    expect(getTypeColorKey("OracleSet")).toBe("account");
    expect(getTypeColorKey("TicketCreate")).toBe("other");
    expect(getTypeColor("AMMBid")).toBe(getTypeColor("AMMCreate"));
  });
});
