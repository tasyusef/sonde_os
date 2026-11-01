import { describe, expect, it } from "vitest";
import { hostToApprove, imageUrls, isLocalPath, mediaUrls, parseIpfs, parseMetadata } from "./nft-media";

const CID0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const CID1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

describe("parseIpfs", () => {
  it("reads ipfs:// URIs with and without a path", () => {
    expect(parseIpfs(`ipfs://${CID0}`)).toEqual({ cid: CID0, path: "" });
    expect(parseIpfs(`ipfs://${CID1}/12.json`)).toEqual({ cid: CID1, path: "/12.json" });
    expect(parseIpfs(`ipfs://ipfs/${CID0}/a`)).toEqual({ cid: CID0, path: "/a" });
  });

  it("reads bare CIDs", () => {
    expect(parseIpfs(`${CID0}/meta.json`)).toEqual({ cid: CID0, path: "/meta.json" });
  });

  it("reads path- and subdomain-style gateway URLs", () => {
    expect(parseIpfs(`https://ipfs.firstledger.net/ipfs/${CID1}/1.png?x=1`)).toEqual({
      cid: CID1,
      path: "/1.png",
    });
    expect(parseIpfs(`https://${CID1}.ipfs.dweb.link/2.json`)).toEqual({ cid: CID1, path: "/2.json" });
  });

  it("keeps # as part of the filename", () => {
    expect(parseIpfs(`ipfs://${CID1}/Drippy #69.json`)).toEqual({ cid: CID1, path: "/Drippy #69.json" });
    expect(parseIpfs(`ipfs://${CID1}/#94.json`)).toEqual({ cid: CID1, path: "/#94.json" });
    expect(parseIpfs(`https://gateway.pinata.cloud/ipfs/${CID1}/Ape #1.json?x=1`)).toEqual({
      cid: CID1,
      path: "/Ape #1.json",
    });
  });

  it("ignores everything else", () => {
    expect(parseIpfs("https://example.com/1.json")).toBeNull();
    expect(parseIpfs("ipfs://not-a-cid")).toBeNull();
  });
});

describe("mediaUrls", () => {
  it("expands IPFS into every gateway, encoding the path once", () => {
    const urls = mediaUrls(`ipfs://${CID0}/my%20nft/1 2.json`);
    expect(urls.length).toBeGreaterThan(1);
    expect(urls[0]).toBe(`https://gateway.pinata.cloud/ipfs/${CID0}/my%20nft/1%202.json`);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("encodes # in IPFS filenames instead of dropping the rest", () => {
    expect(mediaUrls(`ipfs://${CID1}/PONGO #2663.json`)[0]).toBe(
      `https://gateway.pinata.cloud/ipfs/${CID1}/PONGO%20%232663.json`,
    );
  });

  it("expands Arweave into its gateways", () => {
    const urls = mediaUrls("ar://abc123");
    expect(urls[0]).toBe("https://arweave.net/abc123");
    expect(urls.length).toBeGreaterThan(1);
  });

  it("passes safe https URLs through unchanged", () => {
    expect(mediaUrls("https://cdn.example.com/1.json")).toEqual(["https://cdn.example.com/1.json"]);
  });

  it("rejects unsafe or non-https references", () => {
    for (const bad of [
      "http://example.com/1.json",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://user:pw@example.com/x",
      "https://127.0.0.1/x",
      "https://example.com:8443/x",
      "",
      null,
    ]) {
      expect(mediaUrls(bad)).toEqual([]);
    }
  });
});

describe("imageUrls", () => {
  it("keeps same-origin paths", () => {
    expect(imageUrls("/tokens/xrp.svg")).toEqual(["/tokens/xrp.svg"]);
    expect(isLocalPath("/a")).toBe(true);
  });

  it("doesn't treat protocol-relative or backslash paths as local", () => {
    for (const src of ["//evil.com/x.png", "/\\evil.com/x.png", "/\\/evil.com"]) {
      expect(isLocalPath(src)).toBe(false);
      expect(imageUrls(src)).toEqual([]);
    }
  });
});

describe("hostToApprove", () => {
  const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

  it("needs no OK for IPFS and Arweave, even on another host's gateway URL", () => {
    expect(hostToApprove(`ipfs://${CID}/1.json`)).toBeNull();
    expect(hostToApprove(CID)).toBeNull();
    expect(hostToApprove(`https://ipfs.unknown-host.net/ipfs/${CID}/1.png`)).toBeNull();
    expect(hostToApprove(`https://${"bafy" + "a".repeat(55)}.ipfs.w3s.link/1.png`)).toBeNull();
    expect(hostToApprove("ar://abc123")).toBeNull();
    expect(hostToApprove("https://arweave.net/abc123")).toBeNull();
  });

  it("needs no OK for trusted hosts or local paths", () => {
    expect(hostToApprove("https://static.expo2025-dwnft.com/meta/1.json")).toBeNull();
    expect(hostToApprove("/tokens/xrp.svg")).toBeNull();
  });

  it("names any other host", () => {
    expect(hostToApprove("https://cdn.example.com/1.json")).toBe("cdn.example.com");
    expect(hostToApprove("https://CDN.Example.com./a.png")).toBe("cdn.example.com");
  });

  it("is null for what can't load at all", () => {
    expect(hostToApprove(null)).toBeNull();
    expect(hostToApprove("")).toBeNull();
    expect(hostToApprove("http://cdn.example.com/1.json")).toBeNull();
    expect(hostToApprove("//cdn.example.com/1.png")).toBeNull();
  });
});

describe("parseMetadata", () => {
  it("extracts name, image, description, attributes and collection", () => {
    const meta = parseMetadata({
      name: "Ape #12",
      description: "A rowboat ape",
      image: `ipfs://${CID0}`,
      collection: { name: "Pixel Ape Rowboat Club" },
      attributes: [
        { trait_type: "Hat", value: "Cap" },
        { trait_type: "Level", value: 3 },
        { nope: true },
      ],
    });
    expect(meta).toEqual({
      name: "Ape #12",
      collectionName: "Pixel Ape Rowboat Club",
      imageUrl: `https://gateway.pinata.cloud/ipfs/${CID0}`,
      description: "A rowboat ape",
      attributes: [
        { trait_type: "Hat", value: "Cap" },
        { trait_type: "Level", value: 3 },
      ],
    });
  });

  it("falls back to animation_url and a description prefix", () => {
    const meta = parseMetadata({
      animation_url: "https://cdn.example.com/a.mp4",
      description: "Rowboat Club: generation two",
    });
    expect(meta?.imageUrl).toBe("https://cdn.example.com/a.mp4");
    expect(meta?.collectionName).toBe("Rowboat Club");
  });

  it("drops unsafe image URLs", () => {
    expect(parseMetadata({ image: "javascript:alert(1)" })?.imageUrl).toBeNull();
    expect(parseMetadata({ image: "data:image/png;base64,AAAA" })?.imageUrl).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(parseMetadata(null)).toBeNull();
    expect(parseMetadata([1, 2])).toBeNull();
    expect(parseMetadata("hi")).toBeNull();
  });
});
