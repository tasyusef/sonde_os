/**
 * Backfill missing `nft_static_metadata` rows.
 *
 * Symptom: ~100k unburned NFTs are present in `nft_ownership` but have
 * no matching row in `nft_static_metadata`. The daily collection
 * snapshotter (`scripts/run-collection-daily-snapshot.ts`) INNER JOINs
 * the two tables on `nft_id` to map NFTs to their `(issuer, taxon)`
 * collection — so any NFT in the gap is excluded from holder_count
 * and listing_count for its collection. Collections whose NFTs were
 * mostly in the gap reported zero holders even when they had real
 * ownership, which is what surfaced on
 * `/nft/collection/rw1R8cfHGMySmbj7gJ1HkiCqTY1xhLGYAs/1`.
 *
 * Root cause is in scope for a separate investigation: the gap is
 * present in every monthly partition from May 2025 onward (1.5k–20k
 * missing per month), so the live ingester is still producing it.
 * For now this script closes the existing gap.
 *
 * Approach — decode-from-nft_id, no XRPL RPC:
 *   XLS-20 encodes the issuer (20 bytes) and the descrambled taxon
 *   inside the 32-byte NFTokenID. `parseNFTokenID` in
 *   `src/lib/nft-parsing.ts` already handles the descramble using
 *   the canonical `(384160001 * serial + 2459) MOD 2^32` cipher.
 *   That's the same logic the ingester uses on a live mint, so the
 *   `issuer` + `taxon` it produces here are byte-identical to what
 *   the ingester would have written if it had handled the original
 *   mint correctly.
 *
 *   `uri` we can't recover — the URI only exists on the original
 *   NFTokenMint tx body, and these gap rows don't have a mint event
 *   in our captured history. We write empty string, which is the
 *   table's DEFAULT and what the ingester also writes for NFTs minted
 *   without a URI. Downstream pages that DO render URI/image already
 *   handle empty correctly (fall back to placeholder).
 *
 *   `minted_ledger` and `minted_timestamp` we substitute with the
 *   ownership row's `acquired_ledger` / `acquired_timestamp`. Not the
 *   real mint moment (it's "when the current owner acquired"), but
 *   it's a real timestamp from this NFT's history and is strictly
 *   better than a sentinel zero/epoch.
 *
 * Idempotent: re-running finds zero missing rows (the LEFT JOIN comes
 * up empty after the first successful pass). The target table is a
 * `ReplacingMergeTree(last_updated)` so even if the live ingester
 * later writes a proper row for the same `nft_id`, ClickHouse merges
 * keep the newer entry — this backfill won't clobber real metadata.
 *
 * Flags:
 *   --db <database>           default: sonde_smoketest
 *   --confirm-production      required when --db sonde
 *   --execute                 actually insert (default is dry-run)
 *   --batch-size N            rows per CH INSERT (default 10000)
 *
 * Usage:
 *   pnpm tsx scripts/backfill-nft-static-metadata.ts                                   # dry-run vs smoketest
 *   pnpm tsx scripts/backfill-nft-static-metadata.ts --db sonde                        # dry-run vs prod
 *   pnpm tsx scripts/backfill-nft-static-metadata.ts --db sonde --confirm-production --execute
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";
import { parseNFTokenID } from "../src/lib/nft-parsing";

const args = process.argv.slice(2);
function arg(name: string, def: string): string {
  const i = args.indexOf(name);
  if (i === -1) return def;
  return args[i + 1] ?? def;
}
const flag = (name: string) => args.includes(name);

const DB = arg("--db", "sonde_smoketest");
const EXECUTE = flag("--execute");
const BATCH_SIZE = Number(arg("--batch-size", "10000"));

if (DB === "sonde" && !flag("--confirm-production")) {
  console.error(
    "Refusing to target the sonde production database without --confirm-production",
  );
  process.exit(1);
}

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const ch = createClient({
  url: CLICKHOUSE_URL,
  database: DB,
  request_timeout: 300_000,
  http_headers:
    process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
      ? {
          "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : undefined,
});

interface MissingRow {
  nft_id: string;
  acquired_ledger: number;
  acquired_timestamp: string;
}

async function run() {
  const startedAt = Date.now();
  console.log(
    `[backfill-static] db=${DB} execute=${EXECUTE} batch=${BATCH_SIZE}`,
  );

  // 1. Find missing rows. acquired_ledger / acquired_timestamp travel
  //    along so they can stand in for the unknown mint fields below.
  const missingResult = await ch.query({
    query: `
      SELECT
        o.nft_id AS nft_id,
        toUInt32(o.acquired_ledger) AS acquired_ledger,
        toString(o.acquired_timestamp) AS acquired_timestamp
      FROM nft_ownership AS o FINAL
      LEFT JOIN (SELECT nft_id FROM nft_static_metadata FINAL) AS m USING nft_id
      WHERE m.nft_id = ''
    `,
    format: "JSONEachRow",
  });
  const missing = (await missingResult.json()) as MissingRow[];
  console.log(`[backfill-static] missing rows discovered: ${missing.length}`);

  if (missing.length === 0) {
    console.log("[backfill-static] nothing to do");
    return;
  }

  // 2. Decode each. parseNFTokenID returns null on a malformed nft_id
  //    — log and skip those (shouldn't happen given they came from
  //    `nft_ownership` which only writes valid 64-hex ids, but be
  //    defensive).
  let decoded = 0;
  let undecodable = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const m of missing) {
    const parsed = parseNFTokenID(m.nft_id);
    if (!parsed) {
      undecodable += 1;
      continue;
    }
    rows.push({
      nft_id: m.nft_id,
      uri: "",
      issuer: parsed.issuer,
      taxon: parsed.nft_taxon,
      minted_ledger: m.acquired_ledger,
      minted_timestamp: m.acquired_timestamp,
    });
    decoded += 1;
  }
  console.log(
    `[backfill-static] decoded=${decoded} undecodable=${undecodable}`,
  );

  if (rows.length > 0) {
    console.log("[backfill-static] sample row:", rows[0]);
  }

  if (!EXECUTE) {
    console.log(
      "[backfill-static] dry-run — not inserting. Re-run with --execute to write.",
    );
    return;
  }

  // 3. Batch INSERT. ReplacingMergeTree handles duplicates safely if
  //    the same nft_id appears twice in `missing` (it won't, since the
  //    DISTINCT effect is implied by FINAL above on `nft_ownership`,
  //    but defense in depth).
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await ch.insert({
      table: "nft_static_metadata",
      values: batch,
      format: "JSONEachRow",
    });
    inserted += batch.length;
    console.log(`[backfill-static] inserted ${inserted}/${rows.length}`);
  }

  console.log(
    `[backfill-static] done inserted=${inserted} elapsedMs=${Date.now() - startedAt}`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-static] fatal", err);
    process.exit(1);
  });
