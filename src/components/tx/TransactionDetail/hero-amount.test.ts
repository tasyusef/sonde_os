import { describe, expect, it } from "vitest";
import { heroTone, pickHeroAmount } from "./hero-amount";

const ok = { TransactionResult: "tesSUCCESS" };
const failed = { TransactionResult: "tecUNFUNDED_OFFER" };
const usd = { currency: "USD", issuer: "rIssuer", value: "12.5" };

describe("heroTone", () => {
  it("maps result codes to success / failed / pending", () => {
    expect(heroTone("tesSUCCESS")).toBe("success");
    expect(heroTone("tecNO_DST")).toBe("failed");
    expect(heroTone(undefined)).toBe("pending");
  });
});

describe("pickHeroAmount", () => {
  it("features delivered_amount on a successful Payment", () => {
    const tx = { TransactionType: "Payment", Amount: "5000000" };
    expect(pickHeroAmount(tx, { ...ok, delivered_amount: "4000000" })).toEqual({
      amount: "4000000",
      label: "Delivered",
      tone: "success",
    });
  });

  it("falls back to Amount (or DeliverMax) when delivered_amount is missing", () => {
    expect(
      pickHeroAmount({ TransactionType: "Payment", Amount: "1" }, ok),
    ).toMatchObject({ amount: "1", label: "Delivered" });
    expect(
      pickHeroAmount({ TransactionType: "Payment", DeliverMax: usd }, ok),
    ).toMatchObject({ amount: usd, label: "Delivered" });
  });

  it("calls an old partial payment's Amount a request, not a delivery", () => {
    const tx = { TransactionType: "Payment", Amount: "9", Flags: 0x80020000 };
    expect(
      pickHeroAmount(tx, { ...ok, delivered_amount: "unavailable" }),
    ).toEqual({ amount: "9", label: "Requested", tone: "success" });
  });

  it("says a failed Payment was not delivered and ignores delivered_amount", () => {
    const tx = { TransactionType: "Payment", Amount: "7" };
    expect(pickHeroAmount(tx, { ...failed, delivered_amount: "7" })).toEqual({
      amount: "7",
      label: "Not delivered",
      tone: "failed",
    });
  });

  it("never says Delivered for an NFT offer", () => {
    const sell = { TransactionType: "NFTokenCreateOffer", Amount: "665614997", Flags: 1 };
    const buy = { TransactionType: "NFTokenCreateOffer", Amount: "6000000", Flags: 0 };
    expect(pickHeroAmount(sell, ok)?.label).toBe("Sell offer");
    expect(pickHeroAmount(buy, ok)?.label).toBe("Buy offer");
    expect(pickHeroAmount(buy, failed)?.label).toBe("Offer not created");
  });

  it("labels intent-only types by what the number is", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ TransactionType: "EscrowCreate", Amount: "1" }, "Escrowed"],
      [{ TransactionType: "CheckCreate", SendMax: "1" }, "Check amount"],
      [{ TransactionType: "PaymentChannelCreate", Amount: "1" }, "Channel amount"],
      [{ TransactionType: "PaymentChannelFund", Amount: "1" }, "Added to channel"],
      [{ TransactionType: "OfferCreate", TakerGets: "1", TakerPays: usd }, "Offered"],
      [{ TransactionType: "Clawback", Amount: usd }, "Clawed back"],
    ];
    for (const [tx, label] of cases) {
      expect(pickHeroAmount(tx, ok)?.label).toBe(label);
    }
  });

  it("features OfferCreate's TakerGets and CheckCreate's SendMax", () => {
    expect(
      pickHeroAmount({ TransactionType: "OfferCreate", TakerGets: "3", TakerPays: usd }, ok)
        ?.amount,
    ).toBe("3");
    expect(
      pickHeroAmount({ TransactionType: "CheckCreate", SendMax: usd }, ok)?.amount,
    ).toBe(usd);
  });

  it("uses delivered_amount for CheckCash and AccountDelete", () => {
    expect(
      pickHeroAmount(
        { TransactionType: "CheckCash", DeliverMin: "1" },
        { ...ok, delivered_amount: "3" },
      ),
    ).toMatchObject({ amount: "3", label: "Cashed" });
    expect(
      pickHeroAmount({ TransactionType: "AccountDelete" }, { ...ok, delivered_amount: "8" }),
    ).toMatchObject({ amount: "8", label: "Delivered" });
  });

  it("stays neutral for unmapped types with an Amount", () => {
    const tx = { TransactionType: "AMMDeposit", Amount: "1" };
    expect(pickHeroAmount(tx, ok)?.label).toBe("Amount");
    expect(pickHeroAmount(tx, failed)?.label).toBe("Attempted");
  });

  it("labels an unvalidated tx as pending", () => {
    const tx = { TransactionType: "Payment", Amount: "1" };
    expect(pickHeroAmount(tx, undefined)).toEqual({
      amount: "1",
      label: "Pending",
      tone: "pending",
    });
  });

  it("returns null when the type has no amount to feature", () => {
    expect(pickHeroAmount({ TransactionType: "AccountSet" }, ok)).toBeNull();
    expect(pickHeroAmount({ TransactionType: "AccountDelete" }, failed)).toBeNull();
    expect(pickHeroAmount({ TransactionType: "AccountDelete" }, ok)).toBeNull();
  });
});
