import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XrplSocket, rateLimitCooldownMs, type XrplSocketOptions } from "./xrpl-socket";

const URLS = ["wss://primary", "wss://fallback-1", "wss://fallback-2"];

/** Minimal stand-in for the browser/Node WebSocket. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  closed = false;
  /** Answer keepalive pings automatically, like a healthy node. */
  autoPong = true;

  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(raw: string) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    if (msg.command === "ping" && this.autoPong) queueMicrotask(() => this.reply(msg.id));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.());
  }
  // Test controls
  open() {
    this.onopen?.();
  }
  serverClose() {
    this.closed = true;
    this.onclose?.();
  }
  reply(id: unknown, result: unknown = {}) {
    this.onmessage?.({ data: JSON.stringify({ id, status: "success", result }) });
  }
  push(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  lastRequest() {
    return this.sent[this.sent.length - 1];
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];

/** Answer request `id` the way xrplcluster does when the IP quota is spent. */
function rateLimit(sock: FakeSocket, id: unknown, retryMs: number) {
  sock.push({
    id,
    status: "error",
    error: "slowDown",
    error_message: `rate limit: units quota (10000 per 60s) exhausted, retry in ~${retryMs}ms`,
  });
}
const urlsOpened = () => FakeSocket.all.map((s) => s.url);

function create(opts: XrplSocketOptions = {}) {
  return new XrplSocket({
    urls: URLS,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    ...opts,
  });
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0); // no jitter
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("XrplSocket", () => {
  it("connects to the primary and resolves requests by id", async () => {
    const sock = create();
    sock.start();
    latest().open();
    expect(sock.connected).toBe(true);

    const res = sock.request({ command: "server_info" });
    const { id } = latest().lastRequest();
    latest().reply(id, { info: "ok" });
    await expect(res).resolves.toEqual({ info: "ok" });
  });

  it("rejects with the node's error payload", async () => {
    const sock = create();
    sock.start();
    latest().open();
    const res = sock.request({ command: "tx" });
    latest().onmessage?.({
      data: JSON.stringify({ id: latest().lastRequest().id, status: "error", error: "txnNotFound" }),
    });
    await expect(res).rejects.toMatchObject({ error: "txnNotFound" });
  });

  it("benches a rate-limited node, switches, and re-sends the request there", async () => {
    const sock = create();
    sock.start();
    const primary = latest();
    primary.open();
    const res = sock.request({ command: "account_info", account: "rA" });
    rateLimit(primary, primary.lastRequest().id, 45_000);

    const fallback = latest();
    expect(fallback.url).toBe("wss://fallback-1");
    fallback.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback.lastRequest()).toMatchObject({ command: "account_info", account: "rA" });
    fallback.reply(fallback.lastRequest().id, { ok: true });
    await expect(res).resolves.toEqual({ ok: true });
    expect(primary.closed).toBe(true); // drained
  });

  it("passes the rate limit to the caller when every node is benched", async () => {
    const sock = create({ urls: ["wss://only"] });
    sock.start();
    latest().open();
    const res = sock.request({ command: "tx" });
    rateLimit(latest(), latest().lastRequest().id, 30_000);
    await expect(res).rejects.toMatchObject({ error: "slowDown" });
    expect(FakeSocket.all.length).toBe(1);
  });

  it("re-sends a request only once", async () => {
    const sock = create({ urls: ["wss://a", "wss://b", "wss://c"] });
    sock.start();
    latest().open();
    const res = sock.request({ command: "tx" });
    rateLimit(latest(), latest().lastRequest().id, 30_000);
    latest().open(); // on b
    await vi.advanceTimersByTimeAsync(0);
    rateLimit(latest(), latest().lastRequest().id, 30_000);
    await expect(res).rejects.toMatchObject({ error: "slowDown" });
    expect(latest().url).toBe("wss://c"); // b is benched too, but the next caller gets c
  });

  it("doesn't probe the primary until its bench ends", async () => {
    const sock = create({ probeIntervalMs: 60_000 });
    sock.start();
    const primary = latest();
    primary.open();
    void sock.request({ command: "tx" }).catch(() => {});
    rateLimit(primary, primary.lastRequest().id, 110_000);
    latest().open(); // fallback-1

    const before = FakeSocket.all.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all.length).toBe(before); // still benched at 60s
    await vi.advanceTimersByTimeAsync(50_000);
    expect(latest().url).toBe("wss://primary"); // probe once the bench is over
  });

  it("treats a rate-limited keepalive ping as a live socket", async () => {
    const sock = create({ urls: ["wss://only"], keepaliveMs: 20_000 });
    sock.start();
    const only = latest();
    only.autoPong = false;
    only.open();
    await vi.advanceTimersByTimeAsync(20_000);
    rateLimit(only, only.lastRequest().id, 30_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(only.closed).toBe(false);
    expect(FakeSocket.all.length).toBe(1);
  });

  it("reconnects to the same node when a stable connection drops", async () => {
    const sock = create();
    sock.start();
    latest().open();
    await vi.advanceTimersByTimeAsync(60_000);
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(urlsOpened()).toEqual(["wss://primary", "wss://primary"]);
  });

  it("rotates to the next node when a connection never opens", async () => {
    const sock = create({ connectTimeoutMs: 5_000 });
    sock.start();
    await vi.advanceTimersByTimeAsync(5_000); // connect timeout
    await vi.advanceTimersByTimeAsync(1_000); // first backoff
    expect(latest().url).toBe("wss://fallback-1");
    await vi.advanceTimersByTimeAsync(5_000 + 2_000); // timeout + doubled backoff
    expect(latest().url).toBe("wss://fallback-2");
  });

  it("treats a connection that dies right after opening as a node failure", async () => {
    const sock = create();
    sock.start();
    latest().open();
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(latest().url).toBe("wss://fallback-1");
  });

  it("sends keepalive pings and reconnects when one times out", async () => {
    const sock = create({ keepaliveMs: 20_000, requestTimeoutMs: 5_000 });
    sock.start();
    const first = latest();
    first.autoPong = false;
    first.open();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(first.lastRequest()).toMatchObject({ command: "ping" });
    first.reply(first.lastRequest().id);

    await vi.advanceTimersByTimeAsync(20_000); // second ping, never answered
    await vi.advanceTimersByTimeAsync(5_000); // ping times out → drop
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000); // stable → same node
    expect(latest()).not.toBe(first);
    expect(latest().url).toBe("wss://primary");
  });

  it("switches back to the primary and lets in-flight requests finish", async () => {
    const sock = create({ probeIntervalMs: 60_000 });
    sock.start();
    latest().open();
    latest().serverClose(); // quick death → fallback
    await vi.advanceTimersByTimeAsync(1_000);
    const fallback = latest();
    fallback.open();

    const inFlight = sock.request({ command: "ledger" }, { timeoutMs: 120_000 });
    const { id } = fallback.lastRequest();

    await vi.advanceTimersByTimeAsync(60_000);
    const probe = latest();
    expect(probe.url).toBe("wss://primary");
    probe.open(); // probe succeeds → switch

    const primary = latest();
    expect(primary).not.toBe(probe);
    expect(primary.url).toBe("wss://primary");
    expect(fallback.closed).toBe(false); // draining

    fallback.reply(id, { ledger: 1 });
    await expect(inFlight).resolves.toEqual({ ledger: 1 });
    expect(fallback.closed).toBe(true);
  });

  it("probes less often when the primary fails right after a switch back", async () => {
    const sock = create({ probeIntervalMs: 60_000 });
    sock.start();
    latest().open();
    latest().serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    latest().open(); // on fallback-1

    await vi.advanceTimersByTimeAsync(60_000);
    latest().open(); // probe ok
    latest().open(); // primary opens…
    latest().serverClose(); // …and dies immediately
    await vi.advanceTimersByTimeAsync(1_000);
    latest().open(); // back on a fallback

    const before = FakeSocket.all.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all.length).toBe(before); // no probe at 60s
    await vi.advanceTimersByTimeAsync(60_000);
    expect(latest().url).toBe("wss://primary"); // probe at 120s
  });

  it("ignores events from a socket it has replaced", async () => {
    const onStream = vi.fn();
    const sock = create({ onStream, keepaliveMs: 20_000, requestTimeoutMs: 5_000 });
    sock.start();
    const stale = latest();
    stale.autoPong = false;
    stale.open();
    await vi.advanceTimersByTimeAsync(25_000); // ping timeout → dropped
    await vi.advanceTimersByTimeAsync(1_000);
    latest().open();
    const reconnects = FakeSocket.all.length;

    stale.push({ type: "ledgerClosed" });
    stale.onclose?.();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onStream).not.toHaveBeenCalled();
    expect(FakeSocket.all.length).toBe(reconnects);
  });

  it("forwards stream messages from the active socket", () => {
    const onStream = vi.fn();
    const sock = create({ onStream });
    sock.start();
    latest().open();
    latest().push({ type: "ledgerClosed", ledger_index: 5 });
    expect(onStream).toHaveBeenCalledWith({ type: "ledgerClosed", ledger_index: 5 });
  });

  it("waits for a connection when asked, and fails fast otherwise", async () => {
    const sock = create();
    sock.start();
    await expect(sock.request({ command: "ping" })).rejects.toThrow("not connected");

    const waiting = sock.request({ command: "server_info" }, { waitForOpen: true });
    latest().open();
    await vi.advanceTimersByTimeAsync(0);
    latest().reply(latest().lastRequest().id, "info");
    await expect(waiting).resolves.toBe("info");
  });

  it("never sends a request whose signal already fired", async () => {
    const sock = create();
    sock.start();
    latest().open();
    const ac = new AbortController();
    ac.abort();
    await expect(sock.request({ command: "tx" }, { signal: ac.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(latest().sent.filter((m) => m.command === "tx")).toHaveLength(0);
  });

  it("stops waiting for a connection on abort and never sends", async () => {
    const sock = create();
    sock.start();
    const ac = new AbortController();
    const waiting = sock.request({ command: "tx" }, { waitForOpen: true, signal: ac.signal });
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    latest().open();
    await vi.advanceTimersByTimeAsync(0);
    expect(latest().sent.filter((m) => m.command === "tx")).toHaveLength(0);
  });

  it("rejects an in-flight request on abort and ignores the late reply", async () => {
    const sock = create();
    sock.start();
    latest().open();
    const ac = new AbortController();
    const res = sock.request({ command: "account_objects" }, { signal: ac.signal });
    const { id } = latest().lastRequest();
    ac.abort();
    await expect(res).rejects.toMatchObject({ name: "AbortError" });
    expect(() => latest().reply(id, { late: true })).not.toThrow();
  });

  it("doesn't re-send a rate-limited request after its signal fired", async () => {
    const sock = create();
    sock.start();
    const primary = latest();
    primary.open();
    const ac = new AbortController();
    const res = sock.request({ command: "account_info" }, { signal: ac.signal });
    rateLimit(primary, primary.lastRequest().id, 45_000);
    ac.abort();
    const fallback = latest();
    fallback.open();
    await expect(res).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback.sent.filter((m) => m.command === "account_info")).toHaveLength(0);
  });

  it("reconnects at once from the primary when asked during a backoff", async () => {
    const sock = create({ connectTimeoutMs: 5_000 });
    sock.start();
    await vi.advanceTimersByTimeAsync(5_000 + 1_000); // primary timed out, backoff
    await vi.advanceTimersByTimeAsync(5_000); // fallback-1 timed out, waiting 2 s
    const count = FakeSocket.all.length;
    sock.reconnectNow();
    expect(FakeSocket.all.length).toBe(count + 1);
    expect(latest().url).toBe("wss://primary");
    latest().open();
    const reply = sock.request({ command: "ledger" });
    latest().reply(latest().lastRequest().id, { ok: true });
    await expect(reply).resolves.toEqual({ ok: true });
  });

  it("ignores a reconnect request while open or mid-connect", async () => {
    const sock = create();
    sock.start();
    sock.reconnectNow(); // connecting
    expect(FakeSocket.all.length).toBe(1);
    latest().open();
    sock.reconnectNow(); // open
    expect(FakeSocket.all.length).toBe(1);
  });

  it("stops cleanly: rejects pending work and never reconnects", async () => {
    const onStatus = vi.fn();
    const sock = create({ onStatus });
    sock.start();
    latest().open();
    const pending = sock.request({ command: "ledger" });
    const count = FakeSocket.all.length;

    sock.stop();
    await expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSocket.all.length).toBe(count);
    expect(onStatus).toHaveBeenLastCalledWith({ connected: false, url: "wss://primary" });
  });
});

describe("rateLimitCooldownMs", () => {
  it("uses the node's retry hint", () => {
    expect(rateLimitCooldownMs({ error: "slowDown", error_message: "retry in ~45189ms" })).toBe(45_189);
  });
  it("defaults to a minute without a hint, and clamps", () => {
    expect(rateLimitCooldownMs({ error: "tooBusy" })).toBe(60_000);
    expect(rateLimitCooldownMs({ error_message: "retry in ~5ms" })).toBe(1_000);
    expect(rateLimitCooldownMs({ error_message: "retry in ~999999ms" })).toBe(120_000);
  });
});
