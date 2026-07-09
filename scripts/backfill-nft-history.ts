/**
 * One-off backfill of NFT mint records from before the ingester's
 * coverage window (ledger ~95.8M).
 *
 * Approach (v2 — Clio extension command, replacing the prior
 * account_tx walking strategy):
 *
 *   For each gap issuer, paginate Clio's `nfts_by_issuer` extension
 *   command. It returns every NFT minted by the issuer with:
 *     - nft_id
 *     - uri
 *     - is_burned
 *     - owner (CURRENT owner, not mint-time)
 *     - ledger_index (mint ledger)
 *     - nft_taxon, nft_serial, flags, transfer_fee
 *
 *   That single payload covers everything we'd otherwise have to
 *   derive by walking the issuer's full account_tx history + the
 *   nft_trades latest-buyer reconcile pass. Massively faster and
 *   correct (Clio is authoritative for current state).
 *
 *   Insert directly into:
 *     - `nft_static_metadata` (issuer-level facts about each NFT)
 *     - `nft_ownership`       (current holder + burned flag)
 *
 *   Both tables are ReplacingMergeTree, so re-runs are idempotent.
 *
 * Coverage limitations (post-v2):
 *   - For NFTs we mark as live with this owner, the
 *     `acquired_ledger` defaults to the mint ledger — we don't know
 *     when subsequent transfers happened. The "recently_acquired"
 *     sort on the collection page will under-rank NFTs that
 *     transferred post-mint until the next ownership change goes
 *     through the live ingester. Acceptable.
 *   - Mint timestamp is approximated from the mint ledger via a
 *     linear fit. Off by minutes, not days. Used for sort ordering
 *     and for the "minted N ago" labels — not for accounting.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-nft-history.ts --db sonde_smoketest --limit-issuers 5
 *   pnpm tsx scripts/backfill-nft-history.ts --db sonde --dry-run
 *   pnpm tsx scripts/backfill-nft-history.ts --db sonde
 *
 * Operational notes:
 *   - Skip-already-covered: `findGapIssuers` LEFT JOINs static_metadata
 *     and skips issuers where static_count >= trade_count.
 *   - Per-issuer wallclock cap (5 minutes) prevents single hung
 *     requests from blocking the whole script.
 *   - Pacing: 50ms sleep between issuer completions to be gentle on
 *     Clio.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@clickhouse/client";
import logger from "../src/lib/logger";

/* ── HTTP JSON-RPC client (no WebSocket singleton) ───────────────
 * The first cut of this script used the project's xrplClient
 * (WebSocket-based) and got stuck — first request to nfts_by_issuer
 * for a big issuer never returned over WS, even though the same call
 * via JSON-RPC curl returned in 425ms. WS may be in a bad state from
 * other long-lived consumers, or Clio's WS handler for this extension
 * is flaky. Plain HTTP POST sidesteps that entirely.
 */

const RIPPLED_HTTP_URL = process.env.RIPPLED_HTTP_URL ?? "https://honeycluster.io/";

async function rippledRpc<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RIPPLED_HTTP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params: [params] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`rippled HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) throw new Error(`rippled RPC: ${json.error}`);
  return (json.result ?? {}) as T;
}

const log = logger.child({ module: "backfill-nft-history" });

/* ── CLI ─────────────────────────────────────────────────────────── */

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "sonde_smoketest" },
    "limit-issuers": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    concurrency: { type: "string", default: "3" },
  },
});

const TARGET_DB = values.db ?? "sonde_smoketest";
const LIMIT_ISSUERS = values["limit-issuers"]
  ? Number(values["limit-issuers"])
  : null;
const DRY_RUN = values["dry-run"] ?? false;
const MAX_CONCURRENT_ISSUERS = Math.max(1, Number(values.concurrency) || 3);
const NFTS_PER_PAGE = 100;
const PER_ISSUER_TIMEOUT_MS = 5 * 60 * 1000;

if (TARGET_DB !== "sonde" && TARGET_DB !== "sonde_smoketest") {
  log.error({ db: TARGET_DB }, "--db must be 'sonde' or 'sonde_smoketest'");
  process.exit(1);
}

/* ── CH client (script-local — bypasses src/lib/clickhouse-client.ts
   which carries `server-only` guards) ──────────────────────────── */

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const ch = createClient({
  url: CLICKHOUSE_URL,
  database: TARGET_DB,
  request_timeout: 60_000,
  http_headers:
    process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
      ? {
          "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
          "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
        }
      : undefined,
});

async function chQuery<T>(
  query: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const result = await ch.query({
    query,
    query_params: params,
    format: "JSONEachRow",
  });
  return (await result.json()) as T[];
}

async function chInsert<T extends Record<string, unknown>>(
  table: string,
  values: T[],
): Promise<void> {
  if (values.length === 0) return;
  await ch.insert({ table, values, format: "JSONEachRow" });
}

log.info(
  {
    db: TARGET_DB,
    limit: LIMIT_ISSUERS,
    dryRun: DRY_RUN,
    concurrency: MAX_CONCURRENT_ISSUERS,
  },
  "Backfill v2 (nfts_by_issuer) started",
);

/* ── Approximate-timestamp-from-ledger ─────────────────────────── */
// Linear fit: ledger 90,000,000 ≈ 2024-03-01 UTC,
//             ledger 104,000,000 ≈ 2026-05-01 UTC.
// Slope ≈ 4.86s per ledger on average over that window. Close
// enough for sort ordering / "minted N ago" labels — not used for
// anything accounting-grade.
const REF_LEDGER = 90_000_000;
const REF_UNIX = 1_709_251_200; // 2024-03-01 00:00 UTC
const SEC_PER_LEDGER = 4.86;

function approxUnixFromLedger(ledgerIndex: number): number {
  if (!ledgerIndex || ledgerIndex < 1_000_000) return 0;
  return Math.round(REF_UNIX + (ledgerIndex - REF_LEDGER) * SEC_PER_LEDGER);
}

function tsLiteral(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds < 0) return "1970-01-01 00:00:00";
  return new Date(unixSeconds * 1000)
    .toISOString()
    .replace("T", " ")
    .substring(0, 19);
}

/* ── nfts_by_issuer API call ─────────────────────────────────────── */

interface ClioNFT {
  nft_id: string;
  ledger_index: number;
  owner: string;
  is_burned: boolean;
  uri?: string;
  flags?: number;
  transfer_fee?: number;
  issuer: string;
  nft_taxon: number;
  nft_serial: number;
}

interface NftsByIssuerResponse {
  issuer: string;
  nfts?: ClioNFT[];
  marker?: string;
  validated?: boolean;
  status?: string;
}

async function fetchNftsByIssuer(
  issuer: string,
  marker?: string,
): Promise<NftsByIssuerResponse> {
  const params: Record<string, unknown> = {
    issuer,
    limit: NFTS_PER_PAGE,
  };
  if (marker) params.marker = marker;
  return await rippledRpc<NftsByIssuerResponse>("nfts_by_issuer", params);
}

/* ── Discovery: find gap issuers ─────────────────────────────────── */

async function findGapIssuers(): Promise<string[]> {
  const rows = await chQuery<{ issuer: string; trade_count: number | string }>(
    `SELECT t.issuer AS issuer,
            t.trade_count AS trade_count
     FROM (
       SELECT issuer, toUInt64(count()) AS trade_count
       FROM nft_trades
       WHERE issuer != ''
       GROUP BY issuer
     ) AS t
     LEFT JOIN (
       SELECT issuer, toUInt64(count()) AS static_count
       FROM nft_static_metadata FINAL
       GROUP BY issuer
     ) AS s
       ON s.issuer = t.issuer
     WHERE COALESCE(s.static_count, 0) < t.trade_count
     ORDER BY t.trade_count DESC`,
  );

  let issuers = rows.map((r) => r.issuer);
  if (LIMIT_ISSUERS != null) {
    issuers = issuers.slice(0, LIMIT_ISSUERS);
  }
  return issuers;
}

/* ── Per-issuer pagination ───────────────────────────────────────── */

async function backfillIssuer(issuer: string): Promise<number> {
  let marker: string | undefined;
  let total = 0;
  const nowTs = Math.floor(Date.now() / 1000);

  while (true) {
    const resp = await fetchNftsByIssuer(issuer, marker);
    const nfts = resp.nfts ?? [];
    if (nfts.length === 0) break;

    const staticRows = nfts.map((n) => ({
      nft_id: n.nft_id,
      uri: n.uri ?? "",
      issuer: n.issuer,
      taxon: n.nft_taxon,
      minted_ledger: n.ledger_index,
      minted_timestamp: tsLiteral(approxUnixFromLedger(n.ledger_index)),
      last_updated: tsLiteral(nowTs),
    }));

    const ownershipRows = nfts.map((n) => ({
      nft_id: n.nft_id,
      // Owner from nfts_by_issuer is the CURRENT owner per validated
      // Clio state — exactly what we want for nft_ownership.
      owner: n.owner,
      // We don't know the actual acquired ledger for transfers
      // post-mint. Mint ledger is a defensible default — the live
      // ingester will overwrite this when the next ownership change
      // happens (NFTokenAcceptOffer).
      acquired_ledger: n.ledger_index,
      acquired_tx_hash: "0".repeat(64),
      acquired_timestamp: tsLiteral(approxUnixFromLedger(n.ledger_index)),
      is_burned: n.is_burned ? 1 : 0,
      last_updated: tsLiteral(nowTs),
    }));

    if (!DRY_RUN) {
      await chInsert("nft_static_metadata", staticRows);
      await chInsert("nft_ownership", ownershipRows);
    }

    total += nfts.length;
    if (!resp.marker) break;
    marker = resp.marker;
  }

  return total;
}

/* ── Main ────────────────────────────────────────────────────────── */

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
      } catch (err) {
        log.warn({ err, item: items[i] }, "worker failed");
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return out;
}

async function main() {
  const startedAt = Date.now();

  const issuers = await findGapIssuers();
  log.info({ count: issuers.length }, "Discovered gap issuers");

  let totalDiscovered = 0;
  let processed = 0;

  await pMap(
    issuers,
    async (issuer) => {
      const issuerStart = Date.now();
      let count = 0;
      try {
        count = await Promise.race<number>([
          backfillIssuer(issuer),
          new Promise<number>((_, reject) =>
            setTimeout(
              () => reject(new Error(`issuer exceeded ${PER_ISSUER_TIMEOUT_MS}ms`)),
              PER_ISSUER_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (err) {
        log.warn({ err, issuer }, "issuer backfill failed; skipping");
      }
      totalDiscovered += count;
      processed++;
      log.info(
        {
          processed,
          total: issuers.length,
          issuer,
          nfts: count,
          elapsedSec: ((Date.now() - issuerStart) / 1000).toFixed(1),
          totalSec: ((Date.now() - startedAt) / 1000).toFixed(0),
        },
        "Issuer done",
      );
      if (processed % 50 === 0) {
        log.info(
          {
            processed,
            total: issuers.length,
            discoveredSoFar: totalDiscovered,
            elapsedSec: ((Date.now() - startedAt) / 1000).toFixed(0),
          },
          "Progress",
        );
      }
      await sleep(50);
    },
    MAX_CONCURRENT_ISSUERS,
  );

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(0);
  log.info({ totalDiscovered, elapsedSec }, "Backfill complete");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error({ err }, "Fatal error");
    process.exit(1);
  });
