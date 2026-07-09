/**
 * NFT collection name resolver — periodic Hetzner systemd cron entry.
 *
 * Walks every (issuer, taxon) pair we've observed (via
 * `nft_static_metadata`) and runs the layered resolver in
 * `lib/nft-collection-resolver.ts`. Stores results in PG
 * `nft_collections` keyed on `(issuer, taxon)` with a `source` tag so
 * we know which layer produced each name.
 *
 * Layers in priority order:
 *   1. JSON metadata `collection` field consensus (per-collection,
 *      tallied across all resolved NFTs).
 *   2. Issuer's `xrp-ledger.toml` `[[NFTS]]` / `[[COLLECTIONS]]` entry.
 *   3. Per-NFT name consensus via `pickCollectionName`.
 *
 * Already-resolved rows are re-checked only when a higher-priority
 * source becomes available (e.g. a fresh TOML publication can override
 * a heuristic consensus name). Cheap when nothing changes.
 *
 * Runs as `sonde-nft-collection-resolver.service` triggered by
 * `sonde-nft-collection-resolver.timer` (daily). Same systemd-cron
 * pattern as `sonde-holder-snapshot.timer` and the others.
 *
 * CLI:
 *   --batch=N             rows per CH page when listing pairs (default 5000)
 *   --concurrency=N       parallel resolutions (default 4)
 *   --skip-resolved       skip pairs already in `nft_collections` with
 *                         a name + source (default: false; we revisit so
 *                         a TOML update can supersede a consensus name)
 *   --limit=N             stop after N pairs (default unlimited)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { createClient as createCHClient } from "@clickhouse/client";
import {
  resolveCollection,
  writeResolvedCollection,
  deleteStaleConsensus,
} from "../src/lib/nft-collection-resolver";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

const BATCH = Number(getArg("--batch") ?? "5000");
const CONCURRENCY = Number(getArg("--concurrency") ?? "4");
const SKIP_RESOLVED = args.includes("--skip-resolved");
const LIMIT = Number(getArg("--limit") ?? "0") || Infinity;

const DATABASE_URL = process.env.DATABASE_URL;
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
if (!DATABASE_URL) {
  console.error("[collection-resolver] DATABASE_URL required");
  process.exit(1);
}
if (!CLICKHOUSE_URL) {
  console.error("[collection-resolver] CLICKHOUSE_URL required");
  process.exit(1);
}

const pgClient = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(pgClient);
const ch = createCHClient({
  url: CLICKHOUSE_URL,
  database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
  request_timeout: 60_000,
});

interface Pair {
  issuer: string;
  taxon: number;
}

interface ExistingRow {
  source: string | null;
}

async function listAllPairs(): Promise<Pair[]> {
  // Union of two sources:
  //   1. CH `nft_static_metadata` — one row per minted NFT, primary
  //      ingest path. Most collections live here.
  //   2. PG `nft_metadata` — collections that ingested via the page
  //      resolver (account_nfts → batch endpoint) but never came through
  //      the primary mint feed. Some legitimate XRPL collections (older
  //      mints, mints during ingester gaps) only appear here. Walking
  //      CH alone leaves them unresolved forever.
  const [chRows, pgRows] = await Promise.all([
    ch
      .query({
        query: `SELECT DISTINCT issuer, taxon FROM nft_static_metadata WHERE issuer != '' ORDER BY issuer, taxon`,
        format: "JSONEachRow",
      })
      .then((r) => r.json()) as Promise<Array<{ issuer: string; taxon: number }>>,
    pgClient.unsafe(
      `SELECT DISTINCT issuer, taxon FROM nft_metadata WHERE issuer != '' ORDER BY issuer, taxon`,
    ) as unknown as Promise<Array<{ issuer: string; taxon: number }>>,
  ]);

  // Dedup across both sources via stringified key.
  const seen = new Map<string, Pair>();
  for (const r of chRows) {
    const key = `${r.issuer}:${r.taxon}`;
    if (!seen.has(key)) {
      seen.set(key, { issuer: r.issuer, taxon: Number(r.taxon) });
    }
  }
  for (const r of pgRows) {
    const key = `${r.issuer}:${r.taxon}`;
    if (!seen.has(key)) {
      seen.set(key, { issuer: r.issuer, taxon: Number(r.taxon) });
    }
  }
  return [...seen.values()];
}

/** Chunk into batches under PG's stack-depth limit for large IN-lists.
 *  500 pairs × ~50 chars each → roughly 25 KB SQL — well under limits. */
const READ_EXISTING_CHUNK = 500;

async function readExisting(pairs: Pair[]): Promise<Map<string, ExistingRow>> {
  const out = new Map<string, ExistingRow>();
  for (let i = 0; i < pairs.length; i += READ_EXISTING_CHUNK) {
    const slice = pairs.slice(i, i + READ_EXISTING_CHUNK);
    const valuesSql = slice
      .map((p) => `('${p.issuer.replace(/'/g, "''")}', ${p.taxon})`)
      .join(",");
    const rows = (await pgClient.unsafe(
      `SELECT issuer, taxon, source FROM nft_collections WHERE (issuer, taxon) IN (${valuesSql})`,
    )) as unknown as Array<{ issuer: string; taxon: number; source: string | null }>;
    for (const r of rows) {
      out.set(`${r.issuer}:${r.taxon}`, { source: r.source });
    }
  }
  return out;
}

interface RunStats {
  considered: number;
  skipped: number;
  resolvedJson: number;
  resolvedToml: number;
  resolvedConsensus: number;
  unresolved: number;
  /** Stale consensus rows we deleted during the self-heal pass —
   *  rows the resolver no longer trusts because the new
   *  single-sample logic returns null instead of a one-off NFT name. */
  selfHealed: number;
  errors: number;
}

async function processPair(
  p: Pair,
  existing: Map<string, ExistingRow>,
  stats: RunStats,
): Promise<void> {
  try {
    const result = await resolveCollection(db, p.issuer, p.taxon);
    if (!result) {
      stats.unresolved += 1;
      // Self-heal: if we previously wrote a consensus row for this
      // pair and the resolver no longer derives a name, delete the
      // stale row. Bounded to consensus rows — JSON / TOML are
      // canonical and a transient miss shouldn't take them out.
      const cached = existing.get(`${p.issuer}:${p.taxon}`);
      if (cached?.source === "consensus") {
        await deleteStaleConsensus(db, p.issuer, p.taxon);
        stats.selfHealed += 1;
      }
      return;
    }
    await writeResolvedCollection(db, p.issuer, p.taxon, result);
    if (result.source === "json") stats.resolvedJson += 1;
    else if (result.source === "toml") stats.resolvedToml += 1;
    else if (result.source === "consensus") stats.resolvedConsensus += 1;
  } catch (err) {
    stats.errors += 1;
    console.error(
      `[collection-resolver] error on ${p.issuer}/${p.taxon}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function runWorkerPool(
  pairs: Pair[],
  existing: Map<string, ExistingRow>,
  stats: RunStats,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < pairs.length) {
      const i = cursor++;
      if (i >= pairs.length) break;
      await processPair(pairs[i], existing, stats);
      stats.considered += 1;
      if (stats.considered % 100 === 0) {
        console.log(
          `[collection-resolver] progress=${stats.considered}/${pairs.length}` +
            ` json=${stats.resolvedJson} toml=${stats.resolvedToml}` +
            ` consensus=${stats.resolvedConsensus} unresolved=${stats.unresolved}` +
            ` self-healed=${stats.selfHealed} errors=${stats.errors}`,
        );
      }
    }
  });
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log(
    `[collection-resolver] starting batch=${BATCH} concurrency=${CONCURRENCY}` +
      ` skip-resolved=${SKIP_RESOLVED} limit=${LIMIT === Infinity ? "∞" : LIMIT}`,
  );

  const pairs = await listAllPairs();
  console.log(`[collection-resolver] universe: ${pairs.length} (issuer, taxon) pairs`);

  // Filter by SKIP_RESOLVED and the source-priority rule. We re-check
  // existing rows when a higher-priority source might be available;
  // already-TOML rows skip unless explicitly forced.
  const existing = await readExisting(pairs);
  const toProcess: Pair[] = [];
  let skipped = 0;
  for (const p of pairs) {
    const cached = existing.get(`${p.issuer}:${p.taxon}`);
    if (SKIP_RESOLVED && cached?.source) {
      skipped += 1;
      continue;
    }
    // Always retry "consensus" source — TOML or JSON might now resolve.
    // Skip "toml" (highest priority); JSON is also a strong source so
    // only retry it if the user explicitly didn't pass --skip-resolved
    // (already handled above).
    if (cached?.source === "toml") {
      skipped += 1;
      continue;
    }
    toProcess.push(p);
    if (toProcess.length >= LIMIT) break;
  }

  console.log(
    `[collection-resolver] processing ${toProcess.length}, skipping ${skipped}`,
  );

  const stats: RunStats = {
    considered: 0,
    skipped,
    resolvedJson: 0,
    resolvedToml: 0,
    resolvedConsensus: 0,
    unresolved: 0,
    selfHealed: 0,
    errors: 0,
  };

  await runWorkerPool(toProcess, existing, stats);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[collection-resolver] complete in ${elapsed}s — ` +
      `considered=${stats.considered} skipped=${stats.skipped} ` +
      `json=${stats.resolvedJson} toml=${stats.resolvedToml} ` +
      `consensus=${stats.resolvedConsensus} unresolved=${stats.unresolved} ` +
      `self-healed=${stats.selfHealed} errors=${stats.errors}`,
  );

  await ch.close();
  await pgClient.end();
}

main()
  .then(() => {
    // Force-exit on success — without this the XRPL WS singleton (used
    // by the TOML resolver layer for issuer DOMAIN lookups) keeps the
    // event loop alive even after main() returns. systemd reads that
    // as "still starting" and eventually trips its 2h TimeoutStartSec,
    // which is why the 2026-05-09 23:57 run got SIGTERM'd at 03:16
    // despite logging "complete in 539.2s" at 01:25. We're fully done
    // when main() resolves; bail.
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[collection-resolver] fatal:", err);
    try {
      await ch.close();
      await pgClient.end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
