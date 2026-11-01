import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WATCHLIST_STORAGE_KEY, addItem, parseWatchlist, removeItem } from "./watchlist-store";

const A = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const B = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

describe("parseWatchlist", () => {
  it("returns an empty list for missing or broken JSON", () => {
    expect(parseWatchlist(null)).toEqual([]);
    expect(parseWatchlist("")).toEqual([]);
    expect(parseWatchlist("{not json")).toEqual([]);
    expect(parseWatchlist('{"watchedAddress":"x"}')).toEqual([]);
  });

  it("keeps valid entries, drops malformed ones and duplicates", () => {
    const raw = JSON.stringify([
      { watchedAddress: A, label: "Pepper" },
      { watchedAddress: "not-an-address", label: null },
      { watchedAddress: A, label: "dupe" },
      { watchedAddress: B, label: "" },
      { watchedAddress: B, label: "later dupe" },
      null,
      42,
    ]);
    expect(parseWatchlist(raw)).toEqual([
      { watchedAddress: A, label: "Pepper" },
      { watchedAddress: B, label: null },
    ]);
  });
});

describe("addItem / removeItem", () => {
  it("adds once, trims labels, blank becomes null", () => {
    const one = addItem([], A, "  Pepper  ");
    expect(one).toEqual([{ watchedAddress: A, label: "Pepper" }]);
    expect(addItem(one, A, "again")).toBe(one);
    expect(addItem(one, B, "   ")).toEqual([...one, { watchedAddress: B, label: null }]);
  });

  it("removes by address and returns the same list when absent", () => {
    const list = addItem(addItem([], A), B);
    expect(removeItem(list, A)).toEqual([{ watchedAddress: B, label: null }]);
    expect(removeItem(list, "rMissing")).toBe(list);
  });
});

describe("watchlistStore", () => {
  let storage: Map<string, string>;
  let storageListener: ((e: { key: string | null }) => void) | null;
  let blocked: boolean;

  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    storageListener = null;
    blocked = false;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => {
          if (blocked) throw new Error("blocked");
          return storage.get(k) ?? null;
        },
        setItem: (k: string, v: string) => {
          if (blocked) throw new Error("blocked");
          storage.set(k, v);
        },
      },
      addEventListener: (_: string, cb: typeof storageListener) => { storageListener = cb; },
      removeEventListener: () => { storageListener = null; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists adds and removes and notifies subscribers", async () => {
    const { watchlistStore } = await import("./watchlist-store");
    const onChange = vi.fn();
    const unsubscribe = watchlistStore.subscribe(onChange);

    watchlistStore.add(A, "Pepper");
    expect(watchlistStore.getSnapshot()).toEqual([{ watchedAddress: A, label: "Pepper" }]);
    expect(JSON.parse(storage.get(WATCHLIST_STORAGE_KEY)!)).toEqual([{ watchedAddress: A, label: "Pepper" }]);

    watchlistStore.add(A);
    expect(onChange).toHaveBeenCalledTimes(1);

    watchlistStore.remove(A);
    expect(watchlistStore.getSnapshot()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("keeps a stable snapshot between reads", async () => {
    storage.set(WATCHLIST_STORAGE_KEY, JSON.stringify([{ watchedAddress: A, label: null }]));
    const { watchlistStore } = await import("./watchlist-store");
    expect(watchlistStore.getSnapshot()).toBe(watchlistStore.getSnapshot());
  });

  it("works in memory when storage is blocked", async () => {
    blocked = true;
    const { watchlistStore } = await import("./watchlist-store");
    expect(watchlistStore.getSnapshot()).toEqual([]);
    watchlistStore.add(B);
    expect(watchlistStore.getSnapshot()).toEqual([{ watchedAddress: B, label: null }]);
  });

  it("reloads when another tab writes or clears storage", async () => {
    const { watchlistStore } = await import("./watchlist-store");
    const onChange = vi.fn();
    watchlistStore.subscribe(onChange);
    expect(watchlistStore.getSnapshot()).toEqual([]);

    storage.set(WATCHLIST_STORAGE_KEY, JSON.stringify([{ watchedAddress: A, label: "from tab 2" }]));
    storageListener?.({ key: "unrelated" });
    expect(onChange).not.toHaveBeenCalled();
    storageListener?.({ key: WATCHLIST_STORAGE_KEY });
    expect(watchlistStore.getSnapshot()).toEqual([{ watchedAddress: A, label: "from tab 2" }]);

    storage.clear();
    storageListener?.({ key: null });
    expect(watchlistStore.getSnapshot()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
