import { describe, expect, it } from "vitest";
import { incomingOfferRows, summarizeBids } from "./nft-bids";
import type { NFTOffer } from "@/types/nft";

const offer = (amount: NFTOffer["amount"], expiration?: number): NFTOffer => ({
  amount,
  owner: "rBuyer",
  nft_offer_index: `IDX${JSON.stringify(amount)}`,
  flags: 0,
  ...(expiration ? { expiration } : {}),
});

describe("summarizeBids", () => {
  it("keeps active offers and takes the highest XRP bid", () => {
    const iou = { value: "5", currency: "USD", issuer: "rIssuer" };
    const res = summarizeBids(
      ["A", "B", "C", "D"],
      [
        { status: "fulfilled", value: { offers: [offer("1000000"), offer("2500000"), offer(iou)] } },
        { status: "fulfilled", value: { offers: [offer("9000000", 100)] } },
        { status: "rejected", reason: { error: "objectNotFound" } },
        { status: "rejected", reason: { error: "timeout" } },
      ],
      200,
    );
    expect(res.highestBids).toEqual({ A: 2.5 });
    expect(Object.keys(res.buyOffers)).toEqual(["A"]);
    expect(res.buyOffers.A).toHaveLength(3);
    expect(res.failed).toBe(1);
  });

  it("lists IOU-only bids without a highest XRP bid", () => {
    const iou = { value: "5", currency: "USD", issuer: "rIssuer" };
    const res = summarizeBids(["A"], [{ status: "fulfilled", value: { offers: [offer(iou)] } }], 0);
    expect(res.highestBids).toEqual({});
    expect(res.buyOffers.A).toHaveLength(1);
  });
});

describe("incomingOfferRows", () => {
  it("emits one row per offer, tagged with its NFT", () => {
    const rows = incomingOfferRows({ A: [offer("1"), offer("2")], B: [offer("3")] });
    expect(rows.map((r) => [r.nftId, r.offer.amount])).toEqual([
      ["B", "3"],
      ["A", "2"],
      ["A", "1"],
    ]);
  });

  it("ranks XRP by drops, then groups IOU offers by token", () => {
    const usd = (value: string, issuer = "rGate") => ({ value, currency: "USD", issuer });
    const rows = incomingOfferRows({
      A: [offer(usd("5000000")), offer("1000000")],
      B: [offer("20000000"), offer({ value: "9", currency: "EUR", issuer: "rGate" })],
      C: [offer(usd("7")), offer(usd("8", "rOther"))],
    });
    expect(rows.map((r) => r.offer.amount)).toEqual([
      "20000000",
      "1000000",
      { value: "9", currency: "EUR", issuer: "rGate" },
      usd("5000000"),
      usd("7"),
      usd("8", "rOther"),
    ]);
  });

  it("orders equal amounts by offer index so the list doesn't reshuffle", () => {
    const a = { ...offer("5"), nft_offer_index: "B" };
    const b = { ...offer("5"), nft_offer_index: "A" };
    expect(incomingOfferRows({ X: [a, b] }).map((r) => r.offer.nft_offer_index)).toEqual(["A", "B"]);
  });
});
