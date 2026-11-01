/**
 * NFT metadata, fetched from the browser.
 *
 * - `fetchNftMetadata(hexUri)`: one metadata JSON with IPFS / Arweave
 *   gateway fallback, 12 s per attempt, 20 s overall, 512 KB cap.
 * - `requestNfts(items, send)`: resolve many NFTs (name, image,
 *   collection) into a shared store that `useNftRows` reads. Learns a
 *   missing URI from `nft_info` (Clio). Returns a release function:
 *   queued work for NFTs nobody wants anymore is dropped.
 *
 * At most 4 fetches run at once per tab, so gateways see a trickle even
 * on big wallets. Results are cached for the session; a failure that
 * may pass (timeout, network, HTTP error) only for `FAILURE_TTL_MS`.
 *
 * Other hosts than the gateways and `isAutoLoadHost` load only after
 * the visitor's click (`media-approvals.ts`): with no server proxy, the
 * host sees the visitor's IP. Even then, metadata needs CORS headers.
 */

import { hexToUtf8 } from "./hex";
import { isMediaApproved, pendingHost } from "./media-approvals";
import { mediaUrls, parseMetadata, type ResolvedMetadata } from "./nft-media";
import { parseNFTokenID } from "./nft-utils";
import { isNotFoundError } from "./xrpl-errors";
import type { SendFn } from "./xrpl-pagination";

export type { ResolvedMetadata } from "./nft-media";

const FETCH_TIMEOUT_MS = 12_000;
const TOTAL_TIMEOUT_MS = 20_000;
const MAX_BYTES = 512 * 1024;
const CONCURRENCY = 4;
const CACHE_MAX = 2_000;
/** A failure that may pass is retried by the next request after this. */
export const FAILURE_TTL_MS = 60_000;
/** Settled rows are announced together, at most this often. */
const PUBLISH_MS = 50;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;

/* ---- Fetch queue --------------------------------------------------- */

/** A queued job whose requester left before it started. */
class DroppedError extends Error {
  constructor() {
    super("No longer wanted");
  }
}

interface Job {
  run: () => void;
  drop: () => void;
  wanted: () => boolean;
}

let active = 0;
const waiting: Job[] = [];

function pump(): void {
  while (active < CONCURRENCY && waiting.length > 0) {
    const job = waiting.shift()!;
    if (job.wanted()) job.run();
    else job.drop();
  }
}

/** Run `fn` in one of `CONCURRENCY` slots. A job that's no longer
 *  `wanted` when its turn comes is dropped (rejects with DroppedError). */
function limited<T>(
  fn: () => Promise<T>,
  { priority = false, wanted = () => true }: { priority?: boolean; wanted?: () => boolean } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      wanted,
      drop: () => reject(new DroppedError()),
      run: () => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      },
    };
    if (priority) waiting.unshift(job);
    else waiting.push(job);
    pump();
  });
}

/* ---- One metadata document -------------------------------------- */

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
}

const imageOnly = (url: string): ResolvedMetadata => ({
  name: null,
  collectionName: null,
  imageUrl: url,
  description: null,
  attributes: null,
});

export interface MetadataResult {
  meta: ResolvedMetadata | null;
  /** Failed in a way that may pass (network, timeout, HTTP error), so
   *  it's only cached for `FAILURE_TTL_MS`. */
  transient: boolean;
}

const FINAL_NONE: MetadataResult = { meta: null, transient: false };

async function loadMetadata(rawUri: string): Promise<MetadataResult> {
  const urls = mediaUrls(rawUri);
  if (urls.length === 0) return FINAL_NONE;
  const deadline = AbortSignal.timeout(TOTAL_TIMEOUT_MS);

  for (const url of urls) {
    if (deadline.aborted) break;
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.any([deadline, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
        headers: { Accept: "application/json, image/*, */*" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch {
      continue; // network, CORS or timeout: try the next gateway
    }
    if (!res.ok) continue;

    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("image/") || type.startsWith("video/")) {
      void res.body?.cancel();
      return { meta: imageOnly(url), transient: false };
    }
    try {
      const body = await readCapped(res);
      return { meta: body ? parseMetadata(JSON.parse(body)) : null, transient: false };
    } catch {
      return FINAL_NONE; // same bytes on every gateway; don't retry
    }
  }
  // Unreachable (often CORS). A URI that names an image still renders
  // through <img>, which needs no CORS.
  if (IMAGE_EXT.test(rawUri)) return { meta: imageOnly(urls[0]), transient: false };
  return { meta: null, transient: true };
}

interface CacheEntry {
  result: Promise<MetadataResult>;
  /** Set when a transient failure settles: refetch from then on. */
  expiresAt?: number;
}

/** Loads that have started (queued ones aren't here, so a slot never
 *  waits on a job still in the queue). */
const metadataCache = new Map<string, CacheEntry>();

function cachedMetadata(hexUri: string): Promise<MetadataResult> | undefined {
  const entry = metadataCache.get(hexUri);
  if (!entry) return undefined;
  if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
    metadataCache.delete(hexUri);
    return undefined;
  }
  return entry.result;
}

/** Start (or join) the load for `hexUri`. Call from inside a slot. */
function metadataNow(hexUri: string): Promise<MetadataResult> {
  const cached = cachedMetadata(hexUri);
  if (cached) return cached;
  const raw = hexToUtf8(hexUri).trim();
  const entry: CacheEntry = { result: Promise.resolve(FINAL_NONE) };
  if (raw) {
    entry.result = loadMetadata(raw)
      .catch((): MetadataResult => ({ meta: null, transient: true }))
      .then((r) => {
        if (r.transient) entry.expiresAt = Date.now() + FAILURE_TTL_MS;
        return r;
      });
  }
  metadataCache.set(hexUri, entry);
  if (metadataCache.size > CACHE_MAX) metadataCache.delete(metadataCache.keys().next().value!);
  return entry.result;
}

/** Metadata for a hex-encoded NFT URI, and whether a failure may pass.
 *  Never rejects. */
export function loadNftMetadata(
  hexUri: string,
  opts: { priority?: boolean } = {},
): Promise<MetadataResult> {
  return cachedMetadata(hexUri) ?? limited(() => metadataNow(hexUri), opts);
}

/** Metadata for a hex-encoded NFT URI. Never rejects; null when the URI
 *  is empty, unsafe or unreachable. */
export function fetchNftMetadata(
  hexUri: string,
  opts: { priority?: boolean } = {},
): Promise<ResolvedMetadata | null> {
  return loadNftMetadata(hexUri, opts).then((r) => r.meta);
}

/* ---- Batch store ------------------------------------------------- */

export interface ResolvedNFT {
  nftokenId: string;
  issuer: string;
  taxon: number;
  name: string | null;
  collectionName: string | null;
  imageUrl: string | null;
  uri: string | null;
  /** Metadata host waiting for the visitor's OK (nothing fetched). */
  askHost: string | null;
}

export interface NftRequest {
  nftokenId: string;
  /** Hex URI. `undefined` = unknown (look it up with `nft_info`);
   *  `null` / `""` = the NFT has none. */
  uri?: string | null;
}

const EMPTY_ROW = { issuer: "", taxon: 0, name: null, collectionName: null, imageUrl: null, askHost: null };
const ROWS_MAX = 5_000;

interface RowEntry {
  row: ResolvedNFT;
  /** Set when the row settled on a failure that may pass. */
  expiresAt?: number;
}

const rows = new Map<string, RowEntry>();
/** Components currently showing each NFT. Wanted rows are never
 *  evicted, and queued work for unwanted ones is dropped. */
const wanters = new Map<string, number>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let publishTimer: ReturnType<typeof setTimeout> | null = null;

/** Announce settled rows, batched: each announcement makes every
 *  `useNftRows` reader rebuild its map. */
function schedulePublish(): void {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    version++;
    for (const fn of listeners) fn();
  }, PUBLISH_MS);
}

export function subscribeNfts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getNftsVersion = (): number => version;

/** Held for an `askHost` the visitor has since approved: due a refetch. */
const isUnblocked = (id: string, row: ResolvedNFT): boolean =>
  row.askHost !== null && isMediaApproved(id, row.askHost);

/** Settled row (name/image null when metadata failed), or undefined
 *  while it hasn't been requested or is still loading. */
export function getNftRow(id: string): ResolvedNFT | undefined {
  const row = rows.get(id)?.row;
  return row && !isUnblocked(id, row) ? row : undefined;
}

const isWanted = (id: string): boolean => (wanters.get(id) ?? 0) > 0;

function storeRow(id: string, row: ResolvedNFT, transient: boolean): void {
  rows.delete(id); // re-insert as newest
  rows.set(id, { row, expiresAt: transient ? Date.now() + FAILURE_TTL_MS : undefined });
  if (rows.size <= ROWS_MAX) return;
  for (const old of rows.keys()) {
    if (rows.size <= ROWS_MAX) break;
    if (!isWanted(old)) rows.delete(old);
  }
}

/** Settled and still fresh: no need to fetch again. */
function isSettled(id: string): boolean {
  const entry = rows.get(id);
  if (!entry || isUnblocked(id, entry.row)) return false;
  return entry.expiresAt === undefined || Date.now() < entry.expiresAt;
}

async function resolveOne(
  item: NftRequest,
  send: SendFn,
): Promise<{ row: ResolvedNFT; transient: boolean }> {
  const parsed = parseNFTokenID(item.nftokenId);
  let uri = item.uri ?? null;
  let transient = false;
  if (item.uri === undefined) {
    const info = (await send({ command: "nft_info", nft_id: item.nftokenId }).catch((err) => {
      transient = !isNotFoundError(err);
      return null;
    })) as { uri?: string } | null;
    uri = info?.uri || null;
  }
  let meta: ResolvedMetadata | null = null;
  const askHost = uri ? pendingHost(item.nftokenId, hexToUtf8(uri).trim()) : null;
  if (uri && parsed && !askHost) {
    const result = await metadataNow(uri);
    meta = result.meta;
    transient ||= result.transient;
  }
  return {
    row: {
      nftokenId: item.nftokenId,
      issuer: parsed?.issuer ?? "",
      taxon: parsed?.nft_taxon ?? 0,
      name: meta?.name ?? null,
      collectionName: meta?.collectionName ?? null,
      imageUrl: meta?.imageUrl ?? null,
      uri,
      askHost,
    },
    transient,
  };
}

/**
 * Resolve NFTs that aren't settled (or whose failure has expired) and
 * aren't in flight. `priority` jumps the queue (cards on screen). Call
 * the returned function when the caller stops showing them: work still
 * queued for NFTs nobody else wants is dropped.
 */
export function requestNfts(
  items: readonly NftRequest[],
  send: SendFn,
  opts: { priority?: boolean } = {},
): () => void {
  const ids = items.map((item) => item.nftokenId);
  for (const id of ids) wanters.set(id, (wanters.get(id) ?? 0) + 1);

  for (const item of items) {
    const id = item.nftokenId;
    if (inFlight.has(id) || isSettled(id)) continue;
    inFlight.add(id);
    limited(() => resolveOne(item, send), { priority: opts.priority, wanted: () => isWanted(id) })
      .then(
        ({ row, transient }) => {
          storeRow(id, row, transient);
          schedulePublish();
        },
        (err) => {
          if (err instanceof DroppedError) return;
          storeRow(id, { ...EMPTY_ROW, nftokenId: id, uri: item.uri ?? null }, true);
          schedulePublish();
        },
      )
      .finally(() => inFlight.delete(id));
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of ids) {
      const n = (wanters.get(id) ?? 0) - 1;
      if (n > 0) wanters.set(id, n);
      else wanters.delete(id);
    }
  };
}
