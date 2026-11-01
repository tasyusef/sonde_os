import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XrplRouter, isClioOnly } from "./xrpl-router";

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  closed = false;

  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.());
  }
  open() {
    this.onopen?.();
  }
  reply(id: unknown, result: unknown = {}) {
    this.onmessage?.({ data: JSON.stringify({ id, status: "success", result }) });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

const byUrl = (url: string) => FakeSocket.all.filter((s) => s.url === url);

function create() {
  return new XrplRouter({
    urls: ["wss://main"],
    clioUrls: ["wss://clio"],
    clioIdleMs: 1_000,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
  });
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isClioOnly", () => {
  it("flags NFT lookups only", () => {
    expect(isClioOnly({ command: "nft_info" })).toBe(true);
    expect(isClioOnly({ command: "nft_history" })).toBe(true);
    expect(isClioOnly({ command: "account_info" })).toBe(false);
    expect(isClioOnly({})).toBe(false);
  });
});

describe("XrplRouter", () => {
  it("does not open the Clio socket until a Clio-only command", async () => {
    const router = create();
    router.start();
    const main = byUrl("wss://main")[0];
    main.open();

    const p = router.request({ command: "account_info" });
    await Promise.resolve();
    main.reply(main.last().id, { ok: 1 });
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(byUrl("wss://clio")).toHaveLength(0);
    router.stop();
  });

  it("sends Clio-only commands to the Clio socket, waiting for it to open", async () => {
    const router = create();
    router.start();
    byUrl("wss://main")[0].open();

    const p = router.request({ command: "nft_info", nft_id: "AB" });
    const clio = byUrl("wss://clio")[0];
    expect(clio).toBeDefined();
    clio.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(clio.last()).toMatchObject({ command: "nft_info", nft_id: "AB" });
    clio.reply(clio.last().id, { nft_id: "AB" });
    await expect(p).resolves.toEqual({ nft_id: "AB" });
    expect(byUrl("wss://main")[0].sent).toHaveLength(0);
    router.stop();
  });

  it("sends full-history requests to the Clio socket", async () => {
    const router = create();
    router.start();
    byUrl("wss://main")[0].open();

    const p = router.request({ command: "tx", transaction: "AB" }, { fullHistory: true });
    const clio = byUrl("wss://clio")[0];
    clio.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(clio.last()).toMatchObject({ command: "tx", transaction: "AB" });
    expect(clio.last()).not.toHaveProperty("fullHistory");
    clio.reply(clio.last().id, { hash: "AB" });
    await expect(p).resolves.toEqual({ hash: "AB" });
    expect(byUrl("wss://main")[0].sent).toHaveLength(0);
    router.stop();
  });

  it("honours a per-call timeout", async () => {
    const router = create();
    router.start();
    byUrl("wss://main")[0].open();

    const p = router.request({ command: "ledger" }, { timeoutMs: 25_000 });
    const settled = vi.fn();
    p.catch(settled);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(17_000);
    expect(settled).toHaveBeenCalledWith(new Error("Request timed out"));
    router.stop();
  });

  it("closes the Clio socket once idle and reopens on demand", async () => {
    const router = create();
    router.start();
    byUrl("wss://main")[0].open();

    const p = router.request({ command: "nft_history" });
    const clio = byUrl("wss://clio")[0];
    clio.open();
    await Promise.resolve();
    await Promise.resolve();
    clio.reply(clio.last().id);
    await p;

    await vi.advanceTimersByTimeAsync(999);
    expect(clio.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(clio.closed).toBe(true);

    void router.request({ command: "nft_info" }).catch(() => {});
    expect(byUrl("wss://clio")).toHaveLength(2);
    router.stop();
  });

  it("rejects after stop", async () => {
    const router = create();
    await expect(router.request({ command: "ping" })).rejects.toThrow("stopped");
  });
});
