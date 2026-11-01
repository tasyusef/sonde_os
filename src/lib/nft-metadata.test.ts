import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAccountID } from "ripple-address-codec";
import { asciiToHex } from "./hex";

const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const ISSUER = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const ID =
  "0008" +
  "0000" +
  Array.from(decodeAccountID(ISSUER), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase() +
  "00000000" +
  "00000000";

type Route = (url: string) => Response | Promise<Response> | "network-error";
let route: Route;
const calls: string[] = [];

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function load() {
  vi.resetModules();
  return import("./nft-metadata");
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const r = await route(url);
      if (r === "network-error") throw new TypeError("Failed to fetch");
      return r;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An NFTokenID for `ISSUER` with serial `n`. */
const idFor = (n: number) => ID.slice(0, -8) + n.toString(16).padStart(8, "0").toUpperCase();
const uriFor = (n: number) => asciiToHex(`ipfs://${CID}/${n}.json`);
const settle = () => new Promise((r) => setTimeout(r, 80));

describe("fetchNftMetadata", () => {
  it("falls back to the next IPFS gateway", async () => {
    route = (url) =>
      url.includes("pinata") ? new Response("", { status: 504 }) : json({ name: "Ape #1", image: `ipfs://${CID}/1.png` });
    const { fetchNftMetadata } = await load();
    const meta = await fetchNftMetadata(asciiToHex(`ipfs://${CID}/1.json`));
    expect(meta?.name).toBe("Ape #1");
    expect(meta?.imageUrl).toContain(`/ipfs/${CID}/1.png`);
    expect(calls).toHaveLength(2);
  });

  it("treats an image response as the image itself", async () => {
    route = () => new Response("png", { headers: { "content-type": "image/png" } });
    const { fetchNftMetadata } = await load();
    const meta = await fetchNftMetadata(asciiToHex("https://cdn.example.com/1"));
    expect(meta).toMatchObject({ name: null, imageUrl: "https://cdn.example.com/1" });
  });

  it("keeps an image URI usable when fetch is blocked (CORS)", async () => {
    route = () => "network-error";
    const { fetchNftMetadata } = await load();
    expect(await fetchNftMetadata(asciiToHex("https://cdn.example.com/a.png"))).toMatchObject({
      imageUrl: "https://cdn.example.com/a.png",
    });
    expect(await fetchNftMetadata(asciiToHex("https://cdn.example.com/a.json"))).toBeNull();
  });

  it("never fetches unsafe URIs", async () => {
    route = () => json({});
    const { fetchNftMetadata } = await load();
    expect(await fetchNftMetadata(asciiToHex("http://example.com/1.json"))).toBeNull();
    expect(await fetchNftMetadata(asciiToHex("javascript:alert(1)"))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rejects bodies over 512 KB and invalid JSON", async () => {
    route = (url) =>
      url.includes("big")
        ? new Response("x".repeat(600 * 1024), { headers: { "content-type": "application/json" } })
        : new Response("{nope", { headers: { "content-type": "application/json" } });
    const { fetchNftMetadata } = await load();
    expect(await fetchNftMetadata(asciiToHex("https://cdn.example.com/big.json"))).toBeNull();
    expect(await fetchNftMetadata(asciiToHex("https://cdn.example.com/bad.json"))).toBeNull();
  });

  it("caches per URI", async () => {
    route = () => json({ name: "A" });
    const { fetchNftMetadata } = await load();
    const hex = asciiToHex("https://cdn.example.com/1.json");
    await fetchNftMetadata(hex);
    await fetchNftMetadata(hex);
    expect(calls).toHaveLength(1);
  });

  it("runs at most four fetches at once", async () => {
    let open = 0;
    let peak = 0;
    route = async () => {
      open++;
      peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return json({ name: "x" });
    };
    const { fetchNftMetadata } = await load();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => fetchNftMetadata(asciiToHex(`https://cdn.example.com/${i}.json`))),
    );
    expect(peak).toBe(4);
  });

  it("retries an unreachable URI after the failure TTL, not before", async () => {
    route = () => "network-error";
    const { fetchNftMetadata, FAILURE_TTL_MS } = await load();
    const hex = asciiToHex("https://cdn.example.com/1.json");
    expect(await fetchNftMetadata(hex)).toBeNull();
    expect(await fetchNftMetadata(hex)).toBeNull();
    expect(calls).toHaveLength(1);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + FAILURE_TTL_MS);
    route = () => json({ name: "Back" });
    expect((await fetchNftMetadata(hex))?.name).toBe("Back");
    expect(calls).toHaveLength(2);
  });

  it("keeps a final failure (bad JSON) for the session", async () => {
    route = () => new Response("{nope", { headers: { "content-type": "application/json" } });
    const { fetchNftMetadata, FAILURE_TTL_MS } = await load();
    const hex = asciiToHex("https://cdn.example.com/bad.json");
    await fetchNftMetadata(hex);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + FAILURE_TTL_MS * 10);
    await fetchNftMetadata(hex);
    expect(calls).toHaveLength(1);
  });
});

describe("requestNfts", () => {
  it("looks up a missing URI with nft_info, then publishes the row", async () => {
    route = () => json({ name: "Rowboat #7", collection: "Rowboat" });
    const { requestNfts, getNftRow, subscribeNfts } = await load();
    const send = vi.fn(async () => ({ uri: uriFor(7) }));
    const published = new Promise<void>((resolve) => subscribeNfts(resolve));

    requestNfts([{ nftokenId: ID }], send);
    requestNfts([{ nftokenId: ID }], send); // deduped while in flight
    await published;

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ command: "nft_info", nft_id: ID });
    expect(getNftRow(ID)).toMatchObject({
      issuer: ISSUER,
      name: "Rowboat #7",
      collectionName: "Rowboat",
    });
  });

  it("skips nft_info when the URI is known to be empty", async () => {
    const { requestNfts, getNftRow, subscribeNfts } = await load();
    const send = vi.fn();
    const published = new Promise<void>((resolve) => subscribeNfts(resolve));
    requestNfts([{ nftokenId: ID, uri: "" }], send);
    await published;
    expect(send).not.toHaveBeenCalled();
    expect(getNftRow(ID)).toMatchObject({ name: null, imageUrl: null });
  });

  it("drops queued work once nobody wants it", async () => {
    const gates: (() => void)[] = [];
    route = () => new Promise((resolve) => gates.push(() => resolve(json({ name: "x" }))));
    const { requestNfts } = await load();
    const items = Array.from({ length: 20 }, (_, i) => ({ nftokenId: idFor(i), uri: uriFor(i) }));
    const release = requestNfts(items, vi.fn());
    await vi.waitFor(() => expect(calls).toHaveLength(4));

    release();
    for (const open of gates.splice(0)) open();
    await settle();
    expect(calls).toHaveLength(4); // the 16 still queued never ran
  });

  it("keeps queued work another caller still wants", async () => {
    const gates: (() => void)[] = [];
    route = () => new Promise((resolve) => gates.push(() => resolve(json({ name: "x" }))));
    const { requestNfts } = await load();
    const items = Array.from({ length: 6 }, (_, i) => ({ nftokenId: idFor(i), uri: uriFor(i) }));
    const releaseA = requestNfts(items, vi.fn());
    requestNfts(items.slice(4), vi.fn()); // B wants the last two
    releaseA();
    for (;;) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0));
      for (const open of gates.splice(0)) open();
      await settle();
      if (gates.length === 0) break;
    }
    expect(calls).toHaveLength(6); // 4 already running + the 2 B wants
  });

  it("announces a burst of settled rows once", async () => {
    route = () => json({ name: "x" });
    const { requestNfts, subscribeNfts } = await load();
    const listener = vi.fn();
    subscribeNfts(listener);
    requestNfts(
      Array.from({ length: 3 }, (_, i) => ({ nftokenId: idFor(i), uri: uriFor(i) })),
      vi.fn(),
    );
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("refetches a row whose lookup failed, once the TTL passes", async () => {
    route = () => json({ name: "Found" });
    const { requestNfts, getNftRow, FAILURE_TTL_MS } = await load();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue({ uri: uriFor(1) });

    requestNfts([{ nftokenId: ID }], send);
    await settle();
    expect(getNftRow(ID)).toMatchObject({ name: null });

    requestNfts([{ nftokenId: ID }], send); // within the TTL: no refetch
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + FAILURE_TTL_MS);
    requestNfts([{ nftokenId: ID }], send);
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    expect(getNftRow(ID)).toMatchObject({ name: "Found" });
  });

  it("treats a not-found nft_info as final", async () => {
    const { requestNfts, FAILURE_TTL_MS } = await load();
    const send = vi.fn().mockRejectedValue({ error: "objectNotFound" });
    requestNfts([{ nftokenId: ID }], send);
    await settle();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + FAILURE_TTL_MS);
    requestNfts([{ nftokenId: ID }], send);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest unwanted rows, never wanted ones", async () => {
    const { requestNfts, getNftRow } = await load();
    const send = vi.fn();
    requestNfts([{ nftokenId: idFor(0), uri: "" }], send); // still on screen
    const releases = [];
    for (let i = 1; i < 5_000; i++) releases.push(requestNfts([{ nftokenId: idFor(i), uri: "" }], send));
    await settle();
    for (const release of releases.slice(0, -1)) release(); // all but the newest leave
    requestNfts([{ nftokenId: idFor(5_000), uri: "" }], send); // row 5,001
    await settle();
    expect(getNftRow(idFor(0))).toBeDefined();
    expect(getNftRow(idFor(1))).toBeUndefined();
    expect(getNftRow(idFor(2))).toBeDefined();
    expect(getNftRow(idFor(5_000))).toBeDefined();
  });

  it("holds metadata on an unknown host until the visitor approves it", async () => {
    route = () => json({ name: "Hosted" });
    const { requestNfts, getNftRow } = await load();
    const { approveMedia } = await import("./media-approvals");
    const item = { nftokenId: ID, uri: asciiToHex("https://cdn.example.com/1.json") };

    requestNfts([item], vi.fn());
    await settle();
    expect(getNftRow(ID)).toMatchObject({ askHost: "cdn.example.com", name: null });
    expect(calls).toHaveLength(0);

    approveMedia(ID, "cdn.example.com");
    expect(getNftRow(ID)).toBeUndefined(); // loading again, not "held"
    requestNfts([item], vi.fn());
    await settle();
    expect(getNftRow(ID)).toMatchObject({ askHost: null, name: "Hosted" });
    expect(calls).toEqual(["https://cdn.example.com/1.json"]);
  });
});
