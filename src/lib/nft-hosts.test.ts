import { describe, expect, it } from "vitest";
import { isAllowedUrl, isAutoLoadHost, parseIPv6 } from "./nft-hosts";

describe("parseIPv6", () => {
  it("expands :: and dotted IPv4 tails", () => {
    expect(parseIPv6("[::1]")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("2001:db8::8:800:200c:417a")).toEqual([0x2001, 0xdb8, 0, 0, 0x8, 0x800, 0x200c, 0x417a]);
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["1::2::3", "1:2:3:4:5:6:7:8:9", "12345::", "g::1", "1:2:3:4:5:6:7"]) {
      expect(parseIPv6(bad)).toBeNull();
    }
  });
});

describe("isAllowedUrl", () => {
  it("allows public https hosts", () => {
    for (const ok of [
      "https://example.com/meta.json",
      "https://static.expo2025-dwnft.com/a.json",
      "https://8.8.8.8/x",
      "https://[2606:4700::1111]/x",
      "https://[64:ff9b::808:808]/x",
    ]) {
      expect(isAllowedUrl(ok), ok).toBe(true);
    }
  });

  it("blocks the reported bypasses", () => {
    expect(isAllowedUrl("https://[::ffff:7f00:1]/")).toBe(false); // IPv4-mapped loopback
    expect(isAllowedUrl("https://[febf::1]/")).toBe(false); // top of fe80::/10
    expect(isAllowedUrl("https://localhost./")).toBe(false); // trailing dot
  });

  it("blocks private, loopback and special IPv4, however it's written", () => {
    for (const bad of [
      "https://127.0.0.1/",
      "https://0x7f.1/",
      "https://2130706433/",
      "https://10.1.2.3/",
      "https://100.64.0.1/",
      "https://169.254.169.254/latest/meta-data",
      "https://172.20.0.1/",
      "https://192.168.1.1/",
      "https://0.0.0.0/",
      "https://224.0.0.1/",
    ]) {
      expect(isAllowedUrl(bad), bad).toBe(false);
    }
  });

  it("blocks private and special IPv6", () => {
    for (const bad of [
      "https://[::]/",
      "https://[::1]/",
      "https://[::7f00:1]/", // IPv4-compatible
      "https://[::ffff:10.0.0.1]/",
      "https://[64:ff9b::7f00:1]/", // NAT64 of loopback
      "https://[64:ff9b:1::1]/", // local-use NAT64
      "https://[2002:c0a8:101::1]/", // 6to4 of 192.168.1.1
      "https://[fc00::1]/",
      "https://[fdff::1]/",
      "https://[fe80::1]/",
      "https://[fec0::1]/",
      "https://[ff02::1]/",
    ]) {
      expect(isAllowedUrl(bad), bad).toBe(false);
    }
  });

  it("blocks internal names, odd ports, credentials and other schemes", () => {
    for (const bad of [
      "https://localhost/",
      "https://LOCALHOST../",
      "https://metadata.google.internal/",
      "https://printer.local/",
      "https://app.localhost/",
      "https://example.com:8443/",
      "https://user:pw@example.com/",
      "http://example.com/",
      "javascript:alert(1)",
      "data:text/html,hi",
      "not a url",
    ]) {
      expect(isAllowedUrl(bad), bad).toBe(false);
    }
  });
});

describe("isAutoLoadHost", () => {
  it("allows our IPFS and Arweave gateways", () => {
    for (const host of ["gateway.pinata.cloud", "dweb.link", "ipfs.io", "arweave.net", "permagate.io"]) {
      expect(isAutoLoadHost(host)).toBe(true);
    }
  });

  it("allows the trusted XRPL hosts, ignoring case and a trailing dot", () => {
    expect(isAutoLoadHost("static.expo2025-dwnft.com")).toBe(true);
    expect(isAutoLoadHost("Mainnet.XRPDomains.xyz.")).toBe(true);
  });

  it("asks for anything else, including look-alike subdomains", () => {
    expect(isAutoLoadHost("example.com")).toBe(false);
    expect(isAutoLoadHost("evil.ipfs.io.example.com")).toBe(false);
    expect(isAutoLoadHost("cdn.static.expo2025-dwnft.com")).toBe(false);
    expect(isAutoLoadHost("ipfs.io.evil.com")).toBe(false);
  });
});
