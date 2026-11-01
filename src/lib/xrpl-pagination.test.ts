import { describe, expect, it, vi } from "vitest";
import { collectPages, settledPool, walkOrNone, walkOutcome, type SendFn } from "./xrpl-pagination";

const pick = (page: Record<string, unknown>) => page.rows as number[] | undefined;

/** A fake node serving `pages`, one per call, chained by marker. */
function server(pages: number[][], failAt?: number) {
  return vi.fn<SendFn>(async (cmd) => {
    const i = cmd.marker === undefined ? 0 : (cmd.marker as number);
    if (i === failAt) throw { error: "timeout" };
    return { rows: pages[i], ...(i + 1 < pages.length ? { marker: i + 1 } : {}) };
  });
}

describe("collectPages", () => {
  it("follows markers to the end", async () => {
    const send = server([[1, 2], [3], [4]]);
    const res = await collectPages(send, { command: "x" }, pick, { maxPages: 10 });
    expect(res).toEqual({ items: [1, 2, 3, 4], marker: undefined });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1][0]).toEqual({ command: "x", marker: 1 });
  });

  it("stops at maxPages and returns the next marker", async () => {
    const send = server([[1], [2], [3]]);
    const res = await collectPages(send, { command: "x" }, pick, { maxPages: 2 });
    expect(res).toEqual({ items: [1, 2], marker: 2 });
  });

  it("resumes from a marker", async () => {
    const send = server([[1], [2], [3]]);
    const res = await collectPages(send, { command: "x" }, pick, { maxPages: 5, marker: 1 });
    expect(res.items).toEqual([2, 3]);
  });

  it("keeps earlier pages when one fails", async () => {
    const send = server([[1], [2], [3]], 1);
    const res = await collectPages(send, { command: "x" }, pick, { maxPages: 5 });
    expect(res).toEqual({ items: [1], marker: 1, error: { error: "timeout" } });
  });

  it("reports each page and passes the timeout", async () => {
    const send = server([[1], [2]]);
    const seen: number[][] = [];
    await collectPages(send, { command: "x" }, pick, {
      maxPages: 5,
      timeoutMs: 25_000,
      onPage: (items) => seen.push(items),
    });
    expect(seen).toEqual([[1], [1, 2]]);
    expect(send.mock.calls[0][1]).toEqual({ timeoutMs: 25_000 });
  });
});

describe("collectPages: abort", () => {
  it("sends no page after the signal fires", async () => {
    const ac = new AbortController();
    const send = server([[1], [2], [3]]);
    const res = await collectPages(send, { command: "x" }, pick, {
      maxPages: 10,
      signal: ac.signal,
      onPage: () => ac.abort(),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ items: [1], marker: 1, aborted: true });
    expect(res.error).toBeUndefined();
  });

  it("passes the signal to every request", async () => {
    const ac = new AbortController();
    const send = server([[1], [2]]);
    await collectPages(send, { command: "x" }, pick, { maxPages: 5, signal: ac.signal });
    expect(send.mock.calls.every(([, opts]) => opts?.signal === ac.signal)).toBe(true);
  });

  it("reports an aborted request as aborted, not as an error", async () => {
    const ac = new AbortController();
    const send = vi.fn<SendFn>(async () => {
      ac.abort();
      throw ac.signal.reason;
    });
    const res = await collectPages(send, { command: "x" }, pick, { maxPages: 5, signal: ac.signal });
    expect(res).toEqual({ items: [], marker: undefined, aborted: true });
  });

  it("does nothing when aborted before the first page", async () => {
    const ac = new AbortController();
    ac.abort();
    const send = server([[1]]);
    const res = await collectPages(send, { command: "x" }, pick, { maxPages: 5, signal: ac.signal });
    expect(send).not.toHaveBeenCalled();
    expect(res.aborted).toBe(true);
  });
});

describe("collectPages: ledger pinning", () => {
  /** Pages that report the ledger they were read from. */
  const ledgerServer = (pages: number[][]) =>
    vi.fn<SendFn>(async (cmd) => {
      const i = cmd.marker === undefined ? 0 : (cmd.marker as number);
      return { rows: pages[i], ledger_index: 100 + i, ...(i + 1 < pages.length ? { marker: i + 1 } : {}) };
    });

  it("asks for page 1's ledger on every later page", async () => {
    const send = ledgerServer([[1], [2], [3]]);
    const res = await collectPages(
      send,
      { command: "account_objects", ledger_index: "validated" },
      pick,
      { maxPages: 5 },
    );
    expect(send.mock.calls.map(([cmd]) => cmd.ledger_index)).toEqual(["validated", 100, 100]);
    expect(res.ledgerIndex).toBe(100);
    expect(res.items).toEqual([1, 2, 3]);
  });

  it("leaves commands without a ledger_index alone", async () => {
    const send = ledgerServer([[1], [2]]);
    const res = await collectPages(send, { command: "nft_buy_offers" }, pick, { maxPages: 5 });
    expect(send.mock.calls.map(([cmd]) => cmd.ledger_index)).toEqual([undefined, undefined]);
    expect(res.ledgerIndex).toBeUndefined();
  });
});

describe("walkOutcome", () => {
  it("marks a capped walk truncated and a failed one partial", () => {
    expect(walkOutcome({ items: [1], marker: undefined })).toEqual({ items: [1], truncated: false, partial: false });
    expect(walkOutcome({ items: [1], marker: "m" })).toEqual({ items: [1], truncated: true, partial: false });
    expect(walkOutcome({ items: [1], marker: "m", error: "x" })).toEqual({ items: [1], truncated: false, partial: true });
  });

  it("throws when the first page failed", () => {
    expect(() => walkOutcome({ items: [], error: { error: "tooBusy" } })).toThrow();
  });
});

describe("walkOrNone", () => {
  it("reads not-found as an empty, complete walk", () => {
    expect(walkOrNone({ items: [], error: { error: "objectNotFound" } })).toEqual({
      items: [],
      truncated: false,
      partial: false,
    });
  });

  it("still throws on any other failure, so it never looks like none", () => {
    expect(() => walkOrNone({ items: [], error: { error: "tooBusy" } })).toThrow();
    expect(() => walkOrNone({ items: [], error: new Error("Request timed out") })).toThrow();
  });

  it("keeps partial and truncated walks as walkOutcome reads them", () => {
    expect(walkOrNone({ items: [1], marker: "m", error: "x" }).partial).toBe(true);
    expect(walkOrNone({ items: [1], marker: "m" }).truncated).toBe(true);
  });
});

describe("settledPool", () => {
  it("keeps order, settles every item and caps concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const res = await settledPool([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      if (n === 3) throw new Error("boom");
      return n * 10;
    });
    expect(peak).toBe(2);
    expect(res.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([10, 20, "x", 40, 50]);
  });

  it("handles an empty list", async () => {
    expect(await settledPool([], 4, async () => 1)).toEqual([]);
  });

  it("starts nothing new once the signal fires", async () => {
    const ac = new AbortController();
    const fn = vi.fn(async (n: number) => {
      if (n === 2) ac.abort();
      return n;
    });
    const res = await settledPool([1, 2, 3, 4, 5], 1, fn, ac.signal);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(res.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected", "rejected", "rejected"]);
    expect((res[2] as PromiseRejectedResult).reason).toBe(ac.signal.reason);
  });
});
