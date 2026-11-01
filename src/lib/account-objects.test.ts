import { describe, expect, it } from "vitest";
import { partitionTrustLines } from "./amm-helpers";
import { groupAccountObjects } from "./account-objects";

const ME = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const ISSUER = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";

const line = (currency: string, value: string, meHigh = false) => ({
  LedgerEntryType: "RippleState",
  Balance: { value, currency, issuer: "rrrrrrrrrrrrrrrrrrrrBZbvji" },
  LowLimit: { value: "0", currency, issuer: meHigh ? ISSUER : ME },
  HighLimit: { value: "0", currency, issuer: meHigh ? ME : ISSUER },
});

describe("groupAccountObjects", () => {
  it("splits objects by type and drops the rest", () => {
    const groups = groupAccountObjects([
      line("USD", "1"),
      { LedgerEntryType: "Escrow", Amount: "5" },
      { LedgerEntryType: "PayChannel" },
      { LedgerEntryType: "Check" },
      { LedgerEntryType: "NFTokenOffer" },
      { LedgerEntryType: "MPToken" },
      { LedgerEntryType: "MPTokenIssuance" },
      { LedgerEntryType: "NFTokenPage" },
      { LedgerEntryType: "Offer" },
    ]);
    expect(groups.trustLines).toHaveLength(1);
    expect(groups.escrows).toEqual([{ LedgerEntryType: "Escrow", Amount: "5" }]);
    expect(groups.channels).toHaveLength(1);
    expect(groups.checks).toHaveLength(1);
    expect(groups.nftOffers).toHaveLength(1);
    expect(groups.mpTokens).toHaveLength(1);
    expect(groups.mpTokenIssuances).toHaveLength(1);
  });

  it("keeps positive LP balances as LP positions, from either side", () => {
    const lp = "03" + "A".repeat(38);
    const { trustLines } = groupAccountObjects([line(lp, "5"), line(lp, "-2", true), line("USD", "1")]);
    const { lpTrustLines, regularTrustLines } = partitionTrustLines(trustLines, ME);
    expect(lpTrustLines).toHaveLength(2);
    expect(regularTrustLines.map((t) => t.Balance.currency)).toEqual(["USD"]);
  });
});
