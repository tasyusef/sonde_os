import { describe, expect, it } from "vitest";
import { matchTokens, onlyMatch, parseTokenList, type TokenListEntry } from "./token-list";

const GATEHUB = "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq";
const BITSTAMP = "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B";
const SOLOGENIC = "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz";
const COPY = "rrrrrrrrrrrrrrrrrrrrBZbvji";
const MPT = "0627B6859931344A3871ED63805BBF07DECBF03F9C2698BD";

const ENTRIES: TokenListEntry[] = [
  { c: "SOLO", i: SOLOGENIC, h: 214_708, t: 3, in: "Sologenic", d: "sologenic.com" },
  { c: "USD", n: "US Dollar", i: GATEHUB, h: 20_474, t: 3, in: "GateHub" },
  { c: "USD", i: COPY, h: 90_000 },
  { c: "USD", n: "US Dollar", i: BITSTAMP, h: 9_000, t: 3 },
  { c: "SOLOX", i: COPY, h: 500 },
  { c: "SVXV1", m: MPT, n: "SIVAX-VAULT-V1", i: COPY, h: 45, in: "SIVAX.io" },
  // Dropped: no issuer checksum, not a ledger code.
  { c: "BAD", i: "rNotAnAddress", h: 1 },
  { c: "XRP", i: GATEHUB, h: 1 },
];
const { tokens } = parseTokenList({ made: "2026-10-30", tokens: ENTRIES });
const tickers = (q: string) => matchTokens(tokens, q).map((t) => `${t.ticker}.${t.issuer.slice(0, 5)}`);

describe("parseTokenList", () => {
  it("drops entries that name no token and fills names it knows", () => {
    expect(tokens).toHaveLength(6);
    expect(tokens.find((t) => t.issuer === BITSTAMP)?.issuerName).toBe("Bitstamp");
    expect(tokens.find((t) => t.ref.kind === "mpt")?.ticker).toBe("SVXV1");
  });

  it("survives a malformed file", () => {
    expect(parseTokenList(null).tokens).toEqual([]);
    expect(parseTokenList({ tokens: "nope" }).tokens).toEqual([]);
  });
});

describe("matchTokens", () => {
  it("puts trusted issuers ahead of a busier copy of the ticker", () => {
    expect(tickers("usd")).toEqual([`USD.${GATEHUB.slice(0, 5)}`, `USD.${BITSTAMP.slice(0, 5)}`, `USD.${COPY.slice(0, 5)}`]);
  });

  it("ranks the exact ticker over a longer one", () => {
    expect(tickers("SOLO")).toEqual([`SOLO.${SOLOGENIC.slice(0, 5)}`, `SOLOX.${COPY.slice(0, 5)}`]);
  });

  it("finds a token by name, issuer name or domain", () => {
    expect(tickers("us dollar")).toHaveLength(2);
    expect(tickers("gatehub")).toEqual([`USD.${GATEHUB.slice(0, 5)}`]);
    expect(tickers("sologenic.com")).toEqual([`SOLO.${SOLOGENIC.slice(0, 5)}`]);
    expect(tickers("vault")).toEqual([`SVXV1.${COPY.slice(0, 5)}`]);
  });

  it("matches inside words only from two characters", () => {
    expect(tickers("x")).toEqual([]);
    expect(tickers("ox")).toEqual([`SOLOX.${COPY.slice(0, 5)}`]);
  });

  it("lists what an address issued", () => {
    expect(tickers(COPY)).toHaveLength(3);
  });

  it("finds a token by its ID or a pasted hex code", () => {
    expect(tickers(`USD.${BITSTAMP}`)).toEqual([`USD.${BITSTAMP.slice(0, 5)}`]);
    expect(tickers(MPT.toLowerCase())).toEqual([`SVXV1.${COPY.slice(0, 5)}`]);
    expect(tickers("534F4C4F00000000000000000000000000000000")[0]).toBe(`SOLO.${SOLOGENIC.slice(0, 5)}`);
  });

  it("stops at the limit", () => {
    expect(matchTokens(tokens, "usd", 1)).toHaveLength(1);
  });
});

describe("onlyMatch", () => {
  it("is the one token with that exact ticker", () => {
    expect(onlyMatch(tokens, "solo")?.issuer).toBe(SOLOGENIC);
    expect(onlyMatch(tokens, "USD")).toBeNull();
    expect(onlyMatch(tokens, "SOL")).toBeNull();
  });
});
