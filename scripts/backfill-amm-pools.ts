/**
 * One-off: enumerate every AMM pool on the XRP Ledger and seed our
 * amm_pools discovery table.
 *
 * Our ingestion only learns about AMMs when an AMMCreate transaction is
 * observed — so any pool created before ingestion started is invisible
 * to us. This walks `ledger_data` with type=amm to discover them all in
 * one pass.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING. Safe to re-run.
 * Also populates the cached tvl_xrp column from the ledger object directly
 * so the Top Liquidity Pools card has data on first load.
 *
 * Usage: npx tsx scripts/backfill-amm-pools.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import WS from "ws";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[backfill-amm] DATABASE_URL required");
  process.exit(1);
}

/** Use a dedicated WS — don't compete with the live ingestion client. */
const XRPL_URL = "wss://xrplcluster.com";

interface AMMLedgerObject {
  LedgerEntryType: "AMM";
  Account: string;
  Asset: string | { currency: string; issuer: string };
  Asset2: string | { currency: string; issuer: string };
  TradingFee: number;
  index: string;
}

interface LedgerDataResponse {
  result?: {
    state?: Array<AMMLedgerObject | { LedgerEntryType: string }>;
    marker?: unknown;
    ledger_index?: number;
  };
  error?: string;
  error_message?: string;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

/** Minimal promise-based JSON-RPC over WebSocket. */
class XrplWs {
  private ws: WS;
  private nextId = 1;
  private pending = new Map<number, (msg: JsonValue) => void>();
  private ready: Promise<void>;

  constructor(url: string) {
    this.ws = new WS(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err) => reject(err));
    });
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: number } & JsonValue;
      if (typeof msg === "object" && msg !== null && "id" in msg) {
        const cb = this.pending.get(msg.id as number);
        if (cb) {
          this.pending.delete(msg.id as number);
          cb(msg as JsonValue);
        }
      }
    });
  }

  async send(command: Record<string, JsonValue>): Promise<JsonValue> {
    await this.ready;
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, ...command }));
    });
  }

  close() {
    this.ws.close();
  }
}

function parseAsset(
  asset: string | { currency: string; issuer: string },
): { currency: string; issuer: string | null } {
  if (typeof asset === "string") return { currency: "XRP", issuer: null };
  return { currency: asset.currency, issuer: asset.issuer };
}

/**
 * For each AMM we also pull live amm_info to compute initial TVL so the
 * card doesn't have to wait for the refresher to catch up. Concurrency-
 * capped so we don't blow up rippled.
 */
async function fetchInitialTvl(
  ws: XrplWs,
  ammAccount: string,
): Promise<number | null> {
  const res = (await ws.send({
    command: "amm_info",
    amm_account: ammAccount,
    ledger_index: "validated",
  })) as {
    result?: {
      amm?: {
        amount: string | { value: string };
        amount2: string | { value: string };
      };
    };
  };
  const amm = res.result?.amm;
  if (!amm) return null;

  const xrpDrops =
    typeof amm.amount === "string"
      ? Number(amm.amount)
      : typeof amm.amount2 === "string"
        ? Number(amm.amount2)
        : 0;

  // Pool is XRP-paired → TVL = XRP side × 2. For token/token pools, we
  // don't have a clean XRP anchor here, so leave null and let the
  // refresher sort it out later.
  if (xrpDrops <= 0) return null;
  return (xrpDrops / 1_000_000) * 2;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Call ledger_data with exponential-backoff retry on transient rippled errors. */
async function ledgerDataWithRetry(
  ws: XrplWs,
  marker: JsonValue,
): Promise<LedgerDataResponse> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = (await ws.send({
      command: "ledger_data",
      ledger_index: "validated",
      type: "amm",
      limit: 256,
      ...(marker ? { marker } : {}),
    })) as LedgerDataResponse;

    if (!res.error) return res;

    const msg = res.error_message ?? res.error;
    if (attempt < maxAttempts) {
      const backoffMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `\n[backfill-amm] ledger_data error "${msg}" — retrying in ${backoffMs}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }
    throw new Error(`ledger_data error after ${maxAttempts} attempts: ${msg}`);
  }
  throw new Error("unreachable");
}

async function insertDiscovery(
  pg: ReturnType<typeof postgres>,
  amm: AMMLedgerObject,
): Promise<boolean> {
  const a1 = parseAsset(amm.Asset);
  const a2 = parseAsset(amm.Asset2);
  const result = await pg`
    INSERT INTO amm_pools (
      account,
      asset1_currency, asset1_issuer,
      asset2_currency, asset2_issuer,
      trading_fee
    )
    VALUES (
      ${amm.Account},
      ${a1.currency}, ${a1.issuer},
      ${a2.currency}, ${a2.issuer},
      ${amm.TradingFee ?? 0}
    )
    ON CONFLICT (account) DO NOTHING
    RETURNING account
  `;
  return result.length > 0;
}

async function main() {
  console.log(`[backfill-amm] connecting to ${XRPL_URL}...`);
  const ws = new XrplWs(XRPL_URL);
  const pg = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} });

  try {
    // ── Phase 1: discover + insert incrementally ─────────────────────
    // Insert each page's AMMs as we find them. If rippled drops the walk
    // mid-scan, we keep the rows already persisted instead of losing the
    // lot. Phase 2 then picks up wherever Phase 1 ended.
    const amms: AMMLedgerObject[] = [];
    let marker: JsonValue = null;
    let page = 0;
    let inserted = 0;
    const startTime = Date.now();

    while (true) {
      const res = await ledgerDataWithRetry(ws, marker);
      const state = res.result?.state ?? [];
      for (const entry of state) {
        if (entry.LedgerEntryType !== "AMM") continue;
        const amm = entry as AMMLedgerObject;
        amms.push(amm);
        try {
          const didInsert = await insertDiscovery(pg, amm);
          if (didInsert) inserted++;
        } catch (err) {
          console.warn(
            `\n[backfill-amm] insert failed for ${amm.Account}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      page++;
      process.stdout.write(
        `\r[backfill-amm] page ${page} — discovered ${amms.length}, inserted ${inserted}`,
      );

      const nextMarker = res.result?.marker;
      if (!nextMarker) break;
      marker = nextMarker as JsonValue;
    }

    const discoveryMs = Date.now() - startTime;
    console.log(
      `\n[backfill-amm] discovery complete: ${amms.length} pools scanned, ${inserted} new rows (${discoveryMs}ms)`,
    );

    // ── Phase 2: fetch initial TVL for every XRP-paired pool ─────────
    // Concurrency-capped so rippled doesn't kill us.
    const xrpPaired = amms.filter(
      (a) => typeof a.Asset === "string" || typeof a.Asset2 === "string",
    );
    console.log(
      `[backfill-amm] fetching initial TVL for ${xrpPaired.length} XRP-paired pools...`,
    );
    const tvlStart = Date.now();
    let tvlUpdates = 0;
    await mapWithConcurrency(xrpPaired, 10, async (amm) => {
      try {
        const tvl = await fetchInitialTvl(ws, amm.Account);
        if (tvl !== null) {
          await pg`
            UPDATE amm_pools
            SET tvl_xrp = ${tvl.toString()}, tvl_updated_at = NOW()
            WHERE account = ${amm.Account}
          `;
          tvlUpdates++;
        }
      } catch (err) {
        console.warn(
          `[backfill-amm] tvl fetch failed for ${amm.Account}:`,
          err instanceof Error ? err.message : err,
        );
      }
    });
    console.log(
      `[backfill-amm] wrote TVL for ${tvlUpdates} pools (${Date.now() - tvlStart}ms)`,
    );
    console.log(
      `[backfill-amm] total elapsed: ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    );
  } finally {
    ws.close();
    await pg.end();
  }
}

main().catch((err) => {
  console.error("[backfill-amm] fatal:", err);
  process.exit(1);
});
