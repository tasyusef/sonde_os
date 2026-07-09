import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { nftMetadata, nftCollections } from "@/db/schema";
import { parseNFTokenID } from "./nft-utils";
import { fetchMetadataFromHexUri } from "./nft-metadata-fetcher";
import { pickCollectionName } from "./nft-name-helpers";
import { xrplClient } from "./xrpl-client";
import logger from "./logger";

const log = logger.child({ module: "nft-metadata-resolver" });

/** How long before retrying a failed fetch. */
const FAILED_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Max parallel URI fetches when resolving a batch. */
const FETCH_CONCURRENCY = 4;

export interface ResolvedNFT {
  nftokenId: string;
  issuer: string;
  taxon: number;
  name: string | null;
  /** Collection name lifted from the JSON metadata. Authoritative when
   *  non-null — UI consumers should prefer it over consensus on per-NFT
   *  names. Null when the metadata didn't carry one. */
  collectionName: string | null;
  imageUrl: string | null;
  /** Present only when the NFT has been fetched or the caller passed it in. */
  uri: string | null;
}

export interface ResolvedCollection {
  issuer: string;
  taxon: number;
  name: string | null;
  imageUrl: string | null;
}

/* ------------------------------------------------------------------ */
/*  NFT-level cache                                                   */
/* ------------------------------------------------------------------ */

interface CacheRow {
  nftokenId: string;
  issuer: string;
  taxon: number;
  uri: string | null;
  name: string | null;
  collectionName: string | null;
  imageUrl: string | null;
  fetchStatus: string;
  fetchedAt: Date;
}

async function readCache(nftokenIds: string[]): Promise<Map<string, CacheRow>> {
  if (nftokenIds.length === 0) return new Map();
  const rows = await db
    .select({
      nftokenId: nftMetadata.nftokenId,
      issuer: nftMetadata.issuer,
      taxon: nftMetadata.taxon,
      uri: nftMetadata.uri,
      name: nftMetadata.name,
      collectionName: nftMetadata.collectionName,
      imageUrl: nftMetadata.imageUrl,
      fetchStatus: nftMetadata.fetchStatus,
      fetchedAt: nftMetadata.fetchedAt,
    })
    .from(nftMetadata)
    .where(inArray(nftMetadata.nftokenId, nftokenIds));
  return new Map(rows.map((r) => [r.nftokenId, r]));
}

function shouldRefetch(row: CacheRow | undefined): boolean {
  if (!row) return true;
  if (row.fetchStatus === "ok") return false;
  if (row.fetchStatus === "pending" && row.uri) return true;
  if (row.fetchStatus === "failed") {
    return Date.now() - row.fetchedAt.getTime() > FAILED_RETRY_WINDOW_MS;
  }
  return false;
}

async function upsertStub(
  nftokenId: string,
  issuer: string,
  taxon: number,
  uri: string | null,
): Promise<void> {
  await db
    .insert(nftMetadata)
    .values({
      nftokenId,
      issuer,
      taxon,
      uri,
      fetchStatus: uri ? "pending" : "unknown",
    })
    .onConflictDoUpdate({
      target: nftMetadata.nftokenId,
      // Backfill uri when missing; never downgrade a resolved row back to
      // pending. If the row is already 'ok', leave it alone.
      set: {
        uri: sql`COALESCE(${nftMetadata.uri}, ${uri})`,
      },
    });
}

async function writeResolved(
  nftokenId: string,
  issuer: string,
  taxon: number,
  uri: string,
  result: {
    name: string | null;
    collectionName: string | null;
    imageUrl: string | null;
    description: string | null;
    attributes: Array<{ trait_type: string; value: string | number }> | null;
  } | null,
): Promise<void> {
  if (result === null) {
    await db
      .insert(nftMetadata)
      .values({
        nftokenId,
        issuer,
        taxon,
        uri,
        fetchStatus: "failed",
        fetchAttempts: 1,
      })
      .onConflictDoUpdate({
        target: nftMetadata.nftokenId,
        set: {
          fetchStatus: "failed",
          fetchedAt: sql`NOW()`,
          fetchAttempts: sql`${nftMetadata.fetchAttempts} + 1`,
          uri: sql`COALESCE(${nftMetadata.uri}, ${uri})`,
        },
      });
    return;
  }

  await db
    .insert(nftMetadata)
    .values({
      nftokenId,
      issuer,
      taxon,
      uri,
      name: result.name,
      collectionName: result.collectionName,
      imageUrl: result.imageUrl,
      description: result.description,
      attributes: result.attributes,
      fetchStatus: "ok",
      fetchAttempts: 1,
    })
    .onConflictDoUpdate({
      target: nftMetadata.nftokenId,
      set: {
        uri,
        name: result.name,
        collectionName: result.collectionName,
        imageUrl: result.imageUrl,
        description: result.description,
        attributes: result.attributes,
        fetchStatus: "ok",
        fetchedAt: sql`NOW()`,
        fetchAttempts: sql`${nftMetadata.fetchAttempts} + 1`,
      },
    });
}

/** Run fn across items with a concurrency cap. */
async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try {
        out[i] = await fn(items[i]);
      } catch {
        // Swallow — individual failures shouldn't abort the batch.
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  );
  await Promise.all(workers);
  return out;
}

/**
 * Resolve a batch of NFTs by id, optionally with known URIs.
 * Reads the cache, fetches any misses in parallel, and returns a map
 * keyed by nftokenId. Never throws — cache miss + fetch failure returns
 * a row with name/imageUrl null.
 */
export async function getNFTMetadataBatch(
  items: Array<{ nftokenId: string; uri?: string | null }>,
): Promise<Map<string, ResolvedNFT>> {
  const unique = new Map<string, string | null>();
  for (const item of items) {
    if (!unique.has(item.nftokenId)) {
      unique.set(item.nftokenId, item.uri ?? null);
    } else if (!unique.get(item.nftokenId) && item.uri) {
      unique.set(item.nftokenId, item.uri);
    }
  }
  const ids = [...unique.keys()];
  const cache = await readCache(ids);

  const toFetch: Array<{
    nftokenId: string;
    issuer: string;
    taxon: number;
    uri: string;
  }> = [];
  // NFTokens whose URI we don't have yet — try nft_info (Clio) to learn it.
  const uriLookups: Array<{
    nftokenId: string;
    issuer: string;
    taxon: number;
  }> = [];

  for (const nftokenId of ids) {
    const row = cache.get(nftokenId);
    const providedUri = unique.get(nftokenId) ?? null;
    const uri = row?.uri ?? providedUri ?? null;
    const parsed = parseNFTokenID(nftokenId);
    if (!parsed) continue;

    if (!uri) {
      // Don't hammer nft_info for rows we already tried and failed recently.
      if (row?.fetchStatus === "failed" && !shouldRefetch(row)) continue;
      uriLookups.push({
        nftokenId,
        issuer: parsed.issuer,
        taxon: parsed.nft_taxon,
      });
      continue;
    }

    if (!shouldRefetch(row)) continue;
    toFetch.push({
      nftokenId,
      issuer: parsed.issuer,
      taxon: parsed.nft_taxon,
      uri,
    });
  }

  // First pass: discover URIs via nft_info for rows we don't have URI for.
  if (uriLookups.length > 0) {
    await pMap(
      uriLookups,
      async (item) => {
        try {
          const info = await xrplClient.getNFTInfo(item.nftokenId);
          if (info?.uri) {
            toFetch.push({ ...item, uri: info.uri });
          } else {
            // nft_info returned but no URI — record a stub so we don't retry.
            await upsertStub(
              item.nftokenId,
              item.issuer,
              item.taxon,
              null,
            );
          }
        } catch {
          // nft_info may fail on non-Clio nodes or for burned NFTs; skip.
        }
      },
      FETCH_CONCURRENCY,
    );
  }

  if (toFetch.length > 0) {
    await pMap(
      toFetch,
      async (item) => {
        const result = await fetchMetadataFromHexUri(item.uri);
        await writeResolved(
          item.nftokenId,
          item.issuer,
          item.taxon,
          item.uri,
          result
            ? {
                name: result.name,
                collectionName: result.collectionName,
                imageUrl: result.imageUrl,
                description: result.description,
                attributes: result.attributes,
              }
            : null,
        );
      },
      FETCH_CONCURRENCY,
    );

    // Re-read cache for the rows we just fetched.
    const refreshed = await readCache(toFetch.map((i) => i.nftokenId));
    for (const [id, row] of refreshed) cache.set(id, row);
  }

  const out = new Map<string, ResolvedNFT>();
  for (const nftokenId of ids) {
    const row = cache.get(nftokenId);
    if (row) {
      out.set(nftokenId, {
        nftokenId,
        issuer: row.issuer,
        taxon: Number(row.taxon),
        name: row.name,
        collectionName: row.collectionName,
        imageUrl: row.imageUrl,
        uri: row.uri,
      });
    } else {
      const parsed = parseNFTokenID(nftokenId);
      if (parsed) {
        out.set(nftokenId, {
          nftokenId,
          issuer: parsed.issuer,
          taxon: parsed.nft_taxon,
          name: null,
          collectionName: null,
          imageUrl: null,
          uri: unique.get(nftokenId) ?? null,
        });
      }
    }
  }
  return out;
}

/** Single-NFT convenience wrapper. */
export async function getNFTMetadata(
  nftokenId: string,
  uri?: string | null,
): Promise<ResolvedNFT | null> {
  const map = await getNFTMetadataBatch([{ nftokenId, uri }]);
  return map.get(nftokenId) ?? null;
}

/**
 * Record a URI we learned from ingestion (e.g. from an NFTokenMint tx or an
 * nft_info lookup at trade time) without blocking on JSON fetching.
 * Writes a stub row so the resolver can pick it up on next read.
 */
export async function recordKnownURI(
  nftokenId: string,
  uri: string,
): Promise<void> {
  const parsed = parseNFTokenID(nftokenId);
  if (!parsed) return;
  try {
    await upsertStub(nftokenId, parsed.issuer, parsed.nft_taxon, uri);
  } catch (err) {
    log.warn({ err, nftokenId }, "Failed to record known URI");
  }
}

/* ------------------------------------------------------------------ */
/*  Collection-level cache                                             */
/* ------------------------------------------------------------------ */

interface CollectionRow {
  issuer: string;
  taxon: number;
  name: string | null;
  imageUrl: string | null;
  fetchStatus: string;
  fetchedAt: Date;
}

async function readCollectionCache(
  pairs: Array<{ issuer: string; taxon: number }>,
): Promise<Map<string, CollectionRow>> {
  if (pairs.length === 0) return new Map();
  const conditions = pairs.map((p) =>
    and(eq(nftCollections.issuer, p.issuer), eq(nftCollections.taxon, p.taxon)),
  );
  const rows = await db
    .select({
      issuer: nftCollections.issuer,
      taxon: nftCollections.taxon,
      name: nftCollections.name,
      imageUrl: nftCollections.imageUrl,
      fetchStatus: nftCollections.fetchStatus,
      fetchedAt: nftCollections.fetchedAt,
    })
    .from(nftCollections)
    .where(or(...conditions));
  return new Map(
    rows.map((r) => [`${r.issuer}:${r.taxon}`, { ...r, taxon: Number(r.taxon) }]),
  );
}

/** How many resolved NFTs to sample per collection when running the
 *  consensus pick. 10 is a balance: enough to drown out a couple of
 *  outlier-named NFTs without making the SELECT expensive. The pattern
 *  ratio in real collections is overwhelmingly high (most NFTs follow
 *  the "{Collection} #{N}" template), so even 5 samples would usually
 *  do; 10 buys safety on collections with mixed-name special editions. */
const COLLECTION_NAME_SAMPLE_SIZE = 10;

/**
 * Pick UP TO N resolved NFTs from `nft_metadata` per (issuer, taxon)
 * pair. Returns a map keyed by "issuer:taxon" with all sampled rows so
 * the caller can run consensus.
 *
 * Single-representative sampling (the prior approach) misnamed
 * collections whose first-resolved NFT had a unique title rather than
 * a "{Collection} #{N}" pattern — `extractCollectionName` returns
 * unique titles unchanged, so the whole collection inherited the
 * outlier's name. Multiple samples + `pickCollectionName` (strict-
 * majority consensus) prevents that.
 */
async function pickRepresentativeNFTs(
  pairs: Array<{ issuer: string; taxon: number }>,
): Promise<
  Map<
    string,
    Array<{ nftokenId: string; name: string | null; imageUrl: string | null }>
  >
> {
  if (pairs.length === 0) return new Map();

  const result = new Map<
    string,
    Array<{ nftokenId: string; name: string | null; imageUrl: string | null }>
  >();

  await pMap(
    pairs,
    async ({ issuer, taxon }) => {
      const rows = await db
        .select({
          nftokenId: nftMetadata.nftokenId,
          name: nftMetadata.name,
          imageUrl: nftMetadata.imageUrl,
        })
        .from(nftMetadata)
        .where(
          and(
            eq(nftMetadata.issuer, issuer),
            eq(nftMetadata.taxon, taxon),
            eq(nftMetadata.fetchStatus, "ok"),
          ),
        )
        .limit(COLLECTION_NAME_SAMPLE_SIZE);
      if (rows.length > 0) {
        result.set(`${issuer}:${taxon}`, rows);
      }
    },
    FETCH_CONCURRENCY,
  );

  return result;
}

async function writeCollectionResolved(
  issuer: string,
  taxon: number,
  name: string | null,
  imageUrl: string | null,
  representativeNftokenId: string | null,
): Promise<void> {
  await db
    .insert(nftCollections)
    .values({
      issuer,
      taxon,
      name,
      imageUrl,
      representativeNftokenId,
      fetchStatus: name ? "ok" : "pending",
    })
    .onConflictDoUpdate({
      target: [nftCollections.issuer, nftCollections.taxon],
      set: {
        name,
        imageUrl,
        representativeNftokenId,
        fetchStatus: name ? "ok" : "pending",
        fetchedAt: sql`NOW()`,
      },
    });
}

/**
 * Resolve a batch of collections. Order of preference:
 *   1. nft_collections cache hit (status=ok)
 *   2. Pick a representative resolved NFT from nft_metadata and cache it
 *   3. Return null name / imageUrl (caller falls back to truncated issuer)
 */
export async function getCollectionMetadataBatch(
  pairs: Array<{ issuer: string; taxon: number }>,
): Promise<Map<string, ResolvedCollection>> {
  const keyOf = (p: { issuer: string; taxon: number }) =>
    `${p.issuer}:${p.taxon}`;

  const unique = new Map<string, { issuer: string; taxon: number }>();
  for (const p of pairs) {
    unique.set(keyOf(p), p);
  }
  const uniquePairs = [...unique.values()];
  const cache = await readCollectionCache(uniquePairs);

  const needResolve: Array<{ issuer: string; taxon: number }> = [];
  for (const p of uniquePairs) {
    const row = cache.get(keyOf(p));
    if (!row || row.fetchStatus !== "ok" || !row.name) {
      needResolve.push(p);
    }
  }

  if (needResolve.length > 0) {
    const reps = await pickRepresentativeNFTs(needResolve);
    await pMap(
      needResolve,
      async (p) => {
        const samples = reps.get(keyOf(p)) ?? [];
        const name = pickCollectionName(samples.map((s) => s.name));
        // Use the first resolved sample's image for the collection
        // thumbnail. We don't run consensus on imageUrl — the
        // representative just needs to be visually plausible, and any
        // resolved sample qualifies.
        const imageSample = samples.find((s) => s.imageUrl);
        const imageUrl = imageSample?.imageUrl ?? null;
        const representativeId = imageSample?.nftokenId ?? samples[0]?.nftokenId ?? null;
        try {
          await writeCollectionResolved(
            p.issuer,
            p.taxon,
            name,
            imageUrl,
            representativeId,
          );
        } catch (err) {
          log.warn(
            { err, issuer: p.issuer, taxon: p.taxon },
            "Failed to write collection cache",
          );
        }
      },
      FETCH_CONCURRENCY,
    );

    const refreshed = await readCollectionCache(needResolve);
    for (const [k, v] of refreshed) cache.set(k, v);
  }

  const out = new Map<string, ResolvedCollection>();
  for (const p of uniquePairs) {
    const row = cache.get(keyOf(p));
    out.set(keyOf(p), {
      issuer: p.issuer,
      taxon: p.taxon,
      name: row?.name ?? null,
      imageUrl: row?.imageUrl ?? null,
    });
  }
  return out;
}

export async function getCollectionMetadata(
  issuer: string,
  taxon: number,
): Promise<ResolvedCollection> {
  const map = await getCollectionMetadataBatch([{ issuer, taxon }]);
  return (
    map.get(`${issuer}:${taxon}`) ?? {
      issuer,
      taxon,
      name: null,
      imageUrl: null,
    }
  );
}
