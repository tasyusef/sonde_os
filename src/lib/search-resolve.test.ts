import { describe, expect, it, vi } from "vitest";
import { mightBeNftId, resolveHexId } from "./search-resolve";
import type { SendFn } from "./xrpl-pagination";

const HASH = "E3FE6EA3D48F0C2B639448020EA4F03D4F4F8FFDB243A852A0F59177921B4879";
/** Flags 0x0008, no transfer fee, then issuer, scrambled taxon and sequence. */
const NFT = "00080000" + "AE123A8556F3CF91154711376AFB0F894F832B3D" + "2DFD1E5C" + "0000002A";

const notFound = (error: string) => Promise.reject({ error });

/** A node that has only what `has` names; anything else is not found. */
function node(has: Partial<Record<"tx" | "ledger" | "nft_info", "found" | "down">>) {
  const missing = { tx: "txnNotFound", ledger: "lgrNotFound", nft_info: "objectNotFound" } as const;
  return vi.fn<SendFn>((command) => {
    const name = command.command as keyof typeof missing;
    const state = has[name];
    if (state === "found") return Promise.resolve({});
    if (state === "down") return Promise.reject(new Error("timeout"));
    return notFound(missing[name]);
  });
}

describe("mightBeNftId", () => {
  it("passes NFT IDs and fails most hashes", () => {
    expect(mightBeNftId(NFT)).toBe(true);
    expect(mightBeNftId(HASH)).toBe(false);
  });

  it("fails a transfer fee over 50,000", () => {
    expect(mightBeNftId(`0008C351${NFT.slice(8)}`)).toBe(false);
    expect(mightBeNftId(`0008C350${NFT.slice(8)}`)).toBe(true);
  });
});

describe("resolveHexId", () => {
  it("finds a transaction", async () => {
    expect(await resolveHexId(node({ tx: "found" }), HASH)).toBe("transaction");
  });

  it("finds a ledger hash", async () => {
    expect(await resolveHexId(node({ ledger: "found" }), HASH)).toBe("ledger");
  });

  it("finds an NFT", async () => {
    expect(await resolveHexId(node({ nft_info: "found" }), NFT)).toBe("nft");
  });

  it("asks Clio only for an ID that could be an NFT", async () => {
    const send = node({});
    await resolveHexId(send, HASH);
    expect(send.mock.calls.map(([c]) => c.command)).not.toContain("nft_info");
  });

  it("re-asks a full-history node before calling a tx or ledger missing", async () => {
    const send = node({});
    expect(await resolveHexId(send, HASH)).toBeNull();
    const asked = send.mock.calls.map(([c, opts]) => `${c.command}${opts?.fullHistory ? "+full" : ""}`);
    expect(asked.sort()).toEqual(["ledger", "ledger+full", "tx", "tx+full"]);
  });

  it("returns a later find when an earlier lookup failed", async () => {
    expect(await resolveHexId(node({ tx: "down", ledger: "found" }), HASH)).toBe("ledger");
  });

  it("throws when a lookup failed and nothing was found", async () => {
    await expect(resolveHexId(node({ ledger: "down" }), HASH)).rejects.toThrow("timeout");
  });
});
