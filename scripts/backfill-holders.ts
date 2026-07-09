/**
 * backfill-holders.ts — Take top-10 holder snapshots for all active tokens.
 *
 * XRPL only stores current state, so this can't reconstruct the past.
 * Instead, run it repeatedly to build up chart data points quickly.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-holders.ts
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-holders.ts --repeat 1h
 *
 * Options:
 *   --repeat <interval>   Loop with the given interval (e.g., 30m, 1h, 2h).
 *                          Without this flag, runs once and exits.
 *   --limit <n>            Max tokens to snapshot per run (default: all).
 *
 * Re-running is safe (ON CONFLICT DO NOTHING on the composite PK).
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";
import WebSocket from "ws";
import { createClient as createCH } from "@clickhouse/client";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Migrated PG → CH on 2026-04-28. PG is still used to enumerate active
// tokens (token_volume_hourly view), but snapshots get written to CH.
const chUrl = process.env.CLICKHOUSE_URL;
if (!chUrl) {
  console.error("CLICKHOUSE_URL is required (snapshots write to CH as of 2026-04-28)");
  process.exit(1);
}

const pgClient = postgres(dbUrl);
const chClient = createCH({
  url: chUrl,
  database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
  request_timeout: 60_000,
});

/** Delay between tokens to stay under XRPL rate limits */
const INTER_TOKEN_DELAY = 2500;

/** Max account_lines pages per token */
const MAX_PAGES = 50;

/** Delay between account_lines pages */
const PAGE_DELAY = 200;

/* ------------------------------------------------------------------ */
/*  XRPL WebSocket (self-contained, not importing app code)            */
/* ------------------------------------------------------------------ */

const XRPL_NODES = [
  "wss://s2.ripple.com",
  "wss://honeycluster.io",
  "wss://xrplcluster.com",
  "wss://s1.ripple.com",
];

let ws: WebSocket | null = null;
let requestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function connectXrpl(): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = XRPL_NODES[0];
    console.log(`[xrpl] Connecting to ${url}`);
    ws = new WebSocket(url);

    ws.on("open", () => {
      console.log("[xrpl] Connected");
      resolve();
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          if (msg.status === "success" || msg.result) {
            pending.resolve(msg.result);
          } else {
            pending.reject(
              new Error(msg.error_message || msg.error || "XRPL error"),
            );
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    ws.on("error", (err) => {
      console.error("[xrpl] WebSocket error:", err.message);
      reject(err);
    });

    ws.on("close", () => {
      console.log("[xrpl] Disconnected");
      // Reject any pending requests
      for (const [, p] of pendingRequests) {
        p.reject(new Error("WebSocket closed"));
      }
      pendingRequests.clear();
      ws = null;
    });
  });
}

function xrplRequest(command: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error("WebSocket not connected"));
    }
    const id = requestId++;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error("XRPL request timeout"));
    }, 15_000);

    pendingRequests.set(id, {
      resolve: (v) => {
        clearTimeout(timeout);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timeout);
        reject(e);
      },
    });

    ws.send(JSON.stringify({ ...command, id }));
  });
}

/* ------------------------------------------------------------------ */
/*  Fetch top holders for a single token                               */
/* ------------------------------------------------------------------ */

interface HolderRow {
  address: string;
  balance: number;
}

async function fetchTopHolders(
  currency: string,
  issuer: string,
): Promise<{ holders: HolderRow[]; totalSupply: number }> {
  // 1. Total supply via gateway_balances
  let totalSupply = 0;
  try {
    const gb = (await xrplRequest({
      command: "gateway_balances",
      account: issuer,
      ledger_index: "validated",
    })) as { obligations?: Record<string, string> };
    const obligation = gb?.obligations?.[currency];
    if (obligation) totalSupply = parseFloat(obligation);
  } catch {
    // Will compute from balances
  }

  // 2. Paginate account_lines
  const allHolders: HolderRow[] = [];
  let marker: unknown = undefined;
  let pages = 0;

  do {
    const params: Record<string, unknown> = {
      command: "account_lines",
      account: issuer,
      ledger_index: "validated",
      limit: 400,
    };
    if (marker) params.marker = marker;

    const result = (await xrplRequest(params)) as {
      lines?: Array<{ account: string; balance: string; currency: string }>;
      marker?: unknown;
    };

    if (result.lines) {
      for (const line of result.lines) {
        if (line.currency !== currency) continue;
        const balance = -parseFloat(line.balance);
        if (balance > 0) {
          allHolders.push({ address: line.account, balance });
        }
      }
    }

    marker = result.marker;
    pages++;

    if (marker && pages < MAX_PAGES) {
      await sleep(PAGE_DELAY);
    }
  } while (marker && pages < MAX_PAGES);

  // 3. Fallback total supply
  if (totalSupply <= 0 && allHolders.length > 0) {
    totalSupply = allHolders.reduce((sum, h) => sum + h.balance, 0);
  }

  // 4. Top 10
  allHolders.sort((a, b) => b.balance - a.balance);
  return { holders: allHolders.slice(0, 10), totalSupply };
}

/* ------------------------------------------------------------------ */
/*  Single run: snapshot all active tokens                             */
/* ------------------------------------------------------------------ */

async function runOnce(limit?: number): Promise<number> {
  // Find actively traded tokens
  const activeTokens = await pgClient`
    SELECT DISTINCT currency, issuer
    FROM token_volume_hourly
    WHERE hour > NOW() - INTERVAL '7 days'
      AND issuer != ''
    ORDER BY currency
  `;

  const tokens = limit ? activeTokens.slice(0, limit) : activeTokens;
  console.log(
    `[backfill] Found ${activeTokens.length} active tokens${limit ? `, processing ${tokens.length}` : ""}`,
  );

  if (tokens.length === 0) return 0;

  const now = new Date();
  let snapshotted = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const label = `${token.currency}:${token.issuer.slice(0, 8)}...`;

    try {
      const result = await fetchTopHolders(token.currency, token.issuer);

      if (result.holders.length > 0) {
        const snapshotTime = now.toISOString().slice(0, 23).replace("T", " ");
        const rows = result.holders.map((h, idx) => ({
          snapshot_time: snapshotTime,
          currency: token.currency,
          issuer: token.issuer,
          holder_address: h.address,
          balance: h.balance,
          total_supply: result.totalSupply,
          rank: idx + 1,
        }));

        await chClient.insert({
          table: "token_holder_snapshots",
          values: rows,
          format: "JSONEachRow",
        });

        snapshotted++;
        console.log(
          `  [${i + 1}/${tokens.length}] ${label} — ${result.holders.length} holders, supply ${formatNum(result.totalSupply)}`,
        );
      } else {
        console.log(`  [${i + 1}/${tokens.length}] ${label} — no holders`);
      }
    } catch (err) {
      console.warn(
        `  [${i + 1}/${tokens.length}] ${label} — FAILED: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (i < tokens.length - 1) {
      await sleep(INTER_TOKEN_DELAY);
    }
  }

  return snapshotted;
}

/* ------------------------------------------------------------------ */
/*  CLI                                                                */
/* ------------------------------------------------------------------ */

function parseInterval(s: string): number {
  const match = s.match(/^(\d+)(m|h)$/);
  if (!match) {
    console.error(`Invalid interval: "${s}". Use e.g. 30m, 1h, 2h`);
    process.exit(1);
  }
  const n = parseInt(match[1]);
  return match[2] === "h" ? n * 60 * 60 * 1000 : n * 60 * 1000;
}

function formatNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  let repeatMs: number | null = null;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repeat" && args[i + 1]) {
      repeatMs = parseInterval(args[i + 1]);
      i++;
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    }
  }

  await connectXrpl();

  const start = Date.now();
  const count = await runOnce(limit);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[backfill] Done — ${count} tokens snapshotted in ${elapsed}s`);

  if (repeatMs) {
    const label =
      repeatMs >= 3600000
        ? `${repeatMs / 3600000}h`
        : `${repeatMs / 60000}m`;
    console.log(`[backfill] Repeating every ${label}. Ctrl+C to stop.\n`);

    const loop = async () => {
      await sleep(repeatMs!);
      // Reconnect if needed
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        await connectXrpl();
      }
      const s = Date.now();
      const n = await runOnce(limit);
      console.log(
        `\n[backfill] Run complete — ${n} tokens in ${((Date.now() - s) / 1000).toFixed(1)}s\n`,
      );
      loop();
    };
    loop();
  } else {
    ws?.close();
    await pgClient.end();
    await chClient.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
