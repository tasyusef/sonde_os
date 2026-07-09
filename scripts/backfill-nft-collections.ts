/**
 * One-off: warm the nft_metadata + nft_collections caches for the top
 * NFT issuers by volume so surfaces like "Top Collections" don't show
 * truncated issuer addresses on cold reads.
 *
 * How it picks a representative NFT per issuer:
 *  1. Clio's `nfts_by_issuer` (works on honeycluster.io) — cheapest path,
 *     returns any minted NFT with URI inline.
 *  2. Fallback: `account_nfts(issuer)` — only works if the issuer still
 *     holds some of their own inventory. Skipped if empty.
 *
 * Writes through the resolver so the normal cache-write path runs,
 * including extractCollectionName + the nft_collections row.
 *
 * Usage: npx tsx scripts/backfill-nft-collections.ts [topN]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import {
  getNFTCollectionRankings,
} from "../src/lib/db-queries";
import { getNFTMetadataBatch } from "../src/lib/nft-metadata-resolver";
import { parseNFTokenID } from "../src/lib/nft-utils";
import { xrplClient } from "../src/lib/xrpl-client";
import { db } from "../src/db";
import { nftMetadata } from "../src/db/schema";
import { and, eq, sql } from "drizzle-orm";

const DEFAULT_TOP_N = 50;

interface NFTsByIssuerResponse {
  issuer: string;
  nfts?: Array<{
    nft_id: string;
    uri?: string | null;
  }>;
  error?: string;
}

interface AccountNFTsEntry {
  NFTokenID: string;
  URI?: string;
}

async function issuerAlreadyResolved(issuer: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<string>`COUNT(*)::text` })
    .from(nftMetadata)
    .where(
      and(
        eq(nftMetadata.issuer, issuer),
        eq(nftMetadata.fetchStatus, "ok"),
      ),
    )
    .limit(1);
  return Number(row?.count ?? 0) > 0;
}

async function pickRepresentativeFromClio(
  issuer: string,
): Promise<{ nftokenId: string; uri: string | null } | null> {
  try {
    const res = (await xrplClient.send({
      command: "nfts_by_issuer",
      issuer,
      limit: 1,
    })) as NFTsByIssuerResponse;
    const first = res?.nfts?.[0];
    if (first?.nft_id) {
      return { nftokenId: first.nft_id, uri: first.uri ?? null };
    }
  } catch {
    /* Clio extension unavailable or issuer has no nfts */
  }
  return null;
}

async function pickRepresentativeFromAccountNFTs(
  issuer: string,
): Promise<{ nftokenId: string; uri: string | null } | null> {
  try {
    const res = await xrplClient.getAccountNFTs(issuer);
    const nfts = (res.account_nfts ?? []) as AccountNFTsEntry[];
    // Prefer NFTs that match this issuer (the account may hold NFTs from
    // other issuers too if it's used as a treasury).
    const match = nfts.find((n) => {
      const parsed = parseNFTokenID(n.NFTokenID);
      return parsed?.issuer === issuer;
    });
    if (match) return { nftokenId: match.NFTokenID, uri: match.URI ?? null };
  } catch {
    /* account_nfts failed */
  }
  return null;
}

async function main() {
  const topN = Number(process.argv[2] ?? DEFAULT_TOP_N);
  if (!Number.isFinite(topN) || topN <= 0) {
    console.error("[backfill] topN must be a positive integer");
    process.exit(1);
  }

  console.log(`[backfill] fetching top ${topN} NFT collections by volume`);
  const { rankings } = await getNFTCollectionRankings("all", topN);
  console.log(`[backfill] ${rankings.length} issuers to consider`);

  let resolved = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rankings) {
    const issuer = r.issuer;
    if (await issuerAlreadyResolved(issuer)) {
      skipped++;
      continue;
    }

    // Try Clio first; fall back to account_nfts.
    const rep =
      (await pickRepresentativeFromClio(issuer)) ??
      (await pickRepresentativeFromAccountNFTs(issuer));

    if (!rep) {
      console.log(`[backfill] ✗ ${issuer} — no representative NFT found`);
      failed++;
      continue;
    }

    // Hand off to the resolver — it writes cache + nft_collections row.
    try {
      const result = await getNFTMetadataBatch([
        { nftokenId: rep.nftokenId, uri: rep.uri },
      ]);
      const meta = result.get(rep.nftokenId);
      if (meta?.name) {
        console.log(
          `[backfill] ✓ ${issuer} → ${meta.name}`,
        );
        resolved++;
      } else {
        console.log(
          `[backfill] ~ ${issuer} — URI resolved but no name (image-only or parse miss)`,
        );
        resolved++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[backfill] ✗ ${issuer} — resolver error: ${msg}`);
      failed++;
    }
  }

  console.log(
    `[backfill] complete — resolved: ${resolved}, skipped (cached): ${skipped}, failed: ${failed}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
