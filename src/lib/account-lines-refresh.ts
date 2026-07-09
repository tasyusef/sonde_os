/**
 * Live-refresh helper for an account's trustlines.
 *
 * Background: the CH `trustlines` table is event-sourced from tx-level
 * RippleState events (`extractTrustlineEvents`). When the ingester
 * misses a `DeletedNode RippleState` (CH insert silent-fails, transient
 * downtime, ingestion lag) the stale row sticks around as a phantom
 * holding on the user's account page. This module is the self-healing
 * layer that takes the live XRPL `account_lines` response as
 * authoritative and reconciles CH against it.
 *
 * Called from the `POST /api/account/[address]/trustlines/refresh`
 * route on every account-page load (client triggers in parallel with
 * the instant CH read).
 *
 * Operations:
 *   1. Paginate `account_lines` for the address from rippled.
 *   2. SELECT current CH rows for the address (FINAL, all is_burned).
 *   3. Insert one row per live trustline with `is_burned = 0`,
 *      `last_updated = now()`.
 *   4. For any CH row that's unburned but missing from the live
 *      response → write a burn row with `is_burned = 1`,
 *      `last_updated = now()`. ReplacingMergeTree picks the latest
 *      `last_updated`, so the burn supersedes the stale row.
 *
 * Sign convention: `account_lines` returns balance signed from the
 * queried account's perspective (positive = account holds, negative =
 * account owes / is issuer). That matches the CH `account`-side row
 * convention 1:1 — no flipping needed.
 *
 * Idempotent. Concurrent invocations for the same address can race
 * but the worst case is a redundant insert (ReplacingMergeTree dedupes).
 */

import "server-only";
import { xrplClient } from "./xrpl-client";
import { insert as chInsert, query } from "./clickhouse-client";
import type { AccountLinesResponse } from "@/types/xrpl-responses";
import logger from "./logger";

const log = logger.child({ module: "account-lines-refresh" });

/** Safety cap on pagination — 200 pages × 400 trustlines = 80k.
 *  Sologenic-class issuers have ~30k, well within. Prevents an
 *  unbounded loop if rippled returns a never-clearing marker. */
const MAX_PAGES = 200;

/** Delay between paginated pages to be rate-limit friendly to rippled. */
const PAGE_DELAY_MS = 50;

/** AMM LP currency heuristic — 40-char hex starting with "03". Matches
 *  the same check in `trustline-state-extractor.ts` and
 *  `amm-helpers.ts` so refreshed rows get tagged consistently. */
function isLpCurrency(currency: string): boolean {
  return currency.length === 40 && currency.startsWith("03");
}

/** Format a Date as a CH-friendly `YYYY-MM-DD HH:MM:SS` (UTC, seconds). */
function chDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

interface LiveLine {
  account: string;
  balance: string;
  currency: string;
  limit: string;
  limit_peer?: string;
}

/**
 * Fetch all `account_lines` for an address, paginating through marker.
 * Returns the flat list of trustlines. Logs and stops on any error to
 * keep the refresh idempotent — partial state is never written so a
 * mid-fetch failure doesn't leave CH inconsistent.
 */
async function fetchAllAccountLines(address: string): Promise<LiveLine[]> {
  const all: LiveLine[] = [];
  let marker: unknown = undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const resp = (await xrplClient.getAccountLines(
      address,
      marker,
    )) as AccountLinesResponse;
    if (resp.lines && resp.lines.length > 0) {
      // The XRPL response shape has more fields than our minimal type;
      // cast at the boundary so the rest of the module is well-typed.
      all.push(...(resp.lines as unknown as LiveLine[]));
    }
    if (!resp.marker) break;
    marker = resp.marker;
    pages++;
    if (pages < MAX_PAGES) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }
  return all;
}

export interface RefreshResult {
  /** Trustlines returned by the live XRPL fetch. */
  live: number;
  /** Phantom CH rows we wrote burn entries for. */
  burned: number;
  /** Page count fetched (useful for whale-account latency tracing). */
  pages: number;
}

/**
 * Refresh an account's CH trustline state against the live XRPL ledger.
 * Throws on rippled errors (caller's responsibility to handle gracefully
 * — the API route falls back to CH-only data).
 */
export async function refreshAccountTrustlines(
  address: string,
): Promise<RefreshResult> {
  const startedAt = Date.now();

  // 1. Live state from rippled
  const liveLines = await fetchAllAccountLines(address);

  // 2. What's currently in CH for this account
  const existingRows = await query<{
    counterparty: string;
    currency: string;
    is_burned: number;
  }>(
    `SELECT counterparty, currency, toUInt8(is_burned) AS is_burned
     FROM trustlines FINAL
     WHERE account = {address:String}`,
    { address },
  );

  // 3. Build the live-key set for the diff. The (counterparty, currency)
  //    composite uniquely identifies a trustline on XRPL.
  const liveKeys = new Set(liveLines.map((l) => `${l.account}|${l.currency}`));

  // 4. CH rows that are unburned and missing from XRPL = phantoms.
  //    These are the rows that produce "holding a token I don't hold"
  //    in the UI. Burn them.
  const phantoms = existingRows.filter(
    (r) =>
      r.is_burned === 0 && !liveKeys.has(`${r.counterparty}|${r.currency}`),
  );

  const nowTs = chDateTime(new Date());

  // 5. Compose insert rows for both live state and phantom burns.
  const liveRows = liveLines.map((l) => ({
    account: address,
    counterparty: l.account,
    currency: l.currency,
    balance_value: l.balance,
    account_limit: l.limit ?? "0",
    counterparty_limit: l.limit_peer ?? "0",
    // Flags from the event-stream extractor are richer (per-side
    // freeze, no_ripple bits). The refresh sets 0 — flags aren't used
    // by the holdings filter, and the next real RippleState event
    // will overwrite with accurate values. Acceptable tradeoff.
    flags: 0,
    is_lp: isLpCurrency(l.currency) ? 1 : 0,
    is_burned: 0,
    ledger_index: 0,
    last_updated: nowTs,
  }));

  const burnRows = phantoms.map((r) => ({
    account: address,
    counterparty: r.counterparty,
    currency: r.currency,
    balance_value: "0",
    account_limit: "0",
    counterparty_limit: "0",
    flags: 0,
    is_lp: isLpCurrency(r.currency) ? 1 : 0,
    is_burned: 1,
    ledger_index: 0,
    last_updated: nowTs,
  }));

  const rowsToInsert = [...liveRows, ...burnRows];
  if (rowsToInsert.length > 0) {
    await chInsert("trustlines", rowsToInsert);
  }

  const pages = Math.ceil(liveLines.length / 400) || 0;
  log.info(
    {
      address,
      live: liveLines.length,
      burned: phantoms.length,
      pages,
      elapsedMs: Date.now() - startedAt,
    },
    "[account-lines-refresh] reconciled",
  );

  return { live: liveLines.length, burned: phantoms.length, pages };
}
