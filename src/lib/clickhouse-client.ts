import "server-only";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import logger from "./logger";

const log = logger.child({ module: "clickhouse" });

// Lazy singleton — safe to import without CLICKHOUSE_URL set.
// Connection created on first query. Uses globalThis to survive HMR reloads.

const globalForCH = globalThis as unknown as {
  _chClient?: ClickHouseClient;
};

function getClient(): ClickHouseClient {
  if (!globalForCH._chClient) {
    const url = process.env.CLICKHOUSE_URL;
    if (!url) {
      throw new Error("CLICKHOUSE_URL environment variable is required");
    }

    // CF Access Service Token headers — only attached when both env vars
    // are present. This lets us put the ClickHouse endpoint behind a
    // Cloudflare Access policy (same security model as the PG tunnel)
    // and authenticate from the app host via Service Token. When unset (e.g.
    // local dev hitting localhost via the SSH tunnel), CH is reached
    // directly with no extra headers and the CH password is the only
    // auth — appropriate for that path.
    const cfAccessId = process.env.CF_ACCESS_CLIENT_ID;
    const cfAccessSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    const http_headers: Record<string, string> = {};
    if (cfAccessId && cfAccessSecret) {
      http_headers["CF-Access-Client-Id"] = cfAccessId;
      http_headers["CF-Access-Client-Secret"] = cfAccessSecret;
    }

    globalForCH._chClient = createClient({
      url,
      database: process.env.CLICKHOUSE_DATABASE ?? "sonde",
      request_timeout: 30_000,
      http_headers: Object.keys(http_headers).length > 0 ? http_headers : undefined,
      // No global row cap. The 10K cap was previously set here as an
      // LLM-query safety net, but it leaked to ALL internal queries
      // (smart-money scorer, network analytics, alert engine, etc.) and
      // silently broke the scorer for 8 days when scoring queries crossed
      // 10K rows. The cap is now enforced ONLY in `readOnlyQuery()` below,
      // which is the LLM path. Internal queries via `query()` and `insert()`
      // run uncapped.
    });

    log.info(
      { host: new URL(url).host, cfAccess: Object.keys(http_headers).length > 0 },
      "ClickHouse client initialized",
    );
  }

  return globalForCH._chClient;
}

/** Run a read query and return parsed JSON rows. */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const client = getClient();
  const result = await client.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  return result.json<T>();
}

/** Run a read-only query (enforced at ClickHouse level). For LLM-generated queries.
 *
 * Applies CH safety guards:
 *   - readonly=1: blocks any DDL/DML even if the LLM tries
 *   - max_execution_time=10s: caps runaway scans
 *   - max_result_rows=10000 + result_overflow_mode=throw: caps row volume
 *     loudly (rather than silently truncating). LLM should add LIMIT clauses
 *     for legit large queries; the throw makes overruns surface as clear
 *     errors the model can self-correct on. */
export async function readOnlyQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const client = getClient();
  const result = await client.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "1",
      max_execution_time: 10,
      max_result_rows: "10000",
      result_overflow_mode: "throw",
    },
  });
  return result.json<T>();
}

/** Insert rows into a table. */
export async function insert<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
): Promise<void> {
  if (rows.length === 0) return;
  const client = getClient();
  await client.insert({
    table,
    values: rows,
    format: "JSONEachRow",
  });
}

/** Verify connectivity — runs a real query (ping bypasses auth). */
export async function verifyConnectivity(): Promise<boolean> {
  try {
    const client = getClient();
    const result = await client.query({ query: "SELECT 1", format: "JSONEachRow" });
    await result.json();
    return true;
  } catch (err) {
    log.error({ err }, "ClickHouse connectivity check failed");
    return false;
  }
}

/** Close the client (for graceful shutdown). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function closeClickHouse(): Promise<void> {
  if (globalForCH._chClient) {
    await globalForCH._chClient.close();
    globalForCH._chClient = undefined;
    log.info("ClickHouse client closed");
  }
}
