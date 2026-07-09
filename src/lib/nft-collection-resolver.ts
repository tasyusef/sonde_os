// No `server-only` import — the cron at `scripts/run-collection-resolver.ts`
// invokes this via tsx, outside the Next.js runtime. We take a `db`
// parameter rather than importing `@/db` directly because that module
// has `import "server-only"` at the top, which throws under tsx.
import { sql, and, eq, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { nftMetadata, nftCollections } from "@/db/schema";
import { resolveCollectionFromToml } from "./xls-26-toml";
import { pickCollectionName } from "./nft-name-helpers";
import logger from "./logger";

/** Drizzle database handle. The Next.js routes pass `@/db`'s singleton;
 *  the cron creates its own with the same schema bindings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = PostgresJsDatabase<any>;

const log = logger.child({ module: "nft-collection-resolver" });

/**
 * Per-collection name + image resolver. Layered priority:
 *
 *   1. JSON metadata's `collection` field — extracted at fetch time
 *      into `nft_metadata.collection_name`. We aggregate across the
 *      collection (most-common value wins) since each NFT carries the
 *      same value when minted properly.
 *   2. Issuer's `xrp-ledger.toml` `[[NFTS]]` / `[[COLLECTIONS]]`
 *      entry. Authoritative when published by the issuer.
 *   3. Per-NFT `name` consensus via `pickCollectionName` — strips
 *      trailing "#N" patterns and requires strict majority. Handles
 *      "Foo #1, Foo #2, … + outlier" shape.
 *   4. Caller falls back to "Collection #{taxon}" when this returns
 *      `null`.
 *
 * Each resolution writes to `nft_collections` with a `source` tag so
 * we can audit coverage by layer + selectively re-resolve when one
 * source improves (e.g. issuer publishes a TOML entry that supersedes
 * a heuristic consensus name).
 *
 * Designed to run from a Hetzner systemd timer over the full set of
 * `(issuer, taxon)` we've ever observed — see
 * `scripts/run-collection-resolver.ts`.
 */

export type ResolverSource = "json" | "toml" | "consensus";

export interface ResolvedCollectionResult {
  name: string;
  imageUrl: string | null;
  source: ResolverSource;
}

export async function resolveCollection(
  db: DB,
  issuer: string,
  taxon: number,
): Promise<ResolvedCollectionResult | null> {
  // Layer 1: per-collection consensus over JSON-extracted collection_name.
  // Most NFTs in a real collection share the same value; pick the most
  // common (or the only one if singleton).
  const fromJson = await resolveFromMetadataJson(db, issuer, taxon);
  if (fromJson) {
    return { name: fromJson, imageUrl: null, source: "json" };
  }

  // Layer 2: issuer's xrp-ledger.toml.
  try {
    const fromToml = await resolveCollectionFromToml(issuer, taxon);
    if (fromToml) {
      return {
        name: fromToml.name,
        imageUrl: fromToml.imageUrl,
        source: "toml",
      };
    }
  } catch (err) {
    log.warn({ err, issuer, taxon }, "toml resolver threw");
  }

  // Layer 3: per-NFT name consensus across resolved metadata.
  const fromConsensus = await resolveFromNameConsensus(db, issuer, taxon);
  if (fromConsensus) {
    return { name: fromConsensus, imageUrl: null, source: "consensus" };
  }

  return null;
}

/**
 * Pick the most-common non-null `collection_name` across NFTs in this
 * collection. Most NFTs in a healthy collection carry the same value;
 * we handle the long tail of mixed values via simple frequency count.
 */
async function resolveFromMetadataJson(
  db: DB,
  issuer: string,
  taxon: number,
): Promise<string | null> {
  const rows = await db
    .select({ collectionName: nftMetadata.collectionName })
    .from(nftMetadata)
    .where(
      and(
        eq(nftMetadata.issuer, issuer),
        eq(nftMetadata.taxon, taxon),
        isNotNull(nftMetadata.collectionName),
      ),
    )
    .limit(50);
  if (rows.length === 0) return null;
  const tally = new Map<string, number>();
  for (const r of rows) {
    if (!r.collectionName) continue;
    const trimmed = r.collectionName.trim();
    if (!trimmed) continue;
    tally.set(trimmed, (tally.get(trimmed) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of tally) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Sample up to N resolved NFT names from this collection and run
 * `pickCollectionName` consensus.
 */
async function resolveFromNameConsensus(
  db: DB,
  issuer: string,
  taxon: number,
): Promise<string | null> {
  const rows = await db
    .select({ name: nftMetadata.name })
    .from(nftMetadata)
    .where(
      and(
        eq(nftMetadata.issuer, issuer),
        eq(nftMetadata.taxon, taxon),
        eq(nftMetadata.fetchStatus, "ok"),
      ),
    )
    .limit(50);
  return pickCollectionName(rows.map((r) => r.name));
}

/**
 * Persist a resolution to `nft_collections`. Writes are upsert-by-
 * `(issuer, taxon)`; an existing higher-priority source is not
 * overwritten by a lower-priority one (caller checks before invoking).
 */
export async function writeResolvedCollection(
  db: DB,
  issuer: string,
  taxon: number,
  result: ResolvedCollectionResult,
): Promise<void> {
  await db
    .insert(nftCollections)
    .values({
      issuer,
      taxon,
      name: result.name,
      imageUrl: result.imageUrl,
      source: result.source,
      fetchStatus: "ok",
    })
    .onConflictDoUpdate({
      target: [nftCollections.issuer, nftCollections.taxon],
      set: {
        name: result.name,
        imageUrl: result.imageUrl,
        source: result.source,
        fetchStatus: "ok",
        fetchedAt: sql`NOW()`,
      },
    });
}

/**
 * Delete a stale `nft_collections` row when the resolver can no
 * longer derive a name. Bounded to consensus rows — JSON / TOML
 * rows are canonical and a transient resolver miss (IPFS down,
 * single sample lost, etc.) should NOT take them out.
 *
 * Used by the cron's self-heal pass. Without this the migration of
 * `pickCollectionName`'s single-sample logic on 2026-05-09 would
 * have left thousands of stale rows around forever — the cron
 * skipped them because it never wrote a replacement.
 */
export async function deleteStaleConsensus(
  db: DB,
  issuer: string,
  taxon: number,
): Promise<void> {
  await db
    .delete(nftCollections)
    .where(
      and(
        eq(nftCollections.issuer, issuer),
        eq(nftCollections.taxon, taxon),
        eq(nftCollections.source, "consensus"),
      ),
    );
}

/** Source priority — higher is "stronger", so we don't downgrade. */
const SOURCE_PRIORITY: Record<ResolverSource, number> = {
  toml: 3, // issuer's own publication, canonical
  json: 2, // metadata's `collection` field, also canonical but per-NFT
  consensus: 1, // heuristic
};

export function shouldUpgrade(
  current: ResolverSource | null | undefined,
  candidate: ResolverSource,
): boolean {
  if (!current) return true;
  return SOURCE_PRIORITY[candidate] >= SOURCE_PRIORITY[current];
}
