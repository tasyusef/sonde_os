import { describe, expect, it, vi } from "vitest";
import { approveMedia, isMediaApproved, pendingHost, subscribeApprovals } from "./media-approvals";

describe("media approvals", () => {
  const URL_A = "https://cdn.example.com/1.json";

  it("asks per NFT until that NFT's host is approved", () => {
    expect(pendingHost("nft-1", URL_A)).toBe("cdn.example.com");
    approveMedia("nft-1", "cdn.example.com");
    expect(pendingHost("nft-1", URL_A)).toBeNull();
    expect(pendingHost("nft-1", "https://cdn.example.com/1.png")).toBeNull(); // same host, same NFT
    expect(pendingHost("nft-2", URL_A)).toBe("cdn.example.com"); // other NFTs still ask
    expect(pendingHost("nft-1", "https://other.example.org/1.png")).toBe("other.example.org");
  });

  it("never asks for gateway media", () => {
    expect(pendingHost("nft-3", "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toBeNull();
  });

  it("notifies once per new approval", () => {
    const fn = vi.fn();
    const stop = subscribeApprovals(fn);
    approveMedia("nft-4", "a.example.com");
    approveMedia("nft-4", "a.example.com");
    stop();
    approveMedia("nft-4", "b.example.com");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isMediaApproved("nft-4", "b.example.com")).toBe(true);
  });
});
