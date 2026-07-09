interface CacheEntry<T> {
  value: T;
  expiry: number | null;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttlMs: number | null;

  constructor(maxSize: number, ttlMs?: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs ?? null;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (entry.expiry != null && Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiry: this.ttlMs != null ? Date.now() + this.ttlMs : null,
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiry != null && Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const transactionCache = new LRUCache<unknown>(10000);
export const accountCache = new LRUCache<unknown>(1000, 30_000);
export const ledgerCache = new LRUCache<unknown>(100, 15_000);
export const recentTxCache = new LRUCache<unknown>(1, 15_000);
export const nftCache = new LRUCache<unknown>(500, 30_000);
export const recentMintsCache = new LRUCache<unknown>(1, 15_000);
export const feeCache = new LRUCache<unknown>(1, 20_000);
export const serverHealthCache = new LRUCache<unknown>(1, 15_000);
export const orderbookCache = new LRUCache<unknown>(50, 10_000);
export const tokenDetailCache = new LRUCache<unknown>(100, 60_000);
export const networkStatsCache = new LRUCache<unknown>(1, 15_000);
export const txDistributionCache = new LRUCache<unknown>(1, 15_000);
export const nftHistoryDataCache = new LRUCache<unknown>(100, 60_000);

// ---------------------------------------------------------------------------
// Singleflight: deduplicates concurrent requests and caches on success.
// If the same key is requested while an earlier call is still in-flight,
// callers share the same promise instead of issuing duplicate work.
// Uses globalThis to survive HMR reloads (same pattern as DB singleton).
// ---------------------------------------------------------------------------
const globalForSingleflight = globalThis as unknown as {
  _singleflightInFlight?: Map<string, Promise<unknown>>;
};
if (!globalForSingleflight._singleflightInFlight) {
  globalForSingleflight._singleflightInFlight = new Map();
}
const inFlight = globalForSingleflight._singleflightInFlight;

export function singleflight<T>(
  key: string,
  cache: LRUCache<unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached as T);

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().then(
    (result) => {
      cache.set(key, result);
      inFlight.delete(key);
      return result;
    },
    (err) => {
      inFlight.delete(key);
      throw err;
    },
  );

  inFlight.set(key, promise);
  return promise;
}
