import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { nftCollections } from "@/db/schema";
import { cachedJson } from "@/lib/api-cache";
import logger from "@/lib/logger";

const log = logger.child({ module: "api/nft/collections/resolve" });

const MAX_PAIRS = 250;

interface ResolvedCollectionResponse {
  /** Keyed on `${issuer}:${taxon}`. Missing keys = no resolved name yet
   *  (caller falls back to its own consensus / "Collection #N" logic). */
  [key: string]: {
    name: string;
    imageUrl: string | null;
    source: string | null;
  } | undefined;
}

/**
 * Looks up cached `nft_collections` rows for a list of `(issuer, taxon)`
 * pairs. The cache is populated by the periodic Hetzner systemd timer
 * (`scripts/run-collection-resolver.ts` running daily) which walks the
 * full set of observed collections and runs the layered resolver.
 *
 * Read-only. Sub-50ms typical — primary key lookup on a small table.
 *
 * Body: `{ pairs: [{issuer: string, taxon: number}, ...] }`
 * Returns: `{ "issuer:taxon": { name, imageUrl, source } }`
 *
 * Edge cache 5min + 30min stale-while-revalidate so concurrent NFTGrid
 * mounts hit cache.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pairsInput =
    body && typeof body === "object" && "pairs" in body
      ? (body as { pairs: unknown }).pairs
      : null;

  if (!Array.isArray(pairsInput)) {
    return NextResponse.json(
      { error: "pairs must be an array" },
      { status: 400 },
    );
  }

  if (pairsInput.length > MAX_PAIRS) {
    return NextResponse.json(
      { error: `pairs exceeds max batch size (${MAX_PAIRS})` },
      { status: 400 },
    );
  }

  // Validate + dedupe.
  const unique = new Map<string, { issuer: string; taxon: number }>();
  for (const p of pairsInput) {
    if (!p || typeof p !== "object") continue;
    const rec = p as Record<string, unknown>;
    const issuer = rec.issuer;
    const taxon = rec.taxon;
    if (typeof issuer !== "string" || !/^r[a-zA-Z0-9]{20,}$/.test(issuer)) continue;
    const taxonNum =
      typeof taxon === "number"
        ? taxon
        : typeof taxon === "string"
          ? Number(taxon)
          : NaN;
    if (!Number.isFinite(taxonNum) || taxonNum < 0) continue;
    unique.set(`${issuer}:${taxonNum}`, { issuer, taxon: taxonNum });
  }

  const pairs = [...unique.values()];
  if (pairs.length === 0) {
    return NextResponse.json({});
  }

  try {
    // Two indexed columns; build an OR of (issuer = ? AND taxon = ?) per
    // pair. Cheap on the (issuer, taxon) PK.
    const issuers = [...new Set(pairs.map((p) => p.issuer))];
    const candidates = await db
      .select({
        issuer: nftCollections.issuer,
        taxon: nftCollections.taxon,
        name: nftCollections.name,
        imageUrl: nftCollections.imageUrl,
        source: nftCollections.source,
      })
      .from(nftCollections)
      .where(
        and(
          inArray(nftCollections.issuer, issuers),
          or(
            ...pairs.map((p) =>
              and(
                eq(nftCollections.issuer, p.issuer),
                eq(nftCollections.taxon, p.taxon),
              ),
            ),
          ),
        ),
      );

    const wanted = new Set(pairs.map((p) => `${p.issuer}:${p.taxon}`));
    const out: ResolvedCollectionResponse = {};
    for (const r of candidates) {
      const key = `${r.issuer}:${r.taxon}`;
      if (!wanted.has(key)) continue; // OR-clause may fan wider than wanted
      if (!r.name) continue;
      out[key] = {
        name: r.name,
        imageUrl: r.imageUrl ?? null,
        source: r.source,
      };
    }

    return cachedJson(out, 300, 1800);
  } catch (err) {
    log.error({ err }, "collection resolve query failed");
    return NextResponse.json({}, { status: 200 });
  }
}
